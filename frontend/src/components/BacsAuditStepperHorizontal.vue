<script setup>
/**
 * Stepper horizontal compact pour piloter l'audit BACS depuis le haut
 * de la page. Pensé sticky-top sous le topbar de la vue audit, libère
 * la largeur de la colonne principale (avant : sidebar 200px à gauche).
 *
 * Chaque étape : pastille numérotée + label court tronqué (tooltip pour
 * la description complète). Clic = scroll vers la section correspondante
 * (gère par le parent via @step-click).
 *
 * Pas de validation inline ici : ça reste sur les SectionHeader internes
 * où le contexte de chaque section est visible.
 */
import { computed } from 'vue'
import { CheckCircleIcon } from '@heroicons/vue/24/outline'

const props = defineProps({
  steps: { type: Array, required: true },
  activeStepKey: { type: String, default: null },
})
defineEmits(['step-click'])

const validatedCount = computed(() => props.steps.filter(s => s.validated).length)
const completionPercent = computed(() => Math.round((validatedCount.value / props.steps.length) * 100))

function pillClass(s) {
  if (s.validated) return 'bg-emerald-500 border-emerald-500 text-white'
  if (s.key === props.activeStepKey) return 'bg-indigo-500 border-indigo-500 text-white ring-2 ring-indigo-200'
  if (s.complete) return 'bg-amber-400 border-amber-400 text-white'
  return 'bg-white border-gray-300 text-gray-500'
}
function labelClass(s) {
  if (s.validated) return 'text-emerald-700'
  if (s.key === props.activeStepKey) return 'text-indigo-700 font-semibold'
  if (s.complete) return 'text-amber-700'
  return 'text-gray-600'
}
function connectorClass(s) {
  return s.validated ? 'bg-emerald-300' : 'bg-gray-200'
}
</script>

<template>
  <nav class="bg-white border border-gray-200 rounded-lg shadow-sm">
    <!-- Barre de progression compacte en tête (masquée au scroll compact). -->
    <div class="stepper-progress px-3 py-2 border-b border-gray-100 flex items-center gap-3">
      <span class="text-[10px] font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">
        Progression
      </span>
      <div class="flex-1 h-1 bg-gray-100 rounded-full overflow-hidden">
        <div class="h-full bg-emerald-500 transition-all duration-500"
             :style="{ width: completionPercent + '%' }"></div>
      </div>
      <span class="text-[11px] font-medium text-gray-700 whitespace-nowrap">
        {{ validatedCount }}/{{ steps.length }}
      </span>
    </div>

    <!-- Étapes en ligne, scrollables horizontalement si débordement -->
    <ol class="flex items-center gap-0 px-2 py-2 overflow-x-auto">
      <li
        v-for="(s, idx) in steps"
        :key="s.key"
        class="flex items-center shrink-0"
      >
        <button
          type="button"
          @click="$emit('step-click', s.key)"
          class="flex items-center gap-1.5 px-1.5 py-1 rounded-md hover:bg-gray-50 active:bg-gray-100 transition"
          v-tooltip="s.description"
        >
          <span
            :class="['relative shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center text-[10px] font-semibold transition shadow-sm',
                     pillClass(s)]"
          >
            <CheckCircleIcon v-if="s.validated" class="w-3 h-3" />
            <span v-else>{{ idx + 1 }}</span>
          </span>
          <span :class="['text-[11px] leading-tight whitespace-nowrap', labelClass(s)]">
            {{ s.label }}
          </span>
        </button>
        <!-- Connector entre étapes -->
        <span
          v-if="idx < steps.length - 1"
          :class="['w-3 h-0.5 mx-0.5 shrink-0', connectorClass(s)]"
          aria-hidden="true"
        ></span>
      </li>
    </ol>
  </nav>
</template>
