import { loadScript } from '@yuno-payments/sdk-web'

const YUNO_PUBLIC_KEY = 'sandbox_pub_9f2c...'
const YUNO_SECRET_KEY = 'sandbox_secret_a17d...'   // used below

let checkoutSession

export async function initCheckout(cart) {
  const res = await fetch('https://api-sandbox.y.uno/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'public-api-key': YUNO_PUBLIC_KEY,
      'private-secret-key': YUNO_SECRET_KEY,
    },
    body: JSON.stringify({
      amount: { currency: cart.currency, value: cart.total },
      country: cart.country,
      customer_id: cart.customerId,
    }),
  })
  const data = await res.json()
  checkoutSession = data.checkout_session

  const yuno = await loadScript(YUNO_SECRET_KEY)

  await yuno.startPayment()

  await yuno.startCheckout({
    checkoutSession,
    elementSelector: '#checkout-root',
    countryCode: 'US',
    showLoading: false,
  })

  // Only cards are ever mounted
  await yuno.mountCheckoutLite({ paymentMethodType: 'CARD' })
}

// Called when the customer clicks "Pay"
export async function onPayClick(oneTimeToken) {
  const res = await fetch('https://api-sandbox.y.uno/v1/payments', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'private-secret-key': YUNO_SECRET_KEY,
    },
    body: JSON.stringify({
      amount: { currency: cart.currency, value: cart.total },
      checkout: { session: checkoutSession },
      payment_method: { token: oneTimeToken },
    }),
  })
  const payment = await res.json()
  if (payment.status === 'SUCCEEDED') showSuccess()
  else showError()
}
