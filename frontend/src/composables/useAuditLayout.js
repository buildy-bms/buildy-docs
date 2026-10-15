// Mise en page de l'audit desktop : « Actuelle » (classic) ou « Nouvelle » (guided), pour toutes
// les étapes. Un seul état partagé (module) : le choix fait dans le bandeau d'une étape vaut pour
// les autres. Mémorisé dans le navigateur, tous audits confondus.
// La nouvelle est imposée à tous (demande de Kévin, 2026-10-15) : défaut « Nouvelle », et nouvelle
// clé de mémoire (v2) pour que les choix « Actuelle » faits avant n'y restent pas. Le bouton du
// bandeau permet encore de revenir à l'actuelle pour comparer.
import { computed, ref } from 'vue'

const KEY = 'bacs-audit-layout-v2'

function read() {
  try {
    return localStorage.getItem(KEY) === 'classic' ? 'classic' : 'guided'
  } catch {
    return 'guided'
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
