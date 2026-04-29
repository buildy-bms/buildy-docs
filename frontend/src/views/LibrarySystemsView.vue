<script setup>
/**
 * Wrapper "Systèmes techniques" — regroupe les modèles d'équipement
 * et les catégories de systèmes dans une même page avec onglets.
 *
 * L'onglet actif est piloté par ?tab=models (défaut) ou ?tab=categories.
 */
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import LibraryEquipmentView from './LibraryEquipmentView.vue'
import LibraryCategoriesView from './LibraryCategoriesView.vue'

const route = useRoute()
const router = useRouter()

const tab = computed(() => route.query.tab === 'categories' ? 'categories' : 'models')

function setTab(name) {
  router.replace({ query: { ...route.query, tab: name === 'models' ? undefined : name } })
}

const TABS = [
  { id: 'models',     label: 'Modèles d\'équipement' },
  { id: 'categories', label: 'Catégories' },
]
</script>

<template>
  <div class="max-w-screen-2xl mx-auto">
    <div class="mb-4">
      <h1 class="text-2xl font-semibold text-gray-800">Systèmes techniques</h1>
      <p class="text-sm text-gray-500 mt-1">
        Bibliothèque des modèles d'équipement et de leurs catégories. Les articles BACS s'éditent au niveau de la catégorie et sont hérités par tous les équipements qui en relèvent.
      </p>
    </div>

    <!-- Onglets -->
    <div class="flex items-center gap-1 mb-5 border-b border-gray-200">
      <button v-for="t in TABS" :key="t.id" type="button" @click="setTab(t.id)"
              :class="['px-4 py-2 text-sm font-medium -mb-px border-b-2 transition',
                       tab === t.id
                         ? 'border-indigo-600 text-indigo-700'
                         : 'border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300']">
        {{ t.label }}
      </button>
    </div>

    <LibraryEquipmentView v-if="tab === 'models'" embedded />
    <LibraryCategoriesView v-else embedded />
  </div>
</template>
