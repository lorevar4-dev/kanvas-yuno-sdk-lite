import { useEffect, useState } from 'react'
import { api } from './api.js'
import ModeBanner from './components/ModeBanner.jsx'
import CheckoutPage from './pages/CheckoutPage.jsx'
import OrderPage from './pages/OrderPage.jsx'

export default function App() {
  const [config, setConfig] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    api.config().then(setConfig).catch((err) => setError(err.message))
  }, [])

  const orderMatch = window.location.pathname.match(/^\/orders\/([\w-]+)/)
  const demoDoubleClick = new URLSearchParams(window.location.search).get('demo') === 'double-click'

  if (error) return <div className="shell"><div className="alert error">Backend unreachable: {error}. Is <code>npm run fixed</code> running?</div></div>
  if (!config) return <div className="shell muted">Loading…</div>

  return (
    <>
      <ModeBanner mode={config.mode} demoDoubleClick={demoDoubleClick} />
      <div className="shell">
        <header className="brand">
          <a href="/" className="logo">kanvas</a>
          <span className="muted">Secure checkout</span>
        </header>
        {orderMatch ? <OrderPage orderId={orderMatch[1]} /> : <CheckoutPage config={config} demoDoubleClick={demoDoubleClick} />}
      </div>
    </>
  )
}
