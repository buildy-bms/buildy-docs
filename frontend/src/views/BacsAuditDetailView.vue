<script setup>
import { ref, computed, onMounted, watch, provide } from 'vue'
import { storeToRefs } from 'pinia'
import { useRouter, useRoute } from 'vue-router'
import {
  ArrowLeftIcon, BuildingOffice2Icon, MapPinIcon, ExclamationTriangleIcon,
  CheckCircleIcon, ArrowPathIcon, DocumentArrowDownIcon, ClipboardDocumentListIcon, PhotoIcon, PlusIcon, TrashIcon,
  WrenchScrewdriverIcon, BoltIcon, FireIcon, PencilSquareIcon,
  DocumentDuplicateIcon,
  ChevronDoubleUpIcon, ChevronDoubleDownIcon, ChevronUpIcon, ChevronDownIcon,
  ClockIcon,
} from '@heroicons/vue/24/outline'
import {
  getAf, updateAf, getSite,
  getBacsAuditRefs,
  getBacsSystems, updateBacsSystem,
  getBacsMeters, createBacsMeter, updateBacsMeter, deleteBacsMeter,
  getBacsBms, updateBacsBms,
  getBacsThermal, updateBacsThermal,
  getBacsActionItems, regenerateBacsActionItems, updateBacsActionItem,
  getBacsActionItemsCsvUrl, exportBacsPdf, exportBacsChecklistPdf, deliverBacsAudit,
  getBacsPowerCumul, resyncBacsAudit,
  listZones, createZone, updateZone, deleteZone,
  getBacsDevices, getBacsPowerSummary, updateBacsDevice, createBacsDevice,
  validateBacsAuditStep, listSiteDocuments, listSiteCredentials,
  updateBacsAuditSynthesis, generateBacsAuditSynthesis,
  duplicateZone, duplicateBacsMeter,
  generateActionAlternatives,
} from '@/api'
import SystemDevicesTable from '@/components/SystemDevicesTable.vue'
import SiteDocumentsManager from '@/components/SiteDocumentsManager.vue'
import SiteCredentialsManager from '@/components/SiteCredentialsManager.vue'
import R175Tooltip from '@/components/R175Tooltip.vue'
import NotesEditorModal from '@/components/NotesEditorModal.vue'
import BacsPhotoButton from '@/components/BacsPhotoButton.vue'
import BacsAuditStepper from '@/components/BacsAuditStepper.vue'
import StepValidateBadge from '@/components/StepValidateBadge.vue'
import RichTextEditor from '@/components/RichTextEditor.vue'
import CollapsibleSection from '@/components/CollapsibleSection.vue'
import SystemCategoryIcon from '@/components/SystemCategoryIcon.vue'
import MeterTypePill from '@/components/MeterTypePill.vue'
import MeterUsagePill from '@/components/MeterUsagePill.vue'
import AddZoneModal from '@/components/AddZoneModal.vue'
import AddMeterModal from '@/components/AddMeterModal.vue'
import BulkPhotoUploadModal from '@/components/BulkPhotoUploadModal.vue'
import TranscriptAssistantModal from '@/components/TranscriptAssistantModal.vue'
import SafeHtml from '@/components/SafeHtml.vue'
import InspectionsSection from '@/components/audit/InspectionsSection.vue'
import CompliancePlanSection from '@/components/audit/CompliancePlanSection.vue'
import SynthesisSection from '@/components/audit/SynthesisSection.vue'
import BmsSection from '@/components/audit/BmsSection.vue'
import ThermalSection from '@/components/audit/ThermalSection.vue'
import MetersSection from '@/components/audit/MetersSection.vue'
import SystemsSection from '@/components/audit/SystemsSection.vue'
import DocumentsSection from '@/components/audit/DocumentsSection.vue'
import CredentialsSection from '@/components/audit/CredentialsSection.vue'
import { useAuditStore } from '@/stores/audit'

const auditStore = useAuditStore()
import AddDeviceModal from '@/components/AddDeviceModal.vue'
import ProtocolMultiPicker from '@/components/ProtocolMultiPicker.vue'
import Tooltip from '@/components/Tooltip.vue'
import VerticalStepper from '@/components/VerticalStepper.vue'
import ActivityPanel from '@/components/ActivityPanel.vue'
import BmsComponentsTable from '@/components/BmsComponentsTable.vue'
import PhotoDropzone from '@/components/PhotoDropzone.vue'
import PhotoDropTr from '@/components/PhotoDropTr.vue'
import { SparklesIcon } from '@heroicons/vue/24/outline'
import { useConfirm } from '@/composables/useConfirm'
import { useNotification } from '@/composables/useNotification'
import { useClaudeUsage, formatUsageTooltip } from '@/composables/useClaudeUsage'

const router = useRouter()
const route = useRoute()
const { success, error } = useNotification()
const { confirm } = useConfirm()
const { usage: claudeUsage, refresh: refreshClaudeUsage } = useClaudeUsage()

const docId = parseInt(route.params.id, 10)

// Tout l'etat de l'audit vient du store Pinia. storeToRefs() expose des
// refs reactifs (utilisables en v-model) sans perdre la connexion au
// store. Plus de duplication / mirror : la vue ECRIT directement dans le
// store via les refs, les sous-composants LISENT depuis le store.
const {
  document, systems, meters, bms, thermal, actionItems,
  zones, devices, inspections, powerSummary, auditRefs,
  loading,
} = storeToRefs(auditStore)
// site garde sa nature locale (pas charge par le store, valeur calculee
// depuis le document.site_id si besoin).
const site = ref(null)
function refOf(kind, id) { return auditRefs.value?.[kind]?.[id] || '' }
provide('auditRefs', auditRefs)
provide('refOf', refOf)

// Toggle pour afficher les usages marques 'non concerne' dans la card
// systemes. Persistance localStorage. Par defaut tout est visible (les
// non concernes sont masques uniquement si le flag est explicitement
// pose par l'auditeur).
const showAddZoneModal = ref(false)
const showAddMeterModal = ref(false)
const addDeviceModalSystem = ref(null) // { id, system_category, zone_name }

// Options pour AddDeviceModal (memes que SystemDevicesTable.vue)
const ENERGY_OPTIONS = [
  { value: null, label: 'Énergie' },
  { value: 'gas', label: 'Gaz' },
  { value: 'electric', label: 'Électrique' },
  { value: 'wood', label: 'Bois' },
  { value: 'heat_pump', label: 'PAC' },
  { value: 'district_heating', label: 'Réseau de chaleur' },
  { value: 'fuel_oil', label: 'Fioul' },
  { value: 'solar', label: 'Solaire' },
  { value: 'biomass', label: 'Biomasse' },
  { value: 'autre', label: 'Autre' },
]
const ROLE_OPTIONS = [
  { value: null, label: 'Nature' },
  { value: 'production', label: 'Production' },
  { value: 'distribution', label: 'Distribution' },
  { value: 'emission', label: 'Émission' },
  { value: 'regulation', label: 'Régulation' },
  { value: 'autre', label: 'Autre' },
]
const COMM_OPTIONS = [
  { value: null, label: '—' },
  { value: 'modbus_tcp', label: 'Modbus TCP' },
  { value: 'modbus_rtu', label: 'Modbus RTU' },
  { value: 'bacnet_ip', label: 'BACnet IP' },
  { value: 'bacnet_mstp', label: 'BACnet MS/TP' },
  { value: 'knx', label: 'KNX' },
  { value: 'mbus', label: 'M-Bus' },
  { value: 'mqtt', label: 'MQTT' },
  { value: 'lorawan', label: 'LoRaWAN' },
  { value: 'autre', label: 'Autre' },
  { value: 'non_communicant', label: 'Non communicant' },
  { value: 'absent', label: 'Absent' },
]

async function submitAddDevice(payload) {
  if (!addDeviceModalSystem.value) return
  try {
    await createBacsDevice(addDeviceModalSystem.value.id, payload)
    await refreshAuditData()
    success('Équipement ajouté')
  } catch (e) {
    error(e.response?.data?.detail || 'Création de l\'équipement impossible')
  }
}
const showNotConcernedSystems = ref(localStorage.getItem('bacs-show-not-concerned') === '1')
watch(showNotConcernedSystems, v => localStorage.setItem('bacs-show-not-concerned', v ? '1' : '0'))
const hiddenNotConcernedCount = computed(() =>
  systems.value.filter(s => s.not_concerned).length
)

const ZONE_NATURES = [
  { value: 'shared-office', label: 'Bureau partagé' },
  { value: 'private-office', label: 'Bureau privé' },
  { value: 'open-space', label: 'Open-space' },
  { value: 'commercial-space', label: 'Espace commercial' },
  { value: 'meeting-room', label: 'Salle de réunion' },
  { value: 'workshop', label: 'Atelier' },
  { value: 'switchboard', label: 'Tableau électrique' },
  { value: 'technical-area', label: 'Local technique' },
  { value: 'classroom', label: 'Salle de classe' },
  { value: 'leasure-space', label: 'Espace loisirs' },
  { value: 'foyer', label: 'Foyer' },
  { value: 'corridor', label: 'Couloir' },
  { value: 'outdoor', label: 'Extérieur' },
  { value: 'meters', label: 'Local compteurs' },
  { value: 'shared-space', label: 'Espace partagé' },
  { value: 'logistic-cell', label: 'Cellule logistique' },
  { value: 'stock', label: 'Stock' },
]
const newZone = ref({ name: '', nature: null, surface_m2: null })

// Compteurs (R175-3 1°)
const METER_USAGES = [
  { value: 'heating', label: 'Chauffage' },
  { value: 'cooling', label: 'Climatisation' },
  { value: 'dhw', label: 'ECS' },
  { value: 'pv', label: 'Production PV' },
  { value: 'lighting', label: 'Éclairage' },
  { value: 'other', label: 'Autre' },
]
const METER_TYPES = [
  { value: 'electric', label: 'Électrique' },
  { value: 'electric_production', label: 'Électrique production' },
  { value: 'gas', label: 'Gaz' },
  { value: 'water', label: 'Eau' },
  { value: 'thermal', label: 'Thermique' },
]
const newMeter = ref({ zone_id: null, usage: 'heating', meter_type: 'thermal', required: true })

const SYSTEM_LABEL = {
  heating: 'Chauffage',
  cooling: 'Refroidissement',
  ventilation: 'Ventilation',
  dhw: 'ECS',
  lighting_indoor: 'Éclairage intérieur',
  lighting_outdoor: 'Éclairage extérieur',
  electricity_production: 'Production photovoltaïque',
}
// Libellés négatifs pour la case "Pas de XXX" (à la place de "Non concerné").
// Utilisés à l'affichage UI et passés au PDF pour cohérence.
// Protocoles communicants disponibles (multi-select pour devices, meters, BMS)
const PROTOCOL_OPTIONS = [
  { value: 'modbus_tcp', label: 'Modbus TCP' },
  { value: 'modbus_rtu', label: 'Modbus RTU' },
  { value: 'bacnet_ip', label: 'BACnet IP' },
  { value: 'bacnet_mstp', label: 'BACnet MS/TP' },
  { value: 'knx', label: 'KNX' },
  { value: 'mbus', label: 'M-Bus' },
  { value: 'lonworks', label: 'LonWorks' },
  { value: 'mqtt', label: 'MQTT' },
  { value: 'opcua', label: 'OPC-UA' },
  { value: 'rest', label: 'API REST' },
  { value: 'lorawan', label: 'LoRaWAN' },
  { value: 'autre', label: 'Autre' },
]
const SYSTEM_NEGATIVE_LABEL = {
  heating: 'Pas de chauffage',
  cooling: 'Pas de refroidissement',
  ventilation: 'Pas de ventilation',
  dhw: 'Pas d\'ECS',
  lighting_indoor: 'Pas d\'éclairage intérieur',
  lighting_outdoor: 'Pas d\'éclairage extérieur',
  electricity_production: 'Pas de production photovoltaïque',
}
// Icone et couleur par categorie de systeme — alignees sur les
// fonctionnalites Buildy de la bibliotheque (chap 2 Perimetre des
// equipements supervises).
const SYSTEM_ICON = {
  heating:                 { icon: 'fa-solid fa-fire',         color: '#dc2626' },
  cooling:                 { icon: 'fa-solid fa-snowflake',    color: '#0891b2' },
  ventilation:             { icon: 'fa-solid fa-fan',          color: '#64748b' },
  dhw:                     { icon: 'fa-solid fa-faucet',       color: '#0284c7' },
  lighting_indoor:         { icon: 'fa-solid fa-lightbulb',    color: '#f59e0b' },
  lighting_outdoor:        { icon: 'fa-solid fa-tower-cell',   color: '#f59e0b' },
  electricity_production:  { icon: 'fa-solid fa-solar-panel',  color: '#16a34a' },
}
const REGULATION_OPTIONS = [
  { value: null, label: '—' },
  { value: 'per_room', label: 'Par pièce' },
  { value: 'per_zone', label: 'Par zone' },
  { value: 'central_only', label: 'Centrale uniquement' },
  { value: 'none', label: 'Aucune' },
]
const GENERATOR_OPTIONS = [
  { value: null, label: '—' },
  { value: 'gas', label: 'Gaz' },
  { value: 'electric', label: 'Effet Joule' },
  { value: 'heat_pump', label: 'Pompe à chaleur' },
  { value: 'wood_appliance', label: 'Appareil bois (exempté R175-6)' },
  { value: 'district_heating', label: 'Réseau de chaleur' },
  { value: 'other', label: 'Autre' },
]
const SEVERITY_LABEL = {
  blocking: { label: 'Bloquante', cls: 'bg-red-100 text-red-700 border-red-300' },
  major: { label: 'Majeure', cls: 'bg-orange-100 text-orange-700 border-orange-300' },
  minor: { label: 'Mineure', cls: 'bg-yellow-100 text-yellow-700 border-yellow-300' },
}
const STATUS_LABEL = {
  open: 'Ouverte',
  quoted: 'Chiffrée',
  in_progress: 'En cours',
  done: 'Terminée',
  declined: 'Refusée',
}

const systemsByZone = computed(() => {
  const groups = new Map()
  for (const s of systems.value) {
    const k = s.zone_id
    if (!groups.has(k)) groups.set(k, { zone_id: s.zone_id, zone_name: s.zone_name, zone_nature: s.zone_nature, items: [] })
    groups.get(k).items.push(s)
  }
  return [...groups.values()]
})

// Replier/déplier manuellement les zones et catégories de la card 3.
// Persistance via localStorage scopée au document.
const collapsedZones = ref(new Set())
const collapsedSystems = ref(new Set())
function loadCollapseState() {
  try {
    const z = localStorage.getItem(`bacs-zone-collapse:${docId}`)
    collapsedZones.value = new Set(z ? JSON.parse(z) : [])
    const s = localStorage.getItem(`bacs-system-collapse:${docId}`)
    collapsedSystems.value = new Set(s ? JSON.parse(s) : [])
  } catch { /* silent */ }
}
function toggleZoneCollapsed(zoneId) {
  const s = new Set(collapsedZones.value)
  if (s.has(zoneId)) s.delete(zoneId); else s.add(zoneId)
  collapsedZones.value = s
  localStorage.setItem(`bacs-zone-collapse:${docId}`, JSON.stringify([...s]))
}
function toggleSystemCollapsed(systemId) {
  const s = new Set(collapsedSystems.value)
  if (s.has(systemId)) s.delete(systemId); else s.add(systemId)
  collapsedSystems.value = s
  localStorage.setItem(`bacs-system-collapse:${docId}`, JSON.stringify([...s]))
}

const itemsBySeverity = computed(() => {
  const out = { blocking: [], major: [], minor: [] }
  for (const it of actionItems.value) {
    if (it.status === 'done' || it.status === 'declined') continue
    out[it.severity]?.push(it)
  }
  return out
})

// Numero affiche par action du plan : "BACS-001" -> facilite la
// reference dans les devis des integrateurs GTB.
function actionNumber(idx) {
  return 'BACS-' + String(idx + 1).padStart(3, '0')
}

// Computed v-model pour les 2 checkboxes conditionnelles : evite les
// problemes de reactivite avec :checked + @change.
const districtConnected = computed({
  get: () => document.value?.bacs_district_heating_substation_kw != null,
  set: (v) => {
    saveDocDebounced({
      bacs_district_heating_substation_kw: v
        ? (document.value?.bacs_district_heating_substation_kw ?? 0)
        : null
    })
  }
})
const generatorWorksDone = computed({
  get: () => document.value?.bacs_generator_works_date != null,
  set: (v) => {
    saveDocDebounced({
      bacs_generator_works_date: v
        ? (document.value?.bacs_generator_works_date ?? new Date().toISOString().slice(0, 10))
        : null
    })
  }
})

// R175-6 applicabilite : PC > 21/07/2021 OU travaux generateur > 21/07/2021
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

// Filtre les actions resolues automatiquement (status='done') ou
// declinees : elles n'ont rien a faire dans le plan a livrer aux
// integrateurs GTB. On les conserve en DB pour traçabilite (visible dans
// l'historique et la vue plein ecran).
const visibleActionItems = computed(() =>
  actionItems.value.filter(it => it.status !== 'done' && it.status !== 'declined')
)
const resolvedCount = computed(() =>
  actionItems.value.filter(it => it.status === 'done' || it.status === 'declined').length
)

function relativeTime(s) {
  if (!s) return ''
  const d = new Date(s)
  const diffSec = Math.floor((Date.now() - d.getTime()) / 1000)
  if (diffSec < 60) return 'quelques secondes'
  if (diffSec < 3600) return Math.floor(diffSec / 60) + ' min'
  if (diffSec < 86400) return Math.floor(diffSec / 3600) + ' h'
  if (diffSec < 30 * 86400) return Math.floor(diffSec / 86400) + ' j'
  return Math.floor(diffSec / (30 * 86400)) + ' mois'
}

function formatDate(s) {
  if (!s) return '—'
  return new Date(s.replace(' ', 'T')).toLocaleDateString('fr-FR', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

async function refresh() {
  try {
    await auditStore.loadAudit(docId)
    refreshSiteCounts()
  } catch (e) {
    error('Échec du chargement de l\'audit BACS')
  }
}

async function refreshAuditData() {
  await auditStore.refreshAuditCore()
}

// Devices regroupés par system_id (pour passer au composant SystemDevicesTable)
const devicesBySystem = computed(() => {
  const out = {}
  for (const d of devices.value) {
    if (!out[d.system_id]) out[d.system_id] = []
    out[d.system_id].push(d)
  }
  return out
})

// Compteurs présents uniquement (pour la liste GTB des compteurs intégrés)
const metersPresent = computed(() => meters.value.filter(m => m.present_actual))

// kind du document : 'bacs_audit' (audit de conformité décret R175) ou
// 'site_audit' (audit site en vue d'un devis Buildy, sans contrainte
// réglementaire). Toute la logique R175 est désactivée en mode site.
const isBacs = computed(() => (document.value?.kind || 'bacs_audit') === 'bacs_audit')

// Régulation thermique (R175-6) : ne lister que les zones qui ont un
// système chauffage ou refroidissement (présent OU non concerné).
// Les zones sans système thermique (ex : un local technique sans chauffage)
// n'ont pas de régulation à évaluer.
// Date du jour au format ISO (YYYY-MM-DD) pour comparer aux échéances.
const todayIso = computed(() => new Date().toISOString().slice(0, 10))
const latestInspection = computed(() => inspections.value[0] || null)

const thermalFiltered = computed(() => {
  // 1 ligne par (zone, catégorie) : on ne garde que les rows dont la
  // catégorie correspond à un système présent dans la zone (sinon ça
  // n'a pas de sens — pas de chauffage = pas de régulation chauffage).
  const presentCats = new Map()  // zone_id -> Set('heating'|'cooling')
  for (const s of systems.value) {
    if (!s.present) continue
    if (s.system_category === 'heating' || s.system_category === 'cooling') {
      if (!presentCats.has(s.zone_id)) presentCats.set(s.zone_id, new Set())
      presentCats.get(s.zone_id).add(s.system_category)
    }
  }
  return thermal.value.filter(t =>
    presentCats.get(t.zone_id)?.has(t.category || 'heating')
  )
})

// Stepper de progression de la card GTB. En mode BACS : 8 etapes
// dont 3 reglementaires (R175-3 capacites, R175-3 mise a disposition,
// R175-4/5 maintenance + formation). En mode site_audit : 5 etapes,
// les 3 reglementaires sont retirees.
const bmsSteps = computed(() => {
  if (bms.value?.out_of_service) {
    return [{ label: isBacs.value ? 'GTB déclarée hors-service' : 'Supervision déclarée hors-service',
              done: true,
              hint: isBacs.value ? 'Plan d\'action ignore les exigences GTB' : 'Sections supervision masquées' }]
  }
  const common = [
    { label: isBacs.value ? 'Identification de la GTB' : 'Identification de la supervision',
      done: !!bms.value?.existing_solution,
      hint: 'Solution + marque + localisation' },
    { label: 'Protocoles de mise à disposition',
      done: !!(bms.value?.provided_protocols && JSON.parse(bms.value.provided_protocols || '[]').length) },
    { label: isBacs.value ? 'Analyse fonctionnelle GTB' : 'Documents existants (AF, plans…)',
      done: !!(document.value?.audit_existing_af_status === 'absent'
              || (siteDocCounts.value?.doe || 0) > 0) },
    { label: isBacs.value ? 'Usages traités cochés' : 'Usages supervisés cochés',
      done: !!(bms.value?.manages_heating || bms.value?.manages_cooling
              || bms.value?.manages_ventilation || bms.value?.manages_dhw
              || bms.value?.manages_lighting) },
    { label: 'Équipements / compteurs intégrés',
      done: !!(devices.value.some(d => d.managed_by_bms) || meters.value.some(m => m.managed_by_bms)),
      hint: 'Au moins un système ou compteur lié à la supervision' },
  ]
  if (!isBacs.value) return common
  return [
    ...common,
    { label: 'Capacités R175-3 (P1 + P2)',
      done: !!(bms.value?.meets_r175_3_p1 && bms.value?.meets_r175_3_p2) },
    { label: 'Mise à disposition des données',
      done: !!(bms.value?.data_provision_to_manager && bms.value?.data_provision_to_operators) },
    { label: 'R175-4 maintenance + R175-5 formation',
      done: !!(bms.value?.has_maintenance_procedures && bms.value?.operator_trained) },
  ]
})

// Devices disponibles comme générateurs pour une (zone, catégorie).
// On filtre sur la category — un device de chauffage n'a aucun sens
// comme générateur de la régulation clim et inversement.
function generatorDevicesForZoneCategory(zoneId, category) {
  const sysIds = systems.value
    .filter(s => s.zone_id === zoneId && s.present && s.system_category === category)
    .map(s => s.id)
  return devices.value.filter(d => sysIds.includes(d.system_id))
}

// Switch entre kinds compatibles (BACS <-> site). PATCH le kind, refresh
// les donnees, et redirige vers la route correspondante. Les saisies
// existantes (zones, systemes, devices, compteurs, GTB, etc.) sont
// preservees telles quelles ; seul l'affichage des blocs R175 change.
async function switchKind(newKind) {
  if (!document.value || newKind === document.value.kind) return
  if (newKind !== 'bacs_audit' && newKind !== 'site_audit') return
  try {
    await updateAf(docId, { kind: newKind })
    success(newKind === 'bacs_audit' ? 'Audit basculé en mode BACS' : 'Audit basculé en mode GTB (Classique)')
    await refresh()
    // Ré-aligner l'URL pour matcher le nouveau kind
    const target = newKind === 'bacs_audit' ? `/bacs-audit/${docId}` : `/site-audit/${docId}`
    if (route.path !== target) router.replace(target)
  } catch (e) {
    error(e.response?.data?.detail || 'Bascule impossible')
  }
}

// Panneau d'activité (slide-out a droite, comme dans l'AF detail).
// Affiche les entrees du journal d'audit (validations, exports,
// uploads, generations Claude, etc.) recuperees via /api/afs/:id/audit.
const showActivity = ref(false)
const activityRef = ref(null)

// Tout replier / déplier (broadcast vers chaque CollapsibleSection)
function setAllSectionsCollapsed(collapsed) {
  window.dispatchEvent(new CustomEvent('bacs-collapse:set-all', { detail: !collapsed }))
}

// Devices enrichis avec system_category + zone_name (pour la liste GTB)
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

async function addZone(payload) {
  const data = payload || newZone.value
  if (!data.name?.trim() || !document.value?.site_id) return
  try {
    await createZone({
      site_id: document.value.site_id,
      name: data.name.trim(),
      nature: data.nature,
      surface_m2: data.surface_m2 ?? null,
    })
    const z = await listZones(document.value.site_id)
    zones.value = z.data
    await resyncBacsAudit(docId)
    await refreshAuditData()
    newZone.value = { name: '', nature: null }
    success('Zone ajoutée et plan d\'audit synchronisé')
  } catch (e) {
    error(e.response?.data?.detail || 'Création zone impossible')
  }
}

async function patchZone(z, patch) {
  try {
    const { data } = await updateZone(z.zone_id, patch)
    Object.assign(z, data)
    // Si la nature a change, on resync (les categories attendues ont change)
    if ('nature' in patch) {
      await resyncBacsAudit(docId)
      await refreshAuditData()
    }
  } catch {
    error('Sauvegarde zone impossible')
  }
}

async function dupZone(z) {
  try {
    const { data } = await duplicateZone(z.zone_id)
    zones.value.push(data)
    await refreshAuditData()
    success(`Zone « ${data.name} » créée`)
  } catch {
    error('Duplication impossible')
  }
}

async function removeZone(z) {
  const ok = await confirm({
    title: 'Supprimer cette zone ?',
    message: `« ${z.name} »\n\nLes systèmes, équipements et lignes d'audit rattachés à cette zone seront aussi supprimés.`,
    confirmLabel: 'Supprimer',
    danger: true,
  })
  if (!ok) return
  try {
    await deleteZone(z.zone_id)
    zones.value = zones.value.filter(x => x.zone_id !== z.zone_id)
    await refreshAuditData()
    success('Zone supprimée')
  } catch {
    error('Suppression impossible')
  }
}

// ── Stepper (9 etapes a valider manuellement) ──
const { auditProgress, synthesisHtml } = storeToRefs(auditStore)
const activeStepKey = ref(null)
const siteDocCounts = ref({ doe: 0, photo: 0 })
const siteCredCount = ref(0)

async function refreshSiteCounts() {
  if (!document.value?.site_uuid) return
  try {
    const [{ data: docs }, { data: creds }] = await Promise.all([
      listSiteDocuments(document.value.site_uuid),
      listSiteCredentials(document.value.site_uuid),
    ])
    siteDocCounts.value = {
      doe: (docs || []).filter(d => d.category !== 'photo').length,
      photo: (docs || []).filter(d => d.category === 'photo').length,
    }
    siteCredCount.value = (creds || []).length
  } catch { /* silencieux */ }
}

const STEP_DEFINITIONS = [
  { key: 'identification',
    label: 'Identification',
    description: 'Site et applicabilite R175-2 renseignes.',
    isComplete: () => !!site.value && !!document.value?.bacs_applicability_status },
  { key: 'zones',
    label: 'Zones',
    description: 'Au moins une zone fonctionnelle saisie.',
    isComplete: () => zones.value.length > 0 },
  { key: 'systems',
    label: 'Systemes',
    description: 'Au moins un systeme present avec un equipement saisi.',
    isComplete: () => systems.value.some(s => s.present && devices.value.some(d => d.system_id === s.id)) },
  { key: 'meters',
    label: 'Compteurs',
    description: 'Compteurs requis revus (presents/absents/HS coches).',
    isComplete: () => meters.value.length > 0 && meters.value.some(m => m.present_actual !== null) },
  { key: 'thermal',
    label: 'Régulation thermique',
    description: 'R175-6 renseignee pour chaque zone chauffee/climatisee.',
    isComplete: () => thermal.value.length > 0 },
  { key: 'bms',
    label: 'GTB',
    description: 'Solution GTB + capacites R175-3 + maintenance + formation.',
    isComplete: () => !!bms.value?.existing_solution },
  { key: 'inspections',
    label: 'Inspections',
    description: 'R175-5-1 : inspection periodique par un tiers (rapport conserve 10 ans).',
    isComplete: () => inspections.value.length > 0 && !!inspections.value[0].last_inspection_date },
  { key: 'documents',
    label: 'Documents',
    description: 'Plans, schemas, datasheets et manuels deposes.',
    isComplete: () => siteDocCounts.value.doe > 0 },
  { key: 'credentials',
    label: 'Credentials',
    description: 'Acces web/SSH/VPN aux GTB et systemes renseignes.',
    isComplete: () => siteCredCount.value > 0 },
  { key: 'review',
    label: 'Plan & livraison',
    description: 'Plan de mise en conformite relu et annote commercialement.',
    isComplete: () => actionItems.value.every(a => a.estimated_effort || a.status !== 'open') },
  { key: 'synthesis',
    label: 'Synthèse',
    description: 'Note de synthese redigee (manuellement ou via Claude).',
    isComplete: () => !!(document.value?.audit_synthesis_html || '').replace(/<[^>]*>/g, '').trim() },
]

function stepFor(key) {
  return stepperSteps.value.find(s => s.key === key)
}

// Steps cachés en mode site_audit (purement R175) : régulation thermique
// (R175-6) et plan de mise en conformité (R175 entier).
const STEPS_BACS_ONLY = new Set(['thermal', 'inspections', 'review'])
const stepperSteps = computed(() => STEP_DEFINITIONS
  .filter(def => isBacs.value || !STEPS_BACS_ONLY.has(def.key))
  .map(def => {
    const p = auditProgress.value?.[def.key] || {}
    return {
      key: def.key,
      label: def.label,
      description: isBacs.value ? def.description : (def.descriptionSite || def.description.replace(/R175-?[0-9]?\s*(§\s*[0-9]|[0-9]°)?/g, '').replace(/\s+/g, ' ').trim()),
      complete: def.isComplete(),
      validated: !!p.validated,
      validated_at: p.validated_at || null,
      validated_by_name: p.validated_by_name || null,
    }
  }))

async function validateStep(stepKey) {
  try {
    const { data } = await validateBacsAuditStep(docId, stepKey, true)
    auditProgress.value = data.audit_progress || {}
    success(`Etape "${STEP_DEFINITIONS.find(s => s.key === stepKey)?.label}" validee`)
  } catch (e) {
    error(e.response?.data?.detail || 'Validation impossible')
  }
}

async function invalidateStep(stepKey) {
  try {
    const { data } = await validateBacsAuditStep(docId, stepKey, false)
    auditProgress.value = data.audit_progress || {}
  } catch (e) {
    error('Annulation impossible')
  }
}

function onStepClick(key) {
  activeStepKey.value = activeStepKey.value === key ? null : key
  // Scroll vers la section correspondante
  const targetId = {
    identification: 'section-identification',
    zones: 'section-zones',
    systems: 'section-systems',
    meters: 'section-meters',
    thermal: 'section-thermal',
    bms: 'section-bms',
    documents: 'section-documents',
    credentials: 'section-credentials',
    review: 'section-review',
    synthesis: 'section-synthesis',
  }[key]
  if (targetId) {
    const el = window.document.getElementById(targetId)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
}

// ── Note de synthese (etape 12, redaction assistee Claude) ──
// synthesisHtml provient deja du store (declare plus haut).
const synthesisGenerating = ref(false)
let synthesisSaveTimer = null

function onSynthesisInput(html) {
  synthesisHtml.value = html
  clearTimeout(synthesisSaveTimer)
  synthesisSaveTimer = setTimeout(async () => {
    try {
      await updateBacsAuditSynthesis(docId, html || null)
      if (document.value) document.value.audit_synthesis_html = html
    } catch {
      error('Sauvegarde synthese impossible')
    }
  }, 600)
}

async function generateSynthesis() {
  if (synthesisGenerating.value) return
  synthesisGenerating.value = true
  try {
    const { data } = await generateBacsAuditSynthesis(docId)
    if (data?.html) {
      synthesisHtml.value = data.html
      if (document.value) {
        document.value.audit_synthesis_html = data.html
        document.value.audit_synthesis_generated_at = data.generated_at
      }
      success('Note de synthese generee par Claude')
      refreshClaudeUsage()
    }
  } catch (e) {
    error(e.response?.data?.detail || 'Echec generation Claude')
  } finally {
    synthesisGenerating.value = false
  }
}

// ── Preconisations Buildy par action ──
// Ouvre la modale Tiptap avec un bouton 'Reformuler avec Claude' (kind
// bacs_audit_notes deja configure pour reformulate uniquement).
function openAlternativesEditor(item) {
  openNotesModal({
    title: 'Préconisations Buildy',
    contextLabel: item.title + ' (' + (item.r175_article || '—') + ')',
    entityType: 'action_item_alternatives',
    entityRef: item,
    currentHtml: item.alternative_solutions_html || '',
  })
}

// ── Modale notes (rich text + Claude) — partagee zones / systems / meters / bms / devices ──
const notesModal = ref({
  open: false,
  title: '',
  contextLabel: '',
  html: '',
  // entityType: 'zone' | 'system' | 'meter' | 'bms' | 'device'
  // entityRef: ref reactive a la ligne en cours d'edition (pour Object.assign)
  entityType: null,
  entityRef: null,
  // Contexte transmis a Claude
  assistContext: null,
})

function openNotesModal({ title, contextLabel, entityType, entityRef, currentHtml }) {
  notesModal.value = {
    open: true,
    title,
    contextLabel,
    html: currentHtml || '',
    entityType,
    entityRef,
    assistContext: {
      kind: 'bacs_audit_notes',
      title: contextLabel || title,
      parent_path: contextLabel || null,
    },
  }
}

async function saveNotesModal(html) {
  const m = notesModal.value
  if (!m.entityRef || !m.entityType) return
  const payload = { notes_html: html || null }
  try {
    if (m.entityType === 'zone') {
      const { data } = await updateZone(m.entityRef.zone_id, payload)
      Object.assign(m.entityRef, data)
    } else if (m.entityType === 'system') {
      const { data } = await updateBacsSystem(m.entityRef.id, payload)
      Object.assign(m.entityRef, data)
    } else if (m.entityType === 'meter') {
      const { data } = await updateBacsMeter(m.entityRef.id, payload)
      Object.assign(m.entityRef, data)
    } else if (m.entityType === 'bms') {
      const { data } = await updateBacsBms(docId, payload)
      bms.value = data
    } else if (m.entityType === 'device') {
      const { data } = await updateBacsDevice(m.entityRef.id, payload)
      Object.assign(m.entityRef, data)
    } else if (m.entityType === 'action_item_alternatives') {
      const { data } = await updateBacsActionItem(m.entityRef.id, { alternative_solutions_html: html || null })
      Object.assign(m.entityRef, data)
    }
    success('Notes enregistrees')
  } catch (e) {
    error(e.response?.data?.detail || 'Sauvegarde notes impossible')
  }
}

function hasNotes(htmlOrText) {
  if (!htmlOrText) return false
  return !!String(htmlOrText).replace(/<[^>]*>/g, '').trim()
}

// ── Applicabilité R175-2 ──
const APPLICABILITY_LABEL = {
  subject_immediate: { label: 'Soumis (immédiat)', cls: 'bg-red-100 text-red-700 border-red-300' },
  subject_2025: { label: 'Soumis — échéance 1er janvier 2025', cls: 'bg-orange-100 text-orange-700 border-orange-300' },
  subject_2027: { label: 'Soumis — échéance 1er janvier 2027', cls: 'bg-amber-100 text-amber-700 border-amber-300' },
  not_subject: { label: 'Non assujetti (puissance < 70 kW)', cls: 'bg-emerald-100 text-emerald-700 border-emerald-300' },
}

let docSaveTimer = null
function saveDocDebounced(patch) {
  Object.assign(document.value, patch)
  clearTimeout(docSaveTimer)
  docSaveTimer = setTimeout(async () => {
    try {
      const { data } = await updateAf(docId, patch)
      document.value = data
    } catch {
      error('Sauvegarde impossible')
    }
  }, 400)
}

async function recomputePowerFromEquipments() {
  try {
    // Utilise la somme des devices saisis dans l'audit (chauffage + clim).
    // Cf retour Kevin : la source de verite est l'audit, pas les equipments
    // du site qui sont une autre table (peut-etre vide).
    const { data } = await getBacsPowerSummary(docId)
    saveDocDebounced({
      bacs_total_power_kw: data.heating_cooling_total_kw,
      bacs_total_power_source: 'auto',
    })
    success(`Puissance recalculée : ${data.heating_cooling_total_kw} kW (chauffage + climatisation)`)
  } catch {
    error('Calcul impossible')
  }
}

async function addMeter(payload) {
  const src = payload || newMeter.value
  if (!src.usage || !src.meter_type) return
  try {
    const { data } = await createBacsMeter(docId, {
      zone_id: src.zone_id || null,
      usage: src.usage,
      meter_type: src.meter_type,
      required: src.required,
    })
    meters.value.push({ ...data, zone_name: zones.value.find(z => z.zone_id === data.zone_id)?.name || null })
    const a = await getBacsActionItems(docId)
    actionItems.value = a.data
    newMeter.value = { zone_id: null, usage: 'heating', meter_type: 'thermal', required: true }
    success('Compteur ajouté')
  } catch (e) {
    error(e.response?.data?.detail || 'Création compteur impossible')
  }
}

let bmsSaveTimer = null
function saveBmsDebounced() {
  clearTimeout(bmsSaveTimer)
  bmsSaveTimer = setTimeout(async () => {
    try {
      await updateBacsBms(docId, bms.value)
      const a = await getBacsActionItems(docId)
      actionItems.value = a.data
    } catch {
      error('Sauvegarde GTB impossible')
    }
  }, 500)
}

// Refresh helpers reduits a leur expression la plus simple (le store
// rafraichit le state, les refs reactives suivent).
async function refreshInspections() { await auditStore.refreshInspections() }
async function refreshActionItems() { await auditStore.refreshActionItems() }

async function patchActionItem(item, patch) {
  try {
    const { data } = await updateBacsActionItem(item.id, patch)
    Object.assign(item, data)
  } catch {
    error('Sauvegarde action impossible')
  }
}

async function regenerate() {
  try {
    // Resync : ajoute les rows manquantes (systems / thermal) si la matrice
    // nature_zone a evolue ou si des zones ont ete ajoutees au site
    await resyncBacsAudit(docId)
    const { data } = await regenerateBacsActionItems(docId)
    success(`Régénération : +${data.added} nouvelles, ${data.updated} synchronisées, ${data.resolved} résolues`)
    await refreshAuditData()
  } catch {
    error('Régénération impossible')
  }
}

function downloadCsv() {
  window.location.href = getBacsActionItemsCsvUrl(docId)
}

const exporting = ref(false)
async function exportPdf() {
  exporting.value = true
  try {
    const { data } = await exportBacsPdf(docId)
    success(`PDF généré (${(data.file_size_bytes / 1024).toFixed(0)} Ko)`)
    window.location.href = data.download_url
  } catch (e) {
    error(e.response?.data?.detail || 'Échec de l\'export PDF')
  } finally {
    exporting.value = false
  }
}

const bulkUploadOpen = ref(false)
function openBulkUpload() { bulkUploadOpen.value = true }
function closeBulkUpload() { bulkUploadOpen.value = false }
function onBulkUploaded() { refreshSiteCounts() }

const transcriptOpen = ref(false)
function openTranscript() { transcriptOpen.value = true }
function closeTranscript() { transcriptOpen.value = false }
function onSuggestionApplied() { refreshAuditData() }

const exportingChecklist = ref(false)
async function exportChecklist() {
  exportingChecklist.value = true
  try {
    const { data } = await exportBacsChecklistPdf(docId)
    const blob = new Blob([data], { type: 'application/pdf' })
    const url = URL.createObjectURL(blob)
    const a = window.document.createElement('a')
    a.href = url
    a.download = `checklist-audit-${document.value?.slug || docId}.pdf`
    a.click()
    URL.revokeObjectURL(url)
    success('Checklist A4 prête à imprimer')
  } catch (e) {
    error(e.response?.data?.detail || 'Échec de l\'export de la checklist')
  } finally {
    exportingChecklist.value = false
  }
}

const delivering = ref(false)
async function deliver() {
  const ok = await confirm({
    title: 'Livrer l\'audit BACS ?',
    message: 'Cette action génère le PDF final, calcule son SHA256 (preuve d\'intégrité) et fige le snapshot Git du document. Une re-livraison ultérieure créera un tag séparé v2/v3 ; l\'historique reste consultable.',
    confirmLabel: 'Livrer',
  })
  if (!ok) return
  delivering.value = true
  try {
    const { data } = await deliverBacsAudit(docId)
    success(`Audit livré — tag Git ${data.delivered_git_tag}`)
    refresh()
  } catch (e) {
    error(e.response?.data?.detail || 'Échec de la livraison')
  } finally {
    delivering.value = false
  }
}

onMounted(() => {
  loadCollapseState()
  refresh()
})
</script>

<template>
  <div class="w-full mx-auto px-3 pb-12">
    <!-- Header compact (1 ligne sur desktop, breadcrumbs + titre + actions) -->
    <div class="flex items-center justify-between gap-4 mb-3 flex-wrap">
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2 text-xs text-gray-500 mb-0.5 flex-wrap">
          <button @click="router.push('/')" class="hover:text-gray-700 inline-flex items-center gap-1">
            <ArrowLeftIcon class="w-3.5 h-3.5" /> Audits
          </button>
          <span>›</span>
          <span class="text-gray-400">{{ isBacs ? 'Audit BACS' : 'Audit GTB (Classique)' }}</span>
          <span v-if="document?.updated_by_name" class="text-gray-400">
            · édité par <strong class="font-medium text-gray-600">{{ document.updated_by_name }}</strong>
            <span v-if="document.updated_at" :title="document.updated_at"> il y a {{ relativeTime(document.updated_at) }}</span>
          </span>
          <span v-if="document?.delivered_at" class="ml-2 inline-flex items-center gap-1 text-emerald-700">
            ✓ Livré le {{ formatDate(document.delivered_at) }}
          </span>
        </div>
        <h1 class="text-lg font-semibold text-gray-800 flex items-center gap-2 min-w-0">
          <FireIcon v-if="isBacs" class="w-5 h-5 text-orange-500 shrink-0" />
          <BuildingOffice2Icon v-else class="w-5 h-5 text-emerald-600 shrink-0" />
          <input
            type="text"
            :value="document?.project_name || ''"
            @blur="e => e.target.value !== (document?.project_name || '') && saveDocDebounced({ project_name: e.target.value || (isBacs ? 'Audit BACS' : 'Audit GTB') })"
            :placeholder="isBacs ? `Titre de l'audit BACS` : `Titre de l'audit GTB`"
            class="min-w-0 bg-transparent text-lg font-semibold text-gray-800 px-1 py-0.5 rounded border border-transparent hover:border-gray-200 focus:border-indigo-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            :style="{ width: ((document?.project_name?.length || 12) + 2) + 'ch' }"
          />
          <span class="text-sm font-normal text-gray-500 truncate">— {{ document?.client_name }}</span>
          <select
            :value="document?.kind || 'bacs_audit'"
            @change="e => switchKind(e.target.value)"
            class="ml-2 text-xs px-2 py-1 border border-gray-200 rounded-lg bg-white hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition shrink-0"
            title="Type d'audit"
          >
            <option value="bacs_audit">Audit BACS (R175)</option>
            <option value="site_audit">Audit GTB (Classique)</option>
          </select>
        </h1>
      </div>
      <div class="flex items-center gap-2 flex-wrap shrink-0">
        <div class="inline-flex rounded-lg border border-gray-200 overflow-hidden bg-white">
          <button @click="setAllSectionsCollapsed(true)"
                  class="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs text-gray-700 hover:bg-gray-50 whitespace-nowrap"
                  title="Replier toutes les sections">
            <ChevronDoubleUpIcon class="w-3.5 h-3.5 shrink-0" /> Tout replier
          </button>
          <span class="w-px bg-gray-200"></span>
          <button @click="setAllSectionsCollapsed(false)"
                  class="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs text-gray-700 hover:bg-gray-50 whitespace-nowrap"
                  title="Déplier toutes les sections">
            <ChevronDoubleDownIcon class="w-3.5 h-3.5 shrink-0" /> Tout déplier
          </button>
        </div>
        <button @click="showActivity = !showActivity"
                :class="['inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs border rounded-lg whitespace-nowrap',
                         showActivity
                           ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                           : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50']"
                title="Panneau d'activité">
          <ClockIcon class="w-3.5 h-3.5 shrink-0" /> Activité
        </button>
        <button v-if="document?.site_uuid" @click="openBulkUpload"
          title="Importer en masse les photos prises sur site (tri par horodatage EXIF + mapping)"
          class="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 whitespace-nowrap">
          <PhotoIcon class="w-3.5 h-3.5 shrink-0" /> Photos terrain
        </button>
        <button @click="openTranscript"
          title="Importer le transcript Plaud Pro et laisser Claude pré-remplir les champs"
          class="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-purple-700 bg-purple-50 border border-purple-200 rounded-lg hover:bg-purple-100 whitespace-nowrap">
          <SparklesIcon class="w-3.5 h-3.5 shrink-0" /> Transcript IA
        </button>
        <button @click="exportPdf" :disabled="exporting"
          title="Génère le rapport d'audit complet (synthèse + plan d'actions + annexes) au format PDF"
          class="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-60 whitespace-nowrap">
          <DocumentArrowDownIcon class="w-3.5 h-3.5 shrink-0" /> {{ exporting ? 'Génération…' : 'Générer le rapport' }}
        </button>
        <button @click="deliver" :disabled="delivering" class="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-60 whitespace-nowrap">
          <CheckCircleIcon class="w-3.5 h-3.5 shrink-0" /> {{ delivering ? 'Livraison…' : 'Livrer' }}
        </button>
      </div>
    </div>

    <div v-if="loading" class="text-center py-12 text-gray-400 text-sm">Chargement…</div>

    <div v-else class="grid grid-cols-[180px_1fr] gap-4 items-start">
      <!-- Stepper vertical sticky : visible tout au long du scroll de la page -->
      <BacsAuditStepper
        :steps="stepperSteps"
        :active-step-key="activeStepKey"
        @step-click="onStepClick"
        @validate-step="validateStep"
        @invalidate-step="invalidateStep"
        class="sticky top-4 self-start"
      />

      <!-- Colonne principale : contenu de l'audit -->
      <div class="space-y-4 min-w-0">
      <!-- Synthese severities (compactee) — hors site_audit (pas de plan d'actions) -->
      <div v-if="isBacs" class="grid grid-cols-3 gap-2">
        <div v-for="sev in ['blocking','major','minor']" :key="sev"
             :class="['rounded-lg border px-3 py-2 flex items-center gap-3', SEVERITY_LABEL[sev].cls]">
          <div class="text-2xl font-semibold leading-none">{{ itemsBySeverity[sev].length }}</div>
          <div class="text-xs leading-tight">
            <div class="font-medium uppercase tracking-wider opacity-70">{{ SEVERITY_LABEL[sev].label }}</div>
            <div class="opacity-70">action{{ itemsBySeverity[sev].length > 1 ? 's' : '' }} ouverte{{ itemsBySeverity[sev].length > 1 ? 's' : '' }}</div>
          </div>
        </div>
      </div>

      <!-- 1. Identification + Applicabilité R175-2 (R175-2 masqué en site_audit) -->
      <CollapsibleSection storage-key="identification" section-id="section-identification">
        <template #header>
          <BuildingOffice2Icon class="w-5 h-5 text-indigo-600" />
          <h2 class="text-base font-semibold text-gray-800">1. Identification du site<span v-if="isBacs"> &amp; applicabilité R175-2</span></h2>
          <R175Tooltip v-if="isBacs" article="R175-2" />
          <StepValidateBadge class="ml-auto" :step="stepFor('identification')" @validate="validateStep" @invalidate="invalidateStep" />
        </template>
        <template #summary>
          <span v-if="isBacs">
            Puissance chauffage + clim {{ document?.bacs_total_power_kw ?? '—' }} kW
            · R175-2 {{ document?.bacs_applicable ? 'applicable' : 'non applicable' }}
          </span>
          <span v-else>
            {{ document?.client_name || 'Client à renseigner' }}<span v-if="site?.name"> · site « {{ site.name }} »</span>
          </span>
        </template>
        <div v-if="isBacs" class="px-5 py-4 grid grid-cols-2 gap-4">
          <div>
            <label class="block text-xs font-medium text-gray-700 mb-1">
              Puissance nominale utile cumulée chauffage + climatisation (kW)
            </label>
            <div class="flex gap-2">
              <input
                type="number" min="0" step="0.1"
                :value="document?.bacs_total_power_kw"
                @input="e => saveDocDebounced({ bacs_total_power_kw: e.target.value === '' ? null : parseFloat(e.target.value), bacs_total_power_source: 'manual_override' })"
                class="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm"
              />
              <button
                @click="recomputePowerFromEquipments"
                class="px-3 py-2 text-xs font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 whitespace-nowrap"
                title="Cumul automatique des équipements chauffage + climatisation du site"
              >
                <ArrowPathIcon class="w-3.5 h-3.5 inline-block -mt-0.5" /> Auto-calculer
              </button>
            </div>
            <p class="text-[11px] text-gray-500 mt-1">
              Source : <span class="font-mono">{{ document?.bacs_total_power_source || 'auto' }}</span>
              <span v-if="document?.bacs_total_power_source === 'manual_override'" class="text-amber-700"> (override manuel)</span>
            </p>
            <!-- Detail du calcul auto : transparence des devices comptes -->
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
            <input
              type="date"
              :value="document?.bacs_building_permit_date || ''"
              @input="e => saveDocDebounced({ bacs_building_permit_date: e.target.value || null })"
              class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
            />
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
              <input
                type="date"
                :value="document?.bacs_generator_works_date || ''"
                @input="e => saveDocDebounced({ bacs_generator_works_date: e.target.value || null })"
                class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
              />
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
              <input
                type="number" min="0" step="0.1"
                :value="document?.bacs_district_heating_substation_kw"
                @input="e => saveDocDebounced({ bacs_district_heating_substation_kw: e.target.value === '' ? 0 : parseFloat(e.target.value) })"
                placeholder="—"
                class="w-full max-w-xs px-3 py-2 border border-gray-200 rounded-lg text-sm"
              />
              <p class="text-[11px] text-gray-500 mt-1 leading-relaxed">
                <strong>R175-2</strong> : « Pour les bâtiments dont la génération de chaleur ou de froid est produite par échange avec un réseau urbain, la <strong>puissance du générateur à considérer est celle de la station d'échange</strong> ». Cette valeur prime sur la puissance cumulée des systèmes en aval pour déterminer l'assujettissement.
              </p>
            </div>
          </div>
        </div>
        <div v-if="!isBacs" class="px-5 py-4 text-sm text-gray-500">
          <p>
            Audit GTB (Classique) — les contraintes du décret R175 sont
            désactivées pour ce document. Les sections ci-dessous se
            concentrent sur l'inventaire technique nécessaire au chiffrage.
          </p>
        </div>
        <div v-if="isBacs && document?.bacs_applicability_status" class="px-5 pb-4">
          <div :class="['rounded-lg border p-3 flex items-start gap-3', APPLICABILITY_LABEL[document.bacs_applicability_status].cls]">
            <ExclamationTriangleIcon class="w-5 h-5 shrink-0 mt-0.5" />
            <div class="flex-1">
              <div class="font-medium text-sm">{{ APPLICABILITY_LABEL[document.bacs_applicability_status].label }}</div>
            </div>
          </div>
          <p v-if="document?.bacs_applicability_status !== 'not_subject'" class="mt-2 text-[11px] text-gray-500 leading-relaxed">
            <em>À titre informatif :</em> l'article R175-2 prévoit une clause de dispense applicable lorsque le temps de retour
            sur investissement de la mise en conformité dépasse 10 ans. Ce calcul ne relève pas du périmètre de l'audit
            (cf. Annexe D, point 4).
          </p>
        </div>
      </CollapsibleSection>

      <!-- 2. Zones fonctionnelles (R175-1 6°) — editable in-situ -->
      <CollapsibleSection storage-key="zones" section-id="section-zones">
        <template #header>
          <MapPinIcon class="w-5 h-5 text-indigo-600" />
          <h2 class="text-base font-semibold text-gray-800">2. Zones fonctionnelles</h2>
          <span v-if="isBacs" class="text-xs text-gray-500">R175-1 6° — usages homogènes</span>
          <R175Tooltip v-if="isBacs" article="R175-1 6°" />
          <span class="ml-auto text-[11px] text-gray-500">{{ zones.length }} zone{{ zones.length > 1 ? 's' : '' }} sur ce site</span>
          <StepValidateBadge :step="stepFor('zones')" @validate="validateStep" @invalidate="invalidateStep" />
        </template>
        <template #summary>
          <span v-if="zones.length">
            {{ zones.length }} zone{{ zones.length > 1 ? 's' : '' }}
            · surface totale {{ zones.reduce((s,z) => s + (z.surface_m2 || 0), 0) || '—' }} m²
            · {{ zones.slice(0,4).map(z => z.name).join(' · ') }}{{ zones.length > 4 ? ' …' : '' }}
          </span>
          <span v-else class="italic">Aucune zone définie</span>
        </template>
        <table class="w-full text-sm">
          <thead class="text-xs uppercase text-gray-500 tracking-wider bg-gray-50">
            <tr>
              <th class="text-center px-5 py-2">Nom</th>
              <th class="text-center py-2 w-48">Nature</th>
              <th class="text-center py-2 w-24">Surface (m²)</th>
              <th class="text-center py-2 w-32">Notes</th>
              <th class="text-center py-2 w-24">Photos</th>
              <th class="text-center px-5 py-2 w-12"></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            <PhotoDropTr v-for="z in zones" :key="z.zone_id" row-class="group"
                         :site-uuid="document?.site_uuid || ''"
                         :attach-to="{ zone_id: z.zone_id }"
                         :enabled="!!document?.site_uuid"
                         @changed="refreshAuditData">
              <td class="px-5 py-2">
                <input type="text" :value="z.name"
                       @blur="e => e.target.value !== z.name && patchZone(z, { name: e.target.value })"
                       class="w-full text-sm px-2 py-1 border border-transparent hover:border-gray-200 focus:border-indigo-500 focus:outline-none rounded" />
              </td>
              <td class="py-2">
                <select :value="z.nature"
                        @change="e => patchZone(z, { nature: e.target.value || null })"
                        class="text-xs px-2 py-1 border border-gray-200 rounded">
                  <option :value="null">—</option>
                  <option v-for="opt in ZONE_NATURES" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
                </select>
              </td>
              <td class="py-2">
                <input type="number" min="0" step="1" :value="z.surface_m2" placeholder="—"
                       @blur="e => patchZone(z, { surface_m2: e.target.value === '' ? null : parseFloat(e.target.value) })"
                       class="w-full text-xs px-2 py-1 border border-transparent hover:border-gray-200 focus:border-indigo-500 focus:outline-none rounded" />
              </td>
              <td class="py-2 text-center">
                <button
                  type="button"
                  @click="openNotesModal({ title: 'Notes - ' + z.name, contextLabel: 'Zone : ' + z.name, entityType: 'zone', entityRef: z, currentHtml: z.notes_html || z.notes || '' })"
                  :class="['inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded-md border transition',
                    hasNotes(z.notes_html || z.notes)
                      ? 'border-indigo-300 text-indigo-700 bg-indigo-50 hover:bg-indigo-100'
                      : 'border-gray-300 text-gray-600 hover:bg-gray-50']"
                  title="Editer les notes (avec assistance Claude)"
                >
                  <PencilSquareIcon class="w-4 h-4" />
                  {{ hasNotes(z.notes_html || z.notes) ? 'Notes' : '+ Notes' }}
                </button>
              </td>
              <td class="py-2 text-center">
                <BacsPhotoButton
                  v-if="document?.site_uuid"
                  :site-uuid="document.site_uuid"
                  :attach-to="{ zone_id: z.zone_id }"
                  :label="z.name"
                />
              </td>
              <td class="px-5 py-2 text-right whitespace-nowrap">
                <button @click="dupZone(z)" class="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-indigo-600 p-1 transition" title="Dupliquer">
                  <DocumentDuplicateIcon class="w-4 h-4" />
                </button>
                <button @click="removeZone(z)" class="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-600 p-1 transition" title="Supprimer">
                  <TrashIcon class="w-4 h-4" />
                </button>
              </td>
            </PhotoDropTr>
            <tr class="bg-emerald-50/30">
              <td colspan="6" class="px-5 py-3 text-center">
                <button @click="showAddZoneModal = true"
                        class="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-sm">
                  <PlusIcon class="w-4 h-4" /> Ajouter une zone
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </CollapsibleSection>

      <!-- 3. Systèmes techniques par zone (R175-1 4° + R175-3 3°/4°) -->
      <SystemsSection
        :systems-by-zone="systemsByZone"
        :devices-by-system="devicesBySystem"
        :hidden-not-concerned-count="hiddenNotConcernedCount"
        :collapsed-zones="collapsedZones"
        :collapsed-systems="collapsedSystems"
        :system-labels="SYSTEM_LABEL"
        :system-negative-labels="SYSTEM_NEGATIVE_LABEL"
        :zone-natures="ZONE_NATURES"
        :step="stepFor('systems')"
        v-model:show-not-concerned-systems="showNotConcernedSystems"
        @open-notes="openNotesModal"
        @validate-step="validateStep"
        @invalidate-step="invalidateStep"
        @toggle-zone-collapsed="toggleZoneCollapsed"
        @toggle-system-collapsed="toggleSystemCollapsed"
        @add-device="sys => addDeviceModalSystem = sys"
      />

      <!-- 4. Compteurs et mesurage (R175-3 1°) -->
      <MetersSection
        :meter-usages="METER_USAGES"
        :protocol-options="PROTOCOL_OPTIONS"
        :step="stepFor('meters')"
        @open-notes="openNotesModal"
        @validate-step="validateStep"
        @invalidate-step="invalidateStep"
        @add-meter="showAddMeterModal = true"
      />

      <!-- 5. Régulation thermique automatique (R175-6) -->
      <ThermalSection
        v-if="isBacs"
        :thermal-filtered="thermalFiltered"
        :regulation-options="REGULATION_OPTIONS"
        :generator-options="GENERATOR_OPTIONS"
        :generator-devices-for-zone-category="generatorDevicesForZoneCategory"
        :step="stepFor('thermal')"
        @validate-step="validateStep"
        @invalidate-step="invalidateStep"
      />

      <!-- 6. Solution GTB / GTC en place (R175-3 / R175-4 / R175-5) -->
      <BmsSection
        :bms-steps="bmsSteps"
        :devices-with-meta="devicesWithMeta"
        :meters-present="metersPresent"
        :system-labels="SYSTEM_LABEL"
        :protocol-options="PROTOCOL_OPTIONS"
        :step="stepFor('bms')"
        @open-notes="openNotesModal"
        @validate-step="validateStep"
        @invalidate-step="invalidateStep"
        @save-doc="saveDocDebounced"
        @refresh-audit-data="refreshAuditData"
      />

      <!-- 7. Inspection périodique par un tiers (R175-5-1) -->
      <InspectionsSection v-if="isBacs" />

      <!-- 9. Documents du site (DOE) -->
      <DocumentsSection
        :site-doc-counts="siteDocCounts"
        :step="stepFor('documents')"
        @validate-step="validateStep"
        @invalidate-step="invalidateStep"
      />

      <!-- 10. Credentials du site (accès) -->
      <CredentialsSection
        :site-cred-count="siteCredCount"
        :step="stepFor('credentials')"
        @validate-step="validateStep"
        @invalidate-step="invalidateStep"
      />

      <!-- Plan de mise en conformité — masqué en mode site_audit -->
      <CompliancePlanSection
        v-if="isBacs"
        :visible-action-items="visibleActionItems"
        :items-by-severity="itemsBySeverity"
        :resolved-count="resolvedCount"
        :step="stepFor('review')"
        :severity-labels="SEVERITY_LABEL"
        :status-labels="STATUS_LABEL"
        @regenerate="regenerate"
        @open-commercial="router.push(`/bacs-audit/${docId}/action-items`)"
        @validate-step="validateStep"
        @invalidate-step="invalidateStep"
        @patch-item="({ item, patch }) => patchActionItem(item, patch)"
        @open-alternatives="openAlternativesEditor"
      />

      <!-- 12. Note de synthèse (Claude) -->
      <SynthesisSection
        :synthesis-html="synthesisHtml"
        :synthesis-generating="synthesisGenerating"
        :generated-at="document?.audit_synthesis_generated_at"
        :claude-usage="claudeUsage"
        :step="stepFor('synthesis')"
        :usage-tooltip="formatUsageTooltip(claudeUsage)"
        @generate="generateSynthesis"
        @update:synthesis-html="onSynthesisInput"
        @validate-step="validateStep"
        @invalidate-step="invalidateStep"
      />
      </div><!-- /colonne principale -->
    </div>

    <!-- Panneau d'activité (slide-out à droite, identique à AfDetailView) -->
    <Teleport to="body">
      <transition name="slide">
        <aside
          v-if="showActivity"
          class="fixed right-3 top-3 bottom-3 w-80 z-50 bg-white border border-gray-200 rounded-lg shadow-2xl flex flex-col overflow-hidden"
        >
          <ActivityPanel
            ref="activityRef"
            :af-id="docId"
            :kind="document?.kind || 'bacs_audit'"
            closable
            @close="showActivity = false"
          />
        </aside>
      </transition>
      <div
        v-if="showActivity"
        class="fixed inset-0 bg-black/30 z-40"
        @click="showActivity = false"
      ></div>
    </Teleport>

    <!-- Modale d'edition de notes (zones, systemes, compteurs, GTB, devices) -->
    <NotesEditorModal
      :open="notesModal.open"
      :title="notesModal.title"
      :context-label="notesModal.contextLabel"
      v-model="notesModal.html"
      :assist-context="notesModal.assistContext"
      @close="notesModal.open = false"
      @save="saveNotesModal"
    />

    <!-- Modales d'ajout -->
    <AddZoneModal
      v-if="showAddZoneModal"
      :zone-natures="ZONE_NATURES"
      @close="showAddZoneModal = false"
      @submit="addZone"
    />
    <AddMeterModal
      v-if="showAddMeterModal"
      :zones="zones"
      :usages="METER_USAGES"
      :types="METER_TYPES"
      @close="showAddMeterModal = false"
      @submit="addMeter"
    />
    <AddDeviceModal
      v-if="addDeviceModalSystem"
      :system-label="SYSTEM_LABEL[addDeviceModalSystem.system_category] || addDeviceModalSystem.system_category"
      :zone-name="addDeviceModalSystem.zone_name || ''"
      :energy-options="ENERGY_OPTIONS"
      :role-options="ROLE_OPTIONS"
      :comm-options="COMM_OPTIONS"
      @close="addDeviceModalSystem = null"
      @submit="submitAddDevice"
    />

    <BulkPhotoUploadModal
      :open="bulkUploadOpen"
      :site-uuid="document?.site_uuid || ''"
      :zones="zones"
      :systems="systems"
      :devices="devices"
      :meters="meters"
      @close="closeBulkUpload"
      @uploaded="onBulkUploaded"
    />

    <TranscriptAssistantModal
      :open="transcriptOpen"
      :document-id="docId"
      @close="closeTranscript"
      @applied="onSuggestionApplied"
    />
  </div>
</template>

<style scoped>
.slide-enter-active, .slide-leave-active { transition: transform 200ms ease; }
.slide-enter-from, .slide-leave-to { transform: translateX(110%); }
</style>
