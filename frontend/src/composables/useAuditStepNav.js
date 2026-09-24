import { ref, computed, watch } from 'vue'

// Navigation par onglets d'étapes de l'audit BACS desktop.
//  - une seule étape affichée ; chaque étape est montée à sa 1re ouverture
//    puis conservée (état local préservé, chargement initial allégé) ;
//  - l'étape courante est dans l'adresse (`?step=<clé>`) : un rechargement
//    ou un lien direct rouvre la même étape ;
//  - sans `?step=` : toujours la première étape non validée (parcours guidé,
//    prévisible — pas de mémoire de la dernière étape consultée).
export function useAuditStepNav({ docId, steps, activeStepKey, route, router }) {
  // Nettoyage de l'ancienne mémoire locale (versions de dev du 2026-09-23).
  try { localStorage.removeItem(`bacs-audit-step:${docId}`) } catch { /* navigation privée */ }
  const visitedSteps = ref(new Set())

  const isEnabled = (key) => steps.value.some(s => s.key === key && !s.disabled)
  const activeTab = computed(() => steps.value.find(s => s.key === activeStepKey.value) || null)

  function neighbour(dir) {
    return computed(() => {
      const list = steps.value
      let i = list.findIndex(s => s.key === activeStepKey.value)
      if (i < 0) return null
      for (i += dir; i >= 0 && i < list.length; i += dir) {
        if (!list[i].disabled) return list[i]
      }
      return null
    })
  }
  const prevTab = neighbour(-1)
  const nextTab = neighbour(1)

  function goToStep(key, { scroll = true } = {}) {
    if (!isEnabled(key)) return false
    const changed = activeStepKey.value !== key
    activeStepKey.value = key
    visitedSteps.value.add(key)
    if (route.query.step !== key) router.replace({ query: { ...route.query, step: key } })
    if (changed && scroll) window.scrollTo({ top: 0 })
    return true
  }

  function defaultStepKey() {
    const q = route.query.step
    if (typeof q === 'string' && isEnabled(q)) return q
    return steps.value.find(s => !s.disabled && !s.validated)?.key
      || steps.value.find(s => !s.disabled)?.key
      || null
  }

  function initActiveStep() {
    const key = defaultStepKey()
    if (key) goToStep(key, { scroll: false })
  }

  // Lien direct modifié à la main dans la barre d'adresse.
  watch(() => route.query.step, (q) => {
    if (typeof q === 'string' && q !== activeStepKey.value && isEnabled(q)) goToStep(q)
  })
  // L'étape active devient sans objet (ex. GTB passée à « Non » alors que
  // l'onglet Inspections est ouvert) → on passe à l'étape voisine.
  watch(() => activeTab.value?.disabled, (disabled) => {
    if (!disabled) return
    const target = nextTab.value || prevTab.value
    if (target) goToStep(target.key, { scroll: false })
  })

  return { visitedSteps, activeTab, prevTab, nextTab, isEnabled, goToStep, initActiveStep }
}
