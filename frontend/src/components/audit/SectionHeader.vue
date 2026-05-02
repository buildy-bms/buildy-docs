<script setup>
import StepValidateBadge from '@/components/StepValidateBadge.vue'

// Header partagé pour toutes les CollapsibleSection de la fiche d'audit.
// Uniformise le pattern "[N°] [Icône] Titre / Sous-titre [Actions]"
// pour éviter la disparité actuelle des headers (espacements et tailles
// variables, badges colorés ad-hoc, lisibilité dégradée).
//
// Usage :
//   <CollapsibleSection ...>
//     <template #header>
//       <SectionHeader number="6" title="Solution GTB / GTC" subtitle="R175-3 / R175-4 / R175-5"
//                      :icon="WrenchScrewdriverIcon" icon-color="text-purple-600" :step="step"
//                      @validate="emit('validate-step', $event)"
//                      @invalidate="emit('invalidate-step', $event)">
//         <template #subtitle-extra><R175Tooltip article="R175-3" /></template>
//         <template #actions>...</template>
//       </SectionHeader>
//     </template>
//   </CollapsibleSection>

defineProps({
  number: { type: [String, Number], required: true },
  title: { type: String, required: true },
  subtitle: { type: String, default: '' },
  icon: { type: [Object, Function], default: null },
  iconColor: { type: String, default: 'text-indigo-600' },
  step: { type: Object, default: null },
})
const emit = defineEmits(['validate', 'invalidate'])

function pad(n) { return String(n).padStart(2, '0') }
</script>

<template>
  <div class="flex items-center gap-3 flex-1 min-w-0">
    <span class="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-indigo-50 text-indigo-700 font-mono text-xs font-medium shrink-0">
      {{ pad(number) }}
    </span>
    <component v-if="icon" :is="icon" :class="['w-5 h-5 shrink-0', iconColor]" />
    <div class="flex-1 min-w-0">
      <h2 class="text-base font-medium text-gray-900 leading-tight truncate">{{ title }}</h2>
      <p v-if="subtitle || $slots['subtitle-extra']" class="text-xs text-gray-500 mt-0.5 truncate flex items-center gap-1.5">
        <span v-if="subtitle">{{ subtitle }}</span>
        <slot name="subtitle-extra" />
      </p>
    </div>
  </div>
  <div class="flex items-center gap-2 shrink-0">
    <slot name="actions" />
    <StepValidateBadge v-if="step" :step="step"
                       @validate="emit('validate', $event)"
                       @invalidate="emit('invalidate', $event)" />
  </div>
</template>
