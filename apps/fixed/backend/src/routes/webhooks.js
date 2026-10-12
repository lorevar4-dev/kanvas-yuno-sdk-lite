import { createHmac, timingSafeEqual } from 'node:crypto'
import express, { Router } from 'express'
import { config } from '../config.js'
import { log } from '../logger.js'
import { withOrderLock } from '../orders/lock.js'
import { applyYunoPayment } from '../orders/stateMachine.js'
import { store } from '../orders/store.js'
import { yuno } from '../yunoClient.js'

export const webhooksRouter = Router()

const safeEqual = (a = '', b = '') => {
  const x = Buffer.from(String(a))
  const y = Buffer.from(String(b))
  return x.length === y.length && timingSafeEqual(x, y)
}

function authenticate(req) {
  const { apiKey, secret, hmacSecret } = config.yuno.webhook
  if (apiKey && secret && !(safeEqual(req.get('x-api-key'), apiKey) && safeEqual(req.get('x-secret'), secret))) {
    return `x-api-key / x-secret mismatch (x-api-key ${req.get('x-api-key') ? 'present' : 'missing'}, x-secret ${req.get('x-secret') ? 'present' : 'missing'})`
  }
  if (hmacSecret) {
    const expected = createHmac('sha256', hmacSecret).update(req.body).digest('base64')
    if (!safeEqual(req.get('x-hmac-signature'), expected)) return 'invalid x-hmac-signature'
  }
  return null
}

const AUTH_HEADERS = new Set(['x-api-key', 'x-secret', 'x-hmac-signature', 'authorization'])

// Yuno doesn't document where the webhook id travels, so show every id-like header and body field
function webhookIds(req, event = {}) {
  const fromHeaders = Object.entries(req.headers)
    .filter(([name]) => !AUTH_HEADERS.has(name) && /id|webhook|event|delivery|notification/i.test(name))
    .map(([name, value]) => `${name}=${value}`)
  const fromBody = ['id', 'code', 'webhook_id', 'webhook_code', 'event_id', 'notification_id', 'delivery_id']
    .flatMap((key) => [[key, event?.[key]], [`data.${key}`, event?.data?.[key]]])
    .filter(([, value]) => value !== undefined && typeof value !== 'object')
    .map(([key, value]) => `${key}=${value}`)
  const ids = [...fromHeaders, ...fromBody]
  return ids.length ? ids.join(' ') : 'none found'
}

webhooksRouter.post('/webhooks/yuno', express.raw({ type: '*/*', limit: '1mb' }), (req, res) => {
  const authError = authenticate(req)
  if (authError) {
    log.error(`webhook rejected: ${authError} · webhook id: ${webhookIds(req)}`)
    return res.status(401).json({ error: 'unauthorized' })
  }

  let event
  try {
    event = JSON.parse(req.body.toString('utf8'))
  } catch {
    return res.status(400).json({ error: 'invalid JSON' })
  }

  // ack first so Yuno doesn't retry
  res.status(200).json({ received: true })

  // V2 wraps the payment in { type, type_event, data: { payment } }; the legacy format sends { payment } at the top level
  const payment = event?.data?.payment ?? event?.payment
  const paymentId = payment?.id
  log.webhook(`⇐ ${event.type_event ?? event.type ?? 'payment (legacy)'} payment=${paymentId ?? '?'} status=${payment?.status ?? '?'} retry=${event.retry ?? 0} (signature ✓)`)
  log.webhook(`  webhook id: ${webhookIds(req, event)}`)
  if ((event.type && event.type !== 'payment') || !paymentId) {
    log.warn(`webhook not handled — no payment id (top-level keys: ${Object.keys(event ?? {}).join(', ')})`)
    return
  }

  handlePaymentEvent(paymentId).catch((err) => log.error(`webhook processing failed: ${err.message}`))
})

// Anything else under /webhooks would be a 404 for Yuno: log it so a misconfigured URL or method is visible
webhooksRouter.use('/webhooks', (req, res) => {
  log.warn(`webhook 404: ${req.method} ${req.originalUrl} (only POST /webhooks/yuno is handled) · webhook id: ${webhookIds(req)}`)
  res.status(404).json({ error: 'not found' })
})

async function handlePaymentEvent(paymentId) {
  // don't trust the payload, re-read from Yuno
  const payment = await yuno.getPayment(paymentId)
  const orderId = payment.merchant_order_id
  if (!orderId || !store.getOrder(orderId)) {
    log.warn(`webhook for unknown order ${orderId} (payment ${paymentId}) — ignored`)
    return
  }

  await withOrderLock(orderId, () => {
    const order = store.getOrder(orderId)
    if (!order.yuno.paymentId) {
      order.yuno.paymentId = payment.id
      order.yuno.paymentMethod = payment.payment_method?.type ?? null
    } else if (order.yuno.paymentId !== payment.id) {
      order.needsReview = `Second Yuno payment ${payment.id} for this order`
      log.error(`order ${orderId}: unexpected second payment ${payment.id} (expected ${order.yuno.paymentId}) → flagged for refund review`)
      store.saveOrder(order)
      return
    }
    applyYunoPayment(order, payment, 'webhook')
    store.saveOrder(order)
  })
}
