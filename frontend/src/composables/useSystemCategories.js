import { ref } from 'vue'
import { listSystemCategories } from '@/api'

/**
 * Composable d'accès au catalogue des catégories de systèmes (table
 * `system_categories_db`). Source de vérité unique pour tous les dropdowns
 * et groupements d'affichage des templates équipement / instances.
 *
 * - Cache module-level partagé : 1 fetch / session, mutualisé entre tous les
 *   composants consommateurs (pattern useNotification.js).
 * - Reactive : tous les consommateurs voient la même `categories` ref.
 * - Legacy fallback : `equipment_templates.category` contient encore des
 *   valeurs historiques ('eclairage', 'electricite') qui n'existent pas comme
 *   clé DB. On les ajoute virtuellement à la liste pour que les dropdowns
 *   affichent un libellé propre et que les anciens templates restent
 *   éditables. À retirer quand le backfill aura migré vers les clés DB
 *   ('eclairage_int' / 'eclairage_ext' / 'pv').
 */

const LEGACY = [
  { key: 'eclairage',   label: 'Éclairage',   icon: 'fa-lightbulb', color: '#eab308' },
  { key: 'electricite', label: 'Électricité', icon: 'fa-bolt',      color: '#a855f7' },
]

const categories = ref([])
const loaded = ref(false)
const loading = ref(false)
let inflight = null

async function loadOnce() {
  if (loaded.value) return
  if (inflight) return inflight
  loading.value = true
  inflight = listSystemCategories()
    .then(({ data }) => {
      const fromDb = (data || []).map(c => ({
        key: c.key,
        label: c.label,
        icon: c.icon_value || 'fa-cube',
        color: c.icon_color || '#6b7280',
        bacs: c.bacs || null,
        position: c.position ?? 0,
      }))
      const dbKeys = new Set(fromDb.map(c => c.key))
      const legacyToAdd = LEGACY
        .filter(l => !dbKeys.has(l.key))
        .map(l => ({ ...l, bacs: null, position: 9999 }))
      categories.value = [...fromDb, ...legacyToAdd]
      loaded.value = true
    })
    .catch(() => {
      // Fallback : si l'API échoue, on garde au moins le legacy pour ne pas
      // casser les dropdowns. L'erreur est silencieuse — un simple re-render
      // suivant tentera de recharger.
      if (categories.value.length === 0) {
        categories.value = LEGACY.map(l => ({ ...l, bacs: null, position: 9999 }))
      }
    })
    .finally(() => {
      loading.value = false
      inflight = null
    })
  return inflight
}

export function useSystemCategories() {
  loadOnce()

  function labelOf(key) {
    return categories.value.find(c => c.key === key)?.label || key
  }
  function iconOf(key) {
    const c = categories.value.find(c => c.key === key)
    return c ? { name: c.icon, color: c.color } : null
  }
  async function refresh() {
    loaded.value = false
    inflight = null
    await loadOnce()
  }

  return { categories, loading, labelOf, iconOf, refresh }
}
