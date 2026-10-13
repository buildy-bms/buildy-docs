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
import HelpTip from '@/components/HelpTip.vue'
import Tooltip from '@/components/Tooltip.vue'
import {
  applicabilityTip, fmtKw, POWER_LABEL_HELP, POWER_AUTO_TIP, PERMIT_DATE_TIP, SUBSTATION_TIP,
} from '@/lib/audit-tips-site'
import { POWER_MANUAL_MOBILE_TIP } from '@/lib/audit-tips-mobile'

const audit = useAuditStore()
const { document, site, powerSummary } = storeToRefs(audit)
const { error, success } = useNotification()

const isBacs = computed(() => (document.value?.kind || 'bacs_audit') === 'bacs_audit')

// Icones FA en kebab-case (passees a FontAwesomeIcon via :icon="['fas', ...]")
// Libellés identiques au bureau (verdict « Le bâtiment est-il concerné ? »).
const APPLICABILITY_LABEL = {
  subject_immediate: { label: 'Concerné dès la construction',         icon: 'triangle-exclamation', cls: 'bg-red-50 text-red-800 border-red-200' },
  subject_2025:      { label: 'Concerné depuis le 1er janvier 2025',  icon: 'triangle-exclamation', cls: 'bg-orange-50 text-orange-800 border-orange-200' },
  subject_2030:      { label: 'Concerné d’ici le 1er janvier 2030',   icon: 'triangle-exclamation', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
  not_subject:       { label: 'Non concerné (70 kW ou moins)',        icon: 'circle-check',         cls: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
}

// Carte du verdict (présumé concerné quand des puissances d'équipements manquent,
// cf. bacs-audit-power.js) : même source que le bureau (lib/audit-tips-site.js).
const verdictTip = computed(() => applicabilityTip(document.value?.bacs_applicability_status, {
  presumed: !!powerSummary.value?.power_summary?.presumedSubjectDueToMissingData,
}))

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
    // Même calcul que le bureau (BacsAuditDetailView recomputePowerFromEquipments) : la
    // PUISSANCE RETENUE (la plus forte entre chauffage et climatisation, émetteurs exclus),
    // pas la somme brute chaud + froid qui gonflait la puissance et faussait le verdict.
    const retained = data.power_summary?.autoKw || data.power_summary?.retainedKw || data.heating_cooling_total_kw || 0
    saveDebounced({
      bacs_total_power_kw: retained,
      bacs_total_power_source: 'auto',
    })
    success(`Puissance retenue recalculée : ${fmtKw(retained)} (la plus forte entre chauffage et climatisation)`)
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

    <!-- Hero : le bâtiment est-il concerné par le décret ? (R175-2). ⓘ = carte
         du verdict, ouverte aussi au doigt. -->
    <div v-if="isBacs && document?.bacs_applicability_status"
         :class="['rounded-2xl border p-4 flex items-start gap-3', APPLICABILITY_LABEL[document.bacs_applicability_status]?.cls]">
      <FontAwesomeIcon
        :icon="['fas', APPLICABILITY_LABEL[document.bacs_applicability_status]?.icon || 'triangle-exclamation']"
        class="w-7 h-7 shrink-0 mt-0.5"
      />
      <div class="flex-1 min-w-0">
        <p class="text-xs uppercase tracking-wider opacity-75 font-medium">Le bâtiment est-il concerné ?</p>
        <p class="text-base font-medium leading-tight mt-0.5">
          {{ APPLICABILITY_LABEL[document.bacs_applicability_status]?.label }}<HelpTip v-if="verdictTip" :tip="verdictTip" class="ml-1.5 p-1 -my-1" />
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
            class="pwa-input"
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
          <div class="pwa-input bg-gray-50 text-gray-700 flex items-center">
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
            class="pwa-input leading-relaxed resize-y"
          ></textarea>
        </MobileField>

        <MobileField v-if="site?.customer_name" label="Client">
          <div class="pwa-input bg-gray-50 text-gray-700 flex items-center">
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
          <h3 class="text-base font-medium text-gray-900">Puissance et date du permis</h3>
        </div>
        <div class="p-4 space-y-4">
          <MobileField
            label="Puissance de chauffage et de climatisation (kW)"
            hint="La plus forte des deux puissances, chauffage ou climatisation. Au-delà de 70 kW, un bâtiment tertiaire est concerné par le décret."
            :tip="POWER_LABEL_HELP"
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
                class="pwa-input pwa-input--num flex-1"
                placeholder="—"
              />
              <Tooltip :text="POWER_AUTO_TIP">
              <button
                @click="recomputePower"
                :disabled="recomputing"
                aria-label="Calculer la puissance depuis les équipements"
                class="tap-target px-3 py-3 text-sm font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-xl disabled:opacity-50"
              >
                <FontAwesomeIcon :icon="['fas', 'arrows-rotate']" :class="['w-5 h-5', recomputing ? 'animate-spin' : '']" />
              </button>
              </Tooltip>
            </div>
            <p v-if="document?.bacs_total_power_source === 'manual_override'" class="text-xs text-amber-700 mt-1"
               v-tooltip="POWER_MANUAL_MOBILE_TIP">
              Valeur saisie à la main : elle ne suit plus les équipements.
            </p>
          </MobileField>

          <MobileField
            label="Date du permis de construire"
            hint="Date de dépôt du permis. Avec la puissance, elle fixe la date à laquelle la GTB est exigée."
            :tip="PERMIT_DATE_TIP"
          >
            <input
              type="date"
              :value="document?.bacs_building_permit_date || ''"
              @input="e => saveDebounced({ bacs_building_permit_date: e.target.value || null })"
              class="pwa-input"
            />
          </MobileField>
        </div>
      </div>

      <!-- Toggle : travaux générateur -->
      <div class="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <MobileYesNo
          label="Des travaux d’installation ou de remplacement d’un générateur de chaleur ont-ils été réalisés ?"
          description="Chaudière, pompe à chaleur… Après le 21 juillet 2021, ces travaux rendent obligatoire la régulation automatique de la température pièce par pièce."
          :model-value="generatorWorksDone"
          @update:model-value="v => generatorWorksDone = v"
          class="border-0! rounded-none!" />
        <div v-if="document?.bacs_generator_works_date != null" class="px-4 pb-4 border-t border-gray-100 pt-3">
          <MobileField label="Date des derniers travaux sur le générateur">
            <input
              type="date"
              :value="document?.bacs_generator_works_date || ''"
              @input="e => saveDebounced({ bacs_generator_works_date: e.target.value || null })"
              class="pwa-input"
            />
          </MobileField>
        </div>
      </div>

      <!-- Toggle : réseau urbain -->
      <div class="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <MobileYesNo
          label="Le bâtiment est-il raccordé à un réseau urbain de chaleur ou de froid ?"
          description="Par une sous-station reliée au réseau du quartier. Si oui, la puissance retenue est celle de la station d’échange, pas la somme des équipements qu’elle alimente."
          :model-value="districtConnected"
          @update:model-value="v => districtConnected = v"
          class="border-0! rounded-none!" />
        <div v-if="document?.bacs_district_heating_substation_kw !== null && document?.bacs_district_heating_substation_kw !== undefined"
             class="px-4 pb-4 border-t border-gray-100 pt-3">
          <MobileField label="Puissance de la station d’échange (kW)" :tip="SUBSTATION_TIP">
            <input
              type="number"
              inputmode="decimal"
              pattern="[0-9.,]*"
              min="0"
              step="0.1"
              :value="document?.bacs_district_heating_substation_kw"
              @input="e => saveDebounced({ bacs_district_heating_substation_kw: e.target.value === '' ? 0 : parseFloat(e.target.value) })"
              placeholder="—"
              class="pwa-input pwa-input--num"
            />
          </MobileField>
        </div>
      </div>
    </template>
  </div>
</template>
