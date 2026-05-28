<script setup>
import { ref, computed, onMounted, watch, defineAsyncComponent } from 'vue'
import { storeToRefs } from 'pinia'
import { useRouter, useRoute } from 'vue-router'
import {
  ArrowLeftIcon, BuildingOffice2Icon, MapPinIcon, ExclamationTriangleIcon,
  CheckCircleIcon, ArrowPathIcon, DocumentArrowDownIcon, ClipboardDocumentListIcon, PhotoIcon, PlusIcon, TrashIcon,
  WrenchScrewdriverIcon, BoltIcon, FireIcon, PencilSquareIcon,
  DocumentDuplicateIcon,
  ChevronDoubleUpIcon, ChevronDoubleDownIcon, ChevronUpIcon, ChevronDownIcon,
  ClockIcon, EyeIcon, TableCellsIcon, EllipsisHorizontalIcon,
} from '@heroicons/vue/24/outline'
import {
  getAf, updateAf, getSite,
  getBacsSystems, updateBacsSystem,
  getBacsMeters, createBacsMeter, updateBacsMeter, deleteBacsMeter,
  getBacsBms, updateBacsBms,
  getBacsThermal, updateBacsThermal,
  getBacsActionItems, regenerateBacsActionItems, updateBacsActionItem,
  getBacsActionItemsCsvUrl, exportBacsPdf, exportBacsTablesPdf, exportBacsChecklistPdf, deliverBacsAudit,
  getBacsPowerCumul, resyncBacsAudit,
  listZones, createZone, updateZone, deleteZone, setZoneParties,
  getBacsDevices, getBacsPowerSummary, updateBacsDevice,
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
import BacsAuditStepperHorizontal from '@/components/BacsAuditStepperHorizontal.vue'
import StepValidateBadge from '@/components/StepValidateBadge.vue'
import RichTextEditor from '@/components/RichTextEditor.vue'
import CollapsibleSection from '@/components/CollapsibleSection.vue'
import Button from '@/components/Button.vue'
import SystemCategoryIcon from '@/components/SystemCategoryIcon.vue'
import MeterTypePill from '@/components/MeterTypePill.vue'
import MeterUsagePill from '@/components/MeterUsagePill.vue'
import AddZoneModal from '@/components/AddZoneModal.vue'
import AddMeterModal from '@/components/AddMeterModal.vue'
import BulkPhotoUploadModal from '@/components/BulkPhotoUploadModal.vue'
import TranscriptAssistantModal from '@/components/TranscriptAssistantModal.vue'
import EditAuditMetadataModal from '@/components/EditAuditMetadataModal.vue'
import EditSiteModal from '@/components/EditSiteModal.vue'
// Sections lourdes : lazy-loaded pour réduire le bundle initial du
// chemin /bacs-audit/:id. Pattern repris de AfDetailView (PR #52).
// Le tree est paint avant que ces composants chargent (~30 % de gain
// sur le mount initial perçu).
const ChecklistSection = defineAsyncComponent(() => import('@/components/audit/ChecklistSection.vue'))
import PdfPreviewModal from '@/components/PdfPreviewModal.vue'
import SafeHtml from '@/components/SafeHtml.vue'
const InspectionsSection = defineAsyncComponent(() => import('@/components/audit/InspectionsSection.vue'))
const CompliancePlanSection = defineAsyncComponent(() => import('@/components/audit/CompliancePlanSection.vue'))
const SynthesisSection = defineAsyncComponent(() => import('@/components/audit/SynthesisSection.vue'))
const BmsSection = defineAsyncComponent(() => import('@/components/audit/BmsSection.vue'))
import ThermalSection from '@/components/audit/ThermalSection.vue'
import MetersSection from '@/components/audit/MetersSection.vue'
import SystemsSection from '@/components/audit/SystemsSection.vue'
import DocumentsSection from '@/components/audit/DocumentsSection.vue'
import CredentialsSection from '@/components/audit/CredentialsSection.vue'
import IdentificationSection from '@/components/audit/IdentificationSection.vue'
import ZonesSection from '@/components/audit/ZonesSection.vue'
import { useAuditStore } from '@/stores/audit'
import { useAuditAutoSync } from '@/composables/useAuditAutoSync'
import { useGlobalSaveStatus } from '@/composables/useGlobalSaveStatus'
import { useViewport } from '@/composables/useViewport'
import MobileAuditNav from '@/components/MobileAuditNav.vue'
import OpenOnPhoneButton from '@/components/OpenOnPhoneButton.vue'
import ShareAfModal from '@/components/ShareAfModal.vue'
import { UserPlusIcon, Cog6ToothIcon } from '@heroicons/vue/24/outline'

const auditStore = useAuditStore()
// Sync desktop ↔ PWA : revalide à chaque retour sur l'onglet + polling
// 30 s tant que la page est visible. Évite à un binôme (auditeur PWA
// terrain + chef de projet bureau) de devoir F5 pour voir les modifs.
// Sync agressif aussi côté desktop : si l'auditeur PWA crée/modifie une
// entité depuis le terrain, le chef de projet desktop la voit dans
// les 5 secondes sans F5.
useAuditAutoSync({ intervalMs: 5000 })
// Indicateur global de sauvegarde dans la toolbar (Vague 2 item 6).
const saveStatus = useGlobalSaveStatus()
const { isNarrow } = useViewport()
const showShare = ref(false)
const showEditMetadata = ref(false)
const showEditSite = ref(false)

async function onMetadataSaved(updated) {
  showEditMetadata.value = false
  // Si le kind a changé, rediriger vers la bonne URL canonique pour rester
  // cohérent avec le router (BacsAuditDetailView est branché sur les 2 kinds
  // mais l'URL doit refléter le type courant pour les liens directs).
  const oldKind = document.value?.kind
  const newKind = updated.kind
  document.value = updated
  if (oldKind && oldKind !== newKind) {
    const target = newKind === 'bacs_audit' ? `/bacs-audit/${docId}` : `/site-audit/${docId}`
    if (router.currentRoute.value.path !== target) router.replace(target)
  }
  // Le client_name / project_name peuvent influencer l'audit (en-tête),
  // pas besoin de full reload — document.value mis à jour suffit.
}
const showSettingsMenu = ref(false)
const settingsMenuRef = ref(null)

// Click-away pour fermer le menu engrenage
function onDocClickSettings(e) {
  if (!showSettingsMenu.value) return
  if (settingsMenuRef.value && !settingsMenuRef.value.contains(e.target)) {
    showSettingsMenu.value = false
  }
}

async function deleteAudit() {
  const ok = await confirm({
    title: `Supprimer « ${document.value?.project_name || 'cet audit'} » ?`,
    message: 'Action irréversible. Toutes les données saisies (zones, compteurs, systèmes, photos) seront perdues.',
    confirmLabel: 'Supprimer',
    danger: true,
  })
  if (!ok) return
  try {
    const { deleteAf } = await import('@/api')
    await deleteAf(docId)
    success('Audit supprimé')
    router.push('/')
  } catch (e) {
    error(e.response?.data?.detail || 'Suppression impossible')
  }
}
import DeviceAddModal from '@/components/DeviceAddModal.vue'
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
  zones, devices, inspections, powerSummary,
  loading,
} = storeToRefs(auditStore)
// site garde sa nature locale (pas charge par le store, valeur calculee
// depuis le document.site_id si besoin).
const site = ref(null)

// Toggle pour afficher les usages marques 'non concerne' dans la card
// systemes. Persistance localStorage. Par defaut tout est visible (les
// non concernes sont masques uniquement si le flag est explicitement
// pose par l'auditeur).
const showAddZoneModal = ref(false)
const showAddMeterModal = ref(false)
// Préfill de la modale création compteur quand l'auditeur clique sur une
// cellule vide de la matrice « Plan de comptage » ou sur le bouton
// « + Ajouter un compteur <énergie> » d'une section. Forme : { zone_id?, meter_type?, usage? }
const meterAddPrefill = ref(null)
function openMeterAddModal(prefill) {
  meterAddPrefill.value = prefill && typeof prefill === 'object' ? prefill : null
  showAddMeterModal.value = true
}
const addDeviceSystem = ref(null) // { id, system_category, zone_name } — modale d'ajout d'équipement à 2 onglets

// Options pour AddDeviceModal (memes que SystemDevicesTable.vue)
// Catalogues d'options partagés (BACS audit) avec icônes + couleurs pour
// SearchableSelect. Source de vérité unique : `lib/audit-options.js`.
import { ENERGY_OPTIONS, ROLE_OPTIONS, COMM_OPTIONS, ZONE_NATURES, isDeviceComplete } from '@/lib/audit-options'

const showNotConcernedSystems = ref(localStorage.getItem('bacs-show-not-concerned') === '1')
watch(showNotConcernedSystems, v => localStorage.setItem('bacs-show-not-concerned', v ? '1' : '0'))
const hiddenNotConcernedCount = computed(() =>
  systems.value.filter(s => s.not_concerned).length
)

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
  blocking: { label: 'Bloquante', cls: 'sev-blocking' },
  major: { label: 'Majeure', cls: 'sev-major' },
  minor: { label: 'Mineure', cls: 'sev-minor' },
}
const STATUS_LABEL = {
  open: 'Ouverte',
  quoted: 'Chiffrée',
  in_progress: 'En cours',
  done: 'Terminée',
  declined: 'Non retenue',
}

// Card 4 : on liste TOUTES les zones (fonctionnelles ET techniques),
// y compris celles sans aucun usage encore — c'est là qu'on ajoute des
// usages manuels. Les zones techniques sont ainsi visibles et éditables.
const systemsByZone = computed(() => {
  const byZone = new Map()
  for (const s of systems.value) {
    if (!byZone.has(s.zone_id)) byZone.set(s.zone_id, [])
    byZone.get(s.zone_id).push(s)
  }
  const groups = []
  const seen = new Set()
  for (const z of (zones.value || [])) {
    seen.add(z.zone_id)
    groups.push({
      zone_id: z.zone_id, zone_name: z.name, zone_nature: z.nature,
      zone_kind: z.kind || 'functional', items: byZone.get(z.zone_id) || [],
    })
  }
  // Zones présentes via leurs systèmes mais absentes du store (audit sans
  // site rattaché) : on les conserve pour ne rien masquer.
  for (const [zid, items] of byZone) {
    if (seen.has(zid)) continue
    groups.push({
      zone_id: zid, zone_name: items[0]?.zone_name, zone_nature: items[0]?.zone_nature,
      zone_kind: 'functional', items,
    })
  }
  return groups
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
    // Auto-heal : si l'audit a des zones mais aucune ligne system / thermal
    // (cas des audits créés pendant la régression de cascade — le require
    // resyncBacsAuditWithSiteZones manquait dans bacs-audit.js, fix f5c1baa),
    // on déclenche un resync silencieux pour repeupler la card 03.
    if (zones.value.length > 0 && systems.value.length === 0) {
      try {
        const r = await resyncBacsAudit(docId)
        if (r?.data?.systems_count > 0) {
          await refreshAuditData()
          success(`Plan d'audit synchronisé (${r.data.systems_count} système${r.data.systems_count > 1 ? 's' : ''} ajouté${r.data.systems_count > 1 ? 's' : ''})`)
        }
      } catch { /* ignore — le user peut declencher manuellement via le bouton */ }
    }
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
// Inclut aussi les devices partagés depuis un autre usage via
// bacs_audit_device_shared_systems (mig 143).
function generatorDevicesForZoneCategory(zoneId, category) {
  const sysIds = new Set(systems.value
    .filter(s => s.zone_id === zoneId && s.present && s.system_category === category)
    .map(s => s.id))
  return devices.value.filter(d =>
    sysIds.has(d.system_id) ||
    (Array.isArray(d.extra_system_ids) && d.extra_system_ids.some(sid => sysIds.has(sid)))
  )
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

// Type de zone pré-rempli pour la modale d'ajout (selon la card cliquée :
// « Zones fonctionnelles » -> functional, « Zones techniques » -> technical).
const addZoneKind = ref('functional')

// Émis par ZonesSection : { kind } seul = ouvrir la modale, payload avec
// `name` = création directe (duplication).
function onAddZoneRequest(payload) {
  if (payload?.name) { addZone(payload); return }
  addZoneKind.value = payload?.kind || 'functional'
  showAddZoneModal.value = true
}

async function addZone(payload) {
  const data = payload || newZone.value
  if (!data.name?.trim() || !document.value?.site_id) return
  try {
    const created = await createZone({
      site_id: document.value.site_id,
      name: data.name.trim(),
      nature: data.nature,
      kind: data.kind || 'functional',
      surface_m2: data.surface_m2 ?? null,
      latitude: data.latitude ?? null,
      longitude: data.longitude ?? null,
      occupancy_profile: data.occupancy_profile ?? null,
      comfort_constraint: data.comfort_constraint ?? null,
    })
    // Item 5 — occupants choisis à la création de la zone.
    if (Array.isArray(data.party_ids) && data.party_ids.length && created.data?.zone_id) {
      try {
        await setZoneParties(created.data.zone_id, data.party_ids)
        // Met à jour les zones affectées des parties dans le store partagé.
        await auditStore.refreshSiteParties()
      } catch { /* non bloquant : la zone est créée, l'affectation pourra se refaire */ }
    }
    const z = await listZones(document.value.site_id)
    zones.value = z.data
    await resyncBacsAudit(docId)
    await refreshAuditData()
    newZone.value = { name: '', nature: null }
    success(data.kind === 'technical'
      ? 'Zone technique ajoutée'
      : 'Zone ajoutée et plan d\'audit synchronisé')
  } catch (e) {
    error(e.response?.data?.detail || 'Création zone impossible')
  }
}

// ── Stepper (9 etapes a valider manuellement) ──
const { auditProgress, synthesisHtml } = storeToRefs(auditStore)
const activeStepKey = ref(null)

// État replié/déplié du stepper, persisté localStorage. Permet de gagner
// ~150px de largeur sur la zone principale quand l'auditeur a validé sa
// progression et n'a plus besoin des labels.
const STEPPER_KEY = 'bacs-audit-stepper-collapsed'
const stepperCollapsed = ref(localStorage.getItem(STEPPER_KEY) === '1')
function toggleStepperCollapsed() {
  stepperCollapsed.value = !stepperCollapsed.value
  localStorage.setItem(STEPPER_KEY, stepperCollapsed.value ? '1' : '0')
}
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

// Chaque étape expose `incomplete()` → liste des raisons (texte court) qui
// empêchent sa validation. Liste vide = étape complète. Ces raisons sont
// affichées telles quelles à l'auditeur quand il tente de valider.
const STEP_DEFINITIONS = [
  { key: 'identification',
    label: 'Identification',
    description: 'Site et applicabilite R175-2 renseignes.',
    incomplete: () => {
      const r = []
      if (!site.value) r.push("le site n'est pas rattaché")
      if (!document.value?.bacs_applicability_status) {
        r.push("l'applicabilité R175-2 n'est pas déterminée (puissance chauffage + climatisation et date de permis à renseigner)")
      }
      return r
    } },
  { key: 'zones',
    label: 'Zones',
    description: 'Au moins une zone fonctionnelle saisie. Les locaux techniques (hors décret BACS) sont inventoriés dans la même carte mais ne sont pas exigés pour la validation.',
    incomplete: () => (zones.value.some(z => (z.kind || 'functional') !== 'technical')
      ? [] : ["aucune zone fonctionnelle n'a été saisie"]) },
  { key: 'systems',
    label: 'Systèmes',
    description: 'Chaque équipement des systèmes présents doit être complètement renseigné.',
    incomplete: () => {
      const presentIds = new Set(systems.value.filter(s => s.present).map(s => s.id))
      const auditedDevices = devices.value.filter(d => presentIds.has(d.system_id))
      if (!auditedDevices.length) return ["aucun équipement n'est saisi sur les usages marqués présents"]
      const catById = {}
      for (const s of systems.value) catById[s.id] = s.system_category
      const ko = auditedDevices.filter(d => !isDeviceComplete(d, catById[d.system_id]))
      if (!ko.length) return []
      return [ko.length === 1
        ? '1 équipement incomplet — repérable à son bouton « Modifier » rouge'
        : `${ko.length} équipements incomplets — repérables à leur bouton « Modifier » rouge`]
    } },
  { key: 'meters',
    label: 'Compteurs',
    description: 'Compteurs requis revus (presents/absents/HS coches).',
    incomplete: () => {
      if (!meters.value.length) return ["aucun compteur n'est listé"]
      if (!meters.value.some(m => m.present_actual !== null)) {
        return ["aucun compteur n'a été pointé présent ou absent"]
      }
      return []
    } },
  { key: 'thermal',
    label: 'Régulation',
    description: 'R175-6 renseignee pour chaque zone chauffee/climatisee.',
    incomplete: () => (thermal.value.length > 0
      ? [] : ["aucune régulation thermique R175-6 n'a été saisie"]) },
  // GTB : complète si « Pas de GTB » répondu, ou GTB présente + solution saisie.
  { key: 'bms',
    label: 'GTB',
    description: 'Solution GTB + capacites R175-3 + maintenance + formation.',
    incomplete: () => {
      if (bms.value?.present == null) return ["indiquez d'abord si une GTB est présente sur le site"]
      if (bms.value?.present === 1 && !bms.value?.existing_solution) {
        return ['la solution GTB en place n\'est pas renseignée']
      }
      return []
    } },
  { key: 'inspections',
    label: 'Inspections',
    description: 'R175-5-1 : inspection periodique par un tiers (rapport conserve 10 ans).',
    incomplete: () => {
      // Mig 187 — case « Aucune inspection à déclarer » bypass la validation.
      const na = document.value?.inspection_not_applicable
      if (na === 1 || na === true) return []
      return (inspections.value.length > 0 && !!inspections.value[0].last_inspection_date)
        ? [] : ["la date de la dernière inspection périodique R175-5-1 n'est pas renseignée OU coche « Aucune inspection à déclarer » si le site n'y est pas soumis"]
    } },
  { key: 'docs-checklist',
    label: 'Check-list',
    description: 'Plans, schémas, synoptique GTB, IP, AF GTB, contacts locataires + photos de chaque zone/système/compteur/GTB.',
    incomplete: () => {
      const r = []
      if (!checklistAllHandled.value) r.push('des éléments de la check-list documentaire sont encore en attente')
      if (!photoCoverageComplete.value) r.push("des zones, systèmes, compteurs ou la GTB n'ont pas encore de photo")
      return r
    } },
  { key: 'documents',
    label: 'Documents',
    description: 'Plans, schemas, datasheets et manuels deposes.',
    incomplete: () => (siteDocCounts.value.doe > 0
      ? [] : ["aucun document (plan, schéma, datasheet, manuel) n'a été déposé"]) },
  { key: 'credentials',
    label: 'Credentials',
    description: 'Acces web/SSH/VPN aux GTB et systemes renseignes.',
    incomplete: () => (siteCredCount.value > 0
      ? [] : ["aucun accès (web, SSH, VPN) n'a été renseigné"]) },
  { key: 'review',
    label: 'Plan',
    description: 'Plan de mise en conformite relu et annote commercialement.',
    // Le plan n'a plus de champ par action à renseigner : sign-off manuel.
    incomplete: () => [] },
  { key: 'synthesis',
    label: 'Synthèse',
    description: 'Note de synthese redigee (manuellement ou via Claude).',
    incomplete: () => ((document.value?.audit_synthesis_html || '').replace(/<[^>]*>/g, '').trim()
      ? [] : ['la note de synthèse est vide']) },
]

function stepFor(key) {
  return stepperSteps.value.find(s => s.key === key)
}

// État de complétion de la check-list (mig 100). Recharge à chaque mount
// + à la demande depuis ChecklistSection (event @refreshed).
const checklistAllHandled = ref(false)
const photoCoverageComplete = ref(false)
const checklistSectionRef = ref(null)
async function refreshChecklistStatus() {
  try {
    const { getBacsChecklist, getBacsPhotoCoverage } = await import('@/api')
    const [c, cov] = await Promise.all([
      getBacsChecklist(docId),
      getBacsPhotoCoverage(docId),
    ])
    checklistAllHandled.value = c.data.length > 0 && c.data.every(i => i.status !== 'pending')
    const total = cov.data.zones.total + cov.data.systems.total + cov.data.meters.total + cov.data.bms.total
    const covered = cov.data.zones.covered + cov.data.systems.covered + cov.data.meters.covered + cov.data.bms.covered
    photoCoverageComplete.value = total > 0 && covered === total
  } catch { /* silencieux */ }
}
onMounted(refreshChecklistStatus)

// Navigation depuis le bloc « Couverture photo » : scroller vers la zone
// concernée (les autres entités sont enfouies dans la card systèmes,
// donc on scroll juste vers la card racine pour l'instant).
function gotoChecklistZone(zoneId) {
  const el = document.querySelector(`[data-zone-id="${zoneId}"]`) || document.getElementById('zones')
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
function gotoChecklistSystem(systemId) {
  const el = document.querySelector(`[data-system-id="${systemId}"]`) || document.getElementById('systems')
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
function gotoChecklistMeter(meterId) {
  const el = document.querySelector(`[data-meter-id="${meterId}"]`) || document.getElementById('meters')
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
function gotoChecklistBms() {
  const el = document.getElementById('bms')
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

// Steps cachés en mode site_audit (purement R175) : régulation thermique
// (R175-6) et plan de mise en conformité (R175 entier).
const STEPS_BACS_ONLY = new Set(['thermal', 'inspections', 'review'])
const stepperSteps = computed(() => STEP_DEFINITIONS
  .filter(def => isBacs.value || !STEPS_BACS_ONLY.has(def.key))
  // Sans GTB sur site, l'inspection périodique R175-5-1 n'a pas lieu d'être.
  .filter(def => !(def.key === 'inspections' && bms.value?.present === 0))
  .map(def => {
    const p = auditProgress.value?.[def.key] || {}
    const reasons = def.incomplete ? def.incomplete() : []
    return {
      key: def.key,
      label: def.label,
      description: isBacs.value ? def.description : (def.descriptionSite || def.description.replace(/R175-?[0-9]?\s*(§\s*[0-9]|[0-9]°)?/g, '').replace(/\s+/g, ' ').trim()),
      complete: reasons.length === 0,
      incompleteReasons: reasons,
      validated: !!p.validated,
      validated_at: p.validated_at || null,
      validated_by_name: p.validated_by_name || null,
    }
  }))

async function validateStep(stepKey) {
  // Garde : on ne valide pas une étape dont les infos essentielles manquent.
  // On affiche précisément ce qui bloque (raisons portées par chaque étape).
  const step = stepFor(stepKey)
  if (!step?.complete) {
    const reasons = step?.incompleteReasons || []
    error(reasons.length
      ? `Étape « ${step.label} » non validable — ${reasons.join(' ; ')}`
      : 'Complétez l\'étape avant de la valider.')
    return
  }
  try {
    const { data } = await validateBacsAuditStep(docId, stepKey, true)
    auditProgress.value = data.audit_progress || {}
    success(`Etape "${STEP_DEFINITIONS.find(s => s.key === stepKey)?.label}" validee`)
  } catch (e) {
    error(e.response?.data?.detail || 'Validation impossible')
  }
}

async function invalidateStep(stepKey) {
  const reason = window.prompt(
    `Raison de l'invalidation de l'étape "${STEP_DEFINITIONS.find(s => s.key === stepKey)?.label}" (optionnel) :`,
  )
  if (reason === null) return
  try {
    const { data } = await validateBacsAuditStep(docId, stepKey, false, reason.trim() || null)
    auditProgress.value = data.audit_progress || {}
  } catch (e) {
    error(e.response?.data?.detail || 'Annulation impossible')
  }
}

// Mapping bidirectionnel step ↔ id DOM, utilise par onStepClick (click
// stepper -> scroll) et par le scroll-spy (scroll page -> highlight stepper).
const STEP_TO_SECTION_ID = {
  identification: 'section-identification',
  zones: 'section-zones',
  systems: 'section-systems',
  meters: 'section-meters',
  thermal: 'section-thermal',
  bms: 'section-bms',
  inspections: 'section-inspections',
  'docs-checklist': 'section-docs-checklist',
  documents: 'section-documents',
  credentials: 'section-credentials',
  review: 'section-review',
  synthesis: 'section-synthesis',
}
const SECTION_ID_TO_STEP = Object.fromEntries(
  Object.entries(STEP_TO_SECTION_ID).map(([k, v]) => [v, k])
)

// Scroll JS animé : durée fixe ~280 ms avec easing easeOutCubic. Plus
// réactif que le `behavior: 'smooth'` natif qui peut prendre 1-2 s sur
// les longues distances (audit BACS = ~10 sections sur ~30 écrans).
function fastScrollTo(targetY) {
  const startY = window.scrollY
  const dist = targetY - startY
  if (Math.abs(dist) < 4) { window.scrollTo(0, targetY); return }
  const duration = Math.min(450, Math.max(200, Math.abs(dist) * 0.35))
  const t0 = performance.now()
  function step(now) {
    const t = Math.min(1, (now - t0) / duration)
    const eased = 1 - Math.pow(1 - t, 3) // easeOutCubic
    window.scrollTo(0, startY + dist * eased)
    if (t < 1) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

function onStepClick(key) {
  activeStepKey.value = key
  const targetId = STEP_TO_SECTION_ID[key]
  if (!targetId) return
  const el = window.document.getElementById(targetId)
  if (!el) return
  // Compense la hauteur du header sticky pour que le titre de la section
  // n'apparaisse pas masqué dessous. On lit la hauteur courante du wrapper
  // (peut être plein ou compact selon le scroll actuel).
  const header = window.document.querySelector('.audit-sticky-header')
  const headerH = header ? header.getBoundingClientRect().height : 0
  const y = el.getBoundingClientRect().top + window.scrollY - headerH - 12
  fastScrollTo(y)
}

// Scroll-spy : promote la section dont le titre se trouve juste sous le
// header sticky comme step actif. On observe l'ensemble des sections puis
// on choisit, à chaque tick, celle dont le `top` est positif et le plus
// proche du bas du header (= la section "en cours de lecture"). Si aucune
// n'est sous le header, on prend la dernière section dont le top est
// négatif (celle qui couvre encore l'écran).
let _spyObserver = null
function pickActiveSection() {
  const header = window.document.querySelector('.audit-sticky-header')
  const headerH = header ? header.getBoundingClientRect().height : 0
  const sections = Object.values(STEP_TO_SECTION_ID)
    .map(id => ({ id, el: window.document.getElementById(id) }))
    .filter(s => s.el)
  if (!sections.length) return
  const measured = sections.map(s => ({ id: s.id, top: s.el.getBoundingClientRect().top }))
  // Sections qui ont leur titre sous le header (top >= headerH - quelques px)
  // = candidates principales, on prend la plus haute.
  const belowHeader = measured.filter(s => s.top >= headerH - 8)
  let chosen = null
  if (belowHeader.length) {
    chosen = belowHeader.sort((a, b) => a.top - b.top)[0]
  } else {
    // Toutes les sections ont leur top au-dessus du header (= on est dans
    // la dernière). On prend celle dont le top négatif est le plus proche
    // de 0 = la plus récente que l'on a dépassée.
    chosen = measured.sort((a, b) => b.top - a.top)[0]
  }
  if (chosen) activeStepKey.value = SECTION_ID_TO_STEP[chosen.id] || activeStepKey.value
}
function setupScrollSpy() {
  if (_spyObserver) _spyObserver.disconnect()
  const sections = Object.values(STEP_TO_SECTION_ID)
    .map(id => window.document.getElementById(id))
    .filter(Boolean)
  if (!sections.length) return
  _spyObserver = new IntersectionObserver(pickActiveSection, {
    rootMargin: '0px 0px -60% 0px',
    threshold: [0, 0.1, 0.5, 1],
  })
  sections.forEach(s => _spyObserver.observe(s))
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
    } catch (e) {
      error(e.response?.data?.detail || 'Sauvegarde synthèse impossible')
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
  // Champ DB où sauver le HTML. Par défaut `notes_html`, mais peut être
  // surchargé pour cibler un champ spécifique (ex. `production_notes_html`
  // sur la régulation thermique pour la note d'un niveau précis).
  noteField: 'notes_html',
  // Contexte transmis a Claude
  assistContext: null,
})

function openNotesModal({ title, contextLabel, entityType, entityRef, currentHtml, noteField }) {
  notesModal.value = {
    open: true,
    title,
    contextLabel,
    html: currentHtml || '',
    entityType,
    entityRef,
    noteField: noteField || 'notes_html',
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
  const field = m.noteField || 'notes_html'
  const payload = { [field]: html || null }
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
    } else if (m.entityType === 'bms_topic') {
      // Note libre par sujet de la carte GTB (mig 109). On passe par le
      // store pour mettre à jour gtbTopicNotes en place (pastille « Note »
      // sur le bouton se met à jour sans refresh).
      await auditStore.saveGtbTopicNote(m.entityRef.topic_key, html)
    } else if (m.entityType === 'device') {
      const { data } = await updateBacsDevice(m.entityRef.id, payload)
      Object.assign(m.entityRef, data)
    } else if (m.entityType === 'thermal') {
      // Couvre notes globales (notes_html) + notes par niveau
      // (production_notes_html, distribution_notes_html, emission_notes_html)
      // via le `noteField` transmis par ThermalSection.
      const { data } = await updateBacsThermal(m.entityRef.id, payload)
      Object.assign(m.entityRef, data)
    } else if (m.entityType === 'action_item_alternatives') {
      const { data } = await updateBacsActionItem(m.entityRef.id, { alternative_solutions_html: html || null })
      Object.assign(m.entityRef, data)
    } else if (m.entityType === 'site_ownership') {
      // Particularités de la structure juridique : champ `ownership_notes`
      // de la table `sites` (propagé à FM via le sync existant).
      await auditStore.updateSiteFields({ [field]: html || null })
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
  subject_immediate: { label: 'Soumis (immédiat)', cls: 'sev-blocking' },
  subject_2025: { label: 'Soumis — échéance 1er janvier 2025', cls: 'sev-major' },
  subject_2030: { label: 'Soumis — échéance 1er janvier 2030', cls: 'sev-minor' },
  not_subject: { label: 'Non assujetti (puissance < 70 kW)', cls: 'tone-success' },
}

let docSaveTimer = null
function saveDocDebounced(patch) {
  Object.assign(document.value, patch)
  clearTimeout(docSaveTimer)
  docSaveTimer = setTimeout(async () => {
    try {
      const { data } = await updateAf(docId, patch)
      document.value = data
    } catch (e) {
      error(e.response?.data?.detail || 'Sauvegarde impossible')
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
  } catch (e) {
    error(e.response?.data?.detail || 'Calcul de puissance impossible')
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
    } catch (e) {
      error(e.response?.data?.detail || 'Sauvegarde GTB impossible')
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
  } catch (e) {
    error(e.response?.data?.detail || 'Sauvegarde action impossible')
  }
}

const regenerating = ref(false)
async function regenerate() {
  if (regenerating.value) return
  regenerating.value = true
  try {
    // Resync : ajoute les rows manquantes (systems / thermal) si la matrice
    // nature_zone a evolue ou si des zones ont ete ajoutees au site
    await resyncBacsAudit(docId)
    const { data } = await regenerateBacsActionItems(docId)
    success(`Régénération : +${data.added} nouvelles, ${data.updated} synchronisées, ${data.resolved} résolues`)
    await refreshAuditData()
  } catch (e) {
    error(e.response?.data?.detail || 'Régénération impossible')
  } finally {
    regenerating.value = false
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

// Export PDF tableaux de synthèse (A3 paysage, 4 grands tableaux denses
// destinés à l'intégrateur pour bâtir le devis).
const exportingTables = ref(false)
async function exportTablesPdf() {
  exportingTables.value = true
  try {
    const { data } = await exportBacsTablesPdf(docId)
    success(`Tableaux de synthèse générés (${(data.file_size_bytes / 1024).toFixed(0)} Ko)`)
    window.location.href = data.download_url
  } catch (e) {
    error(e.response?.data?.detail || 'Échec de l\'export tableaux')
  } finally {
    exportingTables.value = false
  }
}

// Aperçu HTML in-browser (sans Puppeteer) — permet de valider visuellement
// le contenu avant de declencher l'export PDF qui prend ~3-5s.
const previewOpen = ref(false)
const previewUrl = computed(() => `/api/bacs-audit/${docId}/preview`)
function openPreview() { previewOpen.value = true }
function closePreview() { previewOpen.value = false }

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
  // Met à jour --audit-sticky-offset (CSS var globale) avec la hauteur du
  // header sticky audit, pour que les card headers internes (sticky aussi)
  // se calent juste en-dessous au scroll. Compact mode change la hauteur,
  // d'où ResizeObserver pour rester synchronisé.
  nextTick(() => {
    const el = window.document.querySelector('.audit-sticky-header')
    if (!el) return
    const apply = () => {
      const h = Math.round(el.getBoundingClientRect().height)
      window.document.documentElement.style.setProperty('--audit-sticky-offset', `${h}px`)
    }
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    // Stocke pour cleanup
    _stickyOffsetObserver = ro
  })
})
let _stickyOffsetObserver = null

import { onBeforeUnmount, nextTick } from 'vue'

// Active le scroll-spy une fois que les sections sont rendues dans
// le DOM (apres loadAudit qui passe loading=false).
watch(loading, async (isLoading) => {
  if (!isLoading) {
    await nextTick()
    setupScrollSpy()
    // Re-bind l'observer de la hauteur du header sticky une fois que le
    // DOM est monté (sinon querySelector peut renvoyer null au 1er mount).
    setupStickyOffsetObserver()
  }
})
function setupStickyOffsetObserver() {
  const el = window.document.querySelector('.audit-sticky-header')
  if (!el) return
  if (_stickyOffsetObserver) _stickyOffsetObserver.disconnect()
  let lastH = -1
  const apply = () => {
    // Overlap 1px : on positionne les card headers juste UNDER (cachés
    // derrière) le bord bas du header global pour masquer toute couture
    // sub-pixel (le bg-white/95 + backdrop-blur du header global laisse
    // sinon transparaître le contenu défilant dans cette fine bande).
    const h = Math.round(el.getBoundingClientRect().height) - 1
    if (h !== lastH) {
      lastH = h
      window.document.documentElement.style.setProperty('--audit-sticky-offset', `${h}px`)
    }
  }
  apply()
  _stickyOffsetObserver = new ResizeObserver(apply)
  _stickyOffsetObserver.observe(el)
  // Backup : ResizeObserver ne catche pas toujours les transitions CSS
  // (animations sur padding / max-height qui changent la hauteur sans
  // déclencher ResizeObserver de manière fiable). Un listener scroll
  // rAF-throttlé garde la CSS var synchro.
  if (_stickyOffsetScrollHandler) window.removeEventListener('scroll', _stickyOffsetScrollHandler, { passive: true })
  let scheduled = false
  _stickyOffsetScrollHandler = () => {
    if (scheduled) return
    scheduled = true
    requestAnimationFrame(() => { scheduled = false; apply() })
  }
  window.addEventListener('scroll', _stickyOffsetScrollHandler, { passive: true })
}
let _stickyOffsetScrollHandler = null

onBeforeUnmount(() => {
  if (_spyObserver) { _spyObserver.disconnect(); _spyObserver = null }
  if (_stickyOffsetObserver) { _stickyOffsetObserver.disconnect(); _stickyOffsetObserver = null }
  if (_stickyOffsetScrollHandler) { window.removeEventListener('scroll', _stickyOffsetScrollHandler, { passive: true }); _stickyOffsetScrollHandler = null }
  window.document.documentElement.style.removeProperty('--audit-sticky-offset')
})

onMounted(() => window.document.addEventListener('mousedown', onDocClickSettings))
onBeforeUnmount(() => window.document.removeEventListener('mousedown', onDocClickSettings))

// ── Topbar compact au scroll ──────────────────────────────────────────
// Pattern « hide-on-scroll-down, show-on-scroll-up » avec hystérésis pour
// éviter les bascules nerveuses quand on scrolle finement autour du seuil :
//   - bascule en compact dès qu'on dépasse 120 px en descendant
//   - revient en plein dès qu'on remonte de 8 px (delta minimum) ou
//     qu'on est sous les 50 px
// Le scroll handler est throttle par requestAnimationFrame pour éviter
// d'overcaler le DOM à chaque pixel.
const isScrolledDown = ref(false)
let lastScrollY = 0
let scrollRaf = 0
function processScroll() {
  scrollRaf = 0
  const y = window.scrollY
  const delta = y - lastScrollY
  lastScrollY = y
  if (y < 50) { isScrolledDown.value = false; return }
  if (delta < -8) { isScrolledDown.value = false; return }      // remontée nette
  if (delta > 0 && y > 120) { isScrolledDown.value = true; return } // descente nette
}
function onScrollY() {
  if (scrollRaf) return
  scrollRaf = requestAnimationFrame(processScroll)
}
onMounted(() => {
  window.addEventListener('scroll', onScrollY, { passive: true })
  lastScrollY = window.scrollY
  processScroll()
})
onBeforeUnmount(() => {
  window.removeEventListener('scroll', onScrollY)
  if (scrollRaf) cancelAnimationFrame(scrollRaf)
})
</script>

<template>
  <div class="w-full mx-auto px-3 pb-12" :style="isNarrow ? { paddingBottom: 'calc(56px + env(safe-area-inset-bottom) + 1rem)' } : null">
    <!-- Bloc sticky desktop : breadcrumb + titre + actions + stepper.
         Reste visible en haut tout au long du scroll de l'audit. -->
    <div :class="['audit-sticky-header lg:sticky lg:top-0 lg:z-30 lg:bg-white/95 lg:backdrop-blur lg:-mx-3 lg:px-3 lg:border-b lg:border-gray-100 lg:mb-6 lg:transition-all',
                  isScrolledDown ? 'lg:pt-1.5 lg:pb-2 audit-topbar-compact' : 'lg:pt-3 lg:pb-3']">
    <!-- Header compact (1 ligne sur desktop, breadcrumbs + titre + actions) -->
    <div class="flex items-center justify-between gap-4 mb-3 flex-wrap">
      <div class="min-w-0 flex-1">
        <div class="audit-breadcrumb flex items-center gap-2 text-xs text-gray-500 mb-0.5 flex-wrap">
          <button @click="router.push('/')" class="hover:text-gray-700 inline-flex items-center gap-1">
            <ArrowLeftIcon class="w-3.5 h-3.5" /> Audits
          </button>
          <span>›</span>
          <span class="text-gray-400">{{ isBacs ? 'Audit BACS' : 'Audit GTB (Classique)' }}</span>
          <span v-if="document?.updated_by_name" class="text-gray-400">
            · édité par <strong class="font-medium text-gray-600">{{ document.updated_by_name }}</strong>
            <span v-if="document.updated_at" v-tooltip="document.updated_at"> il y a {{ relativeTime(document.updated_at) }}</span>
          </span>
          <span v-if="document?.delivered_at" class="ml-2 inline-flex items-center gap-1 text-emerald-700">
            ✓ Livré le {{ formatDate(document.delivered_at) }}
          </span>
        </div>
        <h1 class="audit-title text-lg font-semibold text-gray-800 flex items-center gap-2 min-w-0">
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
          <span class="audit-subtitle text-sm font-normal text-gray-500 truncate">— {{ document?.client_name }}</span>
        </h1>
      </div>
      <div class="flex items-center gap-2 flex-wrap shrink-0">
        <!-- Indicateur global de sauvegarde : agrégé depuis l'interceptor
             axios. Idle au boot (rien à signaler), saving pendant les
             requêtes, saved après succès, error sur fail réseau / 4xx
             / 5xx. Donne à l'auditeur la certitude que ses modifs sont
             bien parties (et signale clairement si pas). -->
        <div v-if="saveStatus.state.value === 'saving'"
             v-tooltip="`${saveStatus.inflight.value} sauvegarde(s) en cours…`"
             class="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] text-gray-500 bg-gray-50 rounded-md whitespace-nowrap">
          <ArrowPathIcon class="w-3.5 h-3.5 shrink-0 animate-spin" /> Sauvegarde…
        </div>
        <div v-else-if="saveStatus.state.value === 'error'"
             v-tooltip="saveStatus.lastError.value?.response?.data?.detail || 'La dernière sauvegarde a échoué'"
             @click="saveStatus.clearError()"
             class="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] text-red-700 bg-red-50 rounded-md whitespace-nowrap cursor-pointer hover:bg-red-100">
          <ExclamationTriangleIcon class="w-3.5 h-3.5 shrink-0" /> Erreur de sauvegarde
        </div>
        <div v-else-if="saveStatus.state.value === 'saved'"
             v-tooltip="saveStatus.lastSavedAt.value ? `Dernière sauvegarde : ${saveStatus.lastSavedAt.value.toLocaleTimeString('fr-FR')}` : 'Tout est enregistré'"
             class="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] text-emerald-700 bg-emerald-50 rounded-md whitespace-nowrap">
          <CheckCircleIcon class="w-3.5 h-3.5 shrink-0" /> Enregistré
        </div>

        <!-- Aperçu HTML (avant export PDF) -->
        <Button variant="secondary" size="md" @click="openPreview"
          v-tooltip="'Aperçu HTML rapide du rapport (sans génération PDF)'">
          <template #icon-left><EyeIcon class="w-4 h-4 shrink-0" /></template>
          Aperçu
        </Button>

        <!-- Exports PDF principaux (style cohérent avec AF : indigo solide) -->
        <Button variant="primary" size="md" :loading="exporting" @click="exportPdf"
          v-tooltip="'Génère le rapport d\'audit complet en PDF A4'">
          <template #icon-left><DocumentArrowDownIcon class="w-4 h-4" /></template>
          {{ exporting ? 'Génération…' : 'Rapport' }}
        </Button>
        <Button variant="primary" size="md" :loading="exportingTables" @click="exportTablesPdf"
          v-tooltip="'Génère les tableaux de synthèse (A3 paysage) destinés à l\'intégrateur'">
          <template #icon-left><TableCellsIcon class="w-4 h-4" /></template>
          {{ exportingTables ? 'Génération…' : 'Synthèse' }}
        </Button>

        <!-- Livrer (CTA principal vert) -->
        <Button variant="success" size="md" :loading="delivering" @click="deliver"
          v-tooltip="'Génère le PDF final + fige le snapshot Git'">
          <template #icon-left><CheckCircleIcon class="w-4 h-4 shrink-0" /></template>
          {{ delivering ? 'Livraison…' : 'Livrer' }}
        </Button>

        <!-- Menu Plus (cohérent avec AF) -->
        <div ref="settingsMenuRef" class="relative inline-flex">
          <Button variant="secondary" size="md" @click="showSettingsMenu = !showSettingsMenu"
            v-tooltip="'Plus d\'actions'">
            <template #icon-left><EllipsisHorizontalIcon class="w-4 h-4 shrink-0" /></template>
            Plus
          </Button>
          <div v-if="showSettingsMenu"
               class="absolute top-full right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-20 min-w-56 py-1 whitespace-nowrap"
               @click.stop>
            <button @click="showSettingsMenu = false; showEditMetadata = true"
              class="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-700 hover:bg-gray-50">
              <PencilSquareIcon class="w-4 h-4 text-gray-400 shrink-0" />
              Modifier les paramètres
            </button>
            <button v-if="auditStore.site" @click="showSettingsMenu = false; showEditSite = true"
              class="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-700 hover:bg-gray-50">
              <MapPinIcon class="w-4 h-4 text-gray-400 shrink-0" />
              Modifier le site
            </button>
            <button @click="showSettingsMenu = false; showShare = true"
              class="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-700 hover:bg-gray-50">
              <UserPlusIcon class="w-4 h-4 text-gray-400 shrink-0" />
              Partager
            </button>
            <button @click="showSettingsMenu = false; showActivity = true"
              class="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-700 hover:bg-gray-50">
              <ClockIcon class="w-4 h-4 text-gray-400 shrink-0" />
              Activité
            </button>
            <button v-if="document?.site_uuid" @click="showSettingsMenu = false; openBulkUpload()"
              class="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-700 hover:bg-gray-50">
              <PhotoIcon class="w-4 h-4 text-gray-400 shrink-0" />
              Photos terrain (import en masse)
            </button>
            <button @click="showSettingsMenu = false; openTranscript()"
              class="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-700 hover:bg-gray-50">
              <SparklesIcon class="w-4 h-4 text-gray-400 shrink-0" />
              Transcript IA (Plaud Pro)
            </button>
            <div class="border-t border-gray-100 my-1"></div>
            <button @click="showSettingsMenu = false; deleteAudit()"
              class="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-600 hover:bg-red-50">
              <TrashIcon class="w-4 h-4 shrink-0" />
              Supprimer cet audit
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Stepper horizontal (à l'intérieur du bloc sticky : reste collé sous le header). -->
    <BacsAuditStepperHorizontal
      v-if="!loading"
      :steps="stepperSteps"
      :active-step-key="activeStepKey"
      @step-click="onStepClick"
      class="hidden lg:block"
    />
    </div>
    <!-- /Fin du wrapper sticky desktop -->

    <div v-if="loading" class="text-center py-12 text-gray-400 text-sm">Chargement…</div>

    <div v-else>
      <!-- Colonne principale : contenu de l'audit pleine largeur -->
      <div class="space-y-6 min-w-0">
      <!-- Synthese severities (compactee) — hors site_audit (pas de plan d'actions) -->
      <div v-if="isBacs" class="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div v-for="sev in ['blocking','major','minor']" :key="sev"
             :class="['rounded-lg border px-3 py-2 flex items-center gap-3', SEVERITY_LABEL[sev].cls]">
          <div class="text-2xl font-semibold leading-none">{{ itemsBySeverity[sev].length }}</div>
          <div class="text-xs leading-tight">
            <div class="font-medium uppercase tracking-wider opacity-70">{{ SEVERITY_LABEL[sev].label }}</div>
            <div class="opacity-70">action{{ itemsBySeverity[sev].length > 1 ? 's' : '' }} ouverte{{ itemsBySeverity[sev].length > 1 ? 's' : '' }}</div>
          </div>
        </div>
      </div>

      <!-- 1. Identification + Applicabilité R175-2 -->
      <IdentificationSection
        :active="activeStepKey === 'identification'"
        :step="stepFor('identification')"
        :applicability-labels="APPLICABILITY_LABEL"
        @save-doc="saveDocDebounced"
        @recompute-power="recomputePowerFromEquipments"
        @validate-step="validateStep"
        @invalidate-step="invalidateStep"
        @open-notes="openNotesModal"
      />

      <!-- 2. Zones (R175-1 6° + locaux techniques) — section unifiée :
           map satellite + un seul tableau avec colonne « Type » qui permet
           de basculer chaque ligne entre fonctionnelle et technique.
           Le PDF garde un rendu séparé (zonesFunctional / zonesTechnical). -->
      <ZonesSection
        unified
        :active="activeStepKey === 'zones'"
        :zone-natures="ZONE_NATURES"
        :step="stepFor('zones')"
        @open-notes="openNotesModal"
        @validate-step="validateStep"
        @invalidate-step="invalidateStep"
        @add-zone="onAddZoneRequest"
      />

      <!-- 4. Systèmes techniques par zone (R175-1 4° + R175-3 3°/4°) -->
      <SystemsSection
        :active="activeStepKey === 'systems'"
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
        @add-device="sys => addDeviceSystem = sys"
      />

      <!-- 5. Compteurs et mesurage (R175-3 1°) -->
      <MetersSection
        :active="activeStepKey === 'meters'"
        :meter-usages="METER_USAGES"
        :protocol-options="PROTOCOL_OPTIONS"
        :step="stepFor('meters')"
        @open-notes="openNotesModal"
        @validate-step="validateStep"
        @invalidate-step="invalidateStep"
        @add-meter="openMeterAddModal"
      />

      <!-- 6. Régulation thermique automatique (R175-6) -->
      <ThermalSection
        v-if="isBacs"
        :active="activeStepKey === 'thermal'"
        :thermal-filtered="thermalFiltered"
        :regulation-options="REGULATION_OPTIONS"
        :generator-options="GENERATOR_OPTIONS"
        :generator-devices-for-zone-category="generatorDevicesForZoneCategory"
        :step="stepFor('thermal')"
        @validate-step="validateStep"
        @invalidate-step="invalidateStep"
        @open-notes="openNotesModal"
      />

      <!-- 7. Solution GTB / GTC en place (R175-3 / R175-4 / R175-5) -->
      <BmsSection
        :active="activeStepKey === 'bms'"
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

      <!-- 8. Inspection périodique par un tiers (R175-5-1).
           Masquée sans GTB sur site : rien à faire inspecter. -->
      <InspectionsSection v-if="isBacs && bms?.present !== 0"
                          :active="activeStepKey === 'inspections'"
                          :step="stepFor('inspections')"
                          @validate-step="validateStep"
                          @invalidate-step="invalidateStep"
                          @save-doc="saveDocDebounced" />

      <!-- 9. Check-list documentaire (mig 100) -->
      <ChecklistSection
        :doc-id="docId"
        :active="activeStepKey === 'docs-checklist'"
        :step="stepFor('docs-checklist')"
        @validate-step="validateStep"
        @invalidate-step="invalidateStep"
        @goto-zone="gotoChecklistZone"
        @goto-system="gotoChecklistSystem"
        @goto-meter="gotoChecklistMeter"
        @goto-bms="gotoChecklistBms"
      />

      <!-- 10. Documents du site (DOE) -->
      <DocumentsSection
        :active="activeStepKey === 'documents'"
        :site-doc-counts="siteDocCounts"
        :step="stepFor('documents')"
        @validate-step="validateStep"
        @invalidate-step="invalidateStep"
      />

      <!-- 11. Credentials du site (accès) -->
      <CredentialsSection
        :active="activeStepKey === 'credentials'"
        :site-cred-count="siteCredCount"
        :step="stepFor('credentials')"
        @validate-step="validateStep"
        @invalidate-step="invalidateStep"
      />

      <!-- Plan de mise en conformité — masqué en mode site_audit -->
      <CompliancePlanSection
        v-if="isBacs"
        :active="activeStepKey === 'review'"
        :visible-action-items="visibleActionItems"
        :items-by-severity="itemsBySeverity"
        :resolved-count="resolvedCount"
        :step="stepFor('review')"
        :severity-labels="SEVERITY_LABEL"
        :status-labels="STATUS_LABEL"
        :regenerating="regenerating"
        :site-uuid="document?.site_uuid || ''"
        @regenerate="regenerate"
        @open-commercial="router.push(`/bacs-audit/${docId}/action-items`)"
        @validate-step="validateStep"
        @invalidate-step="invalidateStep"
        @patch-item="({ item, patch }) => patchActionItem(item, patch)"
        @open-alternatives="openAlternativesEditor"
      />

      <!-- 13. Note de synthèse (Claude) -->
      <SynthesisSection
        :active="activeStepKey === 'synthesis'"
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
      v-tooltip="notesModal.title"
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
      :kind="addZoneKind"
      :zones="zones"
      :site="auditStore.site"
      @close="showAddZoneModal = false"
      @submit="addZone"
    />
    <AddMeterModal
      v-if="showAddMeterModal"
      :zones="zones"
      :usages="METER_USAGES"
      :types="METER_TYPES"
      :prefill="meterAddPrefill"
      @close="showAddMeterModal = false; meterAddPrefill = null"
      @submit="addMeter"
    />
    <DeviceAddModal
      v-if="addDeviceSystem"
      :system="addDeviceSystem"
      :system-label="addDeviceSystem.is_bacs === 0 ? (addDeviceSystem.custom_label || 'Usage') : (SYSTEM_LABEL[addDeviceSystem.system_category] || addDeviceSystem.system_category)"
      :zone-name="addDeviceSystem.zone_name || ''"
      @close="addDeviceSystem = null"
      @changed="refreshAuditData"
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

    <PdfPreviewModal
      v-if="previewOpen"
      v-tooltip="`Aperçu — ${isBacs ? 'rapport BACS' : 'audit GTB'} ${document?.client_name || ''}`"
      :preview-url="previewUrl"
      :downloading="exporting"
      download-label="Télécharger le PDF"
      @close="closePreview"
      @download="exportPdf"
    />

    <!-- Partage audit (mêmes APIs que ShareAfModal AF — table documents unifiée) -->
    <ShareAfModal v-if="showShare" :af-id="docId" @close="showShare = false" />

    <!-- Modifier les paramètres de l'audit (parité AF) -->
    <EditAuditMetadataModal
      v-if="showEditMetadata && document"
      :audit="document"
      @close="showEditMetadata = false"
      @saved="onMetadataSaved"
    />

    <EditSiteModal
      v-if="showEditSite && auditStore.site"
      :site="auditStore.site"
      @close="showEditSite = false"
    />

    <!-- Bottom navigation mobile/tablette portrait : raccourcis vers les sections principales -->
    <MobileAuditNav
      v-if="!loading"
      :active-step-key="activeStepKey"
      :show-compliance="isBacs"
      @navigate="onStepClick"
    />
  </div>
</template>

<style scoped>
.slide-enter-active, .slide-leave-active { transition: transform 200ms ease; }
.slide-enter-from, .slide-leave-to { transform: translateX(110%); }

/* ── Mode compact du topbar (au scroll) ─────────────────────────────
 * Transitions fluides via max-height + opacity + overflow (display:none
 * provoque un flash brusque). Le bloc passe d'environ 150 px à environ
 * 70 px de hauteur en douceur. */
@media (min-width: 1024px) {
  :deep(.audit-breadcrumb),
  :deep(.audit-subtitle),
  :deep(.stepper-progress) {
    max-height: 4rem;
    opacity: 1;
    overflow: hidden;
    transition: max-height 180ms ease, opacity 150ms ease, margin 180ms ease;
  }
  .audit-topbar-compact :deep(.audit-breadcrumb),
  .audit-topbar-compact :deep(.audit-subtitle),
  .audit-topbar-compact :deep(.stepper-progress) {
    max-height: 0;
    opacity: 0;
    margin: 0;
    pointer-events: none;
  }
  :deep(.audit-title) {
    transition: font-size 180ms ease, line-height 180ms ease;
  }
  .audit-topbar-compact :deep(.audit-title) {
    font-size: 1rem;
    line-height: 1.25rem;
  }
}
</style>
