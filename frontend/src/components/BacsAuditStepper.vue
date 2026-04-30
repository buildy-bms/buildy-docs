<script setup>
import { computed, ref } from 'vue'
import { CheckCircleIcon, ChevronUpIcon, ChevronDownIcon } from '@heroicons/vue/24/outline'

/**
 * Stepper a 9 etapes pour piloter un audit BACS de bout en bout. Chaque
 * etape est validee manuellement par l'auditeur (bouton "Valider l'etape").
 * - "complete" : conditions automatiques satisfaites (auto-saisie)
 * - "validated" : signe-off manuel persiste (audit_progress JSON cote DB)
 * Inspire du ConfigStepper de buildy-tools.
 */
const props = defineProps({
  steps: { type: Array, required: true },
  // Cle de l'etape courante (pour scroll-to-section / highlight)
  activeStepKey: { type: String, default: null },
})

const emit = defineEmits(['validate-step', 'invalidate-step', 'step-click'])

const collapsed = ref(localStorage.getItem('bacs-stepper-collapsed') === '1')
function toggleCollapsed() {
  collapsed.value = !collapsed.value
  localStorage.setItem('bacs-stepper-collapsed', collapsed.value ? '1' : '0')
}

const validatedCount = computed(() => props.steps.filter(s => s.validated).length)
const completionPercent = computed(() => Math.round((validatedCount.value / props.steps.length) * 100))

function pillClass(s) {
  if (s.validated) return 'border-emerald-300 bg-emerald-50 text-emerald-700'
  if (s.key === props.activeStepKey) return 'border-indigo-300 bg-indigo-50 text-indigo-700'
  if (s.complete) return 'border-amber-300 bg-amber-50 text-amber-700'
  return 'border-gray-200 bg-white text-gray-500'
}

function circleClass(s) {
  if (s.validated) return 'bg-emerald-500 text-white'
  if (s.key === props.activeStepKey) return 'bg-indigo-500 text-white'
  if (s.complete) return 'bg-amber-400 text-white'
  return 'bg-gray-200 text-gray-600'
}
</script>

<template>
  <div class="bg-white border border-gray-200 rounded-lg shadow-sm">
    <header class="px-5 py-3 border-b border-gray-200 flex items-center gap-3">
      <h2 class="text-base font-semibold text-gray-800">Progression de l'audit</h2>
      <div class="flex-1 flex items-center gap-3">
        <div class="flex-1 max-w-md h-2 bg-gray-100 rounded-full overflow-hidden">
          <div class="h-full bg-emerald-500 transition-all duration-500"
               :style="{ width: completionPercent + '%' }"></div>
        </div>
        <span class="text-xs font-medium text-gray-700 whitespace-nowrap">
          {{ validatedCount }} / {{ steps.length }} étapes
          <span class="text-gray-500">({{ completionPercent }} %)</span>
        </span>
      </div>
      <button
        type="button"
        @click="toggleCollapsed"
        class="p-1 rounded hover:bg-gray-100 text-gray-500"
        :title="collapsed ? 'Afficher les etapes' : 'Masquer les etapes'"
      >
        <ChevronDownIcon v-if="collapsed" class="w-5 h-5" />
        <ChevronUpIcon v-else class="w-5 h-5" />
      </button>
    </header>

    <div v-if="!collapsed" class="px-5 py-4">
      <!-- Vue desktop : ligne horizontale avec cercles connectes -->
      <ol class="flex items-start gap-1 overflow-x-auto pb-2">
        <li
          v-for="(s, idx) in steps"
          :key="s.key"
          class="flex items-start min-w-[100px] flex-1"
        >
          <div class="flex flex-col items-center flex-1">
            <button
              type="button"
              @click="$emit('step-click', s.key)"
              :class="['w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold transition shadow-sm',
                       circleClass(s),
                       s.key === activeStepKey ? 'ring-4 ring-indigo-100' : '']"
              :title="s.description"
            >
              <CheckCircleIcon v-if="s.validated" class="w-5 h-5" />
              <span v-else>{{ idx + 1 }}</span>
            </button>
            <span class="mt-1.5 text-[11px] font-medium text-center text-gray-700 leading-tight">
              {{ s.label }}
            </span>
            <span v-if="s.complete && !s.validated" class="text-[10px] text-amber-700 mt-0.5 italic">
              à valider
            </span>
          </div>
          <div
            v-if="idx < steps.length - 1"
            :class="['flex-shrink-0 h-px self-center mt-4 w-6 mx-1',
                     s.validated ? 'bg-emerald-300' : 'bg-gray-300 border-dashed']"
          ></div>
        </li>
      </ol>

      <!-- Bouton de validation pour l'etape active -->
      <div v-if="activeStepKey" class="mt-4 pt-3 border-t border-gray-100">
        <template v-for="s in steps" :key="s.key">
          <div v-if="s.key === activeStepKey" class="flex items-center justify-between gap-3">
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-gray-800">{{ s.label }}</p>
              <p class="text-xs text-gray-500 mt-0.5">{{ s.description }}</p>
              <p v-if="s.validated_at" class="text-[11px] text-emerald-700 mt-1">
                ✓ Validée le {{ new Date(s.validated_at).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }) }}
              </p>
              <p v-else-if="!s.complete" class="text-[11px] text-amber-700 mt-1">
                ⚠ Conditions automatiques pas encore satisfaites — tu peux valider quand meme si tu juges l'etape complete.
              </p>
            </div>
            <button
              v-if="!s.validated"
              type="button"
              @click="$emit('validate-step', s.key)"
              class="px-4 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition shadow-sm whitespace-nowrap"
            >
              ✓ Valider l'étape
            </button>
            <button
              v-else
              type="button"
              @click="$emit('invalidate-step', s.key)"
              class="px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition whitespace-nowrap"
            >
              Annuler la validation
            </button>
          </div>
        </template>
      </div>
      <p v-else class="mt-4 pt-3 border-t border-gray-100 text-xs text-gray-500 italic">
        Clique sur un cercle pour ouvrir une etape et la valider.
      </p>
    </div>
  </div>
</template>
