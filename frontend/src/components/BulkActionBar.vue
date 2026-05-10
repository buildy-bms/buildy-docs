<script setup>
/**
 * Barre d'actions bulk (sticky en bas du conteneur). S'affiche quand
 * `count > 0`. Le composant ne sait rien des actions metier — il expose
 * un slot pour y poser les boutons specifiques au tableau.
 */
import { TrashIcon, XMarkIcon } from '@heroicons/vue/24/outline'

defineProps({
  count: { type: Number, required: true },
  noun: { type: String, default: 'élément' }, // singulier
})
const emit = defineEmits(['clear'])
</script>

<template>
  <Transition
    enter-active-class="transition-all duration-150 ease-out"
    enter-from-class="opacity-0 translate-y-2"
    enter-to-class="opacity-100 translate-y-0"
    leave-active-class="transition-all duration-150 ease-in"
    leave-from-class="opacity-100 translate-y-0"
    leave-to-class="opacity-0 translate-y-2"
  >
    <div v-if="count > 0"
         class="sticky bottom-3 z-30 mx-auto flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl shadow-lg shadow-indigo-600/30 w-fit max-w-full whitespace-nowrap">
      <span class="text-sm font-medium tabular-nums">
        {{ count }} {{ noun }}{{ count > 1 ? 's' : '' }} sélectionné{{ count > 1 ? 's' : '' }}
      </span>
      <span class="w-px h-5 bg-white/30 mx-1"></span>
      <slot />
      <button
        @click="emit('clear')"
        class="ml-1 inline-flex items-center gap-1 px-2 py-1 text-xs text-white/80 hover:text-white hover:bg-white/10 rounded-md whitespace-nowrap"
        v-tooltip="'Désélectionner tout'"
      >
        <XMarkIcon class="w-4 h-4" />
        Désélectionner
      </button>
    </div>
  </Transition>
</template>
