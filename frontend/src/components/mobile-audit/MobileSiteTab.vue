<script setup>
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import '@/lib/equipment-icons'
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useAuditStore } from '@/stores/audit'
import { useNotification } from '@/composables/useNotification'
import { updateAf, getBacsPowerSummary } from '@/api'
import MobileField from './MobileField.vue'
import BacsPhotoButton from '@/components/BacsPhotoButton.vue'
import SitePartiesCard from '@/components/audit/SitePartiesCard.vue'
import EnergyHistoryCard from '@/components/audit/EnergyHistoryCard.vue'
import MobileYesNo from './MobileYesNo.vue'

const audit = useAuditStore()
const { document, site, powerSummary } = storeToRefs(audit)
const { error, success } = useNotification()

const isBacs = computed(() => (document.value?.kind || 'bacs_audit') === 'bacs_audit')

// Icones FA en kebab-case (passees a FontAwesomeIcon via :icon="['fas', ...]")
const APPLICABILITY_LABEL = {
  subject_immediate: { label: 'Soumis immédiatement',            icon: 'triangle-exclamation', cls: 'bg-red-50 text-red-800 border-red-200' },
  subject_2025:      { label: 'Soumis — échéance 1er janvier 2025', icon: 'triangle-exclamation', cls: 'bg-orange-50 text-orange-800 border-orange-200' },
  subject_2030:      { label: 'Soumis — échéance 1er janvier 2030', icon: 'triangle-exclamation', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
  not_subject:       { label: 'Non assujetti (puissance < 70 kW)',  icon: 'circle-check',         cls: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
}

let saveTimer = null
function saveDebounced(patch) {
  Object.assign(document.value, patch)
  clearTimeout(saveTimer)
  saveTimer = setTimeout(async () => {
    try {
      const { data } = await updateAf(document.value.id, patch)
      document.value = data
    } catch {
      error('Sauvegarde impossible')
    }
  }, 400)
}

async function saveSiteAddress(addr) {
  const next = (addr || '').trim() || null
  if (next === (site.value?.address || null)) return
  try {
    await audit.updateSiteFields({ address: next })
    success('Adresse du site mise à jour')
  } catch {
    error('Sauvegarde de l\'adresse impossible')
  }
}

const recomputing = ref(false)
async function recomputePower() {
  recomputing.value = true
  try {
    const { data } = await getBacsPowerSummary(document.value.id)
    saveDebounced({
      bacs_total_power_kw: data.heating_cooling_total_kw,
      bacs_total_power_source: 'auto',
    })
    success(`Puissance recalculée : ${data.heating_cooling_total_kw} kW`)
  } catch {
    error('Calcul impossible')
  } finally {
    recomputing.value = false
  }
}

const districtConnected = computed({
  get: () => document.value?.bacs_district_heating_substation_kw != null,
  set: (v) => saveDebounced({
    bacs_district_heating_substation_kw: v
      ? (document.value?.bacs_district_heating_substation_kw ?? 0)
      : null,
  }),
})

const generatorWorksDone = computed({
  get: () => document.value?.bacs_generator_works_date != null,
  set: (v) => saveDebounced({
    bacs_generator_works_date: v
      ? (document.value?.bacs_generator_works_date ?? new Date().toISOString().slice(0, 10))
      : null,
  }),
})
</script>

<template>
  <div class="p-3 space-y-3">
    <!-- Photos du site en TÊTE : reflexe terrain de l'auditeur, geste #1
         à l'arrivée sur site (façade, toiture, vue d'ensemble). -->
    <div v-if="document?.site_uuid"
         class="bg-white rounded-2xl border border-gray-200 px-4 py-4">
      <p class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Photos du site</p>
      <BacsPhotoButton
        :site-uuid="document.site_uuid"
        :attach-to="{}"
        :label="site?.name || document?.client_name || 'Site'"
        size="md"
      />
    </div>

    <!-- Hero : applicabilité R175-2 -->
    <div v-if="isBacs && document?.bacs_applicability_status"
         :class="['rounded-2xl border p-4 flex items-start gap-3', APPLICABILITY_LABEL[document.bacs_applicability_status]?.cls]">
      <FontAwesomeIcon
        :icon="['fas', APPLICABILITY_LABEL[document.bacs_applicability_status]?.icon || 'triangle-exclamation']"
        class="w-7 h-7 shrink-0 mt-0.5"
      />
      <div class="flex-1 min-w-0">
        <p class="text-[11px] uppercase tracking-wider opacity-75 font-medium">Applicabilité R175-2</p>
        <p class="text-base font-medium leading-tight mt-0.5">
          {{ APPLICABILITY_LABEL[document.bacs_applicability_status]?.label }}
        </p>
      </div>
    </div>

    <!-- Card : Audit -->
    <div class="bg-white rounded-2xl border border-gray-200 overflow-hidden">
      <div class="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
        <FontAwesomeIcon :icon="['fas', 'building']" class="w-5 h-5 text-indigo-600" />
        <h3 class="text-base font-medium text-gray-900">Audit</h3>
      </div>
      <div class="p-4 space-y-4">
        <MobileField label="Nom du projet">
          <input
            type="text"
            :value="document?.project_name || ''"
            @blur="e => e.target.value !== (document?.project_name || '') && saveDebounced({ project_name: e.target.value || (isBacs ? 'Audit BACS' : 'Audit GTB') })"
            placeholder="Titre de l'audit"
            class="w-full px-4 py-3.5 text-base border border-gray-200 rounded-xl bg-white"
          />
        </MobileField>
      </div>
    </div>

    <!-- Card : Site (source de vérité = table sites, propagée à FM via sync) -->
    <div class="bg-white rounded-2xl border border-gray-200 overflow-hidden">
      <div class="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
        <FontAwesomeIcon :icon="['fas', 'building']" class="w-5 h-5 text-indigo-600" />
        <h3 class="text-base font-medium text-gray-900">Site</h3>
      </div>
      <div class="p-4 space-y-4">
        <MobileField label="Nom du site">
          <div class="px-4 py-3.5 border border-gray-200 rounded-xl bg-gray-50 text-base text-gray-700">
            {{ site?.name || document?.client_name || '—' }}
          </div>
        </MobileField>

        <MobileField
          label="Adresse"
          hint="Modifiable ici ou dans Fleet Manager. Tous les audits du site partagent cette adresse."
        >
          <textarea
            :value="site?.address || ''"
            @blur="e => saveSiteAddress(e.target.value)"
            placeholder="ex : 12 rue de la Paix, 75002 Paris"
            rows="2"
            autocapitalize="sentences"
            class="w-full px-4 py-3.5 text-base border border-gray-200 rounded-xl bg-white leading-relaxed"
          ></textarea>
        </MobileField>

        <MobileField v-if="site?.customer_name" label="Client">
          <div class="px-4 py-3.5 border border-gray-200 rounded-xl bg-gray-50 text-base text-gray-700">
            {{ site.customer_name }}
          </div>
        </MobileField>
      </div>
    </div>

    <!-- Item 4 — Structure juridique & parties prenantes -->
    <SitePartiesCard v-if="isBacs && document?.site_uuid" />

    <!-- Item 13 — Base de consommations mensuelles de référence -->
    <EnergyHistoryCard v-if="isBacs && document?.site_uuid" />

    <!-- BACS only : puissance + dates -->
    <template v-if="isBacs">
      <div class="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div class="px-4 py-3 border-b border-gray-100">
          <h3 class="text-base font-medium text-gray-900">Puissance & dates</h3>
        </div>
        <div class="p-4 space-y-4">
          <MobileField
            label="Puissance chauffage + clim (kW)"
            hint="Cumul nominal utile cumulée (R175-2)"
          >
            <div class="flex gap-2">
              <input
                type="number"
                inputmode="decimal"
                pattern="[0-9.,]*"
                min="0"
                step="0.1"
                :value="document?.bacs_total_power_kw"
                @input="e => saveDebounced({ bacs_total_power_kw: e.target.value === '' ? null : parseFloat(e.target.value), bacs_total_power_source: 'manual_override' })"
                class="flex-1 px-4 py-3 border border-gray-200 rounded-xl bg-white text-right font-medium"
                placeholder="—"
              />
              <button
                @click="recomputePower"
                :disabled="recomputing"
                class="tap-target px-3 py-3 text-sm font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-xl disabled:opacity-50"
              >
                <FontAwesomeIcon :icon="['fas', 'arrows-rotate']" :class="['w-5 h-5', recomputing ? 'animate-spin' : '']" />
              </button>
            </div>
            <p v-if="document?.bacs_total_power_source === 'manual_override'" class="text-xs text-amber-700 mt-1">
              Override manuel
            </p>
          </MobileField>

          <MobileField
            label="Date du permis de construire"
            hint="Date délivrance PC. Si postérieur au 8 avril 2024, le bâtiment est soumis BACS dès la livraison sans seuil de puissance."
          >
            <input
              type="date"
              :value="document?.bacs_building_permit_date || ''"
              @input="e => saveDebounced({ bacs_building_permit_date: e.target.value || null })"
              class="w-full px-4 py-3.5 text-base border border-gray-200 rounded-xl bg-white"
            />
          </MobileField>
        </div>
      </div>

      <!-- Toggle : travaux générateur -->
      <div class="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <MobileYesNo
          label="Travaux générateur réalisés"
          description="Y a-t-il eu des travaux de remplacement / installation d'un générateur (chaudière, PAC…) après le 21/07/2021 ? Si oui, R175-6 (régulation thermique) s'applique en plus."
          :model-value="generatorWorksDone"
          @update:model-value="v => generatorWorksDone = v"
          class="border-0! rounded-none!" />
        <div v-if="document?.bacs_generator_works_date != null" class="px-4 pb-4 border-t border-gray-100 pt-3">
          <MobileField label="Date des derniers travaux">
            <input
              type="date"
              :value="document?.bacs_generator_works_date || ''"
              @input="e => saveDebounced({ bacs_generator_works_date: e.target.value || null })"
              class="w-full px-4 py-3.5 text-base border border-gray-200 rounded-xl bg-white"
            />
          </MobileField>
        </div>
      </div>

      <!-- Toggle : réseau urbain -->
      <div class="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <MobileYesNo
          label="Raccordé à un réseau urbain"
          description="Le bâtiment reçoit son chauffage ou sa climatisation via une sous-station connectée à un réseau de chaleur / froid de quartier. Dans ce cas, la puissance retenue pour R175-2 = puissance de la station, pas des équipements aval."
          :model-value="districtConnected"
          @update:model-value="v => districtConnected = v"
          class="border-0! rounded-none!" />
        <div v-if="document?.bacs_district_heating_substation_kw !== null && document?.bacs_district_heating_substation_kw !== undefined"
             class="px-4 pb-4 border-t border-gray-100 pt-3">
          <MobileField label="Puissance station d'échange (kW)">
            <input
              type="number"
              inputmode="decimal"
              pattern="[0-9.,]*"
              min="0"
              step="0.1"
              :value="document?.bacs_district_heating_substation_kw"
              @input="e => saveDebounced({ bacs_district_heating_substation_kw: e.target.value === '' ? 0 : parseFloat(e.target.value) })"
              placeholder="—"
              class="w-full px-4 py-3 border border-gray-200 rounded-xl bg-white text-right font-medium"
            />
          </MobileField>
        </div>
      </div>
    </template>
  </div>
</template>
