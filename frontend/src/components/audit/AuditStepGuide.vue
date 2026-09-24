<script setup>
/**
 * Bandeau guide affiché au-dessus de l'étape active de l'audit BACS desktop :
 * phase + « Étape n/12 », objectif de l'étape, puis selon l'état
 *  - « Reste à faire » (raisons calculées par STEP_DEFINITIONS de la vue),
 *  - « Tout est renseigné »,
 *  - « Validée le … par … ».
 * Porte la validation de l'étape (le badge par section est masqué en mode
 * étape). Les clics repassent par validateStep / invalidateStep de la vue :
 * même garde-fous qu'avant (notification si bloquante, confirmation pour la
 * check-list non bloquante, raison demandée pour rouvrir).
 */
import { computed } from 'vue'
import { library } from '@fortawesome/fontawesome-svg-core'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { faBullseye, faCircleCheck, faListCheck, faRotateLeft, faCheck } from '@fortawesome/pro-solid-svg-icons'
import Button from '@/components/Button.vue'
import { phaseForStep } from '@/lib/audit-steps-ui'

library.add(faBullseye, faCircleCheck, faListCheck, faRotateLeft, faCheck)

const props = defineProps({
  step: { type: Object, required: true },
  total: { type: Number, required: true },
})
const emit = defineEmits(['validate', 'invalidate'])

const phase = computed(() => phaseForStep(props.step.key))

const validatedWhen = computed(() => {
  const v = props.step.validated_at
  if (!v) return ''
  const d = new Date(String(v).includes('T') ? v : String(v).replace(' ', 'T'))
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
})

function capitalize(s) {
  const t = String(s || '')
  return t.charAt(0).toUpperCase() + t.slice(1)
}
</script>

<template>
  <section
    data-audit-step-guide
    :class="['bg-white rounded-xl ring-1 ring-slate-200 shadow-sm border-l-4 px-5 py-4 flex items-start gap-5',
             phase?.tone.accent || 'border-l-slate-300']"
  >
    <div class="flex-1 min-w-0">
      <div class="flex items-center gap-2 flex-wrap text-[11px]">
        <span v-if="phase" :class="['inline-flex items-center h-5 px-2 rounded-full font-medium', phase.tone.chip]">
          {{ phase.label }}
        </span>
        <span class="text-gray-500">Étape {{ step.number }}/{{ total }}</span>
        <span v-if="!step.blocking" class="text-gray-400">· non bloquante</span>
      </div>

      <p class="mt-2 text-sm text-gray-800 leading-relaxed flex items-start gap-2">
        <FontAwesomeIcon :icon="['fas', 'bullseye']" :class="['w-3.5 h-3.5 mt-1 shrink-0', phase?.tone.icon || 'text-gray-400']" />
        <span>{{ step.objective }}</span>
      </p>

      <!-- État de l'étape -->
      <div v-if="step.validated" class="mt-3 flex items-center gap-2 text-xs text-emerald-800">
        <FontAwesomeIcon :icon="['fas', 'circle-check']" class="w-3.5 h-3.5 text-emerald-600 shrink-0" />
        <span>
          Étape validée<template v-if="validatedWhen"> le {{ validatedWhen }}</template><template v-if="step.validated_by_name"> par {{ step.validated_by_name }}</template>.
          <span v-if="step.with_pending" class="text-amber-700">Validée avec des éléments encore en attente.</span>
        </span>
      </div>
      <div
        v-else-if="step.incompleteReasons.length"
        class="mt-3 rounded-lg bg-amber-50 ring-1 ring-inset ring-amber-200 px-3 py-2.5"
      >
        <p class="text-xs font-medium text-amber-900 flex items-center gap-1.5">
          <FontAwesomeIcon :icon="['fas', 'list-check']" class="w-3.5 h-3.5 text-amber-600" />
          Reste à faire
          <span v-if="!step.blocking" class="font-normal text-amber-800">
            — étape non bloquante : tu peux la valider quand même et compléter plus tard.
          </span>
        </p>
        <ul class="mt-1.5 space-y-1 text-xs text-amber-900">
          <li v-for="(r, i) in step.incompleteReasons" :key="i" class="flex items-start gap-2">
            <span class="mt-1.5 w-1 h-1 rounded-full bg-amber-500 shrink-0"></span>
            <span>{{ capitalize(r) }}</span>
          </li>
        </ul>
      </div>
      <div v-else class="mt-3 flex items-center gap-2 text-xs text-emerald-800">
        <FontAwesomeIcon :icon="['fas', 'circle-check']" class="w-3.5 h-3.5 text-emerald-600 shrink-0" />
        Tout est renseigné : tu peux valider l'étape.
      </div>
    </div>

    <div class="shrink-0 flex flex-col items-end gap-1.5 pt-0.5">
      <Button
        v-if="!step.validated"
        :variant="step.complete || !step.blocking ? 'success' : 'secondary'"
        size="md"
        @click="emit('validate', step.key)"
      >
        <template #icon-left><FontAwesomeIcon :icon="['fas', 'check']" class="w-3.5 h-3.5" /></template>
        Valider l'étape
      </Button>
      <Button
        v-else
        variant="secondary"
        size="md"
        v-tooltip="{ text: 'Annuler la validation pour modifier cette étape', placement: 'bottom' }"
        @click="emit('invalidate', step.key)"
      >
        <template #icon-left><FontAwesomeIcon :icon="['fas', 'rotate-left']" class="w-3.5 h-3.5" /></template>
        Rouvrir l'étape
      </Button>
    </div>
  </section>
</template>
