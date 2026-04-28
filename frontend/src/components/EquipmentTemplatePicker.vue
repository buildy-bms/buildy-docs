<script setup>
/**
 * Picker visuel d'un template équipement avec filtre par catégorie + grille
 * de cartes (icône colorée + nom + nb points).
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

const categories = computed(() => {
  const cats = new Set(props.templates.map(t => t.category || 'autres'))
  return ['all', ...[...cats].sort((a, b) => {
    const la = CATEGORY_LABELS[a] || a
    const lb = CATEGORY_LABELS[b] || b
    return la.localeCompare(lb, 'fr')
  })]
})

const filtered = computed(() => {
  const list = selectedCategory.value === 'all'
    ? props.templates
    : props.templates.filter(t => (t.category || 'autres') === selectedCategory.value)
  return [...list].sort((a, b) => a.name.localeCompare(b.name, 'fr'))
})

function select(t) {
  emit('update:modelValue', t.id)
}
</script>

<template>
  <div>
    <!-- Filtres catégorie en chips -->
    <div class="flex items-center gap-1.5 flex-wrap mb-3">
      <button
        v-for="cat in categories"
        :key="cat"
        type="button"
        @click="selectedCategory = cat"
        :class="[
          'px-2.5 py-1 text-[11px] rounded-full border transition-colors',
          selectedCategory === cat
            ? 'bg-indigo-600 text-white border-indigo-600'
            : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
        ]"
      >
        {{ cat === 'all' ? `Tous (${templates.length})` : CATEGORY_LABELS[cat] || cat }}
      </button>
    </div>

    <!-- Grille de cartes équipements -->
    <div class="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-[40vh] overflow-y-auto pr-1">
      <button
        v-for="t in filtered"
        :key="t.id"
        type="button"
        @click="select(t)"
        :class="[
          'relative text-left bg-white border p-2.5 rounded-md transition-all group',
          modelValue === t.id
            ? 'border-indigo-500 ring-2 ring-indigo-200 bg-indigo-50/40'
            : 'border-gray-200 hover:border-indigo-300 hover:shadow-sm'
        ]"
      >
        <div class="flex items-start gap-2">
          <EquipmentIcon :template="t" size="md" />
          <div class="min-w-0 flex-1">
            <p class="text-[12px] font-medium text-gray-800 leading-tight line-clamp-2">{{ t.name }}</p>
            <p class="text-[10px] text-gray-500 mt-1">
              <span class="inline-flex items-center justify-center w-4 h-4 rounded-full bg-[#1b2842] text-white text-[9px] font-medium tabular-nums mr-1">{{ t.points_count }}</span>
              points
            </p>
          </div>
          <CheckIcon v-if="modelValue === t.id" class="w-4 h-4 text-indigo-600 absolute top-1.5 right-1.5" />
        </div>
      </button>
      <p v-if="!filtered.length" class="col-span-full text-xs text-gray-400 italic text-center py-6">
        Aucun équipement dans cette catégorie.
      </p>
    </div>
  </div>
</template>
