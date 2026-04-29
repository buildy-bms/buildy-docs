<script setup>
/**
 * Picker de template équipement en TABLEAU compact (préférence Kévin).
 * Filtres catégorie en chips au-dessus + tableau triable avec icône colorée,
 * nom, catégorie, slug, nombre de points dans rond #1b2842.
 *
 * v-model = id du template sélectionné (number | null)
 */
import { computed, ref } from 'vue'
import { CheckIcon } from '@heroicons/vue/24/outline'
import EquipmentIcon from './EquipmentIcon.vue'

const props = defineProps({
  modelValue: { type: Number, default: null },
  templates: { type: Array, required: true },
})
const emit = defineEmits(['update:modelValue'])

const CATEGORY_LABELS = {
  ventilation: 'Ventilation',
  chauffage: 'Chauffage',
  climatisation: 'Climatisation',
  ecs: 'Eau chaude sanitaire',
  eclairage: 'Éclairage',
  electricite: 'Électricité',
  comptage: 'Comptage énergétique',
  qai: 'Qualité de l\'air',
  occultation: 'Occultation',
  process: 'Process industriel',
  autres: 'Autres équipements',
}

const selectedCategory = ref('all')
const sortBy = ref('name')
const sortDir = ref('asc')

const categories = computed(() => {
  const cats = new Set(props.templates.map(t => t.category || 'autres'))
  return ['all', ...[...cats].sort((a, b) => (CATEGORY_LABELS[a] || a).localeCompare(CATEGORY_LABELS[b] || b, 'fr'))]
})

const filteredSorted = computed(() => {
  let list = selectedCategory.value === 'all'
    ? props.templates
    : props.templates.filter(t => (t.category || 'autres') === selectedCategory.value)
  list = [...list].sort((a, b) => {
    let av, bv
    if (sortBy.value === 'points_count') { av = a.points_count || 0; bv = b.points_count || 0 }
    else { av = (a[sortBy.value] || '').toString().toLowerCase(); bv = (b[sortBy.value] || '').toString().toLowerCase() }
    if (av < bv) return sortDir.value === 'asc' ? -1 : 1
    if (av > bv) return sortDir.value === 'asc' ? 1 : -1
    return 0
  })
  return list
})

function toggleSort(c) {
  if (sortBy.value === c) sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  else { sortBy.value = c; sortDir.value = 'asc' }
}

function select(t) { emit('update:modelValue', t.id) }
</script>

<template>
  <div>
    <!-- Filtres catégorie en chips compactes -->
    <div class="flex items-center gap-1 flex-wrap mb-2">
      <button
        v-for="cat in categories"
        :key="cat"
        type="button"
        @click="selectedCategory = cat"
        :class="[
          'px-2 py-0.5 text-[11px] rounded-full border transition-colors',
          selectedCategory === cat
            ? 'bg-indigo-600 text-white border-indigo-600'
            : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
        ]"
      >
        {{ cat === 'all' ? `Tous (${templates.length})` : CATEGORY_LABELS[cat] || cat }}
      </button>
    </div>

    <!-- Tableau compact -->
    <div class="border border-gray-200 max-h-[40vh] overflow-y-auto">
      <table class="w-full text-sm">
        <thead class="bg-gray-50 text-[10px] uppercase text-gray-500 tracking-wider sticky top-0">
          <tr>
            <th class="px-2 py-1.5"></th>
            <th class="text-left px-2 py-1.5 cursor-pointer hover:text-gray-700" @click="toggleSort('name')">
              Équipement {{ sortBy === 'name' ? (sortDir === 'asc' ? '↑' : '↓') : '' }}
            </th>
            <th class="text-left px-2 py-1.5 cursor-pointer hover:text-gray-700" @click="toggleSort('category')">
              Catégorie {{ sortBy === 'category' ? (sortDir === 'asc' ? '↑' : '↓') : '' }}
            </th>
            <th class="text-center px-2 py-1.5 cursor-pointer hover:text-gray-700" @click="toggleSort('points_count')">
              Points {{ sortBy === 'points_count' ? (sortDir === 'asc' ? '↑' : '↓') : '' }}
            </th>
            <th class="px-2 py-1.5"></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="t in filteredSorted"
            :key="t.id"
            @click="select(t)"
            :class="[
              'border-t border-gray-100 cursor-pointer',
              modelValue === t.id ? 'bg-indigo-50' : 'hover:bg-gray-50'
            ]"
          >
            <td class="px-2 py-1.5 text-center w-8"><EquipmentIcon :template="t" size="sm" /></td>
            <td class="px-2 py-1.5 text-gray-800 whitespace-nowrap">{{ t.name }}</td>
            <td class="px-2 py-1.5 text-[11px] text-gray-500 uppercase tracking-wider whitespace-nowrap">{{ CATEGORY_LABELS[t.category] || t.category || '—' }}</td>
            <td class="px-2 py-1.5 text-center">
              <span class="inline-flex items-center justify-center w-6 h-6 rounded-full bg-indigo-600 text-white text-[10px] font-medium tabular-nums">{{ t.points_count }}</span>
            </td>
            <td class="px-2 py-1.5 text-center w-8">
              <CheckIcon v-if="modelValue === t.id" class="w-4 h-4 text-indigo-600" />
            </td>
          </tr>
          <tr v-if="!filteredSorted.length">
            <td colspan="5" class="px-2 py-6 text-center text-xs text-gray-400 italic">
              Aucun équipement dans cette catégorie.
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
