import { ref, computed } from 'vue'

function normalize(s) {
  return (s ?? '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

function compareValues(a, b) {
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return normalize(a).localeCompare(normalize(b), 'fr', { numeric: true })
}

/**
 * Composable de tri/filtre client-side pour les tableaux d'AF (instances,
 * points, zones). Tri local par colonne (toggle asc/desc/none au clic),
 * filtre par colonne (substring case-insensitive accent-insensitive).
 *
 * Usage :
 *   const { sortKey, sortDir, columnFilters, processed, toggleSort, setFilter } =
 *     useTableSortFilter(rowsRef, { defaultSortKey: 'reference' })
 *
 *   <th @click="toggleSort('reference')">
 *     Repère
 *     <span v-if="sortKey === 'reference'">{{ sortDir === 'asc' ? '↑' : '↓' }}</span>
 *   </th>
 *   <input :value="columnFilters.reference || ''"
 *          @input="setFilter('reference', $event.target.value)" />
 *
 * Les valeurs filtrees/triees sont dans `processed` (computed).
 */
export function useTableSortFilter(rowsRef, opts = {}) {
  const sortKey = ref(opts.defaultSortKey || null)
  const sortDir = ref(opts.defaultSortDir || 'asc')
  const columnFilters = ref({})

  function toggleSort(key) {
    if (sortKey.value !== key) {
      sortKey.value = key
      sortDir.value = 'asc'
    } else if (sortDir.value === 'asc') {
      sortDir.value = 'desc'
    } else {
      sortKey.value = null
      sortDir.value = 'asc'
    }
  }

  function setFilter(key, value) {
    if (value == null || value === '') {
      const next = { ...columnFilters.value }
      delete next[key]
      columnFilters.value = next
    } else {
      columnFilters.value = { ...columnFilters.value, [key]: value }
    }
  }

  function clearAll() {
    sortKey.value = null
    columnFilters.value = {}
  }

  const processed = computed(() => {
    const rows = Array.isArray(rowsRef.value) ? rowsRef.value : []
    let out = rows
    const filters = columnFilters.value
    const filterEntries = Object.entries(filters)
    if (filterEntries.length) {
      out = out.filter(row => {
        for (const [key, q] of filterEntries) {
          if (!normalize(row?.[key]).includes(normalize(q))) return false
        }
        return true
      })
    }
    if (sortKey.value) {
      const k = sortKey.value
      const sign = sortDir.value === 'asc' ? 1 : -1
      out = [...out].sort((a, b) => sign * compareValues(a?.[k], b?.[k]))
    }
    return out
  })

  return { sortKey, sortDir, columnFilters, processed, toggleSort, setFilter, clearAll }
}
