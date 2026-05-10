import { ref, computed } from 'vue'

/**
 * Selection multi-lignes generique pour les tableaux de Buildy Docs.
 * Manipule un Set de cles (id ou cle composite). Les composants
 * BulkActionBar + checkboxes de tableau consomment cette API.
 *
 * Usage :
 *   const sel = useBulkSelection(() => filteredRows.value.map(r => r.id))
 *   sel.toggle(id) / sel.toggleAll() / sel.clear()
 *   sel.has(id) / sel.size / sel.allChecked / sel.someChecked
 *   sel.selectedRows(allRows) -> filtre allRows par les ids selectionnes
 */
export function useBulkSelection(visibleKeysFn) {
  const selected = ref(new Set())

  function has(key) { return selected.value.has(key) }
  function toggle(key) {
    const next = new Set(selected.value)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    selected.value = next
  }
  function add(key) {
    if (!selected.value.has(key)) {
      const next = new Set(selected.value); next.add(key); selected.value = next
    }
  }
  function clear() { selected.value = new Set() }

  // Coche / decoche toutes les cles visibles (apres filtre).
  function toggleAll() {
    const visible = visibleKeysFn() || []
    const allOn = visible.length > 0 && visible.every(k => selected.value.has(k))
    if (allOn) {
      const next = new Set(selected.value)
      for (const k of visible) next.delete(k)
      selected.value = next
    } else {
      const next = new Set(selected.value)
      for (const k of visible) next.add(k)
      selected.value = next
    }
  }
  function invert() {
    const visible = visibleKeysFn() || []
    const next = new Set(selected.value)
    for (const k of visible) {
      if (next.has(k)) next.delete(k); else next.add(k)
    }
    selected.value = next
  }

  const size = computed(() => selected.value.size)
  const allChecked = computed(() => {
    const visible = visibleKeysFn() || []
    return visible.length > 0 && visible.every(k => selected.value.has(k))
  })
  const someChecked = computed(() => {
    const visible = visibleKeysFn() || []
    return visible.some(k => selected.value.has(k)) && !allChecked.value
  })

  function selectedRows(allRows, keyFn = r => r.id) {
    return allRows.filter(r => selected.value.has(keyFn(r)))
  }

  return {
    selected, has, toggle, add, clear, toggleAll, invert,
    size, allChecked, someChecked, selectedRows,
  }
}
