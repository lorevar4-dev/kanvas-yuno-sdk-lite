// Test page for Diego's checkout.jsx: calls his two functions and prints what they throw.
import { useState } from 'react'
import { initCheckout, onPayClick } from './checkout.jsx'

const cart = { currency: 'BRL', total: 349.7, country: 'BR', customerId: 'kanvas-customer-123' }

export default function App() {
  const [log, setLog] = useState([])
  const push = (kind, text) => setLog((l) => [...l, { kind, text, at: new Date().toLocaleTimeString() }])

  async function run(label, fn) {
    push('info', `${label}…`)
    try {
      await fn()
      push('ok', `${label} finished without throwing`)
    } catch (err) {
      console.error(err)
      push('error', `${label} threw → ${err.name}: ${err.message}`)
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.banner}>STAGING CODE AS SHARED BY DIEGO · DO NOT SHIP · mode: {__YUNO_MODE__}</div>
      <h1 style={styles.h1}>Kanvas checkout <small style={styles.small}>(staging)</small></h1>
      <p style={styles.p}>Cart: Linen throw blanket ×1, Ceramic vase ×2 — <b>R$ 349,70</b> · country <b>BR</b></p>
      <p style={styles.hint}>Open DevTools → Network and Console before clicking.</p>
      <div style={styles.row}>
        <button style={styles.btn} onClick={() => run('initCheckout(cart)', () => initCheckout(cart))}>1 · Load checkout</button>
        <button style={styles.btn} onClick={() => run('onPayClick(token)', () => onPayClick('one-time-token-from-somewhere'))}>2 · Pay</button>
      </div>
      <div id="checkout-root" style={styles.root}><span style={styles.hint}>#checkout-root — the SDK should mount here</span></div>
      <ol style={styles.log}>
        {log.map((l, i) => (
          <li key={i} style={{ color: l.kind === 'error' ? '#f87171' : l.kind === 'ok' ? '#4ade80' : '#a1a1aa' }}>
            <code>{l.at}</code> {l.text}
          </li>
        ))}
      </ol>
    </div>
  )
}

const styles = {
  page: { fontFamily: 'system-ui, sans-serif', background: '#18181b', color: '#e4e4e7', minHeight: '100vh', padding: 24, margin: -8 },
  banner: { background: '#7f1d1d', color: '#fecaca', padding: '8px 12px', borderRadius: 8, fontWeight: 700, fontSize: 13, letterSpacing: '.03em' },
  h1: { fontWeight: 600, margin: '20px 0 8px' },
  small: { color: '#a1a1aa', fontWeight: 400, fontSize: 16 },
  p: { margin: '4px 0' },
  hint: { color: '#a1a1aa', fontSize: 13 },
  row: { display: 'flex', gap: 12, margin: '16px 0' },
  btn: { padding: '10px 18px', borderRadius: 8, border: '1px solid #3f3f46', background: '#27272a', color: '#fff', fontSize: 15, cursor: 'pointer' },
  root: { border: '1px dashed #3f3f46', borderRadius: 12, padding: 16, minHeight: 80, maxWidth: 420 },
  log: { fontSize: 14, lineHeight: 1.8, paddingLeft: 20 },
}
