import express from 'express'
import { MARKETS, PRODUCTS } from './catalog.js'
import { config } from './config.js'
import { log, paint } from './logger.js'
import { startReconciler } from './reconcile.js'
import { ordersRouter } from './routes/orders.js'
import { webhooksRouter } from './routes/webhooks.js'

const app = express()

// Before express.json(): the webhook needs the raw body for HMAC
app.use(webhooksRouter)

app.use('/api', express.json({ limit: '100kb' }))
app.use('/api', (req, res, next) => {
  const started = Date.now()
  res.on('finish', () => log.api(`${req.method} ${req.originalUrl} → ${res.statusCode} (${Date.now() - started} ms)`))
  next()
})

app.get('/api/config', (req, res) => {
  res.json({ mode: config.mode, publicKey: config.yuno.publicKey, markets: MARKETS, products: PRODUCTS })
})
app.use('/api', ordersRouter)

app.listen(config.port, () => {
  const tag = config.mode === 'mock' ? `${paint.yellow}MOCK (local simulator — not hitting Yuno)${paint.reset}` : `${paint.green}SANDBOX${paint.reset}`
  log.info(`Kanvas backend on http://localhost:${config.port} · mode ${tag} · Yuno API ${config.yuno.apiUrl}`)
  log.info(`webhook endpoint: POST /webhooks/yuno · auth: ${[config.yuno.webhook.apiKey && 'x-api-key/x-secret', config.yuno.webhook.hmacSecret && 'HMAC'].filter(Boolean).join(' + ')}`)
  startReconciler()
})
