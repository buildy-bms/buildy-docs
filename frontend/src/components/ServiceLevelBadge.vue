<script setup>
import { computed } from 'vue'

const props = defineProps({
  level: { type: String, default: null }, // 'E' | 'S' | 'P' | 'E/S/P' | 'S/P' etc.
  // 'compact' (defaut) : codes courts E / S / P, eclates en plusieurs pills.
  // 'full' : libelle long (Essentiel / Smart / Premium / "Tous niveaux"...).
  variant: { type: String, default: 'compact' },
})

const ATOM = {
  E: { short: 'E', label: 'Essentiel', classes: 'bg-gray-100 text-gray-700 border-gray-200' },
  S: { short: 'S', label: 'Smart',     classes: 'bg-amber-50 text-amber-800 border-amber-300' },
  P: { short: 'P', label: 'Premium',   classes: 'bg-emerald-50 text-emerald-800 border-emerald-300' },
}
const FULL_LABEL = {
  E: 'Essentiel',
  S: 'Smart',
  P: 'Premium',
  'S/P': 'Smart et Premium',
  'E/S/P': 'Tous niveaux',
}

// En mode compact, on eclate "S/P" en deux pills [S][P], "E/S/P" en [E][S][P].
const atoms = computed(() => {
  if (!props.level) return []
  return props.level.toUpperCase().split('/').map(a => a.trim()).filter(a => ATOM[a])
})
const fullLabel = computed(() => FULL_LABEL[props.level] || props.level)
</script>

<template>
  <template v-if="level && variant === 'compact'">
    <span class="inline-flex items-center gap-0.5 shrink-0">
      <span
        v-for="atom in atoms"
        :key="atom"
        :class="['inline-flex items-center px-1.5 py-0 text-[9px] font-bold rounded border whitespace-nowrap shrink-0 tabular-nums', ATOM[atom].classes]"
        :title="ATOM[atom].label"
      >
        {{ ATOM[atom].short }}
      </span>
    </span>
  </template>
  <template v-else-if="level">
    <span
      :class="['inline-flex items-center px-2 py-0.5 text-[10px] font-bold rounded border whitespace-nowrap shrink-0', ATOM[level]?.classes || 'bg-gray-100 text-gray-700 border-gray-200']"
      :title="fullLabel"
    >
      {{ fullLabel }}
    </span>
  </template>
</template>
