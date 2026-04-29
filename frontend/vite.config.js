import { fileURLToPath, URL } from 'node:url'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

// Detecter HTTPS depuis le .env du backend
function isBackendHttps() {
  try {
    const env = readFileSync(resolve(__dirname, '../.env'), 'utf-8')
    return /^HTTPS_ENABLED=true$/m.test(env)
  } catch { return false }
}

const httpsEnabled = isBackendHttps()
const backendUrl = httpsEnabled ? 'https://localhost:3100' : 'http://localhost:3100'

const serverHttps = httpsEnabled
  ? {
      key: readFileSync(resolve(__dirname, '../certs/server.key')),
      cert: readFileSync(resolve(__dirname, '../certs/server.crt')),
    }
  : false

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    https: serverHttps,
    proxy: {
      '/api': {
        target: backendUrl,
        secure: false,
      },
      // Sans ce proxy, /attachments/... part au dev server Vite qui sert
      // le SPA index.html en text/html → les <img> recoivent du HTML et
      // affichent une miniature cassee en silence (meme bug que commit
      // 9937b1e cote Fastify).
      '/attachments': {
        target: backendUrl,
        secure: false,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
})
