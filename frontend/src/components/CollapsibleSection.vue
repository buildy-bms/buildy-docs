<script setup>
/**
 * Wrapper section card "depliable / repliable" avec persistance localStorage.
 * Usage :
 *   <CollapsibleSection storage-key="bacs-zones">
 *     <template #header>...header content (icone + titre + badges...)...</template>
 *     <template #summary>...résumé compact affiché quand replié (optionnel)...</template>
 *     ...le contenu plie/depli est ici en slot par defaut
 *   </CollapsibleSection>
 *
 * Réagit aux événements globaux 'bacs-collapse:set-all' (detail = true/false)
 * pour permettre un "Tout replier / Tout déplier" depuis n'importe où.
 */
import { ref, watch, computed, onMounted, onBeforeUnmount } from 'vue'
import { ChevronDownIcon, ChevronUpIcon } from '@heroicons/vue/24/outline'

const props = defineProps({
  storageKey: { type: String, required: true },
  defaultOpen: { type: Boolean, default: true },
  // Permet de passer un id de scroll-to-section sur le wrapper
  sectionId: { type: String, default: null },
  // Mise en evidence visuelle de la section active (calee sur le stepper).
  active: { type: Boolean, default: false },
})

const STORAGE_PREFIX = 'bacs-collapse:'

const persisted = computed(() => STORAGE_PREFIX + props.storageKey)
const open = ref((() => {
  const v = localStorage.getItem(persisted.value)
  if (v === null) return props.defaultOpen
  return v === '1'
})())

function setOpen(v) {
  open.value = !!v
  localStorage.setItem(persisted.value, open.value ? '1' : '0')
}

function toggle() {
  setOpen(!open.value)
}

function onSetAll(e) {
  if (typeof e.detail === 'boolean') setOpen(e.detail)
}
// Événement ciblé : `bacs-collapse:open` avec detail={ storageKey }
// permet d'ouvrir une section précise depuis n'importe où (ex. clic
// sur un nom de système dans la card 05 pour remonter en card 03).
function onOpenOne(e) {
  if (e.detail?.storageKey === props.storageKey) setOpen(true)
}

onMounted(() => {
  window.addEventListener('bacs-collapse:set-all', onSetAll)
  window.addEventListener('bacs-collapse:open', onOpenOne)
})
onBeforeUnmount(() => {
  window.removeEventListener('bacs-collapse:set-all', onSetAll)
  window.removeEventListener('bacs-collapse:open', onOpenOne)
})
</script>

<template>
  <section :id="sectionId"
           :class="['bg-white border rounded-lg shadow-sm scroll-mt-24 transition-shadow',
                    active ? 'border-l-4 border-l-indigo-500 border-y-gray-200 border-r-gray-200 shadow-md ring-1 ring-indigo-100/50'
                           : 'border-gray-200']">
    <div
      class="lg:sticky z-10 bg-white"
      style="top: var(--audit-sticky-offset, 0px);"
      :class="open ? 'rounded-t-lg' : 'rounded-lg'"
    >
      <header
        class="px-5 py-3 flex items-center gap-2 cursor-pointer hover:bg-gray-50/60 transition select-none"
        :class="[
          { 'border-b border-gray-200': open || !$slots.summary },
          { 'rounded-t-lg': open },
          { 'rounded-lg': !open },
        ]"
        @click="toggle"
      >
        <slot name="header" :open="open" />
        <button
          type="button"
          @click.stop="toggle"
          class="ml-1 p-1 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-700 transition shrink-0"
          v-tooltip="open ? 'Replier la section' : 'Déplier la section'"
        >
          <ChevronUpIcon v-if="open" class="w-4 h-4" />
          <ChevronDownIcon v-else class="w-4 h-4" />
        </button>
      </header>
      <!-- Slot pour une barre supplémentaire qui doit rester sticky avec
           le header (filtres, sous-actions, breadcrumbs…). Visible
           uniquement quand la section est dépliée. -->
      <div v-if="open && $slots.headerExtra" class="px-5 py-2 border-b border-gray-200 bg-white">
        <slot name="headerExtra" />
      </div>
    </div>
    <div v-if="!open && $slots.summary" class="px-5 py-2.5 text-xs text-gray-500 bg-gray-50/60 border-t border-gray-100 rounded-b-lg cursor-pointer" @click="toggle">
      <slot name="summary" />
    </div>
    <div v-show="open">
      <slot />
    </div>
  </section>
</template>
