import { createHash, randomUUID } from 'node:crypto'
import { Router } from 'express'
import { MARKETS, priceCart } from '../catalog.js'
import { config } from '../config.js'
import { log } from '../logger.js'
import { withOrderLock } from '../orders/lock.js'
import { applyYunoPayment } from '../orders/stateMachine.js'
import { store } from '../orders/store.js'
import { reconcileOrder } from '../reconcile.js'
import { YunoApiError, yuno } from '../yunoClient.js'

export const ordersRouter = Router()

export function orderView(order) {
  return {
    id: order.id,
    status: order.status,
    country: order.country,
    currency: order.currency,
    amount: order.amount,
    lines: order.lines,
    payment: order.yuno.paymentId
      ? { id: order.yuno.paymentId, method: order.yuno.paymentMethod, yunoStatus: order.yuno.paymentStatus, yunoSubStatus: order.yuno.paymentSubStatus }
      : null,
    idempotencyKey: order.yuno.paymentIdempotencyKey,
    needsReview: order.needsReview ?? null,
    history: order.history,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  }
}

async function ensureCustomer(shopper, country) {
  const merchantCustomerId = `kanvas-${createHash('sha256').update(`${shopper.email.toLowerCase()}|${country}`).digest('hex').slice(0, 16)}`
  const cached = store.getCustomerId(merchantCustomerId)
  if (cached) return cached
  const customer = await yuno.createCustomer(
    {
      merchant_customer_id: merchantCustomerId,
      merchant_customer_created_at: new Date().toISOString(),
      first_name: shopper.firstName,
      last_name: shopper.lastName,
      email: shopper.email,
      country,
      ...(shopper.document ? { document: shopper.document } : {}),
    },
    `customer-${merchantCustomerId}`,
  )
  store.saveCustomerId(merchantCustomerId, customer.id)
  return customer.id
}

ordersRouter.post('/orders', async (req, res) => {
  const { country, items, shopper } = req.body ?? {}
  let priced
  try {
    priced = priceCart(country, items)
    if (!shopper?.email || !shopper?.firstName || !shopper?.lastName) throw new Error('Shopper name and email are required')
  } catch (err) {
    return res.status(400).json({ error: err.message })
  }

  const market = MARKETS[country]
  const orderId = `kv-${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`
  try {
    const customerId = await ensureCustomer(shopper, country)
    const session = await yuno.createCheckoutSession(
      {
        account_id: config.yuno.accountId,
        merchant_order_id: orderId,
        payment_description: `Kanvas order ${orderId}`,
        country,
        customer_id: customerId,
        ...(config.callbackBaseUrl && { callback_url: `${config.callbackBaseUrl}/orders/${orderId}` }),
        amount: { currency: priced.currency, value: priced.total },
      },
      `session-${orderId}`,
    )

    const now = new Date().toISOString()
    const order = store.saveOrder({
      id: orderId,
      status: 'CREATED',
      country,
      currency: priced.currency,
      amount: priced.total,
      lines: priced.lines,
      shopper,
      createdAt: now,
      history: [{ at: now, from: null, to: 'CREATED', source: 'api' }],
      yuno: {
        customerId,
        checkoutSession: session.checkout_session,
        // one key per order, reused by every retry
        paymentIdempotencyKey: randomUUID(),
        paymentId: null,
      },
    })
    log.api(`order ${orderId} created · ${priced.total} ${priced.currency} · session ${session.checkout_session}`)

    res.status(201).json({
      order: orderView(order),
      checkoutSession: session.checkout_session,
      countryCode: country,
      language: market.language,
      methods: market.methods,
    })
  } catch (err) {
    log.error(`create order failed: ${err.message}`)
    res.status(err instanceof YunoApiError ? 502 : 500).json({ error: 'Could not start checkout', detail: err.message })
  }
})

ordersRouter.post('/orders/:id/payments', async (req, res) => {
  const { oneTimeToken, vaultOnSuccess } = req.body ?? {}
  const result = await withOrderLock(req.params.id, async () => {
    const order = store.getOrder(req.params.id)
    if (!order) return { status: 404, body: { error: 'Order not found' } }

    if (order.yuno.paymentId) {
      log.warn(`order ${order.id}: duplicate pay attempt → returning existing payment ${order.yuno.paymentId} (no new charge)`)
      return { status: 200, body: { duplicate: true, order: orderView(order), sdkActionRequired: order.yuno.sdkActionRequired } }
    }
    if (!oneTimeToken) return { status: 400, body: { error: 'oneTimeToken is required' } }

    const { shopper } = order
    try {
      const payment = await yuno.createPayment(
        {
          account_id: config.yuno.accountId,
          description: `Kanvas order ${order.id}`,
          merchant_order_id: order.id,
          country: order.country,
          amount: { currency: order.currency, value: order.amount },
          checkout: { session: order.yuno.checkoutSession },
          customer_payer: {
            id: order.yuno.customerId,
            first_name: shopper.firstName,
            last_name: shopper.lastName,
            email: shopper.email,
            ...(shopper.document ? { document: shopper.document } : {}),
          },
          payment_method: { token: oneTimeToken, vault_on_success: !!vaultOnSuccess },
          workflow: 'SDK_CHECKOUT',
        },
        order.yuno.paymentIdempotencyKey,
      )

      order.yuno.paymentId = payment.id
      order.yuno.paymentMethod = payment.payment_method?.type ?? null
      order.yuno.sdkActionRequired = !!payment.checkout?.sdk_action_required
      applyYunoPayment(order, payment, 'api')
      store.saveOrder(order)
      return { status: 200, body: { duplicate: false, order: orderView(order), sdkActionRequired: order.yuno.sdkActionRequired } }
    } catch (err) {
      log.error(`order ${order.id}: create payment failed: ${err.message}`)
      order.lastError = err.message
      store.saveOrder(order)
      return { status: err instanceof YunoApiError ? 502 : 500, body: { error: 'Payment could not be created', detail: err.message } }
    }
  })
  res.status(result.status).json(result.body)
})

ordersRouter.get('/orders/:id', async (req, res) => {
  const order = await reconcileOrder(req.params.id)
  if (!order) return res.status(404).json({ error: 'Order not found' })
  res.json(orderView(order))
})
