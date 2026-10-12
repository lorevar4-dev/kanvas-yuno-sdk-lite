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
    return 'x-api-key / x-secret mismatch'
  }
  if (hmacSecret) {
    const expected = createHmac('sha256', hmacSecret).update(req.body).digest('base64')
    if (!safeEqual(req.get('x-hmac-signature'), expected)) return 'invalid x-hmac-signature'
  }
  return null
}

webhooksRouter.post('/webhooks/yuno', express.raw({ type: '*/*', limit: '1mb' }), (req, res) => {
  const authError = authenticate(req)
  if (authError) {
    log.error(`webhook rejected: ${authError}`)
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

  const paymentId = event?.data?.payment?.id
  log.webhook(`⇐ ${event.type_event ?? event.type} payment=${paymentId ?? '?'} status=${event?.data?.payment?.status ?? '?'} retry=${event.retry ?? 0} (signature ✓)`)
  if (event.type !== 'payment' || !paymentId) return

  handlePaymentEvent(paymentId).catch((err) => log.error(`webhook processing failed: ${err.message}`))
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
