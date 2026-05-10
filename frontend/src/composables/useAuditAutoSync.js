// Synchro pull-based d'un audit ouvert : rafraîchit le store quand
// l'utilisateur revient sur l'onglet (focus / visibility) et toutes les
// `intervalMs` ms tant que la page est visible. Évite à un binôme
// (auditeur PWA mobile + chef de projet desktop) de devoir F5 pour
// voir les modifications de l'autre.
//
// Approche pragmatique sans WebSocket : suffisant pour un audit (on
// n'est pas dans un chat temps réel). Si on a besoin de plus rapide
// plus tard, basculer en SSE / WS sans changer l'API publique.
//
// Usage :
//   import { useAuditAutoSync } from '@/composables/useAuditAutoSync'
//   useAuditAutoSync({ intervalMs: 30000 })   // dans setup() de la vue audit

import { onMounted, onBeforeUnmount } from 'vue'
import { useAuditStore } from '@/stores/audit'

export function useAuditAutoSync({ intervalMs = 30000, focusGraceMs = 2000 } = {}) {
  const audit = useAuditStore()

  let pollHandle = null
  let lastSyncAt = Date.now()
  let blurredAt = null

  function tick() {
    if (typeof document === 'undefined') return
    if (document.visibilityState !== 'visible') return
    if (audit.loading || audit.saving) return
    audit.softRefresh()
    lastSyncAt = Date.now()
  }

  function onFocus() {
    // Si on a quitté la page > focusGraceMs, on resynchronise tout de
    // suite (pas la peine d'attendre le prochain tick). On évite les
    // sync-spam quand l'utilisateur ne fait que cliquer dans/hors la
    // fenêtre rapidement.
    const wasBlurredFor = blurredAt ? Date.now() - blurredAt : 0
    blurredAt = null
    if (wasBlurredFor >= focusGraceMs) tick()
  }

  function onBlur() {
    blurredAt = Date.now()
  }

  function onVisibilityChange() {
    if (document.visibilityState === 'visible') onFocus()
    else onBlur()
  }

  // pageshow couvre le cas iOS PWA standalone ou Safari mobile : visibility/
  // focus ne se déclenchent pas toujours quand l'utilisateur revient depuis
  // l'app switcher ou un swipe back. pageshow est plus fiable, en
  // particulier avec `event.persisted` qui distingue le bfcache.
  function onPageShow(e) {
    if (e.persisted || document.visibilityState === 'visible') tick()
  }

  onMounted(() => {
    if (typeof window === 'undefined') return
    window.addEventListener('focus', onFocus)
    window.addEventListener('blur', onBlur)
    window.addEventListener('pageshow', onPageShow)
    document.addEventListener('visibilitychange', onVisibilityChange)
    pollHandle = setInterval(tick, intervalMs)
  })

  onBeforeUnmount(() => {
    if (typeof window === 'undefined') return
    window.removeEventListener('focus', onFocus)
    window.removeEventListener('blur', onBlur)
    window.removeEventListener('pageshow', onPageShow)
    document.removeEventListener('visibilitychange', onVisibilityChange)
    if (pollHandle) clearInterval(pollHandle)
    pollHandle = null
  })

  return {
    /**
     * Force une resynchronisation immédiate (utile pour un bouton
     * « Actualiser » ou après un appel d'écriture qui a touché un
     * sous-ensemble de données qu'on veut tout de suite voir mises
     * à jour).
     */
    forceSync: () => audit.softRefresh(),
    lastSyncAt: () => lastSyncAt,
  }
}
