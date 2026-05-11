<script setup>
/**
 * En-tête de colonne cliquable pour tri. Affiche l'indicateur ↑↓↕ selon
 * l'état actif. À utiliser dans un `<thead><tr>` de `.data-table`.
 *
 * Usage :
 *   <DataTableSortHeader
 *     sort-key="name"
 *     :active-key="sortKey"
 *     :dir="sortDir"
 *     @toggle="toggleSort"
 *   >Nom</DataTableSortHeader>
 */
defineProps({
  sortKey: { type: String, required: true },
  activeKey: { type: [String, null], default: null },
  dir: { type: String, default: 'asc' },
})
defineEmits(['toggle'])
</script>

<template>
  <th class="sortable" @click="$emit('toggle', sortKey)">
    <span><slot /></span>
    <span class="sort-ico">{{
      activeKey === sortKey ? (dir === 'asc' ? '↑' : '↓') : '↕'
    }}</span>
  </th>
</template>
