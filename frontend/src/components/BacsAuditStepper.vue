<script setup>
import { computed } from 'vue'
import { CheckCircleIcon } from '@heroicons/vue/24/outline'

/**
 * Stepper vertical persistant pour piloter l'audit BACS de bout en
 * bout. Affiché en colonne sticky à gauche de la page.
 * Chaque étape :
 *  - "complete" : conditions automatiques satisfaites (auto-saisie)
 *  - "validated" : signe-off manuel persisté (audit_progress JSON)
 *  - "active" : section actuellement scrollée par l'utilisateur
 */
const props = defineProps({
  steps: { type: Array, required: true },
  activeStepKey: { type: String, default: null },
})

const emit = defineEmits(['validate-step', 'invalidate-step', 'step-click'])

const validatedCount = computed(() => props.steps.filter(s => s.validated).length)
const completionPercent = computed(() => Math.round((validatedCount.value / props.steps.length) * 100))

function circleClass(s) {
  if (s.validated) return 'bg-emerald-500 border-emerald-500 text-white'
  if (s.key === props.activeStepKey) return 'bg-indigo-500 border-indigo-500 text-white ring-4 ring-indigo-100'
  if (s.complete) return 'bg-amber-400 border-amber-400 text-white'
  return 'bg-white border-gray-300 text-gray-500'
}

function labelClass(s) {
  if (s.validated) return 'text-emerald-700 font-medium'
  if (s.key === props.activeStepKey) return 'text-indigo-700 font-semibold'
  if (s.complete) return 'text-amber-700 font-medium'
  return 'text-gray-700'
}

function connectorClass(s) {
  return s.validated ? 'bg-emerald-300' : 'bg-gray-200'
}
</script>

<template>
  <aside class="bg-white border border-gray-200 rounded-lg shadow-sm">
    <header class="px-4 py-3 border-b border-gray-200">
      <h2 class="text-xs font-semibold text-gray-700 uppercase tracking-wider">Progression de l'audit</h2>
      <div class="mt-2 flex items-center gap-2">
        <div class="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div class="h-full bg-emerald-500 transition-all duration-500"
               :style="{ width: completionPercent + '%' }"></div>
        </div>
        <span class="text-[11px] font-medium text-gray-700 whitespace-nowrap">
          {{ validatedCount }}/{{ steps.length }}
        </span>
      </div>
    </header>

    <ol class="px-4 py-3 space-y-0">
      <li
        v-for="(s, idx) in steps"
        :key="s.key"
        class="relative flex items-start gap-2.5"
      >
        <!-- Connector line vers l'étape suivante -->
        <span
          v-if="idx < steps.length - 1"
          :class="['absolute left-2.75 top-6 w-0.5 h-full', connectorClass(s)]"
          aria-hidden="true"
        ></span>
        <button
          type="button"
          @click="$emit('step-click', s.key)"
          :class="['relative z-10 shrink-0 w-5.5 h-5.5 rounded-full border-2 flex items-center justify-center text-[10px] font-semibold transition shadow-sm',
                   circleClass(s)]"
          :title="s.description"
        >
          <CheckCircleIcon v-if="s.validated" class="w-3.5 h-3.5" />
          <span v-else>{{ idx + 1 }}</span>
        </button>
        <button
          type="button"
          @click="$emit('step-click', s.key)"
          class="text-left flex-1 min-w-0 pb-3 group"
        >
          <p :class="['text-xs leading-tight', labelClass(s)]">
            {{ s.label }}
          </p>
          <p v-if="s.complete && !s.validated" class="text-[10px] text-amber-700 mt-0.5 italic">
            à valider
          </p>
        </button>
      </li>
    </ol>

    <!-- Validation rapide de l'étape active -->
    <div v-if="activeStepKey" class="border-t border-gray-100 px-4 py-3">
      <template v-for="s in steps" :key="s.key">
        <div v-if="s.key === activeStepKey">
          <p class="text-[11px] text-gray-500 leading-snug mb-2">{{ s.description }}</p>
          <button
            v-if="!s.validated"
            type="button"
            @click="$emit('validate-step', s.key)"
            class="w-full px-3 py-1.5 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-md transition shadow-sm"
          >
            ✓ Valider cette étape
          </button>
          <button
            v-else
            type="button"
            @click="$emit('invalidate-step', s.key)"
            class="w-full px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100 rounded-md transition border border-gray-200"
          >
            Annuler la validation
          </button>
          <p v-if="s.validated_at" class="mt-1.5 text-[10px] text-emerald-700">
            ✓ Validée le {{ new Date(s.validated_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) }}
          </p>
        </div>
      </template>
    </div>
  </aside>
</template>
