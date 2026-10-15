<script setup>
import { ref, computed } from 'vue'
import { storeToRefs } from 'pinia'
import { BuildingOffice2Icon, ArrowPathIcon, ExclamationTriangleIcon, CheckCircleIcon } from '@heroicons/vue/24/outline'
import CollapsibleSection from '@/components/CollapsibleSection.vue'
import R175Tooltip from '@/components/R175Tooltip.vue'
import HelpTip from '@/components/HelpTip.vue'
import SectionHeader from '@/components/audit/SectionHeader.vue'
import SitePartiesCard from '@/components/audit/SitePartiesCard.vue'
import EnergyHistoryCard from '@/components/audit/EnergyHistoryCard.vue'
import SegmentedToggle from '@/components/audit/SegmentedToggle.vue'
import { useAuditStore } from '@/stores/audit'
import {
  POWER_LABEL_HELP, POWER_AUTO_TIP, POWER_SOURCE_LABELS, POWER_SOURCE_TIPS, RETAINED_POWER_TIP,
  PERMIT_DATE_TIP, SUBSTATION_TIP, powerDeviceTip, powerCategoryLabel, applicabilityTip, thermalTriggerTip,
} from '@/lib/audit-tips-site'
import RubricShell from '@/components/audit/guided/RubricShell.vue'
import RubricsFilter from '@/components/audit/guided/RubricsFilter.vue'
import { useStepRubrics } from '@/composables/useStepRubrics'
import { identificationRubrics, VERDICT_TONES, frenchDate, formatKw } from '@/lib/identification-guide'
import { IDENT_VERDICT_QUESTION, IDENT_VERDICT_PENDING, IDENT_RETAINED_POWER, IDENT_PERMIT } from '@/lib/audit-tips-guided'
import { OWNERSHIP_STRUCTURES } from '@/lib/audit-options'
import { library } from '@fortawesome/fontawesome-svg-core'
import { faGauge, faScrewdriverWrench, faScaleBalanced, faChartColumn } from '@fortawesome/free-solid-svg-icons'

// Icônes des rubriques (lib/identification-guide.js).
library.add(faGauge, faScrewdriverWrench, faScaleBalanced, faChartColumn)

// Section 1 — Identification du site & applicabilité R175-2.
const props = defineProps({
  step: { type: Object, default: null },
  applicabilityLabels: { type: Object, required: true },
  active: { type: Boolean, default: false },
})
const emit = defineEmits([
  'save-doc', 'recompute-power', 'validate-step', 'invalidate-step', 'open-notes',
])

const audit = useAuditStore()
const { document, powerSummary } = storeToRefs(audit)

// districtConnected / generatorWorksDone : v-models calcules qui
// emettent save-doc plutot que de toucher au store directement.
const districtConnected = computed({
  get: () => document.value?.bacs_district_heating_substation_kw != null,
  set: (v) => emit('save-doc', {
    bacs_district_heating_substation_kw: v
      ? (document.value?.bacs_district_heating_substation_kw ?? 0)
      : null,
  }),
})
const generatorWorksDone = computed({
  get: () => document.value?.bacs_generator_works_date != null,
  set: (v) => emit('save-doc', {
    bacs_generator_works_date: v
      ? (document.value?.bacs_generator_works_date ?? new Date().toISOString().slice(0, 10))
      : null,
  }),
})

// R175-6 declencheur : PC > 21/07/2021 OU travaux generateur > 21/07/2021.
const R175_6_TRIGGER_DATE = '2021-07-21'
const r175_6_applicable = computed(() => {
  if (!document.value) return null
  const pc = document.value.bacs_building_permit_date
  const works = document.value.bacs_generator_works_date
  const pcAfter = pc && pc > R175_6_TRIGGER_DATE
  const worksAfter = works && works > R175_6_TRIGGER_DATE
  // Textes affichés en clair (pastille) ; le détail des dates est dans l'infobulle.
  if (pcAfter && worksAfter) {
    return { applies: true, message: 'Régulation pièce par pièce obligatoire : permis et travaux après le 21 juillet 2021' }
  }
  if (pcAfter) {
    return { applies: true, message: 'Régulation pièce par pièce obligatoire : permis déposé après le 21 juillet 2021' }
  }
  if (worksAfter) {
    return { applies: true, message: 'Régulation pièce par pièce obligatoire : travaux sur le générateur après le 21 juillet 2021' }
  }
  if (!pc && !works) return null
  return { applies: false, message: 'Régulation pièce par pièce non exigée : ni permis ni travaux après le 21 juillet 2021' }
})
const r175_6_tip = computed(() => r175_6_applicable.value && thermalTriggerTip({
  applies: r175_6_applicable.value.applies,
  permitDate: document.value?.bacs_building_permit_date,
  worksDate: document.value?.bacs_generator_works_date,
}))

// Origine de la puissance (calcul automatique ou saisie à la main), en clair.
const powerSource = computed(() => (document.value?.bacs_total_power_source === 'manual_override' ? 'manual_override' : 'auto'))

// Verdict d'assujettissement : carte qui explique le verdict (présumé quand des
// puissances d'équipements manquent, cf. bacs-audit-power.js).
const verdictTip = computed(() => applicabilityTip(document.value?.bacs_applicability_status, {
  presumed: !!powerSummary.value?.power_summary?.presumedSubjectDueToMissingData,
}))

// Style d'input harmonisé avec les autres cards (focus ring, transitions),
// hauteur uniforme h-9 (36px). La largeur est définie au cas par cas.
const inputCls = 'h-9 px-2.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition'

// Détail du calcul de puissance — replié par défaut (gain de hauteur).
const showPowerDetail = ref(false)

// ─── Le verdict en tête, puis les rubriques ─────────────────
// Le verdict (la réponse même de l'étape) passe en tête avec la puissance retenue et le permis ;
// les quatre blocs sont des rubriques repliables (lib/identification-guide.js), comme l'étape GTB.
const { site, siteParties } = storeToRefs(audit)
const historyCount = ref(null)
const retainedKw = computed(() => powerSummary.value?.power_summary?.retainedKw ?? document.value?.bacs_total_power_kw)
const rubrics = computed(() => identificationRubrics(document.value, {
  hasSite: !!document.value?.site_uuid,
  structureLabel: OWNERSHIP_STRUCTURES.find(o => o.value === site.value?.ownership_structure)?.label || '',
  partiesCount: (siteParties.value || []).length,
  historyCount: historyCount.value,
  retainedKw: retainedKw.value,
}))
const rubricByKey = computed(() => Object.fromEntries(rubrics.value.map(r => [r.key, r])))
const {
  showAll: showAllRubrics, setShowAll: setShowAllRubrics, showTodo: showTodoRubrics,
  isOpen: isRubricOpen, toggle: toggleRubric,
} = useStepRubrics(rubrics, () => [!!audit.isBacs, document.value?.id])
function rubric(key) {
  const r = rubricByKey.value[key]
  if (!r) return { title: '', open: true }
  return { title: r.title, icon: r.icon, missing: r.missing, unanswered: r.unanswered, summary: r.summary, open: isRubricOpen(key) }
}
// Verdict en tête : libellé, teinte de sévérité, puissance retenue et date du permis.
const verdict = computed(() => {
  const st = document.value?.bacs_applicability_status
  return st ? { status: st, label: props.applicabilityLabels[st]?.label || st, tone: VERDICT_TONES[st] || 'amber' } : null
})
const VERDICT_HERO = {
  red: 'bg-red-50 ring-red-200 text-red-900',
  orange: 'bg-orange-50 ring-orange-200 text-orange-900',
  amber: 'bg-amber-50 ring-amber-200 text-amber-900',
  green: 'bg-emerald-50 ring-emerald-200 text-emerald-900',
  none: 'bg-white ring-slate-300 text-slate-700',
}
// La structure de propriété sans réponse bloque la validation : « Reste à faire » du bandeau
// (STEP_DEFINITIONS.identification de la vue).
</script>

<template>
  <CollapsibleSection storage-key="identification" section-id="section-identification" :active="active">
    <template #header>
      <SectionHeader number="1"
                     :title="audit.isBacs ? 'Identification du site : concerné par le décret ?' : 'Identification du site'"
                     :icon="BuildingOffice2Icon" icon-color="text-indigo-600"
                     :step="step"
                     @validate="emit('validate-step', $event)"
                     @invalidate="emit('invalidate-step', $event)">
        <template v-if="audit.isBacs" #subtitle-extra><R175Tooltip article="R175-2" /></template>
      </SectionHeader>
    </template>
    <template #summary>
      <span v-if="audit.isBacs">
        Chauffage et climatisation : {{ document?.bacs_total_power_kw ?? '—' }} kW
        · {{ document?.bacs_applicable ? 'concerné par le décret' : 'non concerné par le décret' }}
      </span>
      <span v-else>
        {{ document?.client_name || 'Client à renseigner' }}
      </span>
    </template>
    <!-- Mode BACS : 4 cartes sur fond gris léger. Le verdict d'applicabilité
         est affiché à côté de la puissance et du permis qui le déterminent. -->
    <div v-if="audit.isBacs" class="p-4 flex flex-col gap-3 bg-slate-50/70">
      <!-- Le verdict en tête (la réponse même de l'étape), avec la puissance retenue et la date du
           permis qui le déterminent. -->
      <section data-ident-verdict v-tooltip="verdict ? verdictTip : null"
               :class="['rounded-xl ring-1 px-5 py-4 flex flex-wrap items-center gap-x-10 gap-y-3', VERDICT_HERO[verdict?.tone || 'none']]">
        <div class="flex items-center gap-3 min-w-0 flex-1">
          <span class="w-11 h-11 shrink-0 rounded-xl bg-white/80 ring-1 ring-inset ring-black/5 inline-flex items-center justify-center">
            <CheckCircleIcon v-if="verdict?.tone === 'green'" class="w-6 h-6" />
            <ExclamationTriangleIcon v-else class="w-6 h-6" />
          </span>
          <div class="min-w-0">
            <p class="text-xs opacity-80">{{ IDENT_VERDICT_QUESTION }}</p>
            <p class="text-lg font-semibold leading-snug">{{ verdict ? verdict.label : IDENT_VERDICT_PENDING }}</p>
          </div>
        </div>
        <dl class="flex items-end gap-10">
          <div>
            <dt class="text-xs opacity-80">{{ IDENT_RETAINED_POWER }}</dt>
            <dd class="text-2xl font-semibold leading-tight tabular-nums">{{ formatKw(retainedKw) || '—' }}</dd>
          </div>
          <div>
            <dt class="text-xs opacity-80">{{ IDENT_PERMIT }}</dt>
            <dd class="text-base font-semibold leading-tight">{{ frenchDate(document?.bacs_building_permit_date) || '—' }}</dd>
          </div>
        </dl>
      </section>
      <div class="flex flex-wrap items-start justify-between gap-2">
        <p v-if="verdict && verdict.status !== 'not_subject'" class="flex-1 min-w-60 px-1 text-[11px] text-gray-500 leading-relaxed">
          <em>À titre informatif :</em> le propriétaire peut être dispensé si la mise en conformité ne se rembourse
          pas en moins de 10 ans. Ce calcul ne fait pas partie de l’audit (voir l’annexe D du rapport, point 4).
        </p>
        <RubricsFilter class="ml-auto" :show-all="showAllRubrics" @todo="showTodoRubrics" @all="setShowAllRubrics(true)" />
      </div>
      <RubricShell id="ident-applicability" v-bind="rubric('applicability')"
                   @toggle="toggleRubric('applicability')">
        <div class="grid grid-cols-1 gap-4 items-start">
      <!-- Applicabilité R175-2 : puissance + permis sur une ligne -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-x-4 gap-y-2">
        <div class="md:col-span-2">
          <label class="block text-xs font-medium text-gray-700 mb-0.5">
            Puissance de chauffage et de climatisation (kW)
            <HelpTip size="xs" class="ml-0.5" :tip="POWER_LABEL_HELP" />
          </label>
          <div class="flex gap-2">
            <!-- Calcul automatique : la puissance retenue (celle du verdict et du rapport), pas la
                 valeur enregistrée, qui peut dater d'un ancien calcul (audit #56 : 949 kW
                 enregistrés, 1 002 kW retenus). Saisie à la main : la valeur saisie. -->
            <input type="number" min="0" step="0.1"
                   :value="powerSource === 'auto' ? retainedKw : document?.bacs_total_power_kw"
                   @input="e => emit('save-doc', { bacs_total_power_kw: e.target.value === '' ? null : parseFloat(e.target.value), bacs_total_power_source: 'manual_override' })"
                   :class="inputCls" class="flex-1 min-w-0" />
            <button @click="emit('recompute-power')"
                    class="h-9 px-3 inline-flex items-center gap-1.5 text-xs font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 whitespace-nowrap shrink-0 transition"
                    v-tooltip="POWER_AUTO_TIP">
              <ArrowPathIcon class="w-3.5 h-3.5 shrink-0" /> Auto-calculer
            </button>
          </div>
          <p class="text-[11px] text-gray-500 mt-0.5">
            Source : <span :class="powerSource === 'manual_override' ? 'text-amber-700' : ''"
                           v-tooltip="POWER_SOURCE_TIPS[powerSource]">{{ POWER_SOURCE_LABELS[powerSource] }}</span><template v-if="powerSummary?.heating_cooling_breakdown?.length"> · <button type="button" @click="showPowerDetail = !showPowerDetail" class="text-indigo-600 hover:text-indigo-800 font-medium"
                      v-tooltip="showPowerDetail ? 'Masquer le détail du calcul' : 'Afficher le détail du calcul'">{{ showPowerDetail ? 'Masquer le détail' : 'Détail du calcul' }} ({{ powerSummary.heating_cooling_breakdown.length }} {{ powerSummary.heating_cooling_breakdown.length > 1 ? 'équipements' : 'équipement' }})</button></template>
          </p>
          <div v-if="showPowerDetail && powerSummary?.heating_cooling_breakdown?.length"
               class="mt-1 bg-gray-50 border border-gray-200 rounded-lg p-2 text-[11px] text-gray-600">
            <ul class="space-y-0.5 font-mono">
              <li v-for="d in powerSummary.heating_cooling_breakdown" :key="d.id"
                  :class="['flex justify-between gap-2', d.in_scope === false ? 'opacity-50' : '']"
                  v-tooltip="powerDeviceTip(d)">
                <span class="truncate">
                  <span :class="d.system_category === 'heating' ? 'text-orange-600' : 'text-cyan-600'"
                        v-tooltip="powerCategoryLabel(d.system_category)">●</span>
                  {{ d.name || (d.brand ? d.brand : '—') }}<span class="text-gray-400"> ({{ d.zone_name || '—' }})</span><span v-if="d.in_scope === false" class="text-gray-400"> · non compté<template v-if="d.exclusion_reason_label"> ({{ d.exclusion_reason_label }})</template></span>
                </span>
                <span :class="['font-semibold whitespace-nowrap', d.in_scope === false ? 'line-through text-gray-400' : '']">
                  <template v-if="(d.quantity || 1) > 1">{{ d.quantity }} × {{ d.power_kw }} = {{ Math.round((Number(d.power_kw) || 0) * d.quantity * 10) / 10 }} kW</template>
                  <template v-else>{{ d.power_kw }} kW</template>
                </span>
              </li>
            </ul>
            <p class="mt-1 pt-1 border-t border-gray-200 flex justify-between font-semibold"
               v-tooltip="RETAINED_POWER_TIP">
              <span>Puissance retenue <span class="font-normal text-gray-400">(la plus forte des deux, sans les émetteurs)</span> :</span>
              <span class="font-mono">{{ powerSummary.power_summary?.retainedKw ?? powerSummary.heating_cooling_total_kw }} kW</span>
            </p>
          </div>
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-700 mb-0.5">Date du permis de construire</label>
          <input type="date" :value="document?.bacs_building_permit_date || ''"
                 @input="e => emit('save-doc', { bacs_building_permit_date: e.target.value || null })"
                 :class="inputCls" class="w-full"
                 v-tooltip="PERMIT_DATE_TIP" />
        </div>
      </div>
        </div>
      </RubricShell>

      <!-- Déclencheurs réglementaires : Oui / Non, conditionnels en dessous -->
      <RubricShell id="ident-triggers" v-bind="rubric('triggers')"
                   @toggle="toggleRubric('triggers')">
        <div class="qa-grid text-sm">
          <div class="qa-question">
            Des travaux d'installation ou de remplacement d'un générateur de chaleur ont-ils été réalisés ?
            <span class="qa-desc">Après le 21 juillet 2021, ils rendent obligatoire la régulation automatique de la température pièce par pièce.</span>
          </div>
          <SegmentedToggle :model-value="generatorWorksDone" @update:model-value="v => generatorWorksDone = v" />

          <div class="qa-question">
            Le bâtiment est-il raccordé à un <strong>réseau urbain de chaleur ou de froid</strong> ?
            <span class="qa-desc">Si oui, la puissance retenue est celle de la station d’échange, pas la somme des équipements qu’elle alimente.</span>
          </div>
          <SegmentedToggle :model-value="districtConnected" @update:model-value="v => districtConnected = v" />
        </div>
        <!-- Champs conditionnels (en pleine largeur sous le grid, alignés avec le label de question) -->
        <template v-if="document?.bacs_generator_works_date != null">
          <div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <label class="text-xs text-gray-600">Date des derniers travaux sur le générateur :</label>
            <input type="date" :value="document?.bacs_generator_works_date || ''"
                   @input="e => emit('save-doc', { bacs_generator_works_date: e.target.value || null })"
                   :class="inputCls" />
            <span v-if="r175_6_applicable" class="text-[11px] px-2 py-0.5 rounded"
                  :class="r175_6_applicable.applies ? 'bg-amber-50 text-amber-800 border border-amber-200' : 'bg-emerald-50 text-emerald-800 border border-emerald-200'"
                  v-tooltip="r175_6_tip">
              {{ r175_6_applicable.message }}
            </span>
          </div>
        </template>
        <div v-if="document?.bacs_district_heating_substation_kw !== null && document?.bacs_district_heating_substation_kw !== undefined"
             class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <label class="text-xs text-gray-600">
            Puissance de la station d’échange (kW)
            <HelpTip size="xs" class="ml-0.5" :tip="SUBSTATION_TIP" /> :
          </label>
          <input type="number" min="0" step="0.1"
                 :value="document?.bacs_district_heating_substation_kw"
                 @input="e => emit('save-doc', { bacs_district_heating_substation_kw: e.target.value === '' ? 0 : parseFloat(e.target.value) })"
                 :class="inputCls" class="w-40" />
        </div>
      </RubricShell>

      <!-- Item 4 — Structure juridique & parties prenantes -->
      <RubricShell v-if="audit.document?.site_uuid" id="ident-parties"
                   v-bind="rubric('parties')" @toggle="toggleRubric('parties')">
        <SitePartiesCard flush hide-title @open-notes="emit('open-notes', $event)" />
      </RubricShell>
      <!-- Item 13 — Base de consommations mensuelles de référence -->
      <RubricShell v-if="audit.document?.site_uuid" id="ident-energy-history"
                   v-bind="rubric('history')" @toggle="toggleRubric('history')">
        <EnergyHistoryCard flush hide-title @count="n => (historyCount = n)" />
      </RubricShell>
    </div>
    <div v-if="!audit.isBacs" class="px-5 py-4 text-sm text-gray-500">
      <p>
        Audit GTB (classique) : les exigences du décret BACS ne
        s’appliquent pas à ce document. Les sections ci-dessous se
        concentrent sur l'inventaire technique nécessaire au chiffrage.
      </p>
    </div>
    <!-- Verdict d'applicabilité : désormais dans la carte « Applicabilité du
         décret (R175-2) », à côté de la puissance et du permis. -->
  </CollapsibleSection>
</template>
