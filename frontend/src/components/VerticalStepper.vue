<script setup>
/**
 * Stepper vertical pour visualiser la progression d'une saisie en
 * plusieurs étapes (ex : remplissage d'une fiche GTB). Sert de guide
 * visuel à gauche d'une card.
 *
 * Usage :
 *   <VerticalStepper :steps="[
 *     { label: 'Identification', done: !!bms.existing_solution },
 *     { label: 'Usages', done: bms.manages_heating || ...},
 *     ...
 *   ]" />
 */
import { CheckIcon } from '@heroicons/vue/24/solid'

defineProps({
  steps: { type: Array, required: true }, // [{ label, done, hint? }]
})
</script>

<template>
  <ol class="space-y-3">
    <li v-for="(s, i) in steps" :key="i" class="relative flex items-start gap-3">
      <span
        :class="[
          'shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-semibold border-2 transition relative z-10',
          s.done
            ? 'bg-emerald-500 border-emerald-500 text-white'
            : 'bg-white border-gray-300 text-gray-400'
        ]"
      >
        <CheckIcon v-if="s.done" class="w-3.5 h-3.5" />
        <span v-else>{{ i + 1 }}</span>
      </span>
      <span
        v-if="i < steps.length - 1"
        class="absolute left-3 top-6 -ml-px w-0.5 h-full"
        :class="s.done ? 'bg-emerald-300' : 'bg-gray-200'"
        aria-hidden="true"
      ></span>
      <div class="pt-0.5 min-w-0 flex-1">
        <p :class="['text-xs font-medium leading-tight', s.done ? 'text-emerald-700' : 'text-gray-700']">
          {{ s.label }}
        </p>
        <p v-if="s.hint" class="text-[10px] text-gray-400 mt-0.5">{{ s.hint }}</p>
      </div>
    </li>
  </ol>
</template>
