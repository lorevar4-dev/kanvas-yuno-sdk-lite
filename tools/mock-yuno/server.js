// Local stand-in for api-sandbox.y.uno (YUNO_MODE=mock only).
import express from 'express'
import { createHmac, randomUUID } from 'node:crypto'
import { MOCK_CREDENTIALS as CREDS } from './credentials.js'

try { process.loadEnvFile(new URL('../../.env', import.meta.url)) } catch {}

if ((process.env.YUNO_MODE ?? 'mock') !== 'mock') {
  console.log(`[MOCK-YUNO] YUNO_MODE=${process.env.YUNO_MODE} → simulator not needed, exiting.`)
  process.exit(0)
}

const PORT = Number(process.env.MOCK_YUNO_PORT ?? 4500)
const WEBHOOK_URL = process.env.MOCK_WEBHOOK_URL ?? 'http://localhost:3000/webhooks/yuno'

// methods enabled per country
const METHODS_BY_COUNTRY = {
  BR: [{ type: 'CARD', name: 'Card' }, { type: 'PIX', name: 'PIX' }],
  MX: [{ type: 'CARD', name: 'Card' }, { type: 'OXXO', name: 'OXXO' }],
  US: [{ type: 'CARD', name: 'Card' }],
}
const DECLINED_CARD = '4000000000000002'

const customers = new Map()
const sessions = new Map()
const tokens = new Map()
const payments = new Map()
const idempotency = new Map()
const paymentMeta = new Map() // dashboard only: id → { key, replays }

const c = { dim: '\x1b[2m', y: '\x1b[33m', g: '\x1b[32m', r: '\x1b[31m', b: '\x1b[1m', x: '\x1b[0m' }
const ts = () => new Date().toISOString().slice(11, 19)
const log = (msg) => console.log(`${c.dim}${ts()}${c.x} ${c.y}[MOCK-YUNO]${c.x} ${msg}`)

const app = express()
app.use(express.json())
app.use(express.urlencoded({ extended: false }))

// CORS only for SDK endpoints, like the real API
app.use('/v1/mock-sdk', (req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*')
  res.set('Access-Control-Allow-Headers', 'content-type, public-api-key')
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})

function error(res, status, code, message) {
  return res.status(status).json({ code, messages: [message] })
}

function requireServerKeys(req, res, next) {
  const pub = req.get('public-api-key')
  const secret = req.get('private-secret-key')
  if (pub !== CREDS.publicKey || secret !== CREDS.secretKey) {
    log(`${c.r}401${c.x} ${req.method} ${req.path} — invalid or missing API keys`)
    return error(res, 401, 'INVALID_CREDENTIALS', 'public-api-key and private-secret-key are required')
  }
  next()
}

function requirePublicKey(req, res, next) {
  if (req.get('public-api-key') !== CREDS.publicKey) {
    log(`${c.r}401${c.x} SDK call ${req.path} — invalid public key`)
    return error(res, 401, 'INVALID_PUBLIC_KEY', 'Invalid public-api-key')
  }
  next()
}

function idempotent(req, res, next) {
  const key = req.get('x-idempotency-key')
  if (!key) return next()
  const scope = `${req.method} ${req.path} ${key}`
  const stored = idempotency.get(scope)
  if (stored) {
    log(`${c.g}idempotent replay${c.x} ${req.path} key=${key} → same response, nothing created`)
    const meta = paymentMeta.get(stored.body?.id)
    if (meta) meta.replays++
    return res.status(stored.status).json(stored.body)
  }
  const json = res.json.bind(res)
  res.json = (body) => {
    if (res.statusCode < 500) idempotency.set(scope, { status: res.statusCode, body })
    return json(body)
  }
  next()
}

function missing(body, fields) {
  return fields.filter((f) => f.split('.').reduce((o, k) => o?.[k], body) == null)
}

// customers
app.post('/v1/customers', requireServerKeys, idempotent, (req, res) => {
  const gaps = missing(req.body, ['merchant_customer_id', 'merchant_customer_created_at'])
  if (gaps.length) return error(res, 400, 'INVALID_REQUEST', `Missing fields: ${gaps.join(', ')}`)
  const customer = { id: randomUUID(), ...req.body, created_at: new Date().toISOString() }
  customers.set(customer.id, customer)
  log(`customer created ${customer.id} (${customer.email ?? customer.merchant_customer_id})`)
  res.status(201).json(customer)
})

// checkout sessions
app.post('/v1/checkout/sessions', requireServerKeys, idempotent, (req, res) => {
  const gaps = missing(req.body, ['account_id', 'merchant_order_id', 'payment_description', 'country', 'amount.currency', 'amount.value'])
  if (gaps.length) {
    log(`${c.r}400${c.x} create session — missing ${gaps.join(', ')}`)
    return error(res, 400, 'INVALID_REQUEST', `Missing required fields: ${gaps.join(', ')}`)
  }
  if (req.body.account_id !== CREDS.accountId) return error(res, 400, 'INVALID_ACCOUNT', 'Unknown account_id')
  const session = {
    checkout_session: randomUUID(),
    merchant_order_id: req.body.merchant_order_id,
    payment_description: req.body.payment_description,
    country: req.body.country,
    customer_id: req.body.customer_id ?? null,
    callback_url: req.body.callback_url ?? null,
    amount: req.body.amount,
    workflow: 'SDK_CHECKOUT',
    created_at: new Date().toISOString(),
  }
  sessions.set(session.checkout_session, session)
  log(`checkout session ${session.checkout_session} · ${session.country} · ${session.amount.value} ${session.amount.currency}`)
  res.json(session)
})

// payments
app.post('/v1/payments', requireServerKeys, idempotent, (req, res) => {
  const b = req.body
  const gaps = missing(b, ['account_id', 'merchant_order_id', 'country', 'amount.currency', 'amount.value', 'checkout.session', 'payment_method.token'])
  if (gaps.length) {
    log(`${c.r}400${c.x} create payment — missing ${gaps.join(', ')}`)
    return error(res, 400, 'INVALID_REQUEST', `Missing required fields: ${gaps.join(', ')}`)
  }
  const session = sessions.get(b.checkout.session)
  if (!session) return error(res, 400, 'INVALID_CHECKOUT_SESSION', 'Checkout session not found')
  const ott = tokens.get(b.payment_method.token)
  if (!ott || ott.checkout_session !== session.checkout_session) return error(res, 400, 'INVALID_TOKEN', 'One-time token not found for this session')
  if (ott.used) {
    log(`${c.r}400${c.x} create payment — one-time token already used`)
    return error(res, 400, 'TOKEN_ALREADY_USED', 'One-time token can only be used once')
  }
  ott.used = true

  const now = new Date().toISOString()
  const payment = {
    id: randomUUID(),
    account_id: b.account_id,
    description: b.description ?? session.payment_description,
    country: b.country,
    merchant_order_id: b.merchant_order_id,
    created_at: now,
    updated_at: now,
    amount: { currency: b.amount.currency, value: b.amount.value, captured: 0, refunded: 0 },
    checkout: { session: session.checkout_session, sdk_action_required: false },
    customer_payer: b.customer_payer ?? null,
    payment_method: { type: ott.type, token: ott.token, vault_on_success: !!b.payment_method.vault_on_success, vaulted_token: null, payment_method_detail: {} },
    workflow: b.workflow ?? 'SDK_CHECKOUT',
  }

  if (ott.type === 'CARD') {
    const declined = ott.card_number === DECLINED_CARD
    payment.status = declined ? 'DECLINED' : 'SUCCEEDED'
    payment.sub_status = declined ? 'DECLINED' : 'APPROVED'
    payment.payment_method.payment_method_detail.card = { card_data: ott.card_data }
    if (!declined && payment.payment_method.vault_on_success) payment.payment_method.vaulted_token = randomUUID()
  } else if (ott.type === 'PIX') {
    payment.status = 'PENDING'
    payment.sub_status = 'WAITING_PAYMENT'
    payment.checkout.sdk_action_required = true
    payment.payment_method.payment_method_detail.bank_transfer = {
      payment_instruction: 'Scan the QR code with your bank app',
      qr_code: `00020126580014br.gov.bcb.pix0136${payment.id}5204000053039865406${b.amount.value}5802BR6304MOCK`,
      expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
    }
  } else if (ott.type === 'OXXO') {
    payment.status = 'PENDING'
    payment.sub_status = 'WAITING_PAYMENT'
    payment.checkout.sdk_action_required = true
    payment.payment_method.payment_method_detail.ticket = {
      reference: `93000${String(Math.floor(Math.random() * 1e10)).padStart(10, '0')}`,
      expires_at: new Date(Date.now() + 72 * 3600_000).toISOString(),
    }
  }

  payments.set(payment.id, payment)
  paymentMeta.set(payment.id, { key: req.get('x-idempotency-key') ?? null, replays: 0 })
  const tone = payment.status === 'SUCCEEDED' ? c.g : payment.status === 'PENDING' ? c.y : c.r
  log(`${c.b}payment created${c.x} ${payment.id} · ${ott.type} · ${b.amount.value} ${b.amount.currency} · order=${b.merchant_order_id} → ${tone}${payment.status}${c.x}`)
  sendWebhook(payment)
  res.json(payment)
})

app.get('/v1/payments/:id', requireServerKeys, (req, res) => {
  const payment = payments.get(req.params.id)
  if (!payment) return error(res, 404, 'NOT_FOUND', 'Payment not found')
  res.json(payment)
})

// endpoints used by the mock browser SDK (public key only)
app.get('/v1/mock-sdk/validate', requirePublicKey, (req, res) => res.json({ ok: true }))

app.get('/v1/mock-sdk/checkout/sessions/:id/payment-methods', requirePublicKey, (req, res) => {
  const session = sessions.get(req.params.id)
  if (!session) return error(res, 404, 'INVALID_CHECKOUT_SESSION', 'Checkout session not found')
  res.json(METHODS_BY_COUNTRY[session.country] ?? [])
})

app.post('/v1/mock-sdk/one-time-tokens', requirePublicKey, (req, res) => {
  const { checkout_session, payment_method_type, card, vault_on_success } = req.body
  const session = sessions.get(checkout_session)
  if (!session) return error(res, 400, 'INVALID_CHECKOUT_SESSION', 'Checkout session not found')
  const enabled = (METHODS_BY_COUNTRY[session.country] ?? []).some((m) => m.type === payment_method_type)
  if (!enabled) return error(res, 400, 'PAYMENT_METHOD_NOT_AVAILABLE', `${payment_method_type} is not enabled for ${session.country}`)
  const number = (card?.number ?? '').replace(/\s+/g, '')
  const ott = {
    token: randomUUID(),
    type: payment_method_type,
    vault_on_success: !!vault_on_success,
    vaulted_token: null,
    checkout_session,
    card_number: number || null,
    card_data: number ? { holder_name: card.holder_name ?? '', iin: number.slice(0, 8), lfd: number.slice(-4), brand: number.startsWith('5') ? 'MASTERCARD' : 'VISA' } : undefined,
    used: false,
  }
  tokens.set(ott.token, ott)
  log(`one-time token issued ${ott.token.slice(0, 8)}… · ${payment_method_type}`)
  const { card_number, used, checkout_session: _s, ...publicView } = ott
  res.json(publicView)
})

app.get('/v1/mock-sdk/checkout/sessions/:id/payment', requirePublicKey, (req, res) => {
  const latest = [...payments.values()].filter((p) => p.checkout.session === req.params.id).at(-1)
  if (!latest) return error(res, 404, 'NOT_FOUND', 'No payment for this session yet')
  res.json({
    id: latest.id,
    status: latest.status,
    sub_status: latest.sub_status,
    type: latest.payment_method.type,
    amount: latest.amount,
    detail: latest.payment_method.payment_method_detail,
    pay_url: `http://localhost:${PORT}/mock/pay/${latest.id}`,
  })
})

// simulation: settle async payments (the shopper's bank / OXXO store)
function settle(id, status) {
  const payment = payments.get(id)
  if (!payment) return { error: 'Payment not found' }
  if (payment.status !== 'PENDING') return { error: `Payment is already ${payment.status}` }
  payment.status = status
  payment.sub_status = status === 'SUCCEEDED' ? 'APPROVED' : 'EXPIRED'
  if (status === 'SUCCEEDED') payment.amount.captured = payment.amount.value
  payment.updated_at = new Date().toISOString()
  log(`${c.b}payment settled out-of-band${c.x} ${id} → ${status === 'SUCCEEDED' ? c.g : c.r}${status}${c.x}`)
  sendWebhook(payment)
  return { payment }
}

app.post('/mock/payments/:id/settle', (req, res) => {
  const status = req.body.status === 'EXPIRED' ? 'EXPIRED' : 'SUCCEEDED'
  const result = settle(req.params.id, status)
  if (result.error) return res.status(409).json(result)
  res.json(result.payment)
})

app.get('/mock/payments', (req, res) => {
  let list = [...payments.values()]
  if (req.query.merchant_order_id) list = list.filter((p) => p.merchant_order_id === req.query.merchant_order_id)
  res.json(list.map((p) => ({ id: p.id, merchant_order_id: p.merchant_order_id, type: p.payment_method.type, status: p.status, amount: p.amount.value, currency: p.amount.currency, created_at: p.created_at })))
})

app.get('/mock/pay/:id', (req, res) => {
  const p = payments.get(req.params.id)
  if (!p) return res.status(404).send('Payment not found')
  const isPix = p.payment_method.type === 'PIX'
  res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${isPix ? 'Simulated bank app' : 'Simulated OXXO store'}</title>
<style>body{font-family:system-ui,sans-serif;background:#f4f4f6;margin:0;padding:24px;color:#1c1c22}
.card{max-width:420px;margin:0 auto;background:#fff;border-radius:16px;padding:24px;box-shadow:0 4px 24px rgba(0,0,0,.08)}
.tag{display:inline-block;background:#fff3cd;color:#7a5b00;font-size:12px;padding:3px 8px;border-radius:6px}
h1{font-size:20px;margin:12px 0 4px}.amt{font-size:32px;font-weight:700;margin:16px 0}
dl{font-size:13px;color:#555}dt{font-weight:600;margin-top:8px}dd{margin:0;word-break:break-all}
button{width:100%;padding:14px;border:0;border-radius:10px;font-size:16px;font-weight:600;cursor:pointer;margin-top:12px}
.pay{background:#16a34a;color:#fff}.exp{background:#e5e7eb;color:#333}#out{margin-top:16px;font-weight:600}</style></head>
<body><div class="card"><span class="tag">MOCK — simulates the shopper paying outside your site</span>
<h1>${isPix ? '🏦 Banco Simulado · PIX' : '🏪 OXXO · Pago en efectivo'}</h1>
<div class="amt">${p.amount.value} ${p.amount.currency}</div>
<dl><dt>Payment</dt><dd>${p.id}</dd><dt>Merchant order</dt><dd>${p.merchant_order_id}</dd><dt>Status</dt><dd id="st">${p.status}</dd></dl>
<button class="pay" onclick="go('SUCCEEDED')">${isPix ? 'Confirm PIX transfer' : 'Pay cash at the counter'}</button>
<button class="exp" onclick="go('EXPIRED')">Let it expire</button><div id="out"></div></div>
<script>async function go(status){const r=await fetch('/mock/payments/${p.id}/settle',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({status})});
const j=await r.json();document.getElementById('out').textContent=r.ok?'Done → '+j.status+'. Yuno will notify the merchant by webhook.':j.error;if(r.ok)document.getElementById('st').textContent=j.status}</script>
</body></html>`)
})

app.get('/mock', (req, res) => {
  const list = [...payments.values()].reverse()
  const perOrder = list.reduce((m, p) => m.set(p.merchant_order_id, (m.get(p.merchant_order_id) ?? 0) + 1), new Map())
  const rows = list.map((p) => {
    const meta = paymentMeta.get(p.id) ?? {}
    const count = perOrder.get(p.merchant_order_id)
    return `<tr class="${count > 1 ? 'dup' : ''}"><td>${p.created_at.slice(11, 19)}</td>
<td>${p.merchant_order_id}${count > 1 ? ` <span class="bad">${count} charges</span>` : ''}</td>
<td>${p.payment_method.type}</td><td>${p.amount.value} ${p.amount.currency}</td><td><b>${p.status}</b></td>
<td>${meta.key ? `<code>${meta.key}</code>${meta.replays ? ` <span class="ok">+${meta.replays} replayed</span>` : ''}` : '<span class="none">none</span>'}</td>
<td><code>${p.id}</code></td><td>${p.status === 'PENDING' ? `<a href="/mock/pay/${p.id}" target="_blank">pay</a>` : ''}</td></tr>`
  }).join('')
  res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="3"><title>Mock Yuno · payments</title>
<style>body{font-family:system-ui,sans-serif;padding:24px}table{border-collapse:collapse;width:100%;font-size:13px}td,th{border-bottom:1px solid #ddd;padding:6px 8px;text-align:left;vertical-align:top}
code{font-size:11px}tr.dup{background:#fef2f2}.bad,.ok,.none{font-size:11px;font-weight:700;padding:1px 6px;border-radius:4px}.bad{background:#fecaca;color:#991b1b}.ok{background:#dcfce7;color:#166534}.none{background:#f3f4f6;color:#6b7280}</style></head>
<body><h2>Mock Yuno · payments (${payments.size})</h2><p style="color:#777">Auto-refreshes every 3 s. Stands in for the Yuno dashboard in mock mode. Red rows = more than one charge for the same merchant order. "Replayed" = requests answered from the idempotency key without creating a payment.</p>
<table><tr><th>Time</th><th>Merchant order</th><th>Method</th><th>Amount</th><th>Status</th><th>X-Idempotency-Key</th><th>Payment id</th><th></th></tr>${rows}</table></body></html>`)
})

// webhooks (same headers and payload shape as Yuno's payment.purchase)
function sendWebhook(payment, attempt = 0) {
  const body = JSON.stringify({
    type: 'payment',
    type_event: 'payment.purchase',
    account_id: payment.account_id,
    retry: attempt,
    version: 2,
    data: { payment },
  })
  const signature = createHmac('sha256', CREDS.webhookHmacSecret).update(body).digest('base64')
  const delays = [300, 2000, 5000, 10000]
  setTimeout(async () => {
    try {
      const res = await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': CREDS.webhookApiKey, 'x-secret': CREDS.webhookSecret, 'x-hmac-signature': signature },
        body,
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      log(`webhook delivered → ${payment.id.slice(0, 8)}… ${payment.status} (attempt ${attempt + 1})`)
    } catch (err) {
      log(`${c.r}webhook failed${c.x} (${err.message}) attempt ${attempt + 1}`)
      if (attempt + 1 < delays.length) sendWebhook(payment, attempt + 1)
    }
  }, delays[attempt])
}

app.listen(PORT, () => {
  log(`listening on http://localhost:${PORT}  ·  dashboard http://localhost:${PORT}/mock  ·  webhooks → ${WEBHOOK_URL}`)
})
