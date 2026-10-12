// Only module that uses the secret key
import { config } from './config.js'
import { log } from './logger.js'

export class YunoApiError extends Error {
  constructor(status, body) {
    super(body?.messages?.join('; ') ?? body?.message ?? `Yuno API error ${status}`)
    this.status = status
    this.body = body
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function request(method, path, { body, idempotencyKey } = {}) {
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json',
    'public-api-key': config.yuno.publicKey,
    'private-secret-key': config.yuno.secretKey,
  }
  if (idempotencyKey) headers['X-Idempotency-Key'] = idempotencyKey

  // Safe to retry only with an idempotency key
  const attempts = idempotencyKey ? 2 : 1
  for (let attempt = 1; ; attempt++) {
    log.yuno(`→ ${method} ${path}${idempotencyKey ? `  X-Idempotency-Key=${idempotencyKey}` : ''}${attempt > 1 ? `  (retry ${attempt - 1}, same key)` : ''}`)
    try {
      const res = await fetch(`${config.yuno.apiUrl}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(20_000),
      })
      const text = await res.text()
      let json
      try { json = text ? JSON.parse(text) : null } catch { json = { message: text } }
      if (res.status >= 500 && attempt < attempts) throw new YunoApiError(res.status, json)
      log.yuno(`← ${res.status} ${path}${json?.status ? `  status=${json.status}` : ''}${json?.id ? `  id=${json.id}` : ''}`)
      if (!res.ok) throw new YunoApiError(res.status, json)
      return json
    } catch (err) {
      const transient = err.name === 'TimeoutError' || err.name === 'TypeError' || (err instanceof YunoApiError && err.status >= 500)
      if (!transient || attempt >= attempts) throw err
      log.warn(`Yuno ${path} failed (${err.message}) → retrying with the SAME idempotency key`)
      await sleep(500)
    }
  }
}

export const yuno = {
  createCustomer: (body, idempotencyKey) => request('POST', '/v1/customers', { body, idempotencyKey }),
  createCheckoutSession: (body, idempotencyKey) => request('POST', '/v1/checkout/sessions', { body, idempotencyKey }),
  createPayment: (body, idempotencyKey) => request('POST', '/v1/payments', { body, idempotencyKey }),
  // v2 wraps it as { payment }
  getPayment: async (id) => {
    const res = await request('GET', `/v1/payments/${id}`)
    return res?.payment ?? res
  },
}
