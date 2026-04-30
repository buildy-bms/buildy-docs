import { ref } from 'vue'

/**
 * Autosave debounce + statut visuel + retry exponentiel.
 *
 * Usage :
 *   const { state, lastSaved, lastError, attempt, schedule, cancel, flush }
 *     = useAutosave(saveFn, { delay: 800, retries: 3 })
 *
 *   - state.value : 'idle' | 'pending' | 'saving' | 'saved' | 'error'
 *   - lastSaved.value : Date du dernier succès (ou null)
 *   - lastError.value : Error de la dernière tentative (null si pas d'erreur)
 *   - attempt.value : numéro de tentative en cours (0 si pas de retry actif)
 *   - schedule(payload) : programme une sauvegarde dans `delay` ms ; les
 *     appels successifs annulent la précédente (debounce). Le dernier
 *     payload est utilisé.
 *   - cancel() : annule la sauvegarde en attente sans perdre la donnée.
 *   - flush() : exécute immédiatement la sauvegarde en attente.
 *
 * En cas d'échec : on retente jusqu'à `retries` fois avec un backoff
 * exponentiel (1s, 3s, 9s par défaut). Le payload non sauvegardé est
 * conservé pour le retry. L'état reste 'error' tant qu'aucune tentative
 * n'a abouti, ce qui permet à l'UI d'afficher un feedback persistant.
 */
export function useAutosave(saveFn, { delay = 800, retries = 3, baseRetryDelay = 1000 } = {}) {
  const state = ref('idle')
  const lastSaved = ref(null)
  const lastError = ref(null)
  const attempt = ref(0)

  let debounceTimer = null
  let retryTimer = null
  let pendingPayload = null

  async function execute() {
    if (pendingPayload === null) return
    const payload = pendingPayload
    state.value = 'saving'
    try {
      await saveFn(payload)
      // Succès : on ne libère le payload que s'il n'a pas changé pendant le
      // save (sinon un nouveau schedule() pendant la requête perdrait sa
      // donnée). Si pendingPayload a changé, schedule() a déjà repassé state
      // à 'pending' et armé un nouveau timer — on laisse faire.
      lastSaved.value = new Date()
      lastError.value = null
      attempt.value = 0
      if (pendingPayload === payload) {
        pendingPayload = null
        state.value = 'saved'
      }
    } catch (err) {
      state.value = 'error'
      lastError.value = err
      // Retry exponentiel : 1s, 3s, 9s. Le payload reste pending pour qu'un
      // schedule() ultérieur le fusionne avec une nouvelle frappe sans perte.
      if (attempt.value < retries) {
        attempt.value += 1
        const wait = baseRetryDelay * Math.pow(3, attempt.value - 1)
        if (retryTimer) clearTimeout(retryTimer)
        retryTimer = setTimeout(execute, wait)
      }
      // Si toutes les tentatives ont échoué, on garde state='error' et on
      // attend qu'un nouveau schedule() relance la machine.
    }
  }

  function schedule(payload) {
    pendingPayload = payload
    state.value = 'pending'
    // Un nouveau schedule annule un retry en cours (le payload sera plus
    // récent) et reset le compteur de tentatives.
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null }
    attempt.value = 0
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(execute, delay)
  }

  function cancel() {
    if (debounceTimer) clearTimeout(debounceTimer)
    if (retryTimer) clearTimeout(retryTimer)
    debounceTimer = null
    retryTimer = null
    pendingPayload = null
    attempt.value = 0
    if (state.value === 'pending') state.value = 'idle'
  }

  async function flush() {
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null }
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null }
    await execute()
  }

  return { state, lastSaved, lastError, attempt, schedule, cancel, flush }
}
