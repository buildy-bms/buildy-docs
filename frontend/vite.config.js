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
const backendPort = process.env.BACKEND_PORT || '3100'
const backendUrl = httpsEnabled ? `https://localhost:${backendPort}` : `http://localhost:${backendPort}`

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
    rollupOptions: {
      output: {
        // FA Pro Solid : sans ce manualChunks, Rollup hoist tout le module
        // (qui pese ~2.5 Mo une fois minifie) dans le chunk du 1er
        // consommateur. Resultat : equipment-icons.js gonfle a 2.5 Mo et
        // bloque le 1er paint de l'AF. En isolant FA dans son propre chunk
        // partage, les imports nommes (faFire, faCube, ...) sont reellement
        // tree-shakes — chaque chunk consommateur ne reference que ses
        // icones et fa-pro-solid n'est telecharge qu'a la demande.
        manualChunks(id) {
          if (id.includes('@fortawesome/pro-solid-svg-icons')) {
            return 'fa-pro-solid'
          }
        },
      },
    },
  },
})
