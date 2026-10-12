// Only here so Diego's checkout.jsx runs unchanged. See ../BUGS.md.
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { MOCK_CREDENTIALS, MOCK_YUNO_URL } from '../../../tools/mock-yuno/credentials.js'

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))
const mockSdk = fileURLToPath(new URL('../../../tools/mock-yuno/sdk/index.js', import.meta.url))

// The brief ships placeholder keys; swap them for real ones when the file is served.
function injectKeys(publicKey, secretKey) {
  return {
    name: 'inject-staging-keys',
    enforce: 'pre',
    transform(code, id) {
      if (!id.endsWith('/src/checkout.jsx')) return
      return code
        .replace("'sandbox_pub_9f2c...'", JSON.stringify(publicKey))
        .replace("'sandbox_secret_a17d...'", JSON.stringify(secretKey))
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repoRoot, '')
  const yunoMode = env.YUNO_MODE || 'mock'
  const isMock = yunoMode === 'mock'
  const publicKey = isMock ? MOCK_CREDENTIALS.publicKey : env.YUNO_PUBLIC_KEY ?? ''
  const secretKey = isMock ? MOCK_CREDENTIALS.secretKey : env.YUNO_SECRET_KEY ?? ''

  return {
    plugins: [react(), injectKeys(publicKey, secretKey)],
    envDir: repoRoot,
    server: {
      port: 5173,
      strictPort: true,
      // Browsers can't call api-sandbox.y.uno directly (CORS). Forward as-is, headers included.
      proxy: {
        '/yuno-api': {
          target: isMock ? MOCK_YUNO_URL : 'https://api-sandbox.y.uno',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/yuno-api/, ''),
        },
      },
    },
    resolve: { alias: isMock ? { '@yuno-payments/sdk-web': mockSdk } : {} },
    define: { __YUNO_MODE__: JSON.stringify(yunoMode) },
  }
})
