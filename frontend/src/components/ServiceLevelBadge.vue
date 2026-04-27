<script setup>
defineProps({
  level: { type: String, default: null }, // 'E' | 'S' | 'P' | 'E/S/P' | 'S/P' etc.
})

const config = {
  E:        { label: 'Essentials', classes: 'bg-gray-100 text-gray-700 border-gray-300' },
  S:        { label: 'Smart',      classes: 'bg-amber-50  text-amber-800 border-amber-300' },
  P:        { label: 'Premium',    classes: 'bg-emerald-50 text-emerald-800 border-emerald-300' },
  'E/S/P':  { label: 'E/S/P',      classes: 'bg-gray-100 text-gray-700 border-gray-300' },
  'S/P':    { label: 'S/P',        classes: 'bg-amber-50  text-amber-800 border-amber-300' },
}
</script>

<template>
  <span
    v-if="level"
    :class="['inline-flex items-center px-1.5 py-0.5 text-[10px] font-bold rounded border', config[level]?.classes || 'bg-gray-100 text-gray-700 border-gray-300']"
    :title="config[level]?.label || level"
  >
    [{{ level }}]
  </span>
</template>
