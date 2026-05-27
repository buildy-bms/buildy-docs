// Polices Buildy : Poppins (titres) + Inter (corps).
// Inter = reference editoriale moderne (Stripe, Linear, Vercel, GitHub),
// alignement strict avec les PDF (cf. backend-node/src/lib/pdf.js).
import '@fontsource/poppins/400.css'
import '@fontsource/poppins/500.css'
import '@fontsource/poppins/600.css'
import '@fontsource/poppins/700.css'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'

import './assets/main.css'
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { tooltipDirective, truncateTooltipDirective } from './lib/tooltip-directive'

// Apres un deploy, l'index.html charge en cache pointe vers des chunks
// dont les hashs ont change cote serveur. L'import dynamique echoue
// alors avec "Failed to fetch dynamically imported module" : on reload
// pour recuperer la nouvelle index.html. Garde-fou : un seul reload par
// session pour eviter une boucle si le probleme est durable.
function handleChunkLoadError(reason) {
  const msg = (reason?.message || '').toString()
  const isChunkError =
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /Importing a module script failed/i.test(msg) ||
    /error loading dynamically imported module/i.test(msg)
  if (!isChunkError) return false
  const flag = 'buildy-docs.chunk-reload'
  if (sessionStorage.getItem(flag)) {
    console.error('[chunk] reload deja tente cette session, abandon', reason)
    return false
  }
  sessionStorage.setItem(flag, String(Date.now()))
  console.warn('[chunk] hash modifie cote serveur, reload de la page')
  window.location.reload()
  return true
}
window.addEventListener('vite:preloadError', (ev) => handleChunkLoadError(ev?.payload))
router.onError((err) => handleChunkLoadError(err))

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.directive('tooltip', tooltipDirective)
app.directive('truncate-tooltip', truncateTooltipDirective)
app.mount('#app')

// Charge la totalité de la lib FA Pro Solid en arrière-plan, après le
// 1er paint. Le chunk `fa-pro-solid` (~2,5 Mo) est isolé via vite.config
// manualChunks → 0 impact sur le bundle initial du chemin AF. Après ~1 s,
// toutes les icônes FA Pro deviennent disponibles dans `library`, ce qui
// évite d'avoir à maintenir le registre curé `lib/equipment-icons.js`
// pour chaque nouvelle icône utilisée dans la biblio ou ailleurs.
window.requestIdleCallback?.(() => {
  import('@fortawesome/pro-solid-svg-icons').then(async (mod) => {
    const { library } = await import('@fortawesome/fontawesome-svg-core')
    const icons = Object.values(mod).filter(i => i && i.iconName && i.icon)
    library.add(...icons)
  }).catch(() => { /* silencieux : le registre curé reste en fallback */ })
}, { timeout: 3000 })

// Service worker : PWA install standalone iOS / Android.
// SW minimal (cache assets statiques uniquement, pas d'interception
// nav/api/auth). Voir public/sw.js. On register en prod uniquement —
// en dev avec Vite HMR, le SW casse le hot reload.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* silencieux */ })
  })
}
