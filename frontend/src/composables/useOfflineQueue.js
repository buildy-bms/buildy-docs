// Wrapper Vue autour de la queue offline (lib/offline-queue) :
//  - expose un ref réactif `pendingCount`
//  - drain automatique au retour en ligne (`online` event)
//  - drain également au focus (utile sur iOS Safari où `online` n'est
//    pas toujours fiable selon les transitions WiFi/4G)
//  - notification toast quand des mutations échouent au drain (4xx
//    persistant) — l'auditeur doit savoir qu'une saisie a été refusée
//    par le serveur après coup.
//
// Volontairement instancié au plus haut niveau (dans App.vue ou un
// layout racine) pour rester actif sur toute l'app PWA, pas seulement
// pendant qu'un audit est ouvert.

import { ref, onMounted, onBeforeUnmount } from 'vue'
import { pendingCount, drain, onQueueChange } from '@/lib/offline-queue'
import { useNotification } from '@/composables/useNotification'
import api from '@/api'

export function useOfflineQueue() {
  const count = ref(pendingCount())
  const draining = ref(false)
  const { error: notifyError, success } = useNotification()

  let unsubChange = () => {}

  function refreshCount() { count.value = pendingCount() }

  async function tryDrain() {
    if (draining.value) return
    if (typeof navigator !== 'undefined' && !navigator.onLine) return
    if (count.value === 0) return
    draining.value = true
    try {
      const stats = await drain(api, {
        onMutationFailed: (item, err) => {
          const detail = err?.response?.data?.detail || `Erreur ${err?.response?.status || ''}`
          notifyError(`Modification rejetée par le serveur (${item.method} ${item.url}) : ${detail}`)
        },
      })
      if (stats.replayed > 0) {
        success(`${stats.replayed} modification${stats.replayed > 1 ? 's' : ''} synchronisée${stats.replayed > 1 ? 's' : ''} après reconnexion`)
      }
    } finally {
      draining.value = false
      refreshCount()
    }
  }

  function onOnline() { tryDrain() }
  function onFocus() {
    if (typeof navigator !== 'undefined' && navigator.onLine) tryDrain()
  }

  onMounted(() => {
    if (typeof window === 'undefined') return
    window.addEventListener('online', onOnline)
    window.addEventListener('focus', onFocus)
    unsubChange = onQueueChange(refreshCount)
    // Premier essai au boot : au cas où on a quitté l'app avec des
    // mutations pending et qu'on revient online sans event `online`.
    tryDrain()
  })

  onBeforeUnmount(() => {
    if (typeof window === 'undefined') return
    window.removeEventListener('online', onOnline)
    window.removeEventListener('focus', onFocus)
    unsubChange()
  })

  return {
    pendingCount: count,
    draining,
    forceDrain: tryDrain,
  }
}
