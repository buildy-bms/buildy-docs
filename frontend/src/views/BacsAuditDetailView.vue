<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import {
  ArrowLeftIcon, BuildingOffice2Icon, MapPinIcon, ExclamationTriangleIcon,
  CheckCircleIcon, ArrowPathIcon, DocumentArrowDownIcon, PlusIcon, TrashIcon,
  WrenchScrewdriverIcon, BoltIcon, FireIcon, PencilSquareIcon,
  DocumentDuplicateIcon,
} from '@heroicons/vue/24/outline'
import {
  getAf, updateAf, getSite,
  getBacsSystems, updateBacsSystem,
  getBacsMeters, createBacsMeter, updateBacsMeter, deleteBacsMeter,
  getBacsBms, updateBacsBms,
  getBacsThermal, updateBacsThermal,
  getBacsActionItems, regenerateBacsActionItems, updateBacsActionItem,
  getBacsActionItemsCsvUrl, exportBacsPdf, deliverBacsAudit,
  getBacsPowerCumul, resyncBacsAudit,
  listZones, createZone, updateZone, deleteZone,
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
import StepValidateBadge from '@/components/StepValidateBadge.vue'
import RichTextEditor from '@/components/RichTextEditor.vue'
import CollapsibleSection from '@/components/CollapsibleSection.vue'
import { SparklesIcon } from '@heroicons/vue/24/outline'
import { useConfirm } from '@/composables/useConfirm'
import { useNotification } from '@/composables/useNotification'

const router = useRouter()
const route = useRoute()
const { success, error } = useNotification()
const { confirm } = useConfirm()

const docId = parseInt(route.params.id, 10)

const document = ref(null)
const site = ref(null)
const loading = ref(true)
const systems = ref([])
const meters = ref([])
const bms = ref({})
const thermal = ref([])
const actionItems = ref([])
const zones = ref([])
const devices = ref([])
const powerSummary = ref({ by_category: {}, heating_cooling_total_kw: 0 })

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

// Compteurs (R175-3 §1)
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
const COMM_OPTIONS = [
  { value: null, label: '—' },
  { value: 'modbus_tcp', label: 'Modbus TCP' },
  { value: 'modbus_rtu', label: 'Modbus RTU' },
  { value: 'bacnet_ip', label: 'BACnet IP' },
  { value: 'bacnet_mstp', label: 'BACnet MS/TP' },
  { value: 'knx', label: 'KNX' },
  { value: 'mbus', label: 'M-Bus' },
  { value: 'mqtt', label: 'MQTT' },
  { value: 'autre', label: 'Autre' },
  { value: 'non_communicant', label: 'Non communicant' },
  { value: 'absent', label: 'Absent' },
]
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
    if (!groups.has(k)) groups.set(k, { zone_name: s.zone_name, zone_nature: s.zone_nature, items: [] })
    groups.get(k).items.push(s)
  }
  return [...groups.values()]
})

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
  loading.value = true
  try {
    const [d, s, m, b, t, a] = await Promise.all([
      getAf(docId), getBacsSystems(docId), getBacsMeters(docId),
      getBacsBms(docId), getBacsThermal(docId), getBacsActionItems(docId),
    ])
    document.value = d.data
    systems.value = s.data
    meters.value = m.data
    bms.value = b.data || {}
    thermal.value = t.data
    actionItems.value = a.data
    try { auditProgress.value = JSON.parse(d.data.audit_progress || '{}') }
    catch { auditProgress.value = {} }
    synthesisHtml.value = d.data.audit_synthesis_html || ''
    if (d.data.site_id) {
      const z = await listZones(d.data.site_id)
      zones.value = z.data
    }
    const [dev, ps] = await Promise.all([
      getBacsDevices(docId), getBacsPowerSummary(docId),
    ])
    devices.value = dev.data
    powerSummary.value = ps.data
    // Counts pour les etapes 'documents' et 'credentials' du stepper
    refreshSiteCounts()
  } catch (e) {
    error('Échec du chargement de l\'audit BACS')
  } finally {
    loading.value = false
  }
}

async function refreshAuditData() {
  // Recharge systems / thermal / action_items apres un changement de zone
  const [s, t, a, dev, ps, m] = await Promise.all([
    getBacsSystems(docId), getBacsThermal(docId), getBacsActionItems(docId),
    getBacsDevices(docId), getBacsPowerSummary(docId), getBacsMeters(docId),
  ])
  systems.value = s.data
  thermal.value = t.data
  actionItems.value = a.data
  devices.value = dev.data
  powerSummary.value = ps.data
  meters.value = m.data
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

async function patchDeviceMb(d, patch) {
  try {
    const { data } = await updateBacsDevice(d.id, patch)
    Object.assign(d, data)
  } catch {
    error('Sauvegarde impossible')
  }
}

async function addZone() {
  if (!newZone.value.name.trim() || !document.value?.site_id) return
  try {
    await createZone({
      site_id: document.value.site_id,
      name: newZone.value.name.trim(),
      nature: newZone.value.nature,
      surface_m2: newZone.value.surface_m2 ?? null,
    })
    // Recharge zones puis resync l'audit (pre-remplit systems + thermal pour la nouvelle zone)
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

async function dupMeter(m) {
  try {
    const { data } = await duplicateBacsMeter(m.id)
    meters.value.push({ ...data, zone_name: zones.value.find(z => z.zone_id === data.zone_id)?.name || null })
    success('Compteur dupliqué')
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
const auditProgress = ref({})
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

const stepperSteps = computed(() => STEP_DEFINITIONS.map(def => {
  const p = auditProgress.value?.[def.key] || {}
  return {
    key: def.key,
    label: def.label,
    description: def.description,
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
const synthesisHtml = ref('')
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

async function patchSystem(s, patch) {
  try {
    const { data } = await updateBacsSystem(s.id, patch)
    Object.assign(s, data)
    // Recharge action items (potentiellement modifies par regen)
    const a = await getBacsActionItems(docId)
    actionItems.value = a.data
  } catch {
    error('Sauvegarde impossible')
  }
}

async function addMeter() {
  if (!newMeter.value.usage || !newMeter.value.meter_type) return
  try {
    const { data } = await createBacsMeter(docId, {
      zone_id: newMeter.value.zone_id || null,
      usage: newMeter.value.usage,
      meter_type: newMeter.value.meter_type,
      required: newMeter.value.required,
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

async function patchMeter(m, patch) {
  try {
    const { data } = await updateBacsMeter(m.id, patch)
    Object.assign(m, data)
    const a = await getBacsActionItems(docId)
    actionItems.value = a.data
  } catch {
    error('Sauvegarde impossible')
  }
}

async function removeMeter(m) {
  try {
    await deleteBacsMeter(m.id)
    meters.value = meters.value.filter(x => x.id !== m.id)
    const a = await getBacsActionItems(docId)
    actionItems.value = a.data
  } catch {
    error('Suppression impossible')
  }
}

async function patchThermal(t, patch) {
  try {
    const { data } = await updateBacsThermal(t.id, patch)
    Object.assign(t, data)
    const a = await getBacsActionItems(docId)
    actionItems.value = a.data
  } catch {
    error('Sauvegarde impossible')
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

onMounted(refresh)
</script>

<template>
  <div class="max-w-screen-2xl mx-auto pb-12">
    <!-- Header compact (1 ligne sur desktop, breadcrumbs + titre + actions) -->
    <div class="flex items-center justify-between gap-4 mb-3 flex-wrap">
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2 text-xs text-gray-500 mb-0.5 flex-wrap">
          <button @click="router.push('/')" class="hover:text-gray-700 inline-flex items-center gap-1">
            <ArrowLeftIcon class="w-3.5 h-3.5" /> Audits
          </button>
          <span>›</span>
          <span class="text-gray-400">Audit BACS</span>
          <span v-if="document?.updated_by_name" class="text-gray-400">
            · édité par <strong class="font-medium text-gray-600">{{ document.updated_by_name }}</strong>
            <span v-if="document.updated_at" :title="document.updated_at"> il y a {{ relativeTime(document.updated_at) }}</span>
          </span>
          <button @click="router.push(`/bacs-audit/${docId}/audit-trail`)"
                  class="text-indigo-600 hover:text-indigo-800 underline">
            Historique
          </button>
          <span v-if="document?.delivered_at" class="ml-2 inline-flex items-center gap-1 text-emerald-700">
            ✓ Livré le {{ formatDate(document.delivered_at) }}
          </span>
        </div>
        <h1 class="text-lg font-semibold text-gray-800 flex items-center gap-2 truncate">
          <FireIcon class="w-5 h-5 text-orange-500 shrink-0" />
          <span class="truncate">{{ document?.project_name || '…' }}</span>
          <span class="text-sm font-normal text-gray-500 shrink-0">— {{ document?.client_name }}</span>
          <span v-if="document?.bacs_applicable_deadline" class="text-xs text-amber-700 shrink-0">
            · échéance R175 {{ document.bacs_applicable_deadline }}
          </span>
        </h1>
      </div>
      <div class="flex items-center gap-2 flex-wrap">
        <button @click="regenerate" class="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 whitespace-nowrap">
          <ArrowPathIcon class="w-3.5 h-3.5 shrink-0" /> Régénérer
        </button>
        <button @click="downloadCsv" class="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 whitespace-nowrap">
          <DocumentArrowDownIcon class="w-3.5 h-3.5 shrink-0" /> CSV devis
        </button>
        <button @click="exportPdf" :disabled="exporting" class="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-60 whitespace-nowrap">
          <DocumentArrowDownIcon class="w-3.5 h-3.5 shrink-0" /> {{ exporting ? 'Génération…' : 'PDF' }}
        </button>
        <button @click="deliver" :disabled="delivering" class="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-60 whitespace-nowrap">
          <CheckCircleIcon class="w-3.5 h-3.5 shrink-0" /> {{ delivering ? 'Livraison…' : 'Livrer' }}
        </button>
      </div>
    </div>

    <div v-if="loading" class="text-center py-12 text-gray-400 text-sm">Chargement…</div>

    <div v-else class="space-y-4">
      <!-- Stepper progression (9 etapes a valider manuellement) -->
      <BacsAuditStepper
        :steps="stepperSteps"
        :active-step-key="activeStepKey"
        @step-click="onStepClick"
        @validate-step="validateStep"
        @invalidate-step="invalidateStep"
      />

      <!-- Synthese severities (compactee) -->
      <div class="grid grid-cols-3 gap-2">
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
      <CollapsibleSection storage-key="identification" section-id="section-identification">
        <template #header>
          <BuildingOffice2Icon class="w-5 h-5 text-indigo-600" />
          <h2 class="text-base font-semibold text-gray-800">1. Identification du site &amp; applicabilité R175-2</h2>
          <R175Tooltip article="R175-2" />
          <StepValidateBadge class="ml-auto" :step="stepFor('identification')" @validate="validateStep" @invalidate="invalidateStep" />
        </template>
        <div class="px-5 py-4 grid grid-cols-2 gap-4">
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
            <label class="block text-xs font-medium text-gray-700 mb-1">
              Date des derniers travaux d'installation/remplacement de générateur de chaleur
              <span class="ml-1 text-[10px] text-gray-400 font-normal">— déclencheur R175-6</span>
            </label>
            <input
              type="date"
              :value="document?.bacs_generator_works_date || ''"
              @input="e => saveDocDebounced({ bacs_generator_works_date: e.target.value || null })"
              class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
            />
            <p class="text-[11px] text-gray-500 mt-1 leading-relaxed">
              <strong>R175-6</strong> s'applique si le permis de construire est déposé après le <strong>21/07/2021</strong>, ou si des travaux d'installation/remplacement de générateur ont été engagés après cette date. Sinon, l'obligation de régulation thermique automatique par pièce/zone n'est pas applicable au site.
            </p>
            <p v-if="r175_6_applicable" class="text-[11px] mt-1.5 px-2 py-1 rounded"
               :class="r175_6_applicable.applies ? 'bg-amber-50 text-amber-800 border border-amber-200' : 'bg-emerald-50 text-emerald-800 border border-emerald-200'">
              {{ r175_6_applicable.message }}
            </p>
          </div>
          <div class="col-span-2 border-t border-gray-100 pt-3">
            <label class="block text-xs font-medium text-gray-700 mb-1">
              Puissance de la station d'échange (kW)
              <span class="ml-1 text-[10px] text-gray-400 font-normal">— uniquement si raccordement à un réseau urbain de chaleur ou de froid</span>
            </label>
            <input
              type="number" min="0" step="0.1"
              :value="document?.bacs_district_heating_substation_kw"
              @input="e => saveDocDebounced({ bacs_district_heating_substation_kw: e.target.value === '' ? null : parseFloat(e.target.value) })"
              placeholder="—"
              class="w-full max-w-xs px-3 py-2 border border-gray-200 rounded-lg text-sm"
            />
            <p class="text-[11px] text-gray-500 mt-1 leading-relaxed">
              <strong>R175-2</strong> : « Pour les bâtiments dont la génération de chaleur ou de froid est produite par échange avec un réseau urbain, la <strong>puissance du générateur à considérer est celle de la station d'échange</strong> ». Cette valeur prime sur la puissance cumulée des systèmes en aval pour déterminer l'assujettissement.
            </p>
          </div>
        </div>
        <div v-if="document?.bacs_applicability_status" class="px-5 pb-4">
          <div :class="['rounded-lg border p-3 flex items-start gap-3', APPLICABILITY_LABEL[document.bacs_applicability_status].cls]">
            <ExclamationTriangleIcon class="w-5 h-5 shrink-0 mt-0.5" />
            <div class="flex-1">
              <div class="font-medium text-sm">{{ APPLICABILITY_LABEL[document.bacs_applicability_status].label }}</div>
              <div v-if="document.bacs_applicable_deadline" class="text-xs mt-0.5">
                Date butoir applicable : <strong>{{ formatDate(document.bacs_applicable_deadline) }}</strong>
              </div>
            </div>
          </div>
          <p v-if="document?.bacs_applicability_status !== 'not_subject'" class="mt-2 text-[11px] text-gray-500 leading-relaxed">
            <em>À titre informatif :</em> l'article R175-2 prévoit une clause de dispense applicable lorsque le temps de retour
            sur investissement de la mise en conformité dépasse 10 ans. Ce calcul ne relève pas du périmètre de l'audit
            (cf. Annexe D, point 4).
          </p>
        </div>
      </CollapsibleSection>

      <!-- 2. Zones fonctionnelles (R175-1 §6) — editable in-situ -->
      <CollapsibleSection storage-key="zones" section-id="section-zones">
        <template #header>
          <MapPinIcon class="w-5 h-5 text-indigo-600" />
          <h2 class="text-base font-semibold text-gray-800">2. Zones fonctionnelles</h2>
          <span class="text-xs text-gray-500">R175-1 §6 — usages homogènes</span>
          <R175Tooltip article="R175-1 §6" />
          <span class="ml-auto text-[11px] text-gray-500">{{ zones.length }} zone{{ zones.length > 1 ? 's' : '' }} sur ce site</span>
          <StepValidateBadge :step="stepFor('zones')" @validate="validateStep" @invalidate="invalidateStep" />
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
            <tr v-for="z in zones" :key="z.zone_id" class="group">
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
            </tr>
            <!-- Ligne d'ajout -->
            <tr class="bg-indigo-50/30">
              <td class="px-5 py-2">
                <input v-model="newZone.name" type="text" placeholder="Nom de la zone à ajouter…"
                       @keydown.enter="addZone"
                       class="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500" />
              </td>
              <td class="py-2">
                <select v-model="newZone.nature" class="text-xs px-2 py-1 border border-gray-200 rounded">
                  <option :value="null">— nature</option>
                  <option v-for="opt in ZONE_NATURES" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
                </select>
              </td>
              <td class="py-2">
                <input v-model.number="newZone.surface_m2" type="number" min="0" step="1" placeholder="m²"
                       class="w-full text-xs px-2 py-1 border border-gray-200 rounded" />
              </td>
              <td colspan="3" class="px-5 py-2">
                <button @click="addZone" :disabled="!newZone.name.trim()"
                        class="px-3 py-1 text-xs font-medium text-white bg-indigo-600 rounded hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed">
                  + Ajouter
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </CollapsibleSection>

      <!-- Systemes par zone (R175-1 §4) -->
      <CollapsibleSection storage-key="systems" section-id="section-systems">
        <template #header>
          <WrenchScrewdriverIcon class="w-5 h-5 text-indigo-600" />
          <h2 class="text-base font-semibold text-gray-800 whitespace-nowrap">3. Systèmes techniques par zone</h2>
          <span class="text-xs text-gray-500">R175-1 §4 / R175-3 §3, §4</span>
          <R175Tooltip article="R175-1 §4" />
          <R175Tooltip article="R175-3" />
          <span class="ml-auto text-xs text-gray-600 whitespace-nowrap">
            Total chauffage + clim :
            <strong class="font-mono text-emerald-700">{{ powerSummary.heating_cooling_total_kw || 0 }} kW</strong>
          </span>
          <StepValidateBadge :step="stepFor('systems')" @validate="validateStep" @invalidate="invalidateStep" />
        </template>
        <div class="divide-y divide-gray-100">
          <div v-for="g in systemsByZone" :key="g.zone_name" class="px-5 py-3">
            <div class="flex items-center gap-2 mb-3">
              <MapPinIcon class="w-4 h-4 text-gray-400" />
              <span class="font-medium text-sm text-gray-800">{{ g.zone_name }}</span>
              <span v-if="g.zone_nature" class="text-[11px] text-gray-500">{{ ZONE_NATURES.find(z => z.value === g.zone_nature)?.label || g.zone_nature }}</span>
            </div>
            <div class="space-y-3">
              <div v-for="s in g.items" :key="s.id" class="border border-gray-100 rounded-lg overflow-hidden">
                <!-- En-tête catégorie : présent? + notes + photos -->
                <div class="px-3 py-2 flex items-center gap-3 bg-white">
                  <span class="font-medium text-sm text-gray-800 whitespace-nowrap min-w-45">
                    {{ SYSTEM_LABEL[s.system_category] || s.system_category }}
                  </span>
                  <label class="inline-flex items-center gap-1.5 text-xs cursor-pointer whitespace-nowrap">
                    <input type="checkbox" :checked="!!s.present"
                           @change="e => patchSystem(s, { present: e.target.checked })"
                           class="rounded border-gray-300" />
                    <span class="text-gray-700">Présent</span>
                  </label>
                  <button
                    type="button"
                    :disabled="!s.present"
                    @click="openNotesModal({ title: 'Notes systeme', contextLabel: (SYSTEM_LABEL[s.system_category] || s.system_category) + ' - ' + g.zone_name, entityType: 'system', entityRef: s, currentHtml: s.notes_html || s.notes || '' })"
                    :class="['inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded-md border transition disabled:opacity-30 disabled:cursor-not-allowed',
                      hasNotes(s.notes_html || s.notes)
                        ? 'border-indigo-300 text-indigo-700 bg-indigo-50 hover:bg-indigo-100'
                        : 'border-gray-300 text-gray-600 hover:bg-gray-50']"
                  >
                    <PencilSquareIcon class="w-4 h-4" />
                    {{ hasNotes(s.notes_html || s.notes) ? 'Notes' : '+ Notes' }}
                  </button>
                  <BacsPhotoButton
                    v-if="document?.site_uuid && s.present"
                    :site-uuid="document.site_uuid"
                    :attach-to="{ system_id: s.id }"
                    :label="(SYSTEM_LABEL[s.system_category] || s.system_category) + ' - ' + g.zone_name"
                  />
                </div>
                <!-- Sous-table devices + cases R175-3 §3/§4 (visible uniquement si système présent) -->
                <SystemDevicesTable
                  v-if="s.present"
                  :system="s"
                  :devices="devicesBySystem[s.id] || []"
                  :system-label="SYSTEM_LABEL[s.system_category] || s.system_category"
                  :site-uuid="document?.site_uuid"
                  @changed="refreshAuditData"
                  @system-updated="patch => patchSystem(s, patch)"
                  @open-device-notes="d => openNotesModal({
                    title: 'Notes equipement',
                    contextLabel: (d.name || 'Equipement') + ' - ' + (SYSTEM_LABEL[s.system_category] || s.system_category) + ' / ' + g.zone_name,
                    entityType: 'device',
                    entityRef: d,
                    currentHtml: d.notes_html || d.notes || ''
                  })"
                />
              </div>
            </div>
          </div>
          <div v-if="!systemsByZone.length" class="px-5 py-6 text-center text-sm text-gray-500">
            Aucune zone définie pour ce site. Ajoute-en depuis la section ci-dessus.
          </div>
        </div>
      </CollapsibleSection>

      <!-- 4. Compteurs et mesurage (R175-3 §1) -->
      <CollapsibleSection storage-key="meters" section-id="section-meters">
        <template #header>
          <BoltIcon class="w-5 h-5 text-emerald-600" />
          <h2 class="text-base font-semibold text-gray-800">4. Compteurs et mesurage</h2>
          <span class="text-xs text-gray-500">R175-3 §1 — suivi continu, pas horaire, conservation 5 ans</span>
          <R175Tooltip article="R175-3 §1" />
          <StepValidateBadge class="ml-auto" :step="stepFor('meters')" @validate="validateStep" @invalidate="invalidateStep" />
        </template>
        <table class="w-full text-sm">
          <thead class="text-xs uppercase text-gray-500 tracking-wider bg-gray-50">
            <tr>
              <th class="text-center px-5 py-2 w-44">Zone</th>
              <th class="text-center py-2 w-32">Usage</th>
              <th class="text-center py-2 w-40">Type</th>
              <th class="text-center py-2 w-20">Requis</th>
              <th class="text-center py-2 w-20">Présent</th>
              <th class="text-center py-2 w-24">Communicant</th>
              <th class="text-center py-2 w-32">Protocole</th>
              <th class="text-center py-2 w-28">Notes</th>
              <th class="text-center py-2 w-24">Photos</th>
              <th class="text-center py-2 w-16" title="Compteur Hors-Service — ignoré dans le plan d'action">HS</th>
              <th class="text-center px-5 py-2 w-12"></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            <tr v-for="m in meters" :key="m.id" class="group" :class="m.out_of_service ? 'opacity-50' : ''">
              <td class="px-5 py-2 text-gray-700 text-center">{{ m.zone_name || 'Compteur général' }}</td>
              <td class="py-2 text-gray-700 text-center">{{ METER_USAGES.find(u => u.value === m.usage)?.label || m.usage }}</td>
              <td class="py-2 text-gray-700 text-center">{{ METER_TYPES.find(t => t.value === m.meter_type)?.label || m.meter_type }}</td>
              <td class="py-2 text-center">
                <input type="checkbox" :checked="!!m.required"
                       @change="e => patchMeter(m, { required: e.target.checked })"
                       class="rounded border-gray-300" />
              </td>
              <td class="py-2 text-center">
                <input type="checkbox" :checked="!!m.present_actual"
                       @change="e => patchMeter(m, { present_actual: e.target.checked })"
                       class="rounded border-gray-300" />
              </td>
              <td class="py-2 text-center">
                <input type="checkbox" :checked="!!m.communicating" :disabled="!m.present_actual"
                       @change="e => patchMeter(m, { communicating: e.target.checked })"
                       class="rounded border-gray-300 disabled:opacity-30" />
              </td>
              <td class="py-2 text-center">
                <select :value="m.communication_protocol" :disabled="!m.communicating"
                        @change="e => patchMeter(m, { communication_protocol: e.target.value || null })"
                        class="text-xs px-2 py-1 border border-gray-200 rounded disabled:opacity-30 text-center">
                  <option :value="null">—</option>
                  <option value="modbus_tcp">Modbus TCP</option>
                  <option value="modbus_rtu">Modbus RTU</option>
                  <option value="bacnet_ip">BACnet IP</option>
                  <option value="bacnet_mstp">BACnet MS/TP</option>
                  <option value="knx">KNX</option>
                  <option value="mbus">M-Bus</option>
                  <option value="mqtt">MQTT</option>
                  <option value="lorawan">LoRaWAN</option>
                  <option value="other">Autre</option>
                </select>
              </td>
              <td class="py-2 text-center">
                <button
                  type="button"
                  @click="openNotesModal({ title: 'Notes compteur', contextLabel: (m.zone_name || 'Compteur général') + ' — ' + (METER_USAGES.find(u => u.value === m.usage)?.label || m.usage), entityType: 'meter', entityRef: m, currentHtml: m.notes_html || m.notes || '' })"
                  :class="['inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded-md border transition',
                    hasNotes(m.notes_html || m.notes)
                      ? 'border-indigo-300 text-indigo-700 bg-indigo-50 hover:bg-indigo-100'
                      : 'border-gray-300 text-gray-600 hover:bg-gray-50']"
                  title="Editer les notes"
                >
                  <PencilSquareIcon class="w-4 h-4" />
                  {{ hasNotes(m.notes_html || m.notes) ? 'Notes' : '+ Notes' }}
                </button>
              </td>
              <td class="py-2 text-center">
                <BacsPhotoButton
                  v-if="document?.site_uuid"
                  :site-uuid="document.site_uuid"
                  :attach-to="{ meter_id: m.id }"
                  :label="(m.zone_name || 'Général') + ' / ' + (METER_USAGES.find(u => u.value === m.usage)?.label || m.usage)"
                />
              </td>
              <td class="py-2 text-center">
                <input type="checkbox" :checked="!!m.out_of_service"
                       @change="e => patchMeter(m, { out_of_service: e.target.checked })"
                       class="rounded border-gray-300" />
              </td>
              <td class="px-5 py-2 text-right whitespace-nowrap">
                <button @click="dupMeter(m)" class="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-indigo-600 p-1 transition" title="Dupliquer">
                  <DocumentDuplicateIcon class="w-4 h-4" />
                </button>
                <button @click="removeMeter(m)" class="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-600 p-1 transition" title="Supprimer">
                  <TrashIcon class="w-4 h-4" />
                </button>
              </td>
            </tr>
            <!-- Ligne d'ajout -->
            <tr class="bg-indigo-50/30">
              <td class="px-5 py-2">
                <select v-model="newMeter.zone_id" class="text-xs px-2 py-1 border border-gray-200 rounded w-full">
                  <option :value="null">Compteur général</option>
                  <option v-for="z in zones" :key="z.zone_id" :value="z.zone_id">{{ z.name }}</option>
                </select>
              </td>
              <td class="py-2">
                <select v-model="newMeter.usage" class="text-xs px-2 py-1 border border-gray-200 rounded w-full">
                  <option v-for="u in METER_USAGES" :key="u.value" :value="u.value">{{ u.label }}</option>
                </select>
              </td>
              <td class="py-2">
                <select v-model="newMeter.meter_type" class="text-xs px-2 py-1 border border-gray-200 rounded w-full">
                  <option v-for="t in METER_TYPES" :key="t.value" :value="t.value">{{ t.label }}</option>
                </select>
              </td>
              <td class="py-2">
                <input type="checkbox" v-model="newMeter.required" class="rounded border-gray-300" />
              </td>
              <td colspan="7" class="px-5 py-2">
                <button @click="addMeter"
                        class="px-3 py-1 text-xs font-medium text-white bg-indigo-600 rounded hover:bg-indigo-700">
                  + Ajouter un compteur
                </button>
              </td>
            </tr>
          </tbody>
          <tfoot v-if="!meters.length">
            <tr>
              <td colspan="9" class="px-5 py-6 text-center text-xs text-gray-500">
                Aucun compteur listé. Renseigne les compteurs requis (R175-3 §1) à mesure de la visite.
              </td>
            </tr>
          </tfoot>
        </table>
      </CollapsibleSection>

      <!-- Régulation thermique (R175-6) -->
      <CollapsibleSection storage-key="thermal" section-id="section-thermal">
        <template #header>
          <FireIcon class="w-5 h-5 text-red-500" />
          <h2 class="text-base font-semibold text-gray-800">5. Régulation thermique automatique</h2>
          <R175Tooltip article="R175-6" />
          <span class="text-xs text-gray-500">R175-6</span>
          <StepValidateBadge class="ml-auto" :step="stepFor('thermal')" @validate="validateStep" @invalidate="invalidateStep" />
        </template>
        <table class="w-full text-sm">
          <thead class="text-xs uppercase text-gray-500 tracking-wider bg-gray-50">
            <tr>
              <th class="text-center px-5 py-2">Zone</th>
              <th class="text-center py-2 w-32">Régulation auto ?</th>
              <th class="text-center py-2 w-40">Type de régulation</th>
              <th class="text-center py-2 w-44">Type générateur</th>
              <th class="text-center py-2 w-24">Âge (ans)</th>
              <th class="text-center py-2 w-24" title="Appareil indépendant de chauffage au bois — exempté R175-6 (II)">Exempté bois</th>
              <th class="text-center px-5 py-2">Notes</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            <tr v-for="t in thermal" :key="t.id">
              <td class="px-5 py-2 text-gray-700 text-center">{{ t.zone_name }}</td>
              <td class="py-2 text-center">
                <input type="checkbox" :checked="!!t.has_automatic_regulation"
                       @change="e => patchThermal(t, { has_automatic_regulation: e.target.checked })"
                       class="rounded border-gray-300" />
              </td>
              <td class="py-2 text-center">
                <select :value="t.regulation_type"
                        @change="e => patchThermal(t, { regulation_type: e.target.value || null })"
                        class="text-xs px-2 py-1 border border-gray-200 rounded text-center">
                  <option v-for="o in REGULATION_OPTIONS" :key="o.value || 'null'" :value="o.value">{{ o.label }}</option>
                </select>
              </td>
              <td class="py-2 text-center">
                <select :value="t.generator_type"
                        @change="e => patchThermal(t, { generator_type: e.target.value || null })"
                        class="text-xs px-2 py-1 border border-gray-200 rounded text-center">
                  <option v-for="o in GENERATOR_OPTIONS" :key="o.value || 'null'" :value="o.value">{{ o.label }}</option>
                </select>
              </td>
              <td class="py-2 text-center">
                <input type="number" :value="t.generator_age_years" min="0"
                       @blur="e => patchThermal(t, { generator_age_years: e.target.value ? parseInt(e.target.value, 10) : null })"
                       class="w-16 text-xs px-2 py-1 border border-gray-200 rounded text-center" />
              </td>
              <td class="py-2 text-center">
                <input type="checkbox" :checked="!!t.generator_exempt_wood"
                       @change="e => patchThermal(t, { generator_exempt_wood: e.target.checked })"
                       class="rounded border-gray-300"
                       title="Si coché : générateur = appareil indépendant de chauffage au bois → exempté R175-6 (cf décret R175-6 II)" />
              </td>
              <td class="px-5 py-2">
                <input type="text" :value="t.notes" placeholder="—"
                       @blur="e => patchThermal(t, { notes: e.target.value || null })"
                       class="w-full text-xs px-2 py-1 border border-gray-200 rounded" />
              </td>
            </tr>
          </tbody>
        </table>
      </CollapsibleSection>

      <!-- GTB / GTC (R175-3 / R175-4 / R175-5) -->
      <CollapsibleSection storage-key="bms" section-id="section-bms">
        <template #header>
          <WrenchScrewdriverIcon class="w-5 h-5 text-purple-600" />
          <h2 class="text-base font-semibold text-gray-800">6. Solution GTB / GTC en place</h2>
          <span class="text-xs text-gray-500">R175-3 + R175-4 + R175-5</span>
          <R175Tooltip article="R175-4" />
          <R175Tooltip article="R175-5" />
          <div class="ml-auto flex items-center gap-2">
            <button
              type="button"
              @click="openNotesModal({ title: 'Notes GTB', contextLabel: 'Solution GTB / GTC : ' + (bms.existing_solution || 'a renseigner'), entityType: 'bms', entityRef: bms, currentHtml: bms.notes_html || '' })"
              :class="['inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md border transition',
                hasNotes(bms.notes_html)
                  ? 'border-indigo-300 text-indigo-700 bg-indigo-50 hover:bg-indigo-100'
                  : 'border-gray-300 text-gray-600 hover:bg-gray-50']"
              title="Editer les notes GTB"
            >
              <PencilSquareIcon class="w-4 h-4" />
              {{ hasNotes(bms.notes_html) ? 'Notes' : '+ Notes' }}
            </button>
            <BacsPhotoButton
              v-if="document?.site_uuid && bms.document_id"
              :site-uuid="document.site_uuid"
              :attach-to="{ bms_document_id: bms.document_id }"
              label="GTB"
              size="md"
            />
            <StepValidateBadge :step="stepFor('bms')" @validate="validateStep" @invalidate="invalidateStep" />
          </div>
        </template>
        <div class="px-5 py-4 space-y-4">
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-xs font-medium text-gray-700 mb-1">Solution en place</label>
              <input v-model="bms.existing_solution" type="text" placeholder="ex : Niagara, Schneider EcoStruxure, Buildy…"
                     @input="saveBmsDebounced"
                     class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-700 mb-1">Marque / éditeur</label>
              <input v-model="bms.existing_solution_brand" type="text" placeholder="—"
                     @input="saveBmsDebounced"
                     class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-700 mb-1">Localisation</label>
              <input v-model="bms.location" type="text" placeholder="ex : Local technique sous-sol"
                     @input="saveBmsDebounced"
                     class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-700 mb-1">Référence modèle</label>
              <input v-model="bms.model_reference" type="text" placeholder="ex : JACE 8000"
                     @input="saveBmsDebounced"
                     class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
            </div>
          </div>

          <!-- Analyse fonctionnelle de la GTB existante (constat d'auditeur) -->
          <div class="border-t border-gray-100 pt-3">
            <h3 class="text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2">
              Analyse fonctionnelle de la GTB existante
            </h3>
            <div v-if="document?.audit_existing_af_status !== 'absent'" class="flex items-center gap-3 flex-wrap">
              <BacsPhotoButton
                v-if="document?.site_uuid"
                :site-uuid="document.site_uuid"
                :attach-to="{ bms_document_id: bms.document_id }"
                label="Analyse fonctionnelle GTB"
                size="md"
              />
              <p class="text-xs text-gray-500 italic flex-1">
                Glisse ici le document d'AF de la GTB existante (PDF, Word, schéma) si le propriétaire ou l'exploitant le fournit.
              </p>
            </div>
            <p v-else class="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
              ⚠ Aucun document d'<strong>analyse fonctionnelle</strong> n'est disponible pour la GTB existante.
            </p>
            <label class="inline-flex items-center gap-1.5 text-xs cursor-pointer mt-2 text-gray-600">
              <input type="checkbox"
                     :checked="document?.audit_existing_af_status === 'absent'"
                     @change="e => saveDocDebounced({ audit_existing_af_status: e.target.checked ? 'absent' : null })"
                     class="rounded" />
              Le document d'analyse fonctionnelle n'existe pas
            </label>
          </div>

          <div class="border-t border-gray-100 pt-3">
            <h3 class="text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2">Usages traités par la GTB</h3>
            <div class="grid grid-cols-5 gap-2 text-sm">
              <label class="flex items-center gap-1.5 cursor-pointer whitespace-nowrap">
                <input type="checkbox" v-model="bms.manages_heating" :true-value="1" :false-value="0" @change="saveBmsDebounced" class="rounded" />
                Chauffage
              </label>
              <label class="flex items-center gap-1.5 cursor-pointer whitespace-nowrap">
                <input type="checkbox" v-model="bms.manages_cooling" :true-value="1" :false-value="0" @change="saveBmsDebounced" class="rounded" />
                Refroidissement
              </label>
              <label class="flex items-center gap-1.5 cursor-pointer whitespace-nowrap">
                <input type="checkbox" v-model="bms.manages_ventilation" :true-value="1" :false-value="0" @change="saveBmsDebounced" class="rounded" />
                Ventilation
              </label>
              <label class="flex items-center gap-1.5 cursor-pointer whitespace-nowrap">
                <input type="checkbox" v-model="bms.manages_dhw" :true-value="1" :false-value="0" @change="saveBmsDebounced" class="rounded" />
                ECS
              </label>
              <label class="flex items-center gap-1.5 cursor-pointer whitespace-nowrap">
                <input type="checkbox" v-model="bms.manages_lighting" :true-value="1" :false-value="0" @change="saveBmsDebounced" class="rounded" />
                Éclairage
              </label>
            </div>
          </div>

          <div class="border-t border-gray-100 pt-3">
            <label class="flex items-center gap-2 cursor-pointer text-sm mb-3">
              <input type="checkbox" v-model="bms.out_of_service" :true-value="1" :false-value="0" @change="saveBmsDebounced" class="rounded" />
              <span class="text-gray-700 font-medium">GTB Hors-Service</span>
              <span class="text-[11px] text-gray-400">— le plan d'action ignore alors les exigences GTB</span>
            </label>
          </div>

          <div class="border-t border-gray-100 pt-3 grid grid-cols-2 gap-4">
            <div>
              <h3 class="text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2">
                Équipements intégrés à la GTB
                <span class="font-normal normal-case text-gray-500 text-[10px]">— "HS liaison" = équipement OK mais GTB ne le voit pas</span>
              </h3>
              <table v-if="devicesWithMeta.length" class="w-full text-xs">
                <thead class="text-[10px] uppercase text-gray-500 tracking-wider bg-gray-50">
                  <tr>
                    <th class="text-left px-2 py-1 font-semibold">Équipement</th>
                    <th class="text-center py-1 font-semibold w-16" title="Intégré à la GTB">Intégré</th>
                    <th class="text-center py-1 font-semibold w-20" title="Liaison GTB Hors-Service (paramétrage/communication cassé)">HS liaison</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-100">
                  <tr v-for="d in devicesWithMeta" :key="d.id"
                      :class="d.out_of_service ? 'opacity-50' : ''">
                    <td class="px-2 py-1 text-gray-700">
                      <strong>{{ d.name || d.brand || d.model_reference || 'Sans nom' }}</strong>
                      <span class="text-gray-400">
                        — {{ SYSTEM_LABEL[d.system_category] || d.system_category }} / {{ d.zone_name || '?' }}
                      </span>
                    </td>
                    <td class="py-1 text-center">
                      <input type="checkbox" :checked="!!d.managed_by_bms"
                             :disabled="d.out_of_service"
                             @change="e => patchDeviceMb(d, { managed_by_bms: e.target.checked })"
                             class="rounded disabled:opacity-30" />
                    </td>
                    <td class="py-1 text-center">
                      <input type="checkbox" :checked="!!d.bms_integration_out_of_service"
                             :disabled="!d.managed_by_bms"
                             @change="e => patchDeviceMb(d, { bms_integration_out_of_service: e.target.checked })"
                             class="rounded accent-red-500 disabled:opacity-30" />
                    </td>
                  </tr>
                </tbody>
              </table>
              <p v-else class="text-xs text-gray-400 italic">Aucun équipement saisi.</p>
            </div>
            <div>
              <h3 class="text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2">
                Compteurs intégrés à la GTB
                <span class="font-normal normal-case text-gray-500 text-[10px]">— uniquement les compteurs présents</span>
              </h3>
              <table v-if="metersPresent.length" class="w-full text-xs">
                <thead class="text-[10px] uppercase text-gray-500 tracking-wider bg-gray-50">
                  <tr>
                    <th class="text-left px-2 py-1 font-semibold">Compteur</th>
                    <th class="text-center py-1 font-semibold w-16" title="Intégré à la GTB">Intégré</th>
                    <th class="text-center py-1 font-semibold w-20" title="Liaison GTB Hors-Service (la GTB ne relève plus le compteur)">HS liaison</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-100">
                  <tr v-for="m in metersPresent" :key="m.id"
                      :class="m.out_of_service ? 'opacity-50' : ''">
                    <td class="px-2 py-1 text-gray-700">
                      <strong>{{ METER_TYPES.find(t => t.value === m.meter_type)?.label || m.meter_type }}</strong>
                      <span class="text-gray-400">
                        — {{ m.zone_name || 'général' }} ({{ METER_USAGES.find(u => u.value === m.usage)?.label || m.usage }})
                      </span>
                    </td>
                    <td class="py-1 text-center">
                      <input type="checkbox" :checked="!!m.managed_by_bms"
                             :disabled="m.out_of_service"
                             @change="e => patchMeter(m, { managed_by_bms: e.target.checked })"
                             class="rounded disabled:opacity-30" />
                    </td>
                    <td class="py-1 text-center">
                      <input type="checkbox" :checked="!!m.bms_integration_out_of_service"
                             :disabled="!m.managed_by_bms"
                             @change="e => patchMeter(m, { bms_integration_out_of_service: e.target.checked })"
                             class="rounded accent-red-500 disabled:opacity-30" />
                    </td>
                  </tr>
                </tbody>
              </table>
              <p v-else class="text-xs text-gray-400 italic">
                Aucun compteur présent à raccorder.
                <span v-if="meters.length" class="block mt-1">Coche « Présent » dans la section 4 pour rendre les compteurs disponibles ici.</span>
              </p>
            </div>
          </div>

          <div class="border-t border-gray-100 pt-3">
            <h3 class="text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2">
              R175-3 — Capacités de la solution de supervision
              <span class="font-normal normal-case text-gray-500 text-[10px]" title="L'interopérabilité (P3) et l'arrêt manuel + autonome (P4) sont désormais évalués au niveau de chaque système — cf section 3.">
                ⓘ P3 et P4 sont au niveau des systèmes (section 3)
              </span>
            </h3>
            <div class="space-y-2 text-sm">
              <label class="flex items-start gap-2 cursor-pointer">
                <input type="checkbox" v-model="bms.meets_r175_3_p1" :true-value="1" :false-value="0" @change="saveBmsDebounced" class="mt-0.5 rounded" />
                <span><strong>P1.</strong> Suivi continu par zone, pas horaire, conservation 5 ans</span>
              </label>
              <label class="flex items-start gap-2 cursor-pointer">
                <input type="checkbox" v-model="bms.meets_r175_3_p2" :true-value="1" :false-value="0" @change="saveBmsDebounced" class="mt-0.5 rounded" />
                <span><strong>P2.</strong> Détection des pertes d'efficacité</span>
              </label>
            </div>
          </div>

          <!-- R175-3 dernier alinéa : mise à disposition des données -->
          <div class="border-t border-gray-100 pt-3">
            <h3 class="text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2">
              R175-3 — Mise à disposition des données
              <span class="font-normal normal-case text-gray-500 text-[10px] ml-1">(dernier alinéa)</span>
            </h3>
            <div class="space-y-2 text-sm">
              <label class="flex items-start gap-2 cursor-pointer">
                <input type="checkbox" v-model="bms.data_provision_to_manager" :true-value="1" :false-value="0" @change="saveBmsDebounced" class="mt-0.5 rounded" />
                <span>Procédure de mise à disposition des données au <strong>gestionnaire du bâtiment</strong> documentée</span>
              </label>
              <label class="flex items-start gap-2 cursor-pointer">
                <input type="checkbox" v-model="bms.data_provision_to_operators" :true-value="1" :false-value="0" @change="saveBmsDebounced" class="mt-0.5 rounded" />
                <span>Procédure de transmission des données aux <strong>exploitants des systèmes techniques</strong> documentée</span>
              </label>
            </div>
            <textarea
              v-model="bms.notes_data_provision"
              @input="saveBmsDebounced"
              placeholder="Décris le mécanisme : extraction CSV, accès portail web, API, planning d'envoi…"
              class="mt-2 w-full text-xs px-2 py-1.5 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500"
              rows="2"
            ></textarea>
          </div>

          <div class="border-t border-gray-100 pt-3 grid grid-cols-2 gap-4">
            <div>
              <h3 class="text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2">R175-4 — Vérifications périodiques</h3>
              <label class="flex items-start gap-2 cursor-pointer text-sm">
                <input type="checkbox" v-model="bms.has_maintenance_procedures" :true-value="1" :false-value="0" @change="saveBmsDebounced" class="mt-0.5 rounded" />
                <span>Consignes écrites des maintenances passées</span>
              </label>
            </div>
            <div>
              <h3 class="text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2">R175-5 — Formation exploitant</h3>
              <label class="flex items-start gap-2 cursor-pointer text-sm">
                <input type="checkbox" v-model="bms.operator_trained" :true-value="1" :false-value="0" @change="saveBmsDebounced" class="mt-0.5 rounded" />
                <span>Exploitant formé à l'utilisation de la supervision</span>
              </label>
              <p v-if="(bms.existing_solution || '').toLowerCase().includes('buildy')" class="mt-2 text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1">
                ✓ Buildy : exigence R175-5 nativement couverte par le support utilisateur intégré
              </p>
            </div>
          </div>
        </div>
      </CollapsibleSection>

      <!-- 9. Documents du site (DOE) -->
      <CollapsibleSection storage-key="documents" section-id="section-documents">
        <template #header>
          <DocumentArrowDownIcon class="w-5 h-5 text-blue-600" />
          <h2 class="text-base font-semibold text-gray-800">9. Documents du site</h2>
          <span class="text-xs text-gray-500">DOE — plans, schémas, AF, datasheets, manuels…</span>
          <StepValidateBadge class="ml-auto" :step="stepFor('documents')" @validate="validateStep" @invalidate="invalidateStep" />
        </template>
        <div class="px-5 py-4">
          <SiteDocumentsManager
            v-if="document?.site_uuid"
            :site-uuid="document.site_uuid"
            :systems="systems"
          />
          <p v-else class="text-sm text-gray-500 italic text-center py-4">
            L'audit n'est rattaché à aucun site.
          </p>
        </div>
      </CollapsibleSection>

      <!-- 10. Credentials du site (accès) -->
      <CollapsibleSection storage-key="credentials" section-id="section-credentials">
        <template #header>
          <WrenchScrewdriverIcon class="w-5 h-5 text-amber-600" />
          <h2 class="text-base font-semibold text-gray-800">10. Credentials d'accès</h2>
          <span class="text-xs text-gray-500">Logins web/SSH/VPN aux GTB et systèmes (chiffrés AES-256-GCM)</span>
          <StepValidateBadge class="ml-auto" :step="stepFor('credentials')" @validate="validateStep" @invalidate="invalidateStep" />
        </template>
        <div class="px-5 py-4">
          <SiteCredentialsManager
            v-if="document?.site_uuid"
            :site-uuid="document.site_uuid"
            :systems="systems"
          />
          <p v-else class="text-sm text-gray-500 italic text-center py-4">
            L'audit n'est rattaché à aucun site.
          </p>
        </div>
      </CollapsibleSection>

      <!-- Plan de mise en conformité -->
      <CollapsibleSection storage-key="review" section-id="section-review">
        <template #header>
          <ExclamationTriangleIcon class="w-5 h-5 text-orange-500" />
          <h2 class="text-base font-semibold text-gray-800">11. Plan de mise en conformité</h2>
          <span class="text-xs text-gray-500">{{ visibleActionItems.length }} action{{ visibleActionItems.length > 1 ? 's' : '' }}<span v-if="resolvedCount" class="text-emerald-600"> · {{ resolvedCount }} résolue{{ resolvedCount > 1 ? 's' : '' }} masquée{{ resolvedCount > 1 ? 's' : '' }}</span></span>
          <button
            @click.stop="router.push(`/bacs-audit/${docId}/action-items`)"
            class="ml-auto text-xs text-indigo-600 hover:text-indigo-800 font-medium"
          >
            Vue commerciale →
          </button>
          <StepValidateBadge :step="stepFor('review')" @validate="validateStep" @invalidate="invalidateStep" />
        </template>
        <table class="w-full text-sm" style="table-layout: fixed">
          <thead class="text-xs uppercase text-gray-500 tracking-wider bg-gray-50">
            <tr>
              <th class="text-center px-2 py-2 w-16 whitespace-nowrap" title="Numéro d'action — utilisable comme référence par les intégrateurs GTB pour leur devis">N°</th>
              <th class="text-left px-3 py-2 w-24 whitespace-nowrap">Sévérité</th>
              <th class="text-left py-2 w-24 whitespace-nowrap">Article</th>
              <th class="text-left py-2 min-w-70">Action</th>
              <th class="text-left py-2 w-32 whitespace-nowrap">Zone</th>
              <th class="text-left py-2 w-32 whitespace-nowrap">Statut</th>
              <th class="text-left px-3 py-2 w-52" title="Préconisations Buildy / solutions envisageables pour cette action">Préconisations</th>
              <th class="text-left px-3 py-2 w-56">Notes commerciales</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            <tr v-for="(it, idx) in visibleActionItems" :key="it.id"
                :class="['transition', it.status === 'declined' ? 'opacity-50' : '']"
                :title="it.status === 'done' ? 'Action marquee comme terminee' : (it.status === 'declined' ? 'Action declinee' : '')">
              <td class="px-2 py-2 align-top text-center">
                <span class="inline-flex items-center justify-center min-w-10 px-2 py-1 text-xs font-mono font-bold rounded bg-gray-800 text-white whitespace-nowrap">
                  {{ actionNumber(idx) }}
                </span>
              </td>
              <td class="px-3 py-2 align-top">
                <span :class="['inline-block px-2 py-0.5 text-[10px] font-medium rounded border whitespace-nowrap', SEVERITY_LABEL[it.severity].cls]">
                  {{ SEVERITY_LABEL[it.severity].label }}
                </span>
              </td>
              <td class="py-2 text-[11px] text-gray-500 font-mono align-top whitespace-nowrap">{{ it.r175_article || '—' }}</td>
              <td class="py-2 align-top pr-2">
                <div class="text-gray-800 line-clamp-2" :title="it.title">{{ it.title }}</div>
                <div v-if="it.description" class="text-[11px] text-gray-500 mt-0.5 line-clamp-2" :title="it.description">{{ it.description }}</div>
              </td>
              <td class="py-2 text-xs text-gray-600 align-top truncate" :title="it.zone_name">{{ it.zone_name || '—' }}</td>
              <td class="py-2 align-top">
                <select :value="it.status"
                        @change="e => patchActionItem(it, { status: e.target.value })"
                        class="text-xs px-2 py-1 border border-gray-200 rounded w-full">
                  <option v-for="(label, val) in STATUS_LABEL" :key="val" :value="val">{{ label }}</option>
                </select>
              </td>
              <td class="px-3 py-2 align-top">
                <button
                  type="button"
                  @click="openAlternativesEditor(it)"
                  :class="['inline-flex items-center justify-center gap-1 px-2 py-1 text-[11px] font-medium rounded border transition whitespace-nowrap w-full',
                    hasNotes(it.alternative_solutions_html)
                      ? 'border-violet-300 text-violet-700 bg-violet-50 hover:bg-violet-100'
                      : (it.status === 'open'
                        ? 'border-red-300 text-red-700 bg-red-50 hover:bg-red-100 ring-1 ring-red-200'
                        : 'border-gray-300 text-gray-600 hover:bg-gray-50')]"
                  :title="hasNotes(it.alternative_solutions_html) ? 'Modifier les préconisations' : 'Aucune préconisation — cliquer pour rédiger'"
                >
                  <PencilSquareIcon class="w-3.5 h-3.5" />
                  {{ hasNotes(it.alternative_solutions_html)
                      ? 'Préconisations'
                      : (it.status === 'open' ? '⚠ À renseigner' : '+ Préconisations') }}
                </button>
              </td>
              <td class="px-3 py-2 align-top">
                <input type="text" :value="it.commercial_notes" placeholder="ref produit, prix estimé…"
                       @blur="e => patchActionItem(it, { commercial_notes: e.target.value || null })"
                       class="w-full text-xs px-2 py-1 border border-gray-200 rounded" />
              </td>
            </tr>
            <tr v-if="!visibleActionItems.length">
              <td colspan="8" class="py-10 text-center">
                <CheckCircleIcon class="w-10 h-10 text-emerald-500 mx-auto" />
                <p class="mt-2 text-sm text-gray-700 font-medium">Aucune action corrective à ce stade</p>
                <p class="text-xs text-gray-500">Saisis les systèmes et la GTB ci-dessus pour générer le plan.</p>
              </td>
            </tr>
          </tbody>
        </table>
      </CollapsibleSection>

      <!-- 12. Note de synthèse (Claude) -->
      <CollapsibleSection storage-key="synthesis" section-id="section-synthesis">
        <template #header>
          <SparklesIcon class="w-5 h-5 text-violet-500" />
          <h2 class="text-base font-semibold text-gray-800">12. Note de synthèse</h2>
          <span class="text-xs text-gray-500">Affichée en tête du PDF d'audit livré au client.</span>
          <span v-if="document?.audit_synthesis_generated_at" class="text-[11px] text-violet-700 italic">
            ✨ Générée le {{ new Date(document.audit_synthesis_generated_at).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }) }}
          </span>
          <StepValidateBadge class="ml-auto" :step="stepFor('synthesis')" @validate="validateStep" @invalidate="invalidateStep" />
        </template>
        <div class="px-5 py-4 space-y-3">
          <div class="flex items-center gap-2">
            <button
              @click="generateSynthesis"
              :disabled="synthesisGenerating"
              class="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50 rounded-lg transition shadow-sm"
            >
              <SparklesIcon class="w-4 h-4" :class="synthesisGenerating ? 'animate-pulse' : ''" />
              {{ synthesisGenerating
                  ? 'Génération en cours…'
                  : (synthesisHtml ? 'Régénérer avec Claude' : 'Rédiger avec Claude') }}
            </button>
            <p class="text-[11px] text-gray-500 italic">
              Claude lit l'intégralité de l'audit (zones, systèmes, compteurs, GTB, plan) et rédige une note client bienveillante et actionnable, sans inventer de données.
            </p>
          </div>
          <RichTextEditor
            :model-value="synthesisHtml"
            @update:model-value="onSynthesisInput"
            placeholder="Rédige la note de synthèse, ou clique sur 'Rédiger avec Claude' pour la pré-générer puis ajuste-la."
            min-height="240px"
          />
        </div>
      </CollapsibleSection>
    </div>

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
  </div>
</template>
