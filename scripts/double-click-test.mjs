// Double-click test (mock only). In sandbox use http://localhost:5174/?demo=double-click
import { MOCK_CREDENTIALS as CREDS, MOCK_YUNO_URL as YUNO } from '../tools/mock-yuno/credentials.js'

try { process.loadEnvFile(new URL('../.env', import.meta.url)) } catch {}

const FIXED = 'http://localhost:3000'
const BROKEN = 'http://localhost:4000'
const C = { dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', bold: '\x1b[1m', reset: '\x1b[0m' }

if ((process.env.YUNO_MODE ?? 'mock') !== 'mock') {
  console.log('This script needs YUNO_MODE=mock. In sandbox, use the UI: http://localhost:5174/?demo=double-click')
  process.exit(1)
}

const serverHeaders = { 'content-type': 'application/json', 'public-api-key': CREDS.publicKey, 'private-secret-key': CREDS.secretKey }

async function call(url, { method = 'GET', headers = { 'content-type': 'application/json' }, body } = {}) {
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined })
  return { status: res.status, body: await res.json().catch(() => null) }
}

async function up(url, name) {
  try {
    await fetch(url)
  } catch {
    console.log(`${C.red}✖ ${name} is not running (${url}). Start everything with: npm run dev${C.reset}`)
    process.exit(1)
  }
}

const newSession = (orderId, value = 349.7) =>
  call(`${YUNO}/v1/checkout/sessions`, {
    method: 'POST',
    headers: serverHeaders,
    body: { account_id: CREDS.accountId, merchant_order_id: orderId, payment_description: 'double-click test', country: 'BR', amount: { currency: 'BRL', value } },
  }).then((r) => r.body.checkout_session)

const newToken = (session) =>
  call(`${YUNO}/v1/mock-sdk/one-time-tokens`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'public-api-key': CREDS.publicKey },
    body: { checkout_session: session, payment_method_type: 'CARD', card: { number: '4111111111111111', holder_name: 'TEST' } },
  }).then((r) => r.body.token)

const paymentsFor = (orderId) => call(`${YUNO}/mock/payments?merchant_order_id=${orderId}`).then((r) => r.body)

function verdict(count) {
  return count === 1 ? `${C.green}${C.bold}1 payment → charged once ✓${C.reset}` : count === 0 ? `${C.yellow}0 payments → nothing charged${C.reset}` : `${C.red}${C.bold}${count} payments → DOUBLE CHARGE ✖${C.reset}`
}

function header(title) {
  console.log(`\n${C.bold}${title}${C.reset}`)
}

await up(`${YUNO}/mock/payments`, 'Mock Yuno (:4500)')
await up(`${FIXED}/api/config`, 'Fixed backend (:3000)')

// A) Diego's backend route, verbatim
header("A) Diego's /api/create-payment (as shared) — two concurrent clicks")
try {
  await fetch(BROKEN)
  const orderA = `diego-${Date.now()}`
  const sessionA = await newSession(orderA)
  const [t1, t2] = await Promise.all([newToken(sessionA), newToken(sessionA)])
  const results = await Promise.all(
    [t1, t2].map((token) => call(`${BROKEN}/api/create-payment`, { method: 'POST', body: { token, session: sessionA, amount: { currency: 'BRL', value: 349.7 } } })),
  )
  results.forEach((r, i) => console.log(`   click ${i + 1} → HTTP ${r.status} ${C.dim}${JSON.stringify(r.body)}${C.reset}`))
  console.log(`   ${C.yellow}His route cannot create any payment: no public-api-key header, no account_id / merchant_order_id / country.${C.reset}`)
} catch {
  console.log(`   ${C.dim}(broken backend :4000 not running — skipped)${C.reset}`)
}

// B) Diego's pattern, with the missing fields filled in
header("B) Diego's pattern once it 'works' — no X-Idempotency-Key, no order lock")
const orderB = `naive-${Date.now()}`
const sessionB = await newSession(orderB)
const tokensB = await Promise.all([newToken(sessionB), newToken(sessionB)])
const naive = await Promise.all(
  tokensB.map((token) =>
    call(`${YUNO}/v1/payments`, {
      method: 'POST',
      headers: serverHeaders,
      body: { account_id: CREDS.accountId, merchant_order_id: orderB, country: 'BR', amount: { currency: 'BRL', value: 349.7 }, checkout: { session: sessionB }, payment_method: { token } },
    }),
  ),
)
naive.forEach((r, i) => console.log(`   click ${i + 1} → payment ${r.body?.id} ${r.body?.status}`))
console.log(`   Yuno holds for order ${orderB}: ${verdict((await paymentsFor(orderB)).length)}`)

// C) Fixed backend
header('C) Fixed backend — two concurrent clicks on the same order')
const created = await call(`${FIXED}/api/orders`, {
  method: 'POST',
  body: { country: 'BR', items: [{ sku: 'linen-throw', quantity: 1 }, { sku: 'ceramic-vase', quantity: 2 }], shopper: { firstName: 'Ana', lastName: 'Souza', email: 'ana.souza@example.com' } },
})
const orderC = created.body.order.id
const tokensC = await Promise.all([newToken(created.body.checkoutSession), newToken(created.body.checkoutSession)])
const fixed = await Promise.all(tokensC.map((oneTimeToken) => call(`${FIXED}/api/orders/${orderC}/payments`, { method: 'POST', body: { oneTimeToken } })))
fixed.forEach((r, i) => console.log(`   click ${i + 1} → HTTP ${r.status} payment ${r.body?.order?.payment?.id} ${r.body?.duplicate ? `${C.green}(duplicate blocked)${C.reset}` : '(created)'}`))
console.log(`   idempotency key for this order: ${created.body.order.idempotencyKey}`)
console.log(`   Yuno holds for order ${orderC}: ${verdict((await paymentsFor(orderC)).length)}`)

// D) Yuno idempotency on its own (e.g. two servers, or a network retry)
header('D) Same X-Idempotency-Key sent twice straight to Yuno (bypassing our lock)')
const orderD = `idem-${Date.now()}`
const sessionD = await newSession(orderD)
const tokensD = await Promise.all([newToken(sessionD), newToken(sessionD)])
const key = crypto.randomUUID()
const idem = await Promise.all(
  tokensD.map((token) =>
    call(`${YUNO}/v1/payments`, {
      method: 'POST',
      headers: { ...serverHeaders, 'X-Idempotency-Key': key },
      body: { account_id: CREDS.accountId, merchant_order_id: orderD, country: 'BR', amount: { currency: 'BRL', value: 349.7 }, checkout: { session: sessionD }, payment_method: { token } },
    }),
  ),
)
idem.forEach((r, i) => console.log(`   request ${i + 1} → payment ${r.body?.id}`))
console.log(`   Yuno holds for order ${orderD}: ${verdict((await paymentsFor(orderD)).length)}`)
console.log('')
