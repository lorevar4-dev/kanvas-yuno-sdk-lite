// In sandbox mode, missing credentials stop the server (no silent fallback to mock).
import { MOCK_CREDENTIALS, MOCK_YUNO_URL } from '../../../../tools/mock-yuno/credentials.js'

try { process.loadEnvFile(new URL('../../../../.env', import.meta.url)) } catch {}

const env = (name) => process.env[name]?.trim() || undefined
const mode = env('YUNO_MODE') ?? 'mock'

function fail(message) {
  console.error(`\n✖ Config error: ${message}\n  Edit .env at the repo root (see .env.example).\n`)
  process.exit(1)
}

if (!['mock', 'sandbox'].includes(mode)) fail(`YUNO_MODE must be "mock" or "sandbox" (got "${mode}")`)

let yuno
if (mode === 'mock') {
  yuno = {
    apiUrl: MOCK_YUNO_URL,
    publicKey: MOCK_CREDENTIALS.publicKey,
    secretKey: MOCK_CREDENTIALS.secretKey,
    accountId: MOCK_CREDENTIALS.accountId,
    webhook: { apiKey: MOCK_CREDENTIALS.webhookApiKey, secret: MOCK_CREDENTIALS.webhookSecret, hmacSecret: MOCK_CREDENTIALS.webhookHmacSecret },
  }
} else {
  const missing = ['YUNO_PUBLIC_KEY', 'YUNO_SECRET_KEY', 'YUNO_ACCOUNT_ID'].filter((k) => !env(k))
  if (missing.length) fail(`YUNO_MODE=sandbox but ${missing.join(', ')} ${missing.length > 1 ? 'are' : 'is'} empty`)
  yuno = {
    apiUrl: 'https://api-sandbox.y.uno',
    publicKey: env('YUNO_PUBLIC_KEY'),
    secretKey: env('YUNO_SECRET_KEY'),
    accountId: env('YUNO_ACCOUNT_ID'),
    webhook: { apiKey: env('YUNO_WEBHOOK_API_KEY'), secret: env('YUNO_WEBHOOK_SECRET'), hmacSecret: env('YUNO_WEBHOOK_HMAC_SECRET') },
  }
  const { apiKey, secret, hmacSecret } = yuno.webhook
  if (!hmacSecret && !(apiKey && secret)) {
    fail('set YUNO_WEBHOOK_API_KEY + YUNO_WEBHOOK_SECRET (and/or YUNO_WEBHOOK_HMAC_SECRET) — an unauthenticated webhook endpoint could be used to mark orders as paid')
  }
}

const publicBaseUrl = env('PUBLIC_BASE_URL') ?? 'http://localhost:5174'
// Yuno's WAF answers 403 to a callback_url on localhost, so only send it when the shop is reachable
const isLocalUrl = (url) => /^https?:\/\/(localhost|127\.|0\.0\.0\.0|\[::1\])/i.test(url)

export const config = {
  mode,
  port: Number(env('PORT') ?? 3000),
  publicBaseUrl,
  callbackBaseUrl: isLocalUrl(publicBaseUrl) ? null : publicBaseUrl,
  yuno,
}
