import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { METHOD_LABELS, TERMINAL, money, time } from '../format.js'

const COPY = {
  CREATED: 'Waiting for payment',
  PENDING: 'Payment pending — waiting for confirmation from Yuno',
  PAID: 'Paid — order confirmed',
  FAILED: 'Payment failed',
  EXPIRED: 'Payment expired',
}

export default function OrderStatus({ orderId, initial, compact = false }) {
  const [order, setOrder] = useState(initial ?? null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let timer
    let stopped = false
    const tick = async () => {
      try {
        const next = await api.getOrder(orderId)
        if (stopped) return
        setOrder(next)
        setError(null)
        if (TERMINAL.includes(next.status)) return
      } catch (err) {
        if (!stopped) setError(err.message)
      }
      timer = setTimeout(tick, 2000)
    }
    tick()
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [orderId])

  if (!order) return <div className="card muted">{error ?? 'Loading order…'}</div>

  return (
    <div className="card status-card">
      <div className={`status-pill ${order.status.toLowerCase()}`}>{order.status}</div>
      <h2>{COPY[order.status]}</h2>
      {!TERMINAL.includes(order.status) && <p className="muted live">● live — refreshing every 2 s</p>}
      {order.needsReview && <div className="alert error">Needs review: {order.needsReview}</div>}

      <dl className="facts">
        <dt>Order <span className="small">(merchant_order_id)</span></dt><dd><code>{order.id}</code></dd>
        <dt>Total</dt><dd>{money(order.amount, order.currency)}</dd>
        {order.payment && (
          <>
            <dt>Method</dt><dd>{METHOD_LABELS[order.payment.method]?.label ?? order.payment.method}</dd>
            <dt>Yuno payment</dt><dd><code>{order.payment.id}</code></dd>
            <dt>Yuno status</dt><dd>{order.payment.yunoStatus}{order.payment.yunoSubStatus ? ` · ${order.payment.yunoSubStatus}` : ''}</dd>
          </>
        )}
        {!compact && <><dt>Idempotency key</dt><dd><code>{order.idempotencyKey}</code></dd></>}
      </dl>

      <h3>Timeline</h3>
      <ol className="timeline">
        {order.history.map((h, i) => (
          <li key={i}>
            <span className="t">{time(h.at)}</span>
            <span className={`status-dot ${h.to.toLowerCase()}`} />
            <b>{h.to}</b>
            <span className={`source ${h.source}`}>{h.source}</span>
            {h.yunoStatus && <span className="muted">yuno={h.yunoStatus}</span>}
          </li>
        ))}
      </ol>
    </div>
  )
}
