<script setup>
/**
 * En-tête d'une rubrique de la fiche équipement (DeviceEditModal).
 *  - Mise en page actuelle : le titre d'origine, inchangé.
 *  - Fiche en rubriques (mise en page guidée) : un bouton qui ouvre ou ferme la rubrique. À gauche,
 *    l'icône qui identifie la rubrique ; au centre, son titre puis une ligne : ce qui manque
 *    (orange), ce qui est à vérifier (rose), les questions restées sans réponse (gris en pointillés,
 *    `unanswered`, étapes GTB et Identification ; elles bloquent aussi l'étape), sinon, rubrique fermée, le résumé des
 *    réponses (gris) ; à droite, son état (✓, nombre de réponses manquantes, !). Ouverte, son
 *    bandeau prend la teinte de son état.
 */
import { computed } from 'vue'
import { library } from '@fortawesome/fontawesome-svg-core'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import {
  faCheck, faChevronDown, faExclamation, faIdCard, faSitemap, faSliders, faNetworkWired,
  faGaugeHigh, faPowerOff, faShareNodes,
} from '@fortawesome/free-solid-svg-icons'
import { rubricHeaderTip } from '@/lib/audit-tips-systems-guide'

library.add(faCheck, faChevronDown, faExclamation, faIdCard, faSitemap, faSliders, faNetworkWired, faGaugeHigh, faPowerOff, faShareNodes)

const props = defineProps({
  title: { type: String, required: true },
  headClass: { type: String, default: '' },
  rubrics: { type: Boolean, default: false },
  open: { type: Boolean, default: true },
  icon: { type: String, default: 'id-card' },
  missing: { type: Array, default: () => [] },   // libellés courts de ce qui manque
  checks: { type: Array, default: () => [] },    // titres des points à vérifier
  unanswered: { type: Array, default: () => [] }, // questions sans réponse (pointillés)
  summary: { type: String, default: '' },
  bodyId: { type: String, default: '' },
})
const emit = defineEmits(['toggle'])

const state = computed(() => (props.checks.length ? 'check'
  : props.missing.length ? 'todo' : props.unanswered.length ? 'open' : 'done'))
const line = computed(() => {
  if (props.checks.length) return { tone: 'text-rose-700', text: `À vérifier : ${props.checks.join(', ')}` }
  if (props.missing.length) return { tone: 'text-amber-800', text: `À compléter : ${props.missing.join(', ')}` }
  if (props.unanswered.length) return { tone: 'text-slate-600', text: `Sans réponse : ${props.unanswered.join(', ')}` }
  return props.open ? null : (props.summary ? { tone: 'text-slate-500', text: props.summary } : null)
})
const headTone = computed(() => {
  if (!props.open) return 'bg-white hover:bg-slate-50'
  if (state.value === 'check') return 'bg-rose-50/80 border-b border-rose-100'
  if (state.value === 'todo') return 'bg-amber-50/80 border-b border-amber-100'
  return 'bg-slate-50 border-b border-slate-200/80'
})
const tip = computed(() => rubricHeaderTip(props.title, { open: props.open }))
</script>

<template>
  <h4 v-if="!rubrics" :class="headClass">{{ title }}</h4>
  <h4 v-else class="m-0">
    <button type="button" :aria-expanded="open" :aria-controls="bodyId || undefined"
            :class="['w-full flex items-center gap-3 px-3 py-2.5 text-left transition', headTone]"
            v-tooltip="tip"
            @click="emit('toggle')">
      <span class="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-lg bg-white text-indigo-600 ring-1 ring-inset ring-slate-200">
        <FontAwesomeIcon :icon="['fas', icon]" class="w-3.5 h-3.5" />
      </span>
      <span class="min-w-0 flex-1">
        <span class="block text-[13px] font-semibold text-slate-900 truncate">{{ title }}</span>
        <span v-if="line" :class="['block truncate text-xs mt-px', line.tone]" v-tooltip.overflow>{{ line.text }}</span>
      </span>
      <span :class="['shrink-0 inline-flex items-center justify-center min-w-5 h-5 px-1 rounded-full text-[10px] font-semibold',
                     state === 'check' ? 'bg-rose-100 text-rose-700'
                       : state === 'todo' ? 'bg-amber-100 text-amber-800'
                         : state === 'open' ? 'bg-white text-slate-600 border border-dashed border-slate-400'
                           : 'bg-emerald-50 text-emerald-600']">
        <FontAwesomeIcon v-if="state === 'check'" :icon="['fas', 'exclamation']" class="w-2.5 h-2.5" />
        <span v-else-if="state === 'todo'">{{ missing.length }}</span>
        <span v-else-if="state === 'open'">{{ unanswered.length }}</span>
        <FontAwesomeIcon v-else :icon="['fas', 'check']" class="w-2.5 h-2.5" />
      </span>
      <FontAwesomeIcon :icon="['fas', 'chevron-down']"
                       :class="['shrink-0 w-3 h-3 text-slate-400 transition-transform', open ? 'rotate-180' : '']" />
    </button>
  </h4>
</template>
