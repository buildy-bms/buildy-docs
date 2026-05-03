<script setup>
defineProps({
  level: { type: String, default: null }, // 'E' | 'S' | 'P' | 'E/S/P' | 'S/P' etc.
  // 'compact' (defaut) : codes courts (E / S / P / S+P / E+S+P).
  // 'full' : libelles longs (Essentiel / Smart / Premium / ...).
  variant: { type: String, default: 'compact' },
})

// Codes ultra-compacts : E, S, P, S+P, E+S+P, ★ (si all niveaux).
const config = {
  E:        { short: 'E',     label: 'Essentiel',          classes: 'bg-gray-100 text-gray-700 border-gray-200' },
  S:        { short: 'S',     label: 'Smart',              classes: 'bg-amber-50  text-amber-800 border-amber-300' },
  P:        { short: 'P',     label: 'Premium',            classes: 'bg-emerald-50 text-emerald-800 border-emerald-300' },
  'E/S/P':  { short: '★',     label: 'Tous niveaux',       classes: 'bg-gray-100 text-gray-700 border-gray-200' },
  'S/P':    { short: 'S+P',   label: 'Smart et Premium',   classes: 'bg-amber-50  text-amber-800 border-amber-300' },
}
</script>

<template>
  <span
    v-if="level"
    :class="[
      'inline-flex items-center font-bold rounded border whitespace-nowrap shrink-0',
      variant === 'compact' ? 'px-1.5 py-0 text-[9px] tabular-nums' : 'px-2 py-0.5 text-[10px]',
      config[level]?.classes || 'bg-gray-100 text-gray-700 border-gray-200',
    ]"
    :title="config[level]?.label || level"
  >
    {{ variant === 'compact' ? (config[level]?.short || level) : (config[level]?.label || level) }}
  </span>
</template>
