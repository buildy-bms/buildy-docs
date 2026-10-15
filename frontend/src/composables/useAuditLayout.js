// Mise en page de l'audit desktop : « Actuelle » (classic) ou « Nouvelle » (guided), pour toutes
// les étapes. Un seul état partagé (module) : le choix fait dans le bandeau d'une étape vaut pour
// les autres. Mémorisé dans le navigateur, tous audits confondus ; l'actuelle reste le défaut.
// Reprend le choix déjà fait sur l'étape Systèmes (`bacs-systems-layout`, 13/10).
import { computed, ref } from 'vue'

const KEY = 'bacs-audit-layout'
const LEGACY_KEY = 'bacs-systems-layout'

function read() {
  try {
    const v = localStorage.getItem(KEY) ?? localStorage.getItem(LEGACY_KEY)
    return v === 'guided' ? 'guided' : 'classic'
  } catch {
    return 'classic'
  }
}

const layout = ref(read())
const isGuidedLayout = computed(() => layout.value === 'guided')

function setLayout(v) {
  layout.value = v === 'guided' ? 'guided' : 'classic'
  try { localStorage.setItem(KEY, layout.value) } catch { /* navigation privée */ }
}

export function useAuditLayout() {
  return { layout, isGuidedLayout, setLayout }
}
