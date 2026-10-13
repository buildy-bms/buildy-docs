<script setup>
/**
 * Reste à faire d'une zone (étape Systèmes, mise en page guidée), en tête de la liste :
 *  - ambre : réponses manquantes des équipements (« Voir le détail » : chaque équipement et ce
 *    qui lui manque, un clic ouvre sa fiche), usages présents sans équipement ;
 *  - pointillés : usages sans réponse ;
 *  - rose : points à vérifier (règles du pré-contrôle de livraison), un par ligne ;
 *  - filtre des équipements : tous / à compléter / à vérifier.
 * Aucune réponse en masse : chaque ligne mène à l'équipement ou à l'usage concerné.
 */
import { computed, ref } from 'vue'
import { missingSummary, zoneChecks, missingShort } from '@/lib/systems-guide'
import {
  missingLineText, emptySystemsLineText, unansweredLineText, checkLine, checkText, checkCardTip, moreChecksLabel,
  MISSING_DETAIL_TIP, MISSING_HIDE_TIP, GO_TO_SYSTEM_TIP, OPEN_DEVICE_TIP, GUIDE_FILTER_TIPS, GUIDE_DONE_TEXT,
} from '@/lib/audit-tips-systems-guide'

const props = defineProps({
  zone: { type: Object, required: true },        // zoneGuide() de lib/systems-guide.js
  labelOf: { type: Function, required: true },   // libellé d'un usage
  nameOf: { type: Function, required: true },    // nom affiché d'un équipement
  filter: { type: String, default: 'all' },
  // Fiche ouverte à droite : seulement le filtre (la fiche montre ce qui reste à faire).
  compact: { type: Boolean, default: false },
})
const emit = defineEmits(['update:filter', 'open-device', 'go-system', 'add-device'])

const MAX_CHECK_LINES = 3
const detailOpen = ref(false)

const missing = computed(() => missingSummary(props.zone))
const emptyOnes = computed(() => props.zone.systems.filter(x => x.empty))
const unanswered = computed(() => props.zone.systems.filter(x => x.status === 'unanswered'))
const checks = computed(() => zoneChecks(props.zone))
const incompleteEntries = computed(() => props.zone.systems.flatMap(x =>
  (x.present ? x.devices.filter(e => e.missing.length).map(e => ({ ...e, system: x.system })) : [])))
const hasDevices = computed(() => props.zone.systems.some(x => x.present && (x.devices.length || x.shared.length)))
const allDone = computed(() => props.zone.present > 0 && !props.zone.toComplete && !props.zone.toCheck && !props.zone.unanswered)

const filters = computed(() => [
  { value: 'all', label: 'Tous les équipements', count: null, tip: GUIDE_FILTER_TIPS.all, tone: 'navy' },
  { value: 'todo', label: 'À compléter', count: props.zone.incompleteDevices, tip: GUIDE_FILTER_TIPS.todo, tone: 'amber' },
  { value: 'check', label: 'À vérifier', count: checks.value.filter(c => c.kind === 'device').length, tip: GUIDE_FILTER_TIPS.check, tone: 'rose' },
])
const CHIP = {
  navy: { on: 'bg-indigo-600 text-white ring-indigo-600', off: 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50' },
  amber: { on: 'bg-amber-100 text-amber-900 ring-amber-400', off: 'bg-white text-amber-800 ring-amber-300 hover:bg-amber-50' },
  rose: { on: 'bg-rose-100 text-rose-900 ring-rose-400', off: 'bg-white text-rose-700 ring-rose-200 hover:bg-rose-50' },
}
function chipClass(f) {
  if (f.count === 0) return 'bg-white text-slate-400 ring-slate-200 cursor-default'
  const t = CHIP[f.tone]
  return props.filter === f.value ? t.on : t.off
}
function pick(f) {
  if (f.count === 0) return
  emit('update:filter', props.filter === f.value && f.value !== 'all' ? 'all' : f.value)
}
function chipTip(f) {
  if (f.count !== 0) return f.tip
  return f.value === 'todo' ? 'Rien à compléter dans cette zone' : 'Rien à vérifier dans cette zone'
}

function checkTarget(c) {
  if (c.kind === 'device') emit('open-device', { device: c.device, system: c.system })
  else emit('go-system', c.system)
}
</script>

<template>
  <div class="flex flex-col gap-2" data-guide-summary>
    <template v-if="!compact">
    <!-- À compléter : réponses manquantes, usages présents sans équipement -->
    <div v-if="missing.answers || emptyOnes.length"
         class="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] text-amber-950">
      <div v-if="missing.answers" class="flex items-start gap-3">
        <p class="flex-1 min-w-0 leading-snug">{{ missingLineText(missing) }}</p>
        <button type="button" @click="detailOpen = !detailOpen" :aria-expanded="detailOpen ? 'true' : 'false'"
                class="shrink-0 text-xs font-medium text-amber-900 underline underline-offset-2 hover:text-amber-950"
                v-tooltip="detailOpen ? MISSING_HIDE_TIP : MISSING_DETAIL_TIP">
          {{ detailOpen ? 'Masquer le détail' : 'Voir le détail' }}
        </button>
      </div>
      <ul v-if="detailOpen && missing.answers" class="mt-2 flex flex-col gap-1 border-t border-amber-200 pt-2">
        <li v-for="e in incompleteEntries" :key="`${e.system.id}-${e.device.id}`" class="flex items-baseline gap-2 min-w-0 text-xs">
          <button type="button" @click="emit('open-device', { device: e.device, system: e.system })"
                  class="shrink-0 max-w-[45%] truncate text-left font-medium text-indigo-700 hover:underline"
                  v-tooltip="OPEN_DEVICE_TIP">{{ nameOf(e.device) }}</button>
          <span class="shrink-0 text-amber-800/80">{{ labelOf(e.system) }}</span>
          <span class="min-w-0 truncate text-amber-900" v-tooltip.overflow>{{ e.missing.map(missingShort).join(', ') }}</span>
        </li>
      </ul>
      <div v-if="emptyOnes.length" :class="['flex items-start gap-3', missing.answers && 'mt-1.5 border-t border-amber-200 pt-1.5']">
        <p class="flex-1 min-w-0 leading-snug">{{ emptySystemsLineText(emptyOnes.map(x => labelOf(x.system))) }}</p>
        <button v-if="emptyOnes.length === 1" type="button" @click="emit('add-device', emptyOnes[0].system)"
                class="shrink-0 rounded-md bg-white px-2.5 py-1 text-xs font-medium text-indigo-700 ring-1 ring-inset ring-amber-300 hover:bg-amber-100">
          Ajouter un équipement
        </button>
        <button v-else type="button" @click="emit('go-system', emptyOnes[0].system)" v-tooltip="GO_TO_SYSTEM_TIP"
                class="shrink-0 text-xs font-medium text-amber-900 underline underline-offset-2">Voir</button>
      </div>
    </div>

    <!-- Sans réponse -->
    <div v-if="unanswered.length"
         class="flex items-start gap-3 rounded-lg border border-dashed border-slate-400 bg-white px-3 py-2 text-[13px] text-slate-800">
      <p class="flex-1 min-w-0 leading-snug">{{ unansweredLineText(unanswered.map(x => labelOf(x.system))) }}</p>
      <button type="button" @click="emit('go-system', unanswered[0].system)" v-tooltip="GO_TO_SYSTEM_TIP"
              class="shrink-0 text-xs font-medium text-slate-700 underline underline-offset-2 hover:text-slate-900">Voir</button>
    </div>

    <!-- À vérifier : un point par ligne -->
    <div v-for="(c, i) in checks.slice(0, MAX_CHECK_LINES)" :key="`${c.kind}-${c.device?.id || c.system.id}-${c.finding.code}-${i}`"
         class="flex items-start gap-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-950">
      <p class="flex-1 min-w-0 leading-snug" v-tooltip="() => checkCardTip(c.finding, c.device || null, c.system.system_category)">
        <strong class="font-semibold">{{ checkLine(c.finding, c.device ? nameOf(c.device) : labelOf(c.system)).lead }}</strong>
        {{ checkText(c.finding.code).line }}
      </p>
      <button type="button" @click="checkTarget(c)"
              class="shrink-0 rounded-md bg-white px-2.5 py-1 text-xs font-medium text-rose-800 ring-1 ring-inset ring-rose-300 hover:bg-rose-100"
              v-tooltip="c.kind === 'device' ? OPEN_DEVICE_TIP : GO_TO_SYSTEM_TIP">
        {{ c.kind === 'device' ? 'Ouvrir la fiche' : 'Voir l’usage' }}
      </button>
    </div>
    <button v-if="checks.length > MAX_CHECK_LINES" type="button" @click="emit('update:filter', 'check')"
            class="self-start text-xs font-medium text-rose-800 underline underline-offset-2">
      {{ moreChecksLabel(checks.length - MAX_CHECK_LINES) }}
    </button>

    <p v-if="allDone" class="text-[13px] text-emerald-700">✓ {{ GUIDE_DONE_TEXT }}</p>
    </template>

    <!-- Filtre des équipements -->
    <div v-if="hasDevices" role="group" aria-label="Filtrer les équipements" class="flex flex-wrap items-center gap-1.5">
      <button v-for="f in filters" :key="f.value" type="button"
              :aria-pressed="filter === f.value ? 'true' : 'false'"
              :aria-disabled="f.count === 0 ? 'true' : undefined"
              @click="pick(f)"
              v-tooltip="chipTip(f)"
              :class="['inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset transition outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60', chipClass(f)]">
        {{ f.label }}<template v-if="f.count != null"> ({{ f.count }})</template>
      </button>
    </div>
  </div>
</template>
