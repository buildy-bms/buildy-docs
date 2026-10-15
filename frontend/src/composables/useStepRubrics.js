// Rubriques repliables d'une étape (mise en page « Nouvelle » : GTB, Identification…), comme la
// fiche équipement de l'étape Systèmes : le reste à faire d'abord (rubriques incomplètes ouvertes),
// ou toute l'étape (choix mémorisé dans le navigateur, commun aux étapes à rubriques).
//   rubrics : ref/computed d'une liste [{ key, anchor, state ('todo'|'open'|'done'), optional }]
//   resetKey : getter ; les rubriques par défaut sont recalculées quand il change (audit, mise en page)
import { ref, watch, nextTick } from 'vue'
import { flashAuditTarget } from '@/lib/audit-reveal'

const STORAGE_KEY = 'bacs-step-rubrics'
const showAll = ref((() => { try { return localStorage.getItem(STORAGE_KEY) === 'all' } catch { return false } })())

export function useStepRubrics(rubrics, resetKey) {
  const openKeys = ref(new Set())
  const defaultOpen = () => new Set((rubrics.value || []).filter(r => r.state !== 'done' && !r.optional).map(r => r.key))
  watch(resetKey, () => { openKeys.value = defaultOpen() }, { immediate: true })

  function setShowAll(v) {
    showAll.value = !!v
    try { localStorage.setItem(STORAGE_KEY, v ? 'all' : 'todo') } catch { /* navigation privée */ }
  }
  function showTodo() {
    setShowAll(false)
    openKeys.value = defaultOpen()
  }
  const isOpen = (key) => showAll.value || openKeys.value.has(key)
  function toggle(key) {
    const next = showAll.value ? new Set((rubrics.value || []).map(r => r.key)) : new Set(openKeys.value)
    if (showAll.value) setShowAll(false)
    if (next.has(key)) next.delete(key); else next.add(key)
    openKeys.value = next
  }
  // Ouvre une rubrique et l'amène à l'écran (guide de gauche, « Reprendre »).
  const active = ref(null)
  function goTo(key) {
    const r = (rubrics.value || []).find(x => x.key === key)
    if (!r) return
    active.value = key
    if (!showAll.value) openKeys.value = new Set([...openKeys.value, key])
    nextTick(() => {
      const el = window.document.getElementById(r.anchor)
      if (!el) return
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      flashAuditTarget(el)
    })
  }
  return { showAll, setShowAll, showTodo, isOpen, toggle, goTo, active }
}
