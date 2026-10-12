// Boots Diego's routes/payments.js unchanged. Not part of his code.
const path = require('node:path')
const express = require('express')

try { process.loadEnvFile(path.resolve(__dirname, '../../../.env')) } catch {}

const MODE = process.env.YUNO_MODE ?? 'mock'
if (MODE === 'mock') {
  const { MOCK_CREDENTIALS, MOCK_YUNO_URL } = require('../../../tools/mock-yuno/credentials.js')
  process.env.YUNO_SECRET_KEY = MOCK_CREDENTIALS.secretKey
  const realFetch = globalThis.fetch
  globalThis.fetch = (url, options) => realFetch(String(url).replace('https://api-sandbox.y.uno', MOCK_YUNO_URL), options)
}

const app = express()
app.use(express.json())
app.use((req, res, next) => {
  const started = Date.now()
  res.on('finish', () => console.log(`${new Date().toISOString().slice(11, 19)} [BROKEN-BE] ${req.method} ${req.path} → ${res.statusCode} (${Date.now() - started} ms)`))
  next()
})
// The route file uses `app` as a global
global.app = app

require('./routes/payments')

const PORT = 4000
app.listen(PORT, () => console.log(`[BROKEN-BE] Diego's staging backend on http://localhost:${PORT} (mode=${MODE})`))
