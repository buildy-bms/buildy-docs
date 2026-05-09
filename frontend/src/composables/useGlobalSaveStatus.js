// Statut global de sauvegarde des audits BACS — agrégat des écritures
// passant par axios sur les routes audit. Sert un indicateur unique
// dans la toolbar (« Sauvegarde… » / « Tout enregistré » / « Erreur »)
// au lieu de devoir migrer chaque section vers `useAutosave`.
//
// Wiring : alimenté depuis l'interceptor axios (api.js) qui
// `notifySaveStart()` au request et `notifySaveEnd()` au response. Ce
// composable expose juste les refs réactifs aux composants Vue.
//
// Singleton process — un seul state pour toute l'app.
//
// En bonus : un beforeunload listener installé une fois qui prévient
// l'utilisateur s'il ferme l'onglet alors que des écritures sont en
// vol (sinon les modifs partent dans le vide).

import { ref, computed } from 'vue'

const inflight = ref(0)
const lastError = ref(null)
const lastSavedAt = ref(null)

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (e) => {
    if (inflight.value > 0) {
      e.preventDefault()
      e.returnValue = ''
    }
  })
}

const PREFIXES = [
  '/bacs-audit/', '/afs/', '/sites/', '/zones', '/sections',
]

function urlIsTracked(url) {
  if (!url || typeof url !== 'string') return false
  return PREFIXES.some(p => url.startsWith(p))
}

const METHODS = new Set(['post', 'patch', 'put', 'delete'])

export function notifySaveStart(method, url) {
  if (!METHODS.has((method || '').toLowerCase())) return
  if (!urlIsTracked(url)) return
  inflight.value += 1
}

export function notifySaveEnd(method, url, { ok, error }) {
  if (!METHODS.has((method || '').toLowerCase())) return
  if (!urlIsTracked(url)) return
  if (inflight.value > 0) inflight.value -= 1
  if (ok) {
    lastSavedAt.value = new Date()
    lastError.value = null
  } else {
    lastError.value = error || new Error('Save failed')
  }
}

/**
 * `state` agrégé :
 *  - 'saving' : au moins 1 requête en vol
 *  - 'error'  : pas de requête en vol mais la dernière a échoué
 *  - 'saved'  : pas de requête en vol et au moins une a réussi
 *  - 'idle'   : aucune écriture depuis le boot de la page
 */
export function useGlobalSaveStatus() {
  const state = computed(() => {
    if (inflight.value > 0) return 'saving'
    if (lastError.value) return 'error'
    if (lastSavedAt.value) return 'saved'
    return 'idle'
  })
  return {
    state,
    inflight,
    lastError,
    lastSavedAt,
    /** Reset l'état d'erreur après acquittement utilisateur. */
    clearError: () => { lastError.value = null },
  }
}
