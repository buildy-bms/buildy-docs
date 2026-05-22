<script setup>
/**
 * Contrôle segmenté Oui / Non (ou Oui / Partiel / Non) — remplace les cases
 * à cocher pour les états binaires/ternaires métier.
 *
 * - Tant que `modelValue` est null/undefined, AUCUNE option n'est sélectionnée.
 * - Chaque option : { value, label, tone? }. `tone` ∈ 'green' | 'amber' |
 *   'slate' colore le bouton sélectionné (les « Oui » sont en vert Buildy).
 */
defineProps({
  modelValue: { default: null },
  options: {
    type: Array,
    default: () => [
      { value: true, label: 'Oui', tone: 'green' },
      { value: false, label: 'Non', tone: 'slate' },
    ],
  },
})
const emit = defineEmits(['update:modelValue'])

const TONE = {
  green: 'bg-[#00cd92] text-white',
  amber: 'bg-[#f5c259] text-gray-900',
  slate: 'bg-slate-600 text-white',
}
</script>

<template>
  <div class="inline-flex rounded-lg border border-gray-200 overflow-hidden shrink-0">
    <button
      v-for="(opt, i) in options"
      :key="String(opt.value)"
      type="button"
      @click="emit('update:modelValue', opt.value)"
      :class="['h-7 px-3 text-xs font-medium transition whitespace-nowrap',
               i > 0 ? 'border-l border-gray-200' : '',
               modelValue === opt.value
                 ? (TONE[opt.tone] || TONE.slate)
                 : 'bg-white text-gray-600 hover:bg-gray-50']"
    >
      {{ opt.label }}
    </button>
  </div>
</template>
