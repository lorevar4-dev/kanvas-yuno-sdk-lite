import OrderStatus from '../components/OrderStatus.jsx'

export default function OrderPage({ orderId }) {
  return (
    <main className="narrow">
      <OrderStatus orderId={orderId} />
      <p className="muted center"><a href="/">← Back to shop</a></p>
    </main>
  )
}
