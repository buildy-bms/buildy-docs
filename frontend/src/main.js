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

createApp(App).use(createPinia()).use(router).mount('#app')

// Service worker : DESACTIVE temporairement.
// On unregister proactivement tout SW existant (fix incident 2026-05-05
// où le SW v1 cassait la chaîne de redirects OIDC sur Safari iOS). Quand
// la PWA sera réactivée, on bumpera ce flag et on registrera un SW propre.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations()
    .then((regs) => Promise.all(regs.map((r) => r.unregister())))
    .then((results) => {
      if (results.some(Boolean)) {
        // Caches CacheStorage : purge complète si on vient de unregister
        if ('caches' in window) {
          caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
        }
        console.info('[sw] désinscrit (kill-switch)')
      }
    })
    .catch(() => { /* silencieux */ })
}
