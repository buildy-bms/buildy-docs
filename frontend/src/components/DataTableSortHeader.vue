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
  <!-- La flèche dit ce que fera le prochain clic (croissant → décroissant → sans tri) ; une
       bulle posée sur le composant (<DataTableSortHeader v-tooltip>) explique la colonne. -->
  <th class="sortable" @click="$emit('toggle', sortKey)">
    <span><slot /></span>
    <span class="sort-ico"
          v-tooltip="activeKey === sortKey ? (dir === 'asc' ? 'Trier par ordre décroissant' : 'Annuler le tri') : 'Trier par ordre croissant'">{{
      activeKey === sortKey ? (dir === 'asc' ? '↑' : '↓') : '↕'
    }}</span>
  </th>
</template>
