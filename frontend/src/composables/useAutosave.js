import { ref } from 'vue'

/**
 * Autosave debounce + statut visuel.
 *
 * Usage :
 *   const { state, lastSaved, schedule, cancel, flush } = useAutosave(saveFn, { delay: 800 })
 *
 *   - state.value : 'idle' | 'pending' | 'saving' | 'saved' | 'error'
 *   - lastSaved.value : Date du dernier succès (ou null)
 *   - schedule(payload) : programme une sauvegarde dans `delay` ms ; les
 *     appels successifs annulent la précédente (debounce). Le dernier
 *     payload est utilisé.
 *   - cancel() : annule la sauvegarde en attente sans perdre la donnée.
 *   - flush() : exécute immédiatement la sauvegarde en attente.
 */
export function useAutosave(saveFn, { delay = 800 } = {}) {
  const state = ref('idle')
  const lastSaved = ref(null)
  const lastError = ref(null)

  let timer = null
  let pendingPayload = null

  async function execute() {
    if (pendingPayload === null) return
    const payload = pendingPayload
    pendingPayload = null
    state.value = 'saving'
    try {
      await saveFn(payload)
      state.value = 'saved'
      lastSaved.value = new Date()
      lastError.value = null
    } catch (err) {
      state.value = 'error'
      lastError.value = err
    }
  }

  function schedule(payload) {
    pendingPayload = payload
    state.value = 'pending'
    if (timer) clearTimeout(timer)
    timer = setTimeout(execute, delay)
  }

  function cancel() {
    if (timer) clearTimeout(timer)
    timer = null
    pendingPayload = null
    if (state.value === 'pending') state.value = 'idle'
  }

  async function flush() {
    if (timer) clearTimeout(timer)
    timer = null
    await execute()
  }

  return { state, lastSaved, lastError, schedule, cancel, flush }
}
