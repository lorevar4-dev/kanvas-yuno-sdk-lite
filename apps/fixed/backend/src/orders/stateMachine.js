// CREATED → PENDING → PAID | FAILED | EXPIRED. Status never moves backwards.
import { log } from '../logger.js'

const RANK = { CREATED: 0, PENDING: 1, PAID: 2, FAILED: 2, EXPIRED: 2 }

export function orderStatusFromYuno(yunoStatus) {
  switch (yunoStatus) {
    case 'READY_TO_PAY':
    case 'CREATED':
    case 'PENDING':
      return 'PENDING'
    case 'SUCCEEDED':
      return 'PAID'
    case 'EXPIRED':
      return 'EXPIRED'
    case 'DECLINED':
    case 'REJECTED':
    case 'CANCELED':
    case 'ERROR':
    case 'FRAUD_DECLINED':
      return 'FAILED'
    default:
      return null
  }
}

// source: 'api' | 'webhook' | 'reconcile'
export function applyYunoPayment(order, payment, source) {
  order.yuno.paymentStatus = payment.status
  order.yuno.paymentSubStatus = payment.sub_status ?? null

  const to = orderStatusFromYuno(payment.status)
  const from = order.status
  if (!to) {
    log.warn(`order ${order.id}: unmapped Yuno status ${payment.status} — left as ${from}`)
    return false
  }
  if (to === from) {
    log.info(`order ${order.id}: already ${from} (${source}, no-op)`)
    return false
  }
  if (RANK[to] <= RANK[from]) {
    if (to === 'PAID') {
      // Captured money on a closed order needs a human
      order.needsReview = `Yuno reports SUCCEEDED after order was ${from}`
      log.error(`order ${order.id}: payment SUCCEEDED but order is ${from} → flagged for manual review/refund`)
    } else {
      log.info(`order ${order.id}: ignored ${from} → ${to} from ${source} (status only moves forward)`)
    }
    return false
  }

  order.status = to
  order.history.push({ at: new Date().toISOString(), from, to, source, yunoStatus: payment.status })
  log.order(`order ${order.id}: ${from} → ${to}  (source=${source}, yuno=${payment.status})`)
  return true
}
