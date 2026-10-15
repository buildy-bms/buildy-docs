<script setup>
/**
 * « Afficher : Le reste à faire | Toute l'étape » au-dessus des rubriques d'une étape
 * (mise en page « Nouvelle »), comme dans la fiche équipement de l'étape Systèmes.
 */
import { STEP_RUBRICS_LABELS, STEP_RUBRICS_TIPS } from '@/lib/audit-tips-guided'

defineProps({ showAll: { type: Boolean, default: false } })
const emit = defineEmits(['todo', 'all'])
</script>

<template>
  <div class="flex items-center gap-2">
    <span class="text-[11px] text-gray-500">Afficher</span>
    <div class="inline-flex rounded-md overflow-hidden border border-gray-200" role="group" aria-label="Rubriques affichées">
      <button type="button" :aria-pressed="!showAll" v-tooltip="STEP_RUBRICS_TIPS.todo" @click="emit('todo')"
              :class="['px-2.5 py-1 text-xs whitespace-nowrap transition',
                       !showAll ? 'bg-primary text-white font-medium' : 'bg-white text-gray-600 hover:bg-gray-50']">
        {{ STEP_RUBRICS_LABELS.todo }}
      </button>
      <button type="button" :aria-pressed="showAll" v-tooltip="STEP_RUBRICS_TIPS.all" @click="emit('all')"
              :class="['px-2.5 py-1 text-xs whitespace-nowrap transition',
                       showAll ? 'bg-primary text-white font-medium' : 'bg-white text-gray-600 hover:bg-gray-50']">
        {{ STEP_RUBRICS_LABELS.all }}
      </button>
    </div>
  </div>
</template>
