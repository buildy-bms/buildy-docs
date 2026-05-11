// Tri d'un tableau de rows par clé. 3 clics : asc → desc → désactivé.
// Stable : préserve l'ordre d'origine pour les valeurs égales.
//
// Usage :
//   const { sortKey, sortDir, toggleSort, sortedRows } = useTableSort()
//   const rows = computed(() => sortedRows(devices.value, (d, k) => {
//     if (k === 'name') return (d.name || '').toLowerCase()
//     if (k === 'power_kw') return Number(d.power_kw) || 0
//     return ''
//   }))

import { ref } from 'vue'

export function useTableSort(initialKey = null, initialDir = 'asc') {
  const sortKey = ref(initialKey)
  const sortDir = ref(initialDir)

  function toggleSort(key) {
    if (sortKey.value !== key) {
      sortKey.value = key
      sortDir.value = 'asc'
      return
    }
    if (sortDir.value === 'asc') {
      sortDir.value = 'desc'
      return
    }
    sortKey.value = null
    sortDir.value = 'asc'
  }

  function sortedRows(rows, sortValueFn) {
    if (!sortKey.value || !Array.isArray(rows)) return rows || []
    const dir = sortDir.value === 'desc' ? -1 : 1
    return [...rows].sort((a, b) => {
      const av = sortValueFn(a, sortKey.value)
      const bv = sortValueFn(b, sortKey.value)
      if (av < bv) return -1 * dir
      if (av > bv) return 1 * dir
      return 0
    })
  }

  return { sortKey, sortDir, toggleSort, sortedRows }
}
