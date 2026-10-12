import { useState } from 'react'
import { api } from '../api.js'
import OrderStatus from '../components/OrderStatus.jsx'
import { METHOD_LABELS, money } from '../format.js'
import { useYunoCheckout } from '../yuno/useYunoCheckout.js'

const CART = [
  { sku: 'linen-throw', quantity: 1 },
  { sku: 'ceramic-vase', quantity: 2 },
]

const SHOPPERS = {
  BR: { firstName: 'Ana', lastName: 'Souza', email: 'ana.souza@example.com', document: { document_type: 'CPF', document_number: '47033278802' } },
  MX: { firstName: 'Luis', lastName: 'Hernández', email: 'luis.hernandez@example.com' },
}

export default function CheckoutPage({ config, demoDoubleClick }) {
  const [country, setCountry] = useState('BR')
  const [checkout, setCheckout] = useState(null)
  const [paidOrder, setPaidOrder] = useState(null)
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState(null)
  const [attempts, setAttempts] = useState([])

  const market = config.markets[country]
  const estimate = CART.reduce((sum, i) => sum + config.products[i.sku].price[market.currency] * i.quantity, 0)

  const yuno = useYunoCheckout({
    config,
    checkout,
    demoDoubleClick,
    onPaymentCreated: setPaidOrder,
    onPayAttempts: (results) =>
      setAttempts((prev) => [
        ...prev,
        ...results.map((r) => (r.status === 'fulfilled' ? { ok: true, paymentId: r.value.order.payment?.id, duplicate: r.value.duplicate } : { ok: false, error: r.reason?.message })),
      ]),
  })

  async function startCheckout() {
    setStarting(true)
    setStartError(null)
    setPaidOrder(null)
    setAttempts([])
    try {
      setCheckout(await api.createOrder({ country, items: CART, shopper: SHOPPERS[country] }))
    } catch (err) {
      setStartError(err.message)
    } finally {
      setStarting(false)
    }
  }

  function reset() {
    setCheckout(null)
    setPaidOrder(null)
    setAttempts([])
  }

  const order = checkout?.order
  const lines = order?.lines ?? CART.map((i) => ({ ...i, name: config.products[i.sku].name, amount: config.products[i.sku].price[market.currency] * i.quantity }))
  const total = order?.amount ?? estimate
  const failed = paidOrder?.status === 'FAILED'

  return (
    <main className="grid">
      <section className="card summary">
        <h2>Your order</h2>
        <ul className="lines">
          {lines.map((l) => (
            <li key={l.sku}><span>{l.name} <span className="muted">× {l.quantity}</span></span><span>{money(l.amount, market.currency)}</span></li>
          ))}
        </ul>
        <div className="total"><span>Total</span><span>{money(total, market.currency)}</span></div>
        <p className="muted small">{order ? 'Amount confirmed by the server.' : 'Final amount is calculated by the server.'}</p>
        {order && (
          <dl className="facts">
            <dt>Order</dt><dd><code>{order.id}</code></dd>
            <dt className="small">sent to Yuno as</dt><dd className="small muted">merchant_order_id</dd>
          </dl>
        )}
      </section>

      <section className="card">
        <h2>Payment</h2>

        <div className="field">
          <span className="label">Shipping country</span>
          <div className="segmented">
            {Object.entries(config.markets).map(([code, m]) => (
              <button key={code} className={code === country ? 'on' : ''} disabled={!!checkout} onClick={() => setCountry(code)}>
                {code === 'BR' ? '🇧🇷' : '🇲🇽'} {m.label}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span className="label">Customer</span>
          <div className="muted">{SHOPPERS[country].firstName} {SHOPPERS[country].lastName} · {SHOPPERS[country].email}</div>
        </div>

        {!checkout && (
          <>
            <button className="primary" disabled={starting} onClick={startCheckout}>{starting ? 'Starting secure checkout…' : 'Continue to payment'}</button>
            {startError && <div className="alert error">{startError}</div>}
          </>
        )}

        {checkout && !paidOrder && (
          <>
            <div className="field">
              <span className="label">Payment method</span>
              <div className="methods">
                {checkout.methods.map((type) => (
                  <button key={type} className={`method ${yuno.method === type ? 'on' : ''}`} disabled={!yuno.ready || yuno.busy} onClick={() => yuno.mount(type)}>
                    <span className="icon">{METHOD_LABELS[type]?.icon}</span>
                    <span><b>{METHOD_LABELS[type]?.label ?? type}</b><small>{METHOD_LABELS[type]?.hint}</small></span>
                  </button>
                ))}
              </div>
              {yuno.method && yuno.method !== 'CARD' && <p className="muted small">Your {METHOD_LABELS[yuno.method]?.label ?? yuno.method} payment code is generated when you press Pay.</p>}
            </div>
          </>
        )}

        {/* The SDK renders here. Siblings, not nested: the SDK empties #yuno-root when it mounts.
            Kept mounted so continuePayment() can show the QR/voucher. */}
        <div className={checkout ? 'yuno-area' : 'hidden'}>
          <div id="yuno-root" />
          {/* Hide the card form while PIX/OXXO is selected but not yet mounted */}
          <div id="yuno-form" className={paidOrder || yuno.mounted !== yuno.method ? 'hidden' : ''} />
          <div id="yuno-action" />
        </div>

        {checkout && !paidOrder && (
          <button className="primary" disabled={!yuno.ready || (yuno.busy && !demoDoubleClick)} onClick={yuno.pay}>
            {yuno.busy && !demoDoubleClick ? 'Processing…' : `Pay ${money(total, market.currency)}`}
          </button>
        )}
        {yuno.error && <div className="alert error">{yuno.error}</div>}

        {attempts.length > 0 && (
          <div className="attempts">
            <span className="label">Pay requests sent to our backend</span>
            <ol>
              {attempts.map((a, i) => (
                <li key={i}>{a.ok ? <>payment <code>{a.paymentId?.slice(0, 8)}…</code> {a.duplicate ? <span className="tag ok">duplicate blocked</span> : <span className="tag">created</span>}</> : <span className="tag bad">{a.error}</span>}</li>
              ))}
            </ol>
          </div>
        )}

        {paidOrder && (
          <>
            <OrderStatus orderId={paidOrder.id} initial={paidOrder} compact />
            <div className="row">
              <a className="secondary" href={`/orders/${paidOrder.id}`} target="_blank" rel="noopener">Open order page in a new tab ↗</a>
              <button className="secondary" onClick={failed ? startCheckout : reset}>{failed ? 'Try again (new attempt)' : 'New order'}</button>
            </div>
          </>
        )}
      </section>
    </main>
  )
}
