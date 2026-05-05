<script setup>
import { PlusIcon } from '@heroicons/vue/24/outline'

defineProps({
  label: { type: String, default: 'Ajouter' },
})
const emit = defineEmits(['click'])
</script>

<template>
  <button
    @click="emit('click')"
    class="fixed bottom-20 right-4 z-20 inline-flex items-center gap-2 px-5 h-14 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-medium rounded-full shadow-lg transition"
    :style="{ marginBottom: 'env(safe-area-inset-bottom)' }"
  >
    <PlusIcon class="w-6 h-6" />
    {{ label }}
  </button>
</template>
