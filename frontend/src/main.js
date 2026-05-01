// Polices Buildy (Poppins pour UI/titres, Manrope pour corps long)
import '@fontsource/poppins/400.css'
import '@fontsource/poppins/500.css'
import '@fontsource/poppins/600.css'
import '@fontsource/poppins/700.css'
import '@fontsource/manrope/400.css'
import '@fontsource/manrope/500.css'
import '@fontsource/manrope/600.css'
import '@fontsource/manrope/700.css'

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
