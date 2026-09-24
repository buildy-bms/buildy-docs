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
import { ref, watch, computed, inject, onMounted, onBeforeUnmount } from 'vue'
import { ChevronDownIcon, ChevronUpIcon } from '@heroicons/vue/24/outline'
import { AUDIT_STEP_MODE_KEY } from '@/lib/audit-steps-ui'

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

// « Mode étape » (page audit desktop à onglets) : la section est l'unique
// contenu de son onglet → toujours ouverte, pas de chevron ni de résumé,
// carte plus contrastée. Sans fournisseur (autres usages), rendu inchangé.
const stepMode = inject(AUDIT_STEP_MODE_KEY, null)
const isStepMode = computed(() => !!stepMode?.enabled)
const isOpen = computed(() => isStepMode.value || open.value)

function setOpen(v) {
  open.value = !!v
  localStorage.setItem(persisted.value, open.value ? '1' : '0')
}

function toggle() {
  if (isStepMode.value) return
  setOpen(!open.value)
}

function onSetAll(e) {
  if (isStepMode.value) return
  if (typeof e.detail === 'boolean') setOpen(e.detail)
}
// Événement ciblé : `bacs-collapse:open` avec detail={ storageKey }
// permet d'ouvrir une section précise depuis n'importe où (ex. clic
// sur un nom de système dans la card 05 pour remonter en card 03).
function onOpenOne(e) {
  if (isStepMode.value) return
  if (e.detail?.storageKey === props.storageKey) setOpen(true)
}

// Mode étape : hauteur de l'en-tête collant exposée sur la section
// (--section-header-h) pour les éléments collants du contenu (en-tête du
// tableau de la Régulation…). Remesurée à chaque changement de taille,
// dont l'affichage de l'onglet (0 px tant qu'il est masqué).
const stickyHeadRef = ref(null)
let headObs = null
function applyHeaderHeight() {
  const el = stickyHeadRef.value
  if (el?.parentElement) el.parentElement.style.setProperty('--section-header-h', `${Math.round(el.getBoundingClientRect().height)}px`)
}

onMounted(() => {
  window.addEventListener('bacs-collapse:set-all', onSetAll)
  window.addEventListener('bacs-collapse:open', onOpenOne)
  if (isStepMode.value && stickyHeadRef.value && typeof ResizeObserver !== 'undefined') {
    headObs = new ResizeObserver(applyHeaderHeight)
    headObs.observe(stickyHeadRef.value)
    applyHeaderHeight()
  }
})
onBeforeUnmount(() => {
  window.removeEventListener('bacs-collapse:set-all', onSetAll)
  window.removeEventListener('bacs-collapse:open', onOpenOne)
  headObs?.disconnect()
  headObs = null
})
</script>

<template>
  <section :id="sectionId"
           :class="isStepMode
             ? 'bg-white rounded-xl ring-1 ring-slate-200 shadow-sm scroll-mt-24'
             : ['bg-white border rounded-lg shadow-sm scroll-mt-24 transition-shadow',
                active ? 'border-l-4 border-l-indigo-500 border-y-gray-200 border-r-gray-200 shadow-md ring-1 ring-indigo-100/50'
                       : 'border-gray-200']">
    <div
      ref="stickyHeadRef"
      class="lg:sticky z-10 bg-white"
      style="top: var(--audit-sticky-offset, 0px);"
      :class="isStepMode ? 'rounded-t-xl' : (isOpen ? 'rounded-t-lg' : 'rounded-lg')"
    >
      <header
        :class="isStepMode
          ? 'px-5 py-3.5 flex items-center gap-2 border-b border-slate-200 rounded-t-xl'
          : ['px-5 py-3 flex items-center gap-2 cursor-pointer hover:bg-gray-50/60 transition select-none',
             { 'border-b border-gray-200': isOpen || !$slots.summary },
             { 'rounded-t-lg': isOpen },
             { 'rounded-lg': !isOpen }]"
        @click="toggle"
      >
        <slot name="header" :open="isOpen" />
        <button
          v-if="!isStepMode"
          type="button"
          @click.stop="toggle"
          class="ml-1 p-1 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-700 transition shrink-0"
          v-tooltip="isOpen ? 'Replier la section' : 'Déplier la section'"
        >
          <ChevronUpIcon v-if="isOpen" class="w-4 h-4" />
          <ChevronDownIcon v-else class="w-4 h-4" />
        </button>
      </header>
      <!-- Slot pour une barre supplémentaire qui doit rester sticky avec
           le header (filtres, sous-actions, breadcrumbs…). Visible
           uniquement quand la section est dépliée. -->
      <div v-if="isOpen && $slots.headerExtra" :class="['px-5 py-2 bg-white', isStepMode ? 'border-b border-slate-200' : 'border-b border-gray-200']">
        <slot name="headerExtra" />
      </div>
    </div>
    <div v-if="!isOpen && $slots.summary" class="px-5 py-2.5 text-xs text-gray-500 bg-gray-50/60 border-t border-gray-100 rounded-b-lg cursor-pointer" @click="toggle">
      <slot name="summary" />
    </div>
    <!-- Pas d'overflow ici (menus déroulants en position absolue près du bas
         de la carte) : .audit-step-body arrondit le dernier bloc (main.css). -->
    <div v-show="isOpen" :class="isStepMode ? 'audit-step-body rounded-b-xl' : ''">
      <slot />
    </div>
  </section>
</template>
