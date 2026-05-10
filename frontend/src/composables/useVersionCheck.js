// Détecte qu'une nouvelle version a été déployée côté serveur (le SHA git
// retourné par /api/health a changé) et expose un flag `updateAvailable`
// pour afficher un bandeau invitant à recharger l'app. Utilisé desktop +
// PWA. Pattern identique à Buildy Tools / Edge Fleet Manager.
//
// Approche pragmatique sans WebSocket : un poll toutes 60s, un check
// immédiat sur focus / visibility. Si le SHA observé diffère du SHA
// initial chargé au boot, on signale.

import { ref, onMounted, onBeforeUnmount } from 'vue'
import api from '@/api'

// Singleton : on partage l'état entre toutes les instances du composable
// (évite que chaque appel relance son propre poll). La 1re instance
// initialise le polling, les suivantes lisent juste les refs.
const updateAvailable = ref(false)
const newVersion = ref('')
const newBuildSha = ref('')
let initialBuildSha = null
let pollHandle = null
let started = false

async function checkOnce() {
  try {
    const { data } = await api.get('/health')
    const sha = data.build_sha || ''
    if (initialBuildSha === null) {
      initialBuildSha = sha
      newVersion.value = data.version || ''
      newBuildSha.value = sha
      return
    }
    if (sha && sha !== initialBuildSha) {
      updateAvailable.value = true
      newVersion.value = data.version || ''
      newBuildSha.value = sha
    }
  } catch { /* offline ou serveur down — on retentera */ }
}

function start({ intervalMs = 60_000 } = {}) {
  if (started || typeof window === 'undefined') return
  started = true
  checkOnce()
  pollHandle = setInterval(() => {
    if (document.visibilityState === 'visible') checkOnce()
  }, intervalMs)
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('focus', checkOnce)
  window.addEventListener('pageshow', checkOnce)
}

function stop() {
  if (pollHandle) clearInterval(pollHandle)
  pollHandle = null
  if (typeof window !== 'undefined') {
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('focus', checkOnce)
    window.removeEventListener('pageshow', checkOnce)
  }
  started = false
  initialBuildSha = null
  updateAvailable.value = false
}

function onVisibility() {
  if (document.visibilityState === 'visible') checkOnce()
}

export function useVersionCheck(opts = {}) {
  onMounted(() => start(opts))
  // On ne stop QUE quand l'app entière s'unmount (tous les composants qui
  // utilisent ce composable doivent voir le même état). En pratique, le
  // composable est mounté dans App.vue qui ne s'unmount jamais.
  onBeforeUnmount(() => { /* singleton, garder actif */ })
  return { updateAvailable, newVersion, newBuildSha, reload: hardReload }
}

// Reload "dur" : vide le cache du SW PWA et recharge sans cache navigateur.
// Sans ça, sur PWA standalone iOS, l'ancien bundle reste servi par le SW.
async function hardReload() {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations()
      await Promise.all(regs.map(r => r.unregister()))
    }
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys()
      await Promise.all(keys.map(k => caches.delete(k)))
    }
  } catch { /* ignore — on tente le reload de toute façon */ }
  // bypass-cache : true (FF/Chrome supportent ; iOS ignore mais le SW
  // a déjà été unregister juste avant donc le bundle revient propre).
  window.location.reload(true)
}

// Stop est exposé pour les tests (ne pas appeler en prod).
export const __stopVersionCheck = stop
