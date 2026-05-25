<script setup>
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import '@/lib/equipment-icons'
import { ref, computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useAuditStore } from '@/stores/audit'
import { useNotification } from '@/composables/useNotification'
import { updateBacsDevice, updateBacsMeter } from '@/api'
import MobileField from './MobileField.vue'
import MobileSelectSheet from './MobileSelectSheet.vue'
import MobileInspectionsSheet from './MobileInspectionsSheet.vue'

// Item 15 — options des champs « conservation & accès aux données » (R175-3).
const STORAGE_5Y_OPTIONS = [
  { value: 'yes', label: 'Oui — conforme' },
  { value: 'no', label: 'Non — non conforme' },
  { value: 'unknown', label: 'Inconnu / à vérifier' },
]
const STORAGE_LOCATION_OPTIONS = [
  { value: 'local', label: 'Serveur local' },
  { value: 'cloud_editeur', label: 'Cloud de l\'éditeur' },
  { value: 'cloud_proprietaire', label: 'Cloud du propriétaire' },
  { value: 'unknown', label: 'Inconnue' },
]
const ACCESS_OPTIONS = [
  { value: 'yes', label: 'Oui' },
  { value: 'partial', label: 'Partiel' },
  { value: 'no', label: 'Non' },
]
const EXPORT_OPTIONS = [
  { value: 'yes', label: 'Oui' },
  { value: 'no', label: 'Non' },
]
import SystemCategoryIcon from '@/components/SystemCategoryIcon.vue'
import MeterTypePill from '@/components/MeterTypePill.vue'
import MeterUsagePill from '@/components/MeterUsagePill.vue'
import BacsPhotoButton from '@/components/BacsPhotoButton.vue'
import VoiceNoteButton from '@/components/VoiceNoteButton.vue'
import MobileBmsTopicNoteButton from './MobileBmsTopicNoteButton.vue'
import MobileYesNo from './MobileYesNo.vue'
import SegmentedToggle from '@/components/SegmentedToggle.vue'

const audit = useAuditStore()
const { document, bms, devices, meters, systems, inspections, todayIso } = storeToRefs(audit)
const { error } = useNotification()

const isBacs = computed(() => (document.value?.kind || 'bacs_audit') === 'bacs_audit')

// Inspections R175-5-1 (sheet drill-down)
const showInspections = ref(false)
function openInspections() { showInspections.value = true }
const inspectionStatus = computed(() => {
  const list = inspections.value || []
  if (!list.length) return { label: 'Aucune inspection tracée', tone: 'warn' }
  const latest = list[0]
  const overdue = latest.next_inspection_due_date && latest.next_inspection_due_date < todayIso.value
  if (overdue) return { label: '⚠ Échéance dépassée', tone: 'warn' }
  return {
    label: latest.last_inspection_date
      ? `Dernière : ${latest.last_inspection_date}${latest.last_inspection_inspector ? ' · ' + latest.last_inspection_inspector : ''}`
      : `${list.length} inspection${list.length > 1 ? 's' : ''} tracée${list.length > 1 ? 's' : ''}`,
    tone: 'ok',
  }
})

const SYSTEM_LABEL = {
  heating: 'Chauffage',
  cooling: 'Refroidissement',
  ventilation: 'Ventilation',
  dhw: 'ECS',
  lighting_indoor: 'Éclairage intérieur',
  lighting_outdoor: 'Éclairage extérieur',
  electricity_production: 'Production photovoltaïque',
}

let saveTimer = null
function saveDebounced() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(async () => {
    try { await audit.saveBms() }
    catch { error('Sauvegarde GTB impossible') }
  }, 400)
}

// Présence de la GTB (Feature G) : 1 = présente, 0 = pas de GTB.
async function setGtbPresent(val) {
  bms.value.present = val
  try { await audit.saveBms() }
  catch { error('Sauvegarde GTB impossible') }
}

// Refresh plan d'action debouncé (sinon clic-clic-clic = N requêtes serielles).
let actionItemsRefreshTimer = null
function scheduleActionItemsRefresh() {
  clearTimeout(actionItemsRefreshTimer)
  actionItemsRefreshTimer = setTimeout(() => {
    audit.refreshActionItems().catch(() => {})
  }, 800)
}

async function patchDeviceBms(d, patch) {
  // Boolean strict (le serveur z.boolean() refuse 0/1 -> 400).
  const fullPatch = { ...patch }
  if ('managed_by_bms' in patch && patch.managed_by_bms === false) {
    fullPatch.bms_integration_out_of_service = false
  }
  Object.assign(d, fullPatch)
  // PATCH non bloquant — le toggle a déjà réagi via Object.assign.
  updateBacsDevice(d.id, fullPatch)
    .then(scheduleActionItemsRefresh)
    .catch(() => error('Sauvegarde équipement impossible'))
}

async function patchMeterBms(m, patch) {
  const fullPatch = { ...patch }
  if ('managed_by_bms' in patch && patch.managed_by_bms === false) {
    fullPatch.bms_integration_out_of_service = false
  }
  Object.assign(m, fullPatch)
  updateBacsMeter(m.id, fullPatch)
    .then(scheduleActionItemsRefresh)
    .catch(() => error('Sauvegarde compteur impossible'))
}

const devicesWithMeta = computed(() => {
  const sysById = new Map(systems.value.map(s => [s.id, s]))
  return devices.value.map(d => {
    const sys = sysById.get(d.system_id)
    return {
      ...d,
      system_category: sys?.system_category || '?',
      zone_name: sys?.zone_name || '?',
    }
  })
})

const metersPresent = computed(() => meters.value.filter(m => m.present_actual))

// Filtre par usages GTB (si l'auditeur a coché au moins un usage, on ne liste
// que les équipements/compteurs des catégories correspondantes — sinon on
// affiche tout pour ne pas masquer la liste avant qu'il commence à répondre).
const gtbManagesCategory = (cat) => {
  if (!bms.value) return true
  switch (cat) {
    case 'heating': return !!bms.value.manages_heating
    case 'cooling': return !!bms.value.manages_cooling
    case 'ventilation': return !!bms.value.manages_ventilation
    case 'dhw': return !!bms.value.manages_dhw
    case 'lighting_indoor':
    case 'lighting_outdoor': return !!bms.value.manages_lighting
    default: return true
  }
}
const gtbManagesMeterUsage = (usage) => {
  if (!bms.value) return true
  switch (usage) {
    case 'heating': return !!bms.value.manages_heating
    case 'cooling': return !!bms.value.manages_cooling
    case 'dhw': return !!bms.value.manages_dhw
    case 'lighting': return !!bms.value.manages_lighting
    default: return true
  }
}
const anyUsageManaged = computed(() => !!bms.value && (
  bms.value.manages_heating || bms.value.manages_cooling ||
  bms.value.manages_ventilation || bms.value.manages_dhw ||
  bms.value.manages_lighting
))
const filteredDevices = computed(() => {
  if (!anyUsageManaged.value) return devicesWithMeta.value
  return devicesWithMeta.value.filter(d => gtbManagesCategory(d.system_category))
})
const filteredMeters = computed(() => {
  if (!anyUsageManaged.value) return metersPresent.value
  return metersPresent.value.filter(m => gtbManagesMeterUsage(m.usage))
})

const USAGES = [
  { key: 'manages_heating', label: 'Chauffage', category: 'heating' },
  { key: 'manages_cooling', label: 'Refroidissement', category: 'cooling' },
  { key: 'manages_ventilation', label: 'Ventilation', category: 'ventilation' },
  { key: 'manages_dhw', label: 'ECS', category: 'dhw' },
  { key: 'manages_lighting', label: 'Éclairage', category: 'lighting_indoor' },
]
</script>

<template>
  <div class="p-3 space-y-3">
    <!-- Photos GTB en TÊTE : reflexe terrain, geste #1 sur l'écran. -->
    <div v-if="document?.site_uuid && bms.document_id"
         class="bg-white rounded-2xl border border-gray-200 p-4">
      <p class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Photos GTB</p>
      <BacsPhotoButton
        :site-uuid="document.site_uuid"
        :attach-to="{ bms_document_id: bms.document_id }"
        label="GTB"
        size="md"
      />
    </div>
    <div v-if="document?.site_uuid && bms.document_id"
         class="bg-white rounded-2xl border border-gray-200 p-4">
      <p class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Notes vocales GTB</p>
      <VoiceNoteButton
        :site-uuid="document.site_uuid"
        :attach-to="{ bms_document_id: bms.document_id }"
        label="GTB"
        size="md"
      />
    </div>

    <!-- Header card -->
    <div class="bg-white rounded-2xl border border-gray-200 p-4">
      <div class="flex items-center gap-3">
        <div class="w-12 h-12 rounded-xl bg-purple-50 text-purple-600 inline-flex items-center justify-center">
          <FontAwesomeIcon :icon="['fas', 'screwdriver-wrench']" class="w-6 h-6" />
        </div>
        <div class="flex-1 min-w-0">
          <p class="text-base font-medium text-gray-900 truncate">
            {{ bms?.existing_solution || 'GTB non renseignée' }}
          </p>
          <p v-if="bms?.existing_solution_brand" class="text-xs text-gray-500 truncate mt-0.5">
            {{ bms.existing_solution_brand }}
          </p>
        </div>
      </div>
    </div>

    <!-- Présence de la GTB : choix d'emblée (Feature G) -->
    <div class="bg-white rounded-2xl border border-gray-200 p-4">
      <p class="text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2">
        Une GTB est-elle présente sur le site ?
      </p>
      <div class="grid grid-cols-2 gap-2">
        <button type="button" @click="setGtbPresent(1)"
                :class="['min-h-11 py-3 text-base font-medium rounded-xl border-2 transition',
                         bms.present === 1 ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-gray-200 bg-white text-gray-600']">
          GTB présente
        </button>
        <button type="button" @click="setGtbPresent(0)"
                :class="['min-h-11 py-3 text-base font-medium rounded-xl border-2 transition',
                         bms.present === 0 ? 'border-gray-500 bg-gray-100 text-gray-700' : 'border-gray-200 bg-white text-gray-600']">
          Pas de GTB
        </button>
      </div>
      <p v-if="bms.present == null" class="text-xs text-amber-600 mt-2">
        Indiquez d'abord si une GTB est présente.
      </p>
      <p v-else-if="bms.present === 0" class="text-xs text-gray-500 mt-2">
        Aucune GTB — une action « Installer une GTB » est ajoutée au plan.
      </p>
    </div>

    <template v-if="bms.present === 1">
    <!-- Hors-service toggle -->
    <MobileYesNo
      label="La GTB est-elle hors service ?"
      description="Si la GTB est complètement HS, débranchée ou inutilisable, le plan d'action ignore toutes les exigences GTB du décret."
      :model-value="bms.out_of_service"
      @update:model-value="v => { bms.out_of_service = v ? 1 : 0; saveDebounced() }"
    />

    <!-- Mig 109 : on n'efface plus les sous-blocs quand la GTB est HS,
         on les garde affichés (legerement opaques) pour que l'auditeur
         puisse tout renseigner et ajouter des notes pour la traçabilité.
         Pas de <template> wrapper sans directive : Vue 3 ne rend rien. -->
      <!-- Identification GTB -->
      <div :class="['bg-white rounded-2xl border border-gray-200 overflow-hidden', bms.out_of_service ? 'opacity-70' : '']">
        <div class="px-4 py-3 border-b border-gray-100">
          <h3 class="text-base font-medium text-gray-900">Solution en place</h3>
        </div>
        <div class="p-4 space-y-4">
          <MobileField label="Solution">
            <input
              v-model="bms.existing_solution"
              type="text"
              placeholder="ex : Schneider EcoStruxure, Niagara, Buildy"
              autocapitalize="words"
              @input="saveDebounced"
              class="w-full px-4 py-3.5 text-base border border-gray-200 rounded-xl bg-white"
            />
          </MobileField>
          <MobileField label="Marque / éditeur">
            <input
              v-model="bms.existing_solution_brand"
              type="text"
              placeholder="—"
              autocapitalize="words"
              @input="saveDebounced"
              class="w-full px-4 py-3.5 text-base border border-gray-200 rounded-xl bg-white"
            />
          </MobileField>
          <MobileField label="Référence modèle">
            <input
              v-model="bms.model_reference"
              type="text"
              placeholder="ex : JACE 8000"
              @input="saveDebounced"
              class="w-full px-4 py-3.5 text-base border border-gray-200 rounded-xl bg-white"
            />
          </MobileField>
          <MobileField label="Localisation">
            <input
              v-model="bms.location"
              type="text"
              placeholder="ex : Local technique sous-sol"
              autocapitalize="sentences"
              @input="saveDebounced"
              class="w-full px-4 py-3.5 text-base border border-gray-200 rounded-xl bg-white"
            />
          </MobileField>
        </div>
      </div>

      <!-- Usages traités -->
      <div :class="['bg-white rounded-2xl border border-gray-200 overflow-hidden', bms.out_of_service ? 'opacity-70' : '']">
        <div class="px-4 py-3 border-b border-gray-100">
          <div class="flex items-start justify-between gap-2">
            <h3 class="text-base font-medium text-gray-900">Usages traités par la GTB</h3>
            <MobileBmsTopicNoteButton topic-key="usages" topic-label="Usages traités par la GTB" />
          </div>
          <p class="text-xs text-gray-500 mt-1 leading-relaxed">
            Coche chaque usage que la GTB pilote ou supervise réellement, même partiellement.
            Les usages absents du bâtiment ne sont pas concernés.
          </p>
        </div>
        <div class="p-2 space-y-1">
          <button
            v-for="u in USAGES"
            :key="u.key" type="button"
            @click="bms[u.key] = bms[u.key] ? 0 : 1; saveDebounced()"
            :class="['w-full flex items-center justify-between gap-3 px-3 py-4 rounded-xl border-2 transition active:scale-[0.99]',
                     bms[u.key]
                       ? 'border-[#00cd92] bg-emerald-50/60'
                       : 'border-gray-200 bg-white']"
          >
            <div class="flex items-center gap-3 min-w-0">
              <SystemCategoryIcon :category="u.category" size="md" />
              <span :class="['text-base font-medium', bms[u.key] ? 'text-gray-800' : 'text-gray-400']">{{ u.label }}</span>
            </div>
            <span v-if="bms[u.key]" class="text-[#00cd92] text-xl font-bold">✓</span>
            <span v-else class="text-gray-300 text-xl font-bold">✗</span>
          </button>
        </div>
      </div>

      <!-- R175-3 Capacités (BACS uniquement) -->
      <template v-if="isBacs">
        <div :class="['bg-white rounded-2xl border border-gray-200 overflow-hidden', bms.out_of_service ? 'opacity-70' : '']">
          <div class="px-4 py-3 border-b border-gray-100 flex items-start justify-between gap-2">
            <h3 class="text-base font-medium text-gray-900">Capacités R175-3</h3>
            <MobileBmsTopicNoteButton topic-key="r175_3_capacites"
                                      topic-label="R175-3 — Capacités de la solution de supervision" />
          </div>
          <div class="p-4 space-y-4">
            <MobileYesNo
              label="P1. La GTB enregistre-t-elle la consommation en continu par zone et conserve-t-elle ces données pendant 5 ans ?"
              description="Enregistrement au pas horaire ou plus fin, conservation 5 ans minimum."
              :model-value="bms.meets_r175_3_p1"
              @update:model-value="v => { bms.meets_r175_3_p1 = v ? 1 : 0; saveDebounced() }"
            />
            <div v-if="bms.meets_r175_3_p1" class="ml-2 pl-3 border-l-2 border-gray-100 space-y-2">
              <input
                v-model="bms.r175_3_p1_archival_format"
                type="text"
                placeholder="Format d'archivage : CSV, SQL, API…"
                @input="saveDebounced"
                class="touch-control w-full"
              />
              <MobileYesNo
                label="La conservation des données sur 5 ans a-t-elle été vérifiée sur place ?"
                :model-value="bms.r175_3_p1_retention_verified"
                @update:model-value="v => { bms.r175_3_p1_retention_verified = v ? 1 : 0; saveDebounced() }"
              />
            </div>

            <div class="border-t border-gray-100 pt-3"></div>

            <MobileYesNo
              label="P2. La GTB détecte-t-elle les pertes d'efficacité énergétique ?"
              description="La GTB déclenche des alertes en cas de surconsommation, de panne d'équipement ou de dérive de performance (ex : COP qui chute)."
              :model-value="bms.meets_r175_3_p2"
              @update:model-value="v => { bms.meets_r175_3_p2 = v ? 1 : 0; saveDebounced() }"
            />
            <div v-if="bms.meets_r175_3_p2" class="ml-2 pl-3 border-l-2 border-gray-100">
              <textarea
                v-model="bms.r175_3_p2_anomaly_rules_html"
                @input="saveDebounced"
                rows="2"
                placeholder="Règles / seuils / alertes actives…"
                class="touch-control w-full"
              ></textarea>
            </div>
          </div>
        </div>

        <!-- R175-3 Mise à dispo des données -->
        <div :class="['bg-white rounded-2xl border border-gray-200 overflow-hidden', bms.out_of_service ? 'opacity-70' : '']">
          <div class="px-4 py-3 border-b border-gray-100">
            <div class="flex items-start justify-between gap-2">
              <h3 class="text-base font-medium text-gray-900">Mise à disposition des données</h3>
              <MobileBmsTopicNoteButton topic-key="r175_3_mise_dispo"
                                        topic-label="R175-3 — Mise à disposition des données" />
            </div>
          </div>
          <div class="p-4 space-y-4">
            <p class="text-xs text-gray-500 leading-relaxed">
              Le décret R175-3 oblige la GTB à transmettre régulièrement les données
              de consommation au gestionnaire et aux exploitants. Coche ci-dessous
              ce qui est documenté sur place (procédure écrite ou démontrée).
            </p>
            <MobileYesNo
              label="La procédure de mise à disposition des données au gestionnaire du bâtiment est-elle documentée ?"
              description="Gestionnaire = propriétaire / syndic / exploitant principal du bâtiment."
              :model-value="bms.data_provision_to_manager"
              @update:model-value="v => { bms.data_provision_to_manager = v ? 1 : 0; saveDebounced() }"
            />
            <MobileYesNo
              label="La procédure de transmission des données aux exploitants des systèmes techniques est-elle documentée ?"
              description="Exploitants = mainteneur GTB, mainteneur CVC, intégrateur supervision."
              :model-value="bms.data_provision_to_operators"
              @update:model-value="v => { bms.data_provision_to_operators = v ? 1 : 0; saveDebounced() }"
            />
            <template v-if="bms.data_provision_to_manager || bms.data_provision_to_operators">
              <input
                v-model="bms.data_provision_frequency"
                type="text"
                placeholder="Fréquence : temps réel, quotidien…"
                @input="saveDebounced"
                class="touch-control w-full"
              />
              <input
                v-model="bms.data_provision_format"
                type="text"
                placeholder="Format : CSV, dashboard, API…"
                @input="saveDebounced"
                class="touch-control w-full"
              />
            </template>
          </div>
        </div>

        <!-- Item 15 — R175-3 : conservation 5 ans + accès aux données -->
        <div :class="['bg-white rounded-2xl border border-gray-200 overflow-hidden', bms.out_of_service ? 'opacity-70' : '']">
          <div class="px-4 py-3 border-b border-gray-100">
            <h3 class="text-base font-medium text-gray-900">Conservation et accès aux données</h3>
            <p class="text-xs text-gray-500 mt-0.5">R175-3 — archivage 5 ans</p>
          </div>
          <div class="p-4 space-y-4">
            <MobileField label="Données conservées 5 ans (échelle mensuelle) ?">
              <MobileSelectSheet
                :model-value="bms.data_storage_5y_compliant"
                :options="STORAGE_5Y_OPTIONS"
                title="Conservation 5 ans"
                placeholder="— Non renseigné —"
                @update:model-value="v => { bms.data_storage_5y_compliant = v; saveDebounced() }"
              />
            </MobileField>
            <MobileField label="Localisation du stockage">
              <MobileSelectSheet
                :model-value="bms.data_storage_location"
                :options="STORAGE_LOCATION_OPTIONS"
                title="Localisation du stockage"
                placeholder="— Non renseigné —"
                @update:model-value="v => { bms.data_storage_location = v; saveDebounced() }"
              />
            </MobileField>
            <MobileField label="Accès direct du propriétaire à ses données">
              <MobileSelectSheet
                :model-value="bms.data_owner_access"
                :options="ACCESS_OPTIONS"
                title="Accès du propriétaire"
                placeholder="— Non renseigné —"
                @update:model-value="v => { bms.data_owner_access = v; saveDebounced() }"
              />
            </MobileField>
            <MobileField label="Accès du gestionnaire et des exploitants">
              <MobileSelectSheet
                :model-value="bms.gestionnaire_exploitant_access"
                :options="ACCESS_OPTIONS"
                title="Accès gestionnaire / exploitants"
                placeholder="— Non renseigné —"
                @update:model-value="v => { bms.gestionnaire_exploitant_access = v; saveDebounced() }"
              />
            </MobileField>
            <MobileField label="Export possible (CSV / Excel)">
              <MobileSelectSheet
                :model-value="bms.export_capability"
                :options="EXPORT_OPTIONS"
                title="Export des données"
                placeholder="— Non renseigné —"
                @update:model-value="v => { bms.export_capability = v; saveDebounced() }"
              />
            </MobileField>
            <textarea
              v-model="bms.data_access_notes"
              @input="saveDebounced"
              placeholder="Observations sur l'accès aux données…"
              rows="2"
              class="touch-control w-full"
            ></textarea>
          </div>
        </div>

        <!-- R175-4 Maintenance -->
        <div :class="['bg-white rounded-2xl border border-gray-200 overflow-hidden', bms.out_of_service ? 'opacity-70' : '']">
          <div class="px-4 py-3 border-b border-gray-100">
            <div class="flex items-start justify-between gap-2">
              <h3 class="text-base font-medium text-gray-900">R175-4 — Maintenance</h3>
              <MobileBmsTopicNoteButton topic-key="r175_4" topic-label="R175-4 — Vérifications périodiques" />
            </div>
          </div>
          <div class="p-4 space-y-4">
            <MobileYesNo
              label="Les maintenances passées ont-elles fait l'objet de consignes écrites ?"
              description="Document écrit indiquant qui fait quoi sur la GTB et à quelle fréquence (carnet d'entretien, contrat de maintenance, plan de prévention…)."
              :model-value="bms.has_maintenance_procedures"
              @update:model-value="v => { bms.has_maintenance_procedures = v ? 1 : 0; saveDebounced() }"
            />
            <template v-if="bms.has_maintenance_procedures">
              <input
                v-model="bms.maintenance_periodicity"
                type="text"
                placeholder="Périodicité : trimestrielle, annuelle…"
                @input="saveDebounced"
                class="touch-control w-full"
              />
              <input
                v-model="bms.maintenance_responsible"
                type="text"
                placeholder="Responsable : prestataire, équipe interne…"
                @input="saveDebounced"
                class="touch-control w-full"
              />
            </template>
          </div>
        </div>

        <!-- R175-5 Formation -->
        <div :class="['bg-white rounded-2xl border border-gray-200 overflow-hidden', bms.out_of_service ? 'opacity-70' : '']">
          <div class="px-4 py-3 border-b border-gray-100">
            <div class="flex items-start justify-between gap-2">
              <h3 class="text-base font-medium text-gray-900">R175-5 — Formation exploitant</h3>
              <MobileBmsTopicNoteButton topic-key="r175_5" topic-label="R175-5 — Formation exploitant" />
            </div>
          </div>
          <div class="p-4 space-y-4">
            <MobileYesNo
              label="L'exploitant a-t-il été formé à l'utilisation de la supervision ?"
              description="La personne en charge de la GTB a suivi une formation (intégrateur, éditeur, interne) lui permettant de consulter les données et corriger les dérives."
              :model-value="bms.operator_trained"
              @update:model-value="v => { bms.operator_trained = v ? 1 : 0; saveDebounced() }"
            />
            <template v-if="bms.operator_trained">
              <MobileField label="Date de formation">
                <input
                  v-model="bms.operator_training_date"
                  type="date"
                  @input="saveDebounced"
                  class="w-full px-4 py-3.5 text-base border border-gray-200 rounded-xl bg-white"
                />
              </MobileField>
              <MobileField label="Organisme / formateur">
                <input
                  v-model="bms.operator_training_provider"
                  type="text"
                  placeholder="ex : intégrateur GTB"
                  @input="saveDebounced"
                  class="w-full px-4 py-3.5 text-base border border-gray-200 rounded-xl bg-white"
                />
              </MobileField>
            </template>
          </div>
        </div>
      </template>

      <!-- Équipements intégrés -->
      <div :class="['bg-white rounded-2xl border border-gray-200 overflow-hidden', bms.out_of_service ? 'opacity-70' : '']">
        <div class="px-4 py-3 border-b border-gray-100">
          <div class="flex items-start justify-between gap-2">
            <h3 class="text-base font-medium text-gray-900">Équipements intégrés à la GTB</h3>
            <MobileBmsTopicNoteButton topic-key="equipements" topic-label="Équipements intégrés à la GTB" />
          </div>
          <p v-if="filteredDevices.length" class="text-xs text-gray-500 mt-1 leading-relaxed">
            <strong>Intégré</strong> = l'équipement est connu de la GTB.
            <strong>Opérationnel</strong> = tu as vérifié sur place que la GTB voit
            réellement les valeurs et peut le piloter.
          </p>
          <p v-else class="text-xs text-gray-500 mt-1 italic">Aucun équipement saisi.</p>
        </div>
        <div v-if="filteredDevices.length" class="divide-y divide-gray-100">
          <div
            v-for="d in filteredDevices"
            :key="d.id"
            :class="['px-4 py-4', d.out_of_service ? 'opacity-50' : '', d.bms_integration_out_of_service ? 'bg-red-50/40' : '']"
          >
            <div class="flex items-center gap-3 mb-2">
              <SystemCategoryIcon :category="d.system_category" size="md" />
              <p class="flex-1 min-w-0 text-base font-medium text-gray-900 truncate">
                {{ d.name || d.brand || d.model_reference || 'Sans nom' }}
              </p>
            </div>
            <p class="text-sm text-gray-500 mb-3">{{ SYSTEM_LABEL[d.system_category] || d.system_category }} · {{ d.zone_name }}</p>
            <div class="grid grid-cols-2 gap-2">
              <div class="flex items-center justify-between gap-2 px-3 py-3 rounded-xl border border-gray-200 bg-white">
                <span class="text-sm font-medium text-gray-800">Intégré ?</span>
                <SegmentedToggle :model-value="!!d.managed_by_bms"
                                 :disabled="!!d.out_of_service"
                                 @update:model-value="v => patchDeviceBms(d, { managed_by_bms: v })" />
              </div>
              <div class="flex items-center justify-between gap-2 px-3 py-3 rounded-xl border border-gray-200 bg-white">
                <span class="text-sm font-medium text-gray-800">Opérationnel ?</span>
                <SegmentedToggle :model-value="(!d.managed_by_bms || !d.wired) ? null : !d.bms_integration_out_of_service"
                                 :disabled="!d.managed_by_bms || !d.wired"
                                 @update:model-value="v => patchDeviceBms(d, { bms_integration_out_of_service: !v })" />
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Compteurs intégrés -->
      <div :class="['bg-white rounded-2xl border border-gray-200 overflow-hidden', bms.out_of_service ? 'opacity-70' : '']">
        <div class="px-4 py-3 border-b border-gray-100">
          <div class="flex items-start justify-between gap-2">
            <h3 class="text-base font-medium text-gray-900">Compteurs intégrés à la GTB</h3>
            <MobileBmsTopicNoteButton topic-key="compteurs" topic-label="Compteurs intégrés à la GTB" />
          </div>
          <p v-if="filteredMeters.length" class="text-xs text-gray-500 mt-1 leading-relaxed">
            Seuls les compteurs marqués « présents » dans l'onglet Compteurs apparaissent ici.
            <strong>Intégré</strong> = la GTB connaît le compteur.
            <strong>Opérationnel</strong> = les index remontent vraiment.
          </p>
          <p v-else class="text-xs text-gray-500 mt-1 italic">Aucun compteur présent à raccorder.</p>
        </div>
        <div v-if="filteredMeters.length" class="divide-y divide-gray-100">
          <div
            v-for="m in filteredMeters"
            :key="m.id"
            :class="['px-4 py-4', m.out_of_service ? 'opacity-50' : '', m.bms_integration_out_of_service ? 'bg-red-50/40' : '']"
          >
            <div class="flex items-center gap-2 mb-3 flex-wrap">
              <MeterTypePill :type="m.meter_type" />
              <MeterUsagePill :usage="m.usage" />
              <span class="text-sm text-gray-500">{{ m.zone_name || 'général' }}</span>
            </div>
            <div class="grid grid-cols-2 gap-2">
              <div class="flex items-center justify-between gap-2 px-3 py-3 rounded-xl border border-gray-200 bg-white">
                <span class="text-sm font-medium text-gray-800">Intégré ?</span>
                <SegmentedToggle :model-value="(m.out_of_service || !m.communicating) ? null : !!m.managed_by_bms"
                                 :disabled="!!m.out_of_service || !m.communicating"
                                 @update:model-value="v => patchMeterBms(m, { managed_by_bms: v })" />
              </div>
              <div class="flex items-center justify-between gap-2 px-3 py-3 rounded-xl border border-gray-200 bg-white">
                <span class="text-sm font-medium text-gray-800">Opérationnel ?</span>
                <SegmentedToggle :model-value="(!m.managed_by_bms || !m.wired) ? null : !m.bms_integration_out_of_service"
                                 :disabled="!m.managed_by_bms || !m.wired"
                                 @update:model-value="v => patchMeterBms(m, { bms_integration_out_of_service: !v })" />
              </div>
            </div>
          </div>
        </div>
      </div>

    <!-- Inspections périodiques R175-5-1 — déclencheur + sheet (BACS uniquement) -->
    <button
      v-if="isBacs"
      type="button"
      @click="openInspections"
      class="mt-3 w-full tap-target flex items-center gap-3 px-4 py-3 bg-amber-50/60 border border-amber-200 rounded-xl active:bg-amber-100 text-left"
    >
      <span class="w-9 h-9 rounded-lg bg-amber-100 text-amber-700 inline-flex items-center justify-center shrink-0">
        <FontAwesomeIcon :icon="['fas', 'clock']" class="w-5 h-5" />
      </span>
      <div class="flex-1 min-w-0">
        <p class="text-sm font-semibold text-amber-900 truncate">
          Inspections périodiques <span class="font-normal opacity-70">— R175-5-1</span>
        </p>
        <p :class="['text-xs mt-0.5 truncate',
                    inspectionStatus.tone === 'warn' ? 'text-red-600 font-medium' : 'text-emerald-700']">
          {{ inspectionStatus.label }}
        </p>
      </div>
      <FontAwesomeIcon :icon="['fas', 'chevron-right']" class="w-5 h-5 text-amber-400 shrink-0" />
    </button>

    <MobileInspectionsSheet
      :open="showInspections"
      @close="showInspections = false"
    />
    </template>
  </div>
</template>
