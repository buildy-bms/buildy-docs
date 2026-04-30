<script setup>
/**
 * Wrapper section card "depliable / repliable" avec persistance localStorage.
 * Usage :
 *   <CollapsibleSection storage-key="bacs-zones">
 *     <template #header>...header content (icone + titre + badges...)...</template>
 *     ...le contenu plie/depli est ici en slot par defaut
 *   </CollapsibleSection>
 */
import { ref, watch, computed } from 'vue'
import { ChevronDownIcon, ChevronUpIcon } from '@heroicons/vue/24/outline'

const props = defineProps({
  storageKey: { type: String, required: true },
  defaultOpen: { type: Boolean, default: true },
  // Permet de passer un id de scroll-to-section sur le wrapper
  sectionId: { type: String, default: null },
})

const STORAGE_PREFIX = 'bacs-collapse:'

const persisted = computed(() => STORAGE_PREFIX + props.storageKey)
const open = ref((() => {
  const v = localStorage.getItem(persisted.value)
  if (v === null) return props.defaultOpen
  return v === '1'
})())

function toggle() {
  open.value = !open.value
  localStorage.setItem(persisted.value, open.value ? '1' : '0')
}
</script>

<template>
  <section :id="sectionId" class="bg-white border border-gray-200 rounded-lg shadow-sm scroll-mt-24">
    <header
      class="px-5 py-3 border-b border-gray-200 flex items-center gap-2 cursor-pointer hover:bg-gray-50/60 transition select-none"
      :class="{ 'border-b-0 rounded-lg': !open }"
      @click="toggle"
    >
      <slot name="header" :open="open" />
      <button
        type="button"
        @click.stop="toggle"
        class="ml-1 p-1 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-700 transition shrink-0"
        :title="open ? 'Replier la section' : 'Deplier la section'"
      >
        <ChevronUpIcon v-if="open" class="w-4 h-4" />
        <ChevronDownIcon v-else class="w-4 h-4" />
      </button>
    </header>
    <div v-show="open">
      <slot />
    </div>
  </section>
</template>
