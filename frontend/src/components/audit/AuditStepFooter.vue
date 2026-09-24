<script setup>
/**
 * Pied de l'étape active (audit BACS desktop) : retour à l'étape précédente,
 * passage à la suivante, ou « Valider et continuer » quand l'étape n'est pas
 * encore validée. Les étapes sans objet (Inspections sans GTB) sont sautées
 * par le parent (prev / next déjà filtrés).
 */
import { library } from '@fortawesome/fontawesome-svg-core'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { faChevronLeft, faArrowRight, faCheck } from '@fortawesome/pro-solid-svg-icons'
import Button from '@/components/Button.vue'

library.add(faChevronLeft, faArrowRight, faCheck)

defineProps({
  step: { type: Object, required: true },
  prev: { type: Object, default: null },
  next: { type: Object, default: null },
})
const emit = defineEmits(['go', 'validate-and-continue'])
</script>

<template>
  <div data-audit-step-footer class="flex items-center justify-between gap-3 pt-1 pb-4">
    <div>
      <Button v-if="prev" variant="secondary" size="md" @click="emit('go', prev.key)">
        <template #icon-left><FontAwesomeIcon :icon="['fas', 'chevron-left']" class="w-3 h-3" /></template>
        {{ prev.number }}. {{ prev.label }}
      </Button>
    </div>
    <div class="flex items-center gap-2">
      <template v-if="!step.validated">
        <Button v-if="next" variant="tertiary" size="md" @click="emit('go', next.key)">
          Passer à « {{ next.label }} »
        </Button>
        <Button variant="success" size="md" @click="emit('validate-and-continue')">
          <template #icon-left><FontAwesomeIcon :icon="['fas', 'check']" class="w-3.5 h-3.5" /></template>
          {{ next ? 'Valider et continuer' : 'Valider l\'étape' }}
          <template v-if="next" #icon-right><FontAwesomeIcon :icon="['fas', 'arrow-right']" class="w-3.5 h-3.5" /></template>
        </Button>
      </template>
      <Button v-else-if="next" variant="primary" size="md" @click="emit('go', next.key)">
        Étape suivante : {{ next.number }}. {{ next.label }}
        <template #icon-right><FontAwesomeIcon :icon="['fas', 'arrow-right']" class="w-3.5 h-3.5" /></template>
      </Button>
    </div>
  </div>
</template>
