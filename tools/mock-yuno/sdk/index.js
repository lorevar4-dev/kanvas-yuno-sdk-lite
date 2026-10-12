// Mock of @yuno-payments/sdk-web with the same API. YUNO_MODE=mock only.
const MOCK_URL = globalThis.__MOCK_YUNO_URL__ ?? 'http://localhost:4500'
const TAG = '[Yuno mock SDK]'

export async function loadScript(props) {
  if (typeof props !== 'object' || props?.env !== 'sandbox') {
    console.warn(`${TAG} loadScript() received`, props, '→ env is not "sandbox", so the real package would load the PRODUCTION SDK.')
  }
  injectStyles()
  return {
    async initialize(publicApiKey) {
      const res = await fetch(`${MOCK_URL}/v1/mock-sdk/validate`, { headers: { 'public-api-key': publicApiKey ?? '' } })
      if (!res.ok) throw new Error(`${TAG} initialize(): invalid public API key`)
      console.info(`${TAG} initialized`)
      return createInstance(publicApiKey)
    },
  }
}

function createInstance(publicApiKey) {
  const state = { config: null, ready: false, methods: [], mounted: null, poll: null }

  async function api(path, options = {}) {
    const res = await fetch(`${MOCK_URL}/v1/mock-sdk${path}`, {
      ...options,
      headers: { 'content-type': 'application/json', 'public-api-key': publicApiKey },
    })
    const body = await res.json()
    if (!res.ok) throw Object.assign(new Error(body.messages?.[0] ?? `HTTP ${res.status}`), { code: body.code })
    return body
  }

  const el = (selector) => (selector ? document.querySelector(selector) : null)
  const formTarget = () => el(state.config.renderMode?.elementSelector?.apmForm) ?? el(state.config.elementSelector)
  const actionTarget = () => el(state.config.renderMode?.elementSelector?.actionForm) ?? formTarget()
  const reportError = (message, data) => {
    console.error(`${TAG} ${message}`, data ?? '')
    ;(state.config?.error ?? state.config?.yunoError)?.(message, data)
  }
  const reportResult = (status, subStatus) => (state.config?.paymentResult ?? state.config?.yunoPaymentResult)?.(status, subStatus)

  function assertReady(method) {
    if (!state.ready) throw new Error(`${TAG} SDK not ready: ${method}() was called before startCheckout() finished`)
  }

  async function createOneTimeToken() {
    const form = formTarget()
    let card
    if (state.mounted === 'CARD') {
      card = {
        number: form.querySelector('[name=ymk-number]').value,
        holder_name: form.querySelector('[name=ymk-holder]').value,
      }
      if (card.number.replace(/\s+/g, '').length < 15) return reportError('INVALID_CARD_NUMBER')
    }
    const vault = !!form.querySelector('[name=ymk-save]')?.checked || !!state.config.card?.vaultOnSuccess
    state.config.onOneTimeTokenCreationStart?.()
    const ott = await api('/one-time-tokens', {
      method: 'POST',
      body: JSON.stringify({ checkout_session: state.config.checkoutSession, payment_method_type: state.mounted, card, vault_on_success: vault }),
    })
    const callback = state.config.createPayment ?? state.config.yunoCreatePayment
    if (!callback) return console.error(`${TAG} one-time token created but no createPayment callback was registered — it has nowhere to go.`)
    await callback(ott.token, ott)
  }

  return {
    async startCheckout(config) {
      if (!config?.checkoutSession) throw new Error(`${TAG} startCheckout(): checkoutSession is required`)
      if (!el(config.elementSelector)) throw new Error(`${TAG} startCheckout(): element ${config.elementSelector} not found`)
      state.config = config
      state.methods = await api(`/checkout/sessions/${config.checkoutSession}/payment-methods`)
      state.ready = true
      console.info(`${TAG} checkout started · country=${config.countryCode} · enabled methods: ${state.methods.map((m) => m.type).join(', ')}`)
    },

    async mountCheckoutLite({ paymentMethodType }) {
      assertReady('mountCheckoutLite')
      const target = formTarget()
      if (!state.methods.some((m) => m.type === paymentMethodType)) {
        target.innerHTML = `<div class="ymk ymk-warn">${paymentMethodType} is not enabled for this checkout session.</div>`
        return reportError('PAYMENT_METHOD_NOT_AVAILABLE', { paymentMethodType })
      }
      state.mounted = paymentMethodType
      target.innerHTML = renderForm(paymentMethodType, state.config.card)
      // Like the real SDK: methods without a form are tokenized as soon as they are mounted
      if (paymentMethodType !== 'CARD') await createOneTimeToken()
    },

    // Like the real SDK: the Lite card form ignores startPayment() and only submits on submitOneTimeTokenForm()
    async startPayment() {
      assertReady('startPayment')
      if (!state.mounted) return reportError('NO_PAYMENT_METHOD_MOUNTED')
      if (state.mounted === 'CARD') return console.warn(`${TAG} startPayment() does not submit the Lite card form — call submitOneTimeTokenForm()`)
      await createOneTimeToken()
    },

    async submitOneTimeTokenForm() {
      assertReady('submitOneTimeTokenForm')
      if (!state.mounted) return reportError('NO_PAYMENT_METHOD_MOUNTED')
      await createOneTimeToken()
    },

    async continuePayment({ showPaymentStatus = true } = {}) {
      assertReady('continuePayment')
      const payment = await api(`/checkout/sessions/${state.config.checkoutSession}/payment`)
      const target = actionTarget()
      if (payment.status === 'PENDING' && (payment.type === 'PIX' || payment.type === 'OXXO')) {
        target.innerHTML = payment.type === 'PIX' ? renderPix(payment) : renderOxxo(payment)
        clearInterval(state.poll)
        state.poll = setInterval(async () => {
          const latest = await api(`/checkout/sessions/${state.config.checkoutSession}/payment`).catch(() => null)
          if (latest && latest.status !== 'PENDING') {
            clearInterval(state.poll)
            if (showPaymentStatus) target.innerHTML = renderStatus(latest)
            reportResult(latest.status, latest.sub_status)
          }
        }, 2000)
        return null
      }
      if (showPaymentStatus) target.innerHTML = renderStatus(payment)
      reportResult(payment.status, payment.sub_status)
      return null
    },

    async mountStatusPayment() {},
    async showLoader() {},
    async hideLoader() {},
    async notifyError() {},
    async updateCheckoutSession(checkoutSession) {
      state.config = { ...state.config, checkoutSession }
    },
  }
}

// rendering
function renderForm(type, cardConfig = {}) {
  const head = `<div class="ymk-head">Yuno SDK <span>MOCK</span></div>`
  if (type === 'CARD') {
    return `<div class="ymk">${head}
      <label>Card number<input name="ymk-number" value="4111 1111 1111 1111" inputmode="numeric"></label>
      <div class="ymk-row"><label>Expiry<input value="12/30"></label><label>CVV<input value="123"></label></div>
      <label>Cardholder<input name="ymk-holder" value="TEST CUSTOMER"></label>
      ${cardConfig.cardSaveEnable ? '<label class="ymk-check"><input type="checkbox" name="ymk-save"> Save this card for next time</label>' : ''}
      <p class="ymk-hint">Test cards: 4111 1111 1111 1111 approves · 4000 0000 0000 0002 declines</p></div>`
  }
  if (type === 'PIX') return `<div class="ymk">${head}<p>Pay instantly with <b>PIX</b>. You'll get a QR code to scan in your bank app.</p></div>`
  if (type === 'OXXO') return `<div class="ymk">${head}<p>Pay in cash at any <b>OXXO</b> store. You'll get a payment reference.</p></div>`
  return `<div class="ymk">${head}<p>${type}</p></div>`
}

function renderPix(p) {
  return `<div class="ymk ymk-action"><div class="ymk-head">PIX QR code <span>MOCK</span></div>
    ${fakeQr(p.id)}
    <p class="ymk-amount">${p.amount.value} ${p.amount.currency}</p>
    <p class="ymk-hint">PIX copia e cola</p><code class="ymk-code">${p.detail.bank_transfer?.qr_code ?? ''}</code>
    <a class="ymk-btn" href="${p.pay_url}" target="_blank" rel="noopener">Open simulated bank app ↗</a>
    <p class="ymk-hint">Waiting for payment… you can close this tab — the order is confirmed by webhook.</p></div>`
}

function renderOxxo(p) {
  return `<div class="ymk ymk-action"><div class="ymk-head">OXXO voucher <span>MOCK</span></div>
    <p class="ymk-amount">${p.amount.value} ${p.amount.currency}</p>
    <p class="ymk-hint">Payment reference</p><code class="ymk-code ymk-ref">${p.detail.ticket?.reference ?? ''}</code>
    <a class="ymk-btn" href="${p.pay_url}" target="_blank" rel="noopener">Simulate paying at OXXO ↗</a>
    <p class="ymk-hint">Valid for 72 h. The order is confirmed by webhook once the cash payment lands.</p></div>`
}

function renderStatus(p) {
  const ok = p.status === 'SUCCEEDED'
  return `<div class="ymk ymk-status ${ok ? 'ok' : 'bad'}">${ok ? '✓' : '✕'} Payment ${p.status.toLowerCase()}${p.sub_status ? ` · ${p.sub_status}` : ''}</div>`
}

function fakeQr(seed) {
  let h = 0
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  const n = 25
  let cells = ''
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const finder = (x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7)
      h = (h * 1103515245 + 12345) >>> 0
      const on = finder ? (x % 6 === 0 || y % 6 === 0 || (x % 6 >= 2 && x % 6 <= 4 && y % 6 >= 2 && y % 6 <= 4)) : (h >> 16) & 1
      if (on) cells += `<rect x="${x}" y="${y}" width="1" height="1"/>`
    }
  }
  return `<svg class="ymk-qr" viewBox="-2 -2 ${n + 4} ${n + 4}" fill="#111"><rect x="-2" y="-2" width="${n + 4}" height="${n + 4}" fill="#fff"/>${cells}</svg>`
}

function injectStyles() {
  if (document.getElementById('ymk-styles')) return
  const style = document.createElement('style')
  style.id = 'ymk-styles'
  style.textContent = `
.ymk{font:14px/1.45 system-ui,sans-serif;color:#1c1c22;background:#fff;border:1px dashed #b9b4f5;border-radius:12px;padding:16px;display:grid;gap:10px}
.ymk-head{font-weight:700;font-size:13px;color:#3e4fe0;display:flex;gap:8px;align-items:center}
.ymk-head span{font-size:10px;background:#fff3cd;color:#7a5b00;padding:2px 6px;border-radius:4px;letter-spacing:.04em}
.ymk label{display:grid;gap:4px;font-size:12px;color:#555}
.ymk input:not([type=checkbox]){font:inherit;padding:9px 10px;border:1px solid #d6d6de;border-radius:8px;color:#111;background:#fff}
.ymk-row{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.ymk-check{display:flex!important;align-items:center;gap:8px}
.ymk-hint{font-size:12px;color:#777;margin:0}.ymk p{margin:0}
.ymk-warn{border-color:#e0a13e;background:#fff8ec}
.ymk-qr{width:180px;height:180px;justify-self:center;image-rendering:pixelated}
.ymk-amount{font-size:22px;font-weight:700;text-align:center}
.ymk-code{font:12px ui-monospace,monospace;background:#f4f4f6;padding:8px;border-radius:6px;word-break:break-all}
.ymk-ref{font-size:18px;text-align:center;letter-spacing:.1em}
.ymk-btn{display:block;text-align:center;background:#3e4fe0;color:#fff;text-decoration:none;padding:10px;border-radius:8px;font-weight:600}
.ymk-status{font-weight:700;font-size:15px}.ymk-status.ok{color:#15803d;border-color:#86efac}.ymk-status.bad{color:#b91c1c;border-color:#fca5a5}`
  document.head.appendChild(style)
}
