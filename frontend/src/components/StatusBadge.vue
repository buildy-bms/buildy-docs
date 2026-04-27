<script setup>
const props = defineProps({
  status: { type: String, required: true }, // 'setup' | 'chantier' | 'livree' | 'revision'
})

const config = {
  setup:     { label: 'Démarrage',    classes: 'bg-gray-100 text-gray-700' },
  chantier:  { label: 'Chantier',     classes: 'bg-amber-100 text-amber-800' },
  livree:    { label: 'Livrée',       classes: 'bg-emerald-100 text-emerald-800' },
  revision:  { label: 'Révision',     classes: 'bg-blue-100 text-blue-800' },
}
</script>

<template>
  <span
    :class="['inline-flex items-center px-2 py-0.5 text-[11px] font-semibold rounded-full', config[status]?.classes || 'bg-gray-100 text-gray-700']"
  >
    {{ config[status]?.label || status }}
  </span>
</template>
