// Fallback for missed webhooks
import { log } from './logger.js'
import { withOrderLock } from './orders/lock.js'
import { applyYunoPayment } from './orders/stateMachine.js'
import { store } from './orders/store.js'
import { yuno } from './yunoClient.js'

const STALE_MS = 10_000

export async function reconcileOrder(orderId, { force = false } = {}) {
  const order = store.getOrder(orderId)
  if (!order || order.status !== 'PENDING' || !order.yuno.paymentId) return order
  const last = order.yuno.lastReconciledAt ? Date.parse(order.yuno.lastReconciledAt) : 0
  if (!force && Date.now() - last < STALE_MS) return order

  try {
    const payment = await yuno.getPayment(order.yuno.paymentId)
    return await withOrderLock(orderId, () => {
      const fresh = store.getOrder(orderId)
      fresh.yuno.lastReconciledAt = new Date().toISOString()
      applyYunoPayment(fresh, payment, 'reconcile')
      return store.saveOrder(fresh)
    })
  } catch (err) {
    log.warn(`reconcile ${orderId} failed: ${err.message}`)
    return order
  }
}

export function startReconciler(intervalMs = 60_000) {
  setInterval(() => {
    for (const order of store.pendingOrders()) reconcileOrder(order.id)
  }, intervalMs).unref()
}
