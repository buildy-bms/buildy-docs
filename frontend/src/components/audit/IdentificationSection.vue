<script setup>
import { ref, computed } from 'vue'
import { storeToRefs } from 'pinia'
import { BuildingOffice2Icon, ArrowPathIcon, ExclamationTriangleIcon } from '@heroicons/vue/24/outline'
import CollapsibleSection from '@/components/CollapsibleSection.vue'
import R175Tooltip from '@/components/R175Tooltip.vue'
import SectionHeader from '@/components/audit/SectionHeader.vue'
import SitePartiesCard from '@/components/audit/SitePartiesCard.vue'
import EnergyHistoryCard from '@/components/audit/EnergyHistoryCard.vue'
import SegmentedToggle from '@/components/audit/SegmentedToggle.vue'
import { useAuditStore } from '@/stores/audit'

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
  if (pcAfter && worksAfter) {
    return { applies: true, message: '✓ R175-6 applicable — PC postérieur au 21/07/2021 et travaux générateur récents.' }
  }
  if (pcAfter) {
    return { applies: true, message: '✓ R175-6 applicable — permis de construire postérieur au 21/07/2021.' }
  }
  if (worksAfter) {
    return { applies: true, message: '✓ R175-6 applicable — travaux d\'installation/remplacement de générateur postérieurs au 21/07/2021.' }
  }
  if (!pc && !works) return null
  return { applies: false, message: 'R175-6 non applicable — aucun déclencheur (PC ou travaux générateur après 21/07/2021).' }
})

// Style d'input harmonisé avec les autres cards (focus ring, transitions),
// hauteur uniforme h-9 (36px). La largeur est définie au cas par cas.
const inputCls = 'h-9 px-2.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition'

// Détail du calcul de puissance — replié par défaut (gain de hauteur).
const showPowerDetail = ref(false)
</script>

<template>
  <CollapsibleSection storage-key="identification" section-id="section-identification" :active="active">
    <template #header>
      <SectionHeader number="1"
                     :title="audit.isBacs ? 'Identification du site &amp; applicabilité R175-2' : 'Identification du site'"
                     :icon="BuildingOffice2Icon" icon-color="text-indigo-600"
                     :step="step"
                     @validate="emit('validate-step', $event)"
                     @invalidate="emit('invalidate-step', $event)">
        <template v-if="audit.isBacs" #subtitle-extra><R175Tooltip article="R175-2" /></template>
      </SectionHeader>
    </template>
    <template #summary>
      <span v-if="audit.isBacs">
        Puissance chauffage + clim {{ document?.bacs_total_power_kw ?? '—' }} kW
        · R175-2 {{ document?.bacs_applicable ? 'applicable' : 'non applicable' }}
      </span>
      <span v-else>
        {{ document?.client_name || 'Client à renseigner' }}
      </span>
    </template>
    <div v-if="audit.isBacs" class="px-5 py-3.5 space-y-3">
      <!-- Applicabilité R175-2 : puissance + permis sur une ligne -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-x-4 gap-y-2">
        <div class="md:col-span-2">
          <label class="block text-xs font-medium text-gray-700 mb-0.5">
            Puissance nominale utile cumulée chauffage + climatisation (kW)
          </label>
          <div class="flex gap-2">
            <input type="number" min="0" step="0.1"
                   :value="document?.bacs_total_power_kw"
                   @input="e => emit('save-doc', { bacs_total_power_kw: e.target.value === '' ? null : parseFloat(e.target.value), bacs_total_power_source: 'manual_override' })"
                   :class="inputCls" class="flex-1 min-w-0" />
            <button @click="emit('recompute-power')"
                    class="h-9 px-3 inline-flex items-center gap-1.5 text-xs font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 whitespace-nowrap shrink-0 transition"
                    v-tooltip="'Cumul automatique des équipements chauffage + climatisation du site'">
              <ArrowPathIcon class="w-3.5 h-3.5 shrink-0" /> Auto-calculer
            </button>
          </div>
          <p class="text-[11px] text-gray-500 mt-0.5">
            Source : <span class="font-mono">{{ document?.bacs_total_power_source || 'auto' }}</span><span v-if="document?.bacs_total_power_source === 'manual_override'" class="text-amber-700"> (override manuel)</span><template v-if="powerSummary?.heating_cooling_breakdown?.length"> · <button type="button" @click="showPowerDetail = !showPowerDetail" class="text-indigo-600 hover:text-indigo-800 font-medium">{{ showPowerDetail ? 'Masquer le détail' : 'Détail' }} ({{ powerSummary.heating_cooling_breakdown.length }} éq.)</button></template>
          </p>
          <div v-if="showPowerDetail && powerSummary?.heating_cooling_breakdown?.length"
               class="mt-1 bg-gray-50 border border-gray-200 rounded-lg p-2 text-[11px] text-gray-600">
            <ul class="space-y-0.5 font-mono">
              <li v-for="d in powerSummary.heating_cooling_breakdown" :key="d.id" class="flex justify-between gap-2">
                <span class="truncate">
                  <span :class="d.system_category === 'heating' ? 'text-orange-600' : 'text-cyan-600'">●</span>
                  {{ d.name || (d.brand ? d.brand : '—') }}<span class="text-gray-400"> ({{ d.zone_name || '—' }})</span>
                </span>
                <span class="font-semibold whitespace-nowrap">
                  <template v-if="(d.quantity || 1) > 1">{{ d.quantity }} × {{ d.power_kw }} = {{ Math.round((Number(d.power_kw) || 0) * d.quantity * 10) / 10 }} kW</template>
                  <template v-else>{{ d.power_kw }} kW</template>
                </span>
              </li>
            </ul>
            <p class="mt-1 pt-1 border-t border-gray-200 flex justify-between font-semibold">
              <span>Total chauffage + climatisation :</span>
              <span class="font-mono">{{ powerSummary.heating_cooling_total_kw }} kW</span>
            </p>
          </div>
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-700 mb-0.5">Date du permis de construire</label>
          <input type="date" :value="document?.bacs_building_permit_date || ''"
                 @input="e => emit('save-doc', { bacs_building_permit_date: e.target.value || null })"
                 :class="inputCls" class="w-full"
                 v-tooltip="'Postérieur au 8 avril 2024 : bâtiment soumis dès la livraison.'" />
        </div>
      </div>

      <!-- Déclencheurs réglementaires : Oui / Non, conditionnels en ligne -->
      <div class="border-t border-gray-100 pt-2.5 space-y-2">
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span class="text-sm text-gray-700">Des travaux d'installation ou de remplacement d'un générateur de chaleur ont-ils été réalisés ?
            <span class="text-[11px] text-gray-500">(déclencheur R175-6)</span></span>
          <SegmentedToggle :model-value="generatorWorksDone" @update:model-value="v => generatorWorksDone = v" />
          <template v-if="document?.bacs_generator_works_date != null">
            <input type="date" :value="document?.bacs_generator_works_date || ''"
                   @input="e => emit('save-doc', { bacs_generator_works_date: e.target.value || null })"
                   :class="inputCls"
                   v-tooltip="'Date des derniers travaux de générateur de chaleur'" />
            <span v-if="r175_6_applicable" class="text-[11px] px-2 py-0.5 rounded"
                  :class="r175_6_applicable.applies ? 'bg-amber-50 text-amber-800 border border-amber-200' : 'bg-emerald-50 text-emerald-800 border border-emerald-200'">
              {{ r175_6_applicable.message }}
            </span>
          </template>
        </div>
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span class="text-sm text-gray-700">Le bâtiment est-il raccordé à un <strong>réseau urbain de chaleur ou de froid</strong> ?</span>
          <SegmentedToggle :model-value="districtConnected" @update:model-value="v => districtConnected = v" />
          <input v-if="document?.bacs_district_heating_substation_kw !== null && document?.bacs_district_heating_substation_kw !== undefined"
                 type="number" min="0" step="0.1"
                 :value="document?.bacs_district_heating_substation_kw"
                 @input="e => emit('save-doc', { bacs_district_heating_substation_kw: e.target.value === '' ? 0 : parseFloat(e.target.value) })"
                 placeholder="Puissance station d'échange (kW)"
                 :class="inputCls" class="w-64"
                 v-tooltip="'R175-2 : la puissance de la station d\'échange détermine l\'assujettissement (prime sur le cumul des systèmes en aval).'" />
        </div>
      </div>

      <!-- Item 4 — Structure juridique & parties prenantes -->
      <div v-if="audit.document?.site_uuid" class="border-t border-gray-100 pt-2.5">
        <SitePartiesCard flush @open-notes="emit('open-notes', $event)" />
      </div>
      <!-- Item 13 — Base de consommations mensuelles de référence -->
      <div v-if="audit.document?.site_uuid" class="border-t border-gray-100 pt-2.5">
        <EnergyHistoryCard flush />
      </div>
    </div>
    <div v-if="!audit.isBacs" class="px-5 py-4 text-sm text-gray-500">
      <p>
        Audit GTB (Classique) — les contraintes du décret R175 sont
        désactivées pour ce document. Les sections ci-dessous se
        concentrent sur l'inventaire technique nécessaire au chiffrage.
      </p>
    </div>
    <div v-if="audit.isBacs && document?.bacs_applicability_status" class="px-5 pb-4">
      <div :class="['rounded-lg border p-3 flex items-start gap-3', applicabilityLabels[document.bacs_applicability_status].cls]">
        <ExclamationTriangleIcon class="w-5 h-5 shrink-0 mt-0.5" />
        <div class="flex-1">
          <div class="font-medium text-sm">{{ applicabilityLabels[document.bacs_applicability_status].label }}</div>
        </div>
      </div>
      <p v-if="document?.bacs_applicability_status !== 'not_subject'" class="mt-2 text-[11px] text-gray-500 leading-relaxed">
        <em>À titre informatif :</em> l'article R175-2 prévoit une clause de dispense applicable lorsque le temps de retour
        sur investissement de la mise en conformité dépasse 10 ans. Ce calcul ne relève pas du périmètre de l'audit
        (cf. Annexe D, point 4).
      </p>
    </div>
  </CollapsibleSection>
</template>
