<script setup>
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { BuildingOffice2Icon, ArrowPathIcon, ExclamationTriangleIcon } from '@heroicons/vue/24/outline'
import CollapsibleSection from '@/components/CollapsibleSection.vue'
import R175Tooltip from '@/components/R175Tooltip.vue'
import SectionHeader from '@/components/audit/SectionHeader.vue'
import { useAuditStore } from '@/stores/audit'

// Section 1 — Identification du site & applicabilité R175-2.
const props = defineProps({
  step: { type: Object, default: null },
  applicabilityLabels: { type: Object, required: true },
  active: { type: Boolean, default: false },
})
const emit = defineEmits([
  'save-doc', 'recompute-power', 'validate-step', 'invalidate-step',
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
    <div v-if="audit.isBacs" class="px-5 py-4 grid grid-cols-2 gap-4">
      <div>
        <label class="block text-xs font-medium text-gray-700 mb-1">
          Puissance nominale utile cumulée chauffage + climatisation (kW)
        </label>
        <div class="flex gap-2">
          <input type="number" min="0" step="0.1"
                 :value="document?.bacs_total_power_kw"
                 @input="e => emit('save-doc', { bacs_total_power_kw: e.target.value === '' ? null : parseFloat(e.target.value), bacs_total_power_source: 'manual_override' })"
                 class="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm" />
          <button @click="emit('recompute-power')"
                  class="px-3 py-2 text-xs font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 whitespace-nowrap"
                  title="Cumul automatique des équipements chauffage + climatisation du site">
            <ArrowPathIcon class="w-3.5 h-3.5 inline-block -mt-0.5" /> Auto-calculer
          </button>
        </div>
        <p class="text-[11px] text-gray-500 mt-1">
          Source : <span class="font-mono">{{ document?.bacs_total_power_source || 'auto' }}</span>
          <span v-if="document?.bacs_total_power_source === 'manual_override'" class="text-amber-700"> (override manuel)</span>
        </p>
        <details v-if="powerSummary?.heating_cooling_breakdown?.length" class="mt-2 group">
          <summary class="cursor-pointer text-[11px] text-indigo-600 hover:text-indigo-800 font-medium select-none">
            Détail du calcul auto ({{ powerSummary.heating_cooling_breakdown.length }} équipement{{ powerSummary.heating_cooling_breakdown.length > 1 ? 's' : '' }} compté{{ powerSummary.heating_cooling_breakdown.length > 1 ? 's' : '' }})
          </summary>
          <div class="mt-2 bg-gray-50 border border-gray-200 rounded-lg p-2 text-[11px] text-gray-600">
            <p class="mb-1.5 italic">Somme des puissances des équipements <strong>chauffage</strong> et <strong>climatisation</strong> saisis dans la section 3 :</p>
            <ul class="space-y-0.5 font-mono">
              <li v-for="d in powerSummary.heating_cooling_breakdown" :key="d.id" class="flex justify-between gap-2">
                <span class="truncate">
                  <span :class="d.system_category === 'heating' ? 'text-orange-600' : 'text-cyan-600'">●</span>
                  {{ d.name || (d.brand ? d.brand : '—') }}{{ d.model_reference ? ' / ' + d.model_reference : '' }}
                  <span class="text-gray-400">({{ d.zone_name || '—' }})</span>
                </span>
                <span class="font-semibold whitespace-nowrap">{{ d.power_kw }} kW</span>
              </li>
            </ul>
            <p class="mt-2 pt-1.5 border-t border-gray-200 flex justify-between font-semibold">
              <span>Total chauffage + climatisation :</span>
              <span class="font-mono">{{ powerSummary.heating_cooling_total_kw }} kW</span>
            </p>
          </div>
        </details>
      </div>
      <div>
        <label class="block text-xs font-medium text-gray-700 mb-1">Date du permis de construire</label>
        <input type="date" :value="document?.bacs_building_permit_date || ''"
               @input="e => emit('save-doc', { bacs_building_permit_date: e.target.value || null })"
               class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
        <p class="text-[11px] text-gray-500 mt-1">
          Si postérieur au 8 avril 2024, le bâtiment est soumis dès la livraison.
        </p>
      </div>
      <div>
        <label class="inline-flex items-center gap-2 cursor-pointer text-sm text-gray-700">
          <input type="checkbox" v-model="generatorWorksDone" class="rounded border-gray-300" />
          <span>Travaux d'installation/remplacement de générateur de chaleur réalisés <span class="text-[11px] text-gray-500">(déclencheur R175-6)</span></span>
        </label>
        <div v-if="document?.bacs_generator_works_date != null" class="pl-6 border-l-2 border-indigo-100 mt-2">
          <label class="block text-xs font-medium text-gray-700 mb-1">
            Date des derniers travaux générateur de chaleur
          </label>
          <input type="date" :value="document?.bacs_generator_works_date || ''"
                 @input="e => emit('save-doc', { bacs_generator_works_date: e.target.value || null })"
                 class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
          <p class="text-[11px] text-gray-500 mt-1 leading-relaxed">
            <strong>R175-6</strong> s'applique si le permis de construire est postérieur au <strong>21/07/2021</strong> ou si des travaux générateur ont été engagés après cette date.
          </p>
          <p v-if="r175_6_applicable" class="text-[11px] mt-1.5 px-2 py-1 rounded"
             :class="r175_6_applicable.applies ? 'bg-amber-50 text-amber-800 border border-amber-200' : 'bg-emerald-50 text-emerald-800 border border-emerald-200'">
            {{ r175_6_applicable.message }}
          </p>
        </div>
      </div>
      <div class="col-span-2 border-t border-gray-100 pt-3">
        <label class="inline-flex items-center gap-2 cursor-pointer text-sm text-gray-700">
          <input type="checkbox" v-model="districtConnected" class="rounded border-gray-300" />
          <span>Bâtiment raccordé à un <strong>réseau urbain de chaleur ou de froid</strong></span>
        </label>
        <div v-if="document?.bacs_district_heating_substation_kw !== null && document?.bacs_district_heating_substation_kw !== undefined"
             class="mt-2 pl-6 border-l-2 border-indigo-100">
          <label class="block text-xs font-medium text-gray-700 mb-1">
            Puissance de la station d'échange (kW)
          </label>
          <input type="number" min="0" step="0.1"
                 :value="document?.bacs_district_heating_substation_kw"
                 @input="e => emit('save-doc', { bacs_district_heating_substation_kw: e.target.value === '' ? 0 : parseFloat(e.target.value) })"
                 placeholder="—"
                 class="w-full max-w-xs px-3 py-2 border border-gray-200 rounded-lg text-sm" />
          <p class="text-[11px] text-gray-500 mt-1 leading-relaxed">
            <strong>R175-2</strong> : « Pour les bâtiments dont la génération de chaleur ou de froid est produite par échange avec un réseau urbain, la <strong>puissance du générateur à considérer est celle de la station d'échange</strong> ». Cette valeur prime sur la puissance cumulée des systèmes en aval pour déterminer l'assujettissement.
          </p>
        </div>
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
