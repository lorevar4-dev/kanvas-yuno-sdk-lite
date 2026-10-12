import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: true,
    proxy: { '/api': 'http://localhost:3000' },
  },
  resolve: {
    alias: { '@kanvas/mock-yuno-sdk': fileURLToPath(new URL('../../../tools/mock-yuno/sdk/index.js', import.meta.url)) },
  },
})
