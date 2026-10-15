<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, inject, nextTick } from 'vue'
import { storeToRefs } from 'pinia'
import { WrenchScrewdriverIcon, PencilSquareIcon, DocumentArrowUpIcon } from '@heroicons/vue/24/outline'
import CollapsibleSection from '@/components/CollapsibleSection.vue'
import R175Tooltip from '@/components/R175Tooltip.vue'
import SectionHeader from '@/components/audit/SectionHeader.vue'
import BacsPhotoButton from '@/components/BacsPhotoButton.vue'
import VoiceNoteButton from '@/components/VoiceNoteButton.vue'
import PhotoDropzone from '@/components/PhotoDropzone.vue'
import VerticalStepper from '@/components/VerticalStepper.vue'
import BmsComponentsTable from '@/components/BmsComponentsTable.vue'
import ProtocolMultiPicker from '@/components/ProtocolMultiPicker.vue'
import Tooltip from '@/components/Tooltip.vue'
import SystemCategoryIcon from '@/components/SystemCategoryIcon.vue'
import MeterTypePill from '@/components/MeterTypePill.vue'
import MeterUsagePill from '@/components/MeterUsagePill.vue'
import BmsTopicNoteButton from '@/components/audit/BmsTopicNoteButton.vue'
import SegmentedToggle from '@/components/audit/SegmentedToggle.vue'
import CompactToggle from '@/components/SegmentedToggle.vue'
import { useAuditStore } from '@/stores/audit'
import { useNotification } from '@/composables/useNotification'
import { useConfirm } from '@/composables/useConfirm'
import {
  updateBacsDevice, updateBacsMeter, uploadSiteDocument, applyBuildyCloudPreset,
  listSiteDocuments, deleteSiteDocument, getSiteDocumentDownloadUrl,
} from '@/api'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import '@/lib/equipment-icons' // enregistre les icônes FA de la liste des documents d'AF
import DocumentViewerModal from '@/components/DocumentViewerModal.vue'
import { BUILDY_OFFER_LEVELS, buildyReserves, buildyOfferLabel } from '@/lib/buildy-offer'
import { flashAuditTarget } from '@/lib/audit-reveal'
import HelpTip from '@/components/HelpTip.vue'
import {
  BMS_LEVEL_LOCK_TIP, BMS_COLUMN_TIPS, BMS_INTEGRATED_TOGGLE_TIP, BMS_STATUS_TIPS, BMS_SYSTEM_LEVEL_CHECKS_TIP,
  bmsLevelTip, bmsOperationalTip, bmsMeterIntegratedTip, bmsUsageToggleLabel,
} from '@/lib/audit-tips-systems'
import RubricShell from '@/components/audit/guided/RubricShell.vue'
import AuditGuideRail from '@/components/audit/guided/AuditGuideRail.vue'
import RubricsFilter from '@/components/audit/guided/RubricsFilter.vue'
import { useAuditLayout } from '@/composables/useAuditLayout'
import { useStepRubrics } from '@/composables/useStepRubrics'
import { AUDIT_STEP_MODE_KEY } from '@/lib/audit-steps-ui'
import { bmsStepRubrics, bmsGuideTotals, nextBmsRubric, bmsRubricStatus, BMS_RUBRIC_GROUPS } from '@/lib/bms-guide'
import {
  RUBRICS_RESUME_TIP, RUBRICS_DONE_TEXT, BMS_GUIDE_TITLE,
  BMS_OUT_OF_SERVICE_NOTE, rubricsProgressLabel, rubricsResumeLabel,
} from '@/lib/audit-tips-guided'
import { library } from '@fortawesome/fontawesome-svg-core'
import {
  faTowerBroadcast, faIdCard, faShareNodes, faPowerOff, faFileLines, faMicrochip, faLayerGroup, faPlug,
  faChartLine, faShareFromSquare, faDatabase, faScrewdriverWrench,
} from '@fortawesome/free-solid-svg-icons'

// Icônes des rubriques de la mise en page « Nouvelle » (lib/bms-guide.js).
library.add(faTowerBroadcast, faIdCard, faShareNodes, faPowerOff, faFileLines, faMicrochip, faLayerGroup, faPlug,
  faChartLine, faShareFromSquare, faDatabase, faScrewdriverWrench)

// Section "Solution GTB / GTC en place" (R175-3 / R175-4 / R175-5).
// Lit l'etat depuis useAuditStore (bms, document, meters, devices) et
// recoit les computed lourds (bmsSteps, devicesWithMeta, metersPresent)
// en props pour eviter de les dupliquer.
const props = defineProps({
  bmsSteps: { type: Array, required: true },
  devicesWithMeta: { type: Array, required: true },
  metersPresent: { type: Array, required: true },
  systemLabels: { type: Object, required: true },
  protocolOptions: { type: Array, required: true },
  step: { type: Object, default: null },
  active: { type: Boolean, default: false },
})
const emit = defineEmits([
  'open-notes', 'validate-step', 'invalidate-step',
  'save-doc', 'refresh-audit-data', 'credentials-changed',
])

const audit = useAuditStore()
const { bms, document, meters } = storeToRefs(audit)
const { success, error } = useNotification()
const { confirm } = useConfirm()

// Sommaire cliquable (colonne de gauche) : saut vers le bloc de la carte et
// brève surbrillance. window.document : `document` est ici la ref Pinia.
function scrollToBmsBlock(anchor) {
  if (!anchor) return
  const el = window.document.getElementById(anchor)
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  flashAuditTarget(el)
}
// Rubriques de la carte qui ne sont pas des étapes de progression.
const bmsExtraBlocks = computed(() => [
  { anchor: 'bms-block-presence', label: 'Présence et offre Buildy Cloud' },
  ...(bms.value?.out_of_service ? [] : [{ anchor: 'bms-block-out-of-service', label: 'GTB hors service ?' }]),
  { anchor: 'bms-block-components', label: 'Composants matériels GTB' },
  ...(audit.isBacs ? [{ anchor: 'bms-block-data-storage', label: 'Conservation et accès aux données' }] : []),
])

// Modèle « Supervision Buildy Cloud » (mig 205) : l'auditeur choisit le
// niveau d'offre souscrit ; le serveur pré-remplit la carte en conséquence
// et crée l'accès « comptes nominatifs » de la carte 10. Doctrine du
// 2026-09-23 : conforme quel que soit le niveau, sous réserve des
// obligations du niveau (export des données, maintenance en Essentials).
const buildyReservesList = computed(() => buildyReserves(bms.value))
// Les réponses qui découlent du niveau d'offre sont celles du modèle (le
// rapport les lit ainsi) : verrouillées tant qu'un niveau est choisi.
const levelLocked = computed(() => !!bms.value?.buildy_offer_level)
// Carte des interrupteurs verrouillés (lib/audit-tips-systems.js) : pourquoi + quoi faire.
const levelLockTip = computed(() => (levelLocked.value ? BMS_LEVEL_LOCK_TIP : null))

// Question préalable (mig 206) : « La GTB en place est-elle une supervision
// Buildy ? ». Le choix du niveau d'offre n'apparaît que sur « Oui ». Une
// fiche qui a déjà un niveau choisi vaut « Oui » (audits antérieurs).
const isBuildySupervision = computed(() => {
  const v = bms.value?.is_buildy_supervision
  if (v === 1 || v === true) return true
  if (v === 0 || v === false) return false
  return bms.value?.buildy_offer_level ? true : null
})
async function setBuildySupervision(v) {
  // « Non » alors qu'un niveau était choisi : on retire le niveau (et donc
  // les réserves liées au niveau dans le plan), après confirmation.
  if (v === false && bms.value?.buildy_offer_level) {
    const ok = await confirm({
      title: 'Pas une supervision Buildy ?',
      message: `Le niveau d'offre Buildy Cloud (${buildyOfferLabel(bms.value.buildy_offer_level)}) sera retiré, ainsi que les réserves liées à ce niveau dans le plan. Les autres réponses de la carte GTB sont conservées.`,
      confirmLabel: 'Confirmer',
    })
    if (!ok) return
    bms.value.buildy_offer_level = null
  }
  bms.value.is_buildy_supervision = v == null ? null : (v ? 1 : 0)
  clearTimeout(saveTimer) // une sauvegarde en attente enverrait l'ancienne valeur
  try { await audit.saveBms() }
  catch { error('Sauvegarde GTB impossible') }
}
const applyingPreset = ref(false)
async function applyBuildyPreset(level) {
  if (applyingPreset.value) return
  const ok = await confirm({
    title: `Supervision Buildy Cloud — niveau ${buildyOfferLabel(level)}`,
    message: 'La carte GTB est pré-remplie pour ce niveau. Les réponses qui en dépendent (conservation 5 ans, détection des dérives, transmission aux exploitants, maintenance) sont mises à jour ; les autres champs déjà saisis sont conservés. L\'accès « comptes nominatifs » est ajouté à l\'étape 10 · Accès s\'il n\'existe pas.',
    confirmLabel: 'Appliquer',
  })
  if (!ok) return
  clearTimeout(saveTimer) // une sauvegarde en attente écraserait le modèle
  applyingPreset.value = true
  try {
    const { data } = await applyBuildyCloudPreset(audit.docId, level)
    Object.assign(bms.value, data.bms)
    audit.refreshActionItems().catch(() => {})
    if (data.credential_created) emit('credentials-changed')
    success(`Supervision Buildy Cloud ${buildyOfferLabel(level)} appliquée${data.credential_created ? ' — accès ajouté à l\'étape 10 · Accès' : ''}`)
  } catch (e) {
    error(e.response?.data?.detail || 'Application du modèle impossible')
  } finally {
    applyingPreset.value = false
  }
}

// Dropzone "Analyse fonctionnelle GTB existante" — accepte PDF/Word/image
// (contrairement à PhotoDropzone qui n'accepte que les images). Catégorie
// fixée à 'analyse_fonctionnelle', rattachement à `bacs_audit_bms_document_id`.
const afDragOver = ref(false)
const afFileInput = ref(null)
const afUploading = ref(false)
async function uploadAfFiles(files) {
  if (!document.value?.site_uuid || !files?.length) return
  afUploading.value = true
  try {
    for (const f of files) {
      const fd = new FormData()
      fd.append('file', f)
      await uploadSiteDocument(document.value.site_uuid, fd, {
        title: f.name.replace(/\.[^.]+$/, ''),
        category: 'analyse_fonctionnelle',
        bacs_audit_bms_document_id: bms.value?.document_id || null,
      })
    }
    success(files.length > 1 ? `${files.length} documents téléversés` : 'Document téléversé')
    // Un document déposé prouve que l'AF existe : « Oui » si non répondu.
    if (document.value?.audit_existing_af_status == null) {
      emit('save-doc', { audit_existing_af_status: 'present' })
    }
    window.dispatchEvent(new CustomEvent('site-documents:changed'))
    emit('refresh-audit-data')
  } catch (e) {
    error(e.response?.data?.detail || 'Upload impossible')
  } finally {
    afUploading.value = false
  }
}

// Documents d'analyse fonctionnelle déjà déposés (catégorie
// « analyse_fonctionnelle » des documents du site) : listés sous la zone de
// dépôt, avec aperçu, téléchargement et suppression. Rechargés à chaque
// ajout ou suppression de document (événement `site-documents:changed`).
const afDocs = ref([])
// Liste chargée une première fois : les rubriques ouvertes par défaut (mise en page « Nouvelle »)
// attendent ce chargement, sinon « Analyse fonctionnelle » s'ouvrait le temps de la requête.
const afDocsLoaded = ref(false)
const afViewerDoc = ref(null)
async function loadAfDocs() {
  const uuid = document.value?.site_uuid
  if (!uuid) { afDocs.value = []; afDocsLoaded.value = true; return }
  try {
    const { data } = await listSiteDocuments(uuid, { category: 'analyse_fonctionnelle' })
    afDocs.value = data || []
  } catch { /* liste indisponible : la zone de dépôt reste utilisable */ }
  afDocsLoaded.value = true
}
watch(() => document.value?.site_uuid, loadAfDocs, { immediate: true })
onMounted(() => window.addEventListener('site-documents:changed', loadAfDocs))
onBeforeUnmount(() => window.removeEventListener('site-documents:changed', loadAfDocs))

function afIsPreviewable(d) {
  return d.mime_type === 'application/pdf' || /^image\//.test(d.mime_type || '')
}
function openAfDoc(d) {
  if (afIsPreviewable(d)) afViewerDoc.value = d
  else window.location.href = getSiteDocumentDownloadUrl(d.id)
}
async function removeAfDoc(d) {
  const ok = await confirm({
    title: 'Supprimer ce document ?',
    message: `« ${d.title} » sera supprimé des documents du site.`,
    confirmLabel: 'Supprimer', danger: true,
  })
  if (!ok) return
  try {
    await deleteSiteDocument(d.id)
    success('Document supprimé')
    window.dispatchEvent(new CustomEvent('site-documents:changed'))
  } catch (e) {
    error(e.response?.data?.detail || 'Suppression impossible')
  }
}
function afSize(b) {
  if (!b) return ''
  if (b < 1024 * 1024) return `${Math.max(1, Math.round(b / 1024))} Ko`
  return `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} Mo`
}
function afDate(s) {
  if (!s) return ''
  // SQLite CURRENT_TIMESTAMP = UTC sans fuseau.
  const d = new Date(/Z|[+-]\d\d:?\d\d$/.test(s) ? s : `${s.replace(' ', 'T')}Z`)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
}
function onAfDrop(e) {
  afDragOver.value = false
  const files = Array.from(e.dataTransfer?.files || [])
  if (!files.length) return
  uploadAfFiles(files)
}
function onAfPick(e) {
  uploadAfFiles(Array.from(e.target.files || []))
  e.target.value = ''
}

// Présence de la GTB (Feature G) : 1 = présente, 0 = pas de GTB.
async function setGtbPresent(val) {
  bms.value.present = val
  try { await audit.saveBms() }
  catch { error('Sauvegarde GTB impossible') }
}

let saveTimer = null
function saveBmsDebounced() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(async () => {
    try { await audit.saveBms() }
    catch { error('Sauvegarde GTB impossible') }
  }, 500)
}

// Tri-état pour les SegmentedToggle : null → aucun bouton sélectionné.
const triState = (v) => (v == null ? null : !!v)

// Filtre les listes "intégrés à la GTB" par les usages que la GTB traite
// effectivement (toggles "Usages traités" ci-dessus). Si la GTB ne traite
// AUCUN usage (rien coché), on n'affiche AUCUN équipement/compteur — la
// question "intégrés à la GTB" n'a pas de sens.
const gtbManagesCategory = (cat) => {
  if (!bms.value) return false
  switch (cat) {
    case 'heating': return !!bms.value.manages_heating
    case 'cooling': return !!bms.value.manages_cooling
    case 'ventilation': return !!bms.value.manages_ventilation
    case 'dhw': return !!bms.value.manages_dhw
    case 'lighting_indoor':
    case 'lighting_outdoor': return !!bms.value.manages_lighting
    default: return false
  }
}
const gtbManagesMeterUsage = (usage) => {
  if (!bms.value) return false
  switch (usage) {
    case 'heating': return !!bms.value.manages_heating
    case 'cooling': return !!bms.value.manages_cooling
    case 'ventilation': return !!bms.value.manages_ventilation
    case 'dhw': return !!bms.value.manages_dhw
    case 'lighting': return !!bms.value.manages_lighting
    case 'pv': return !!(bms.value.manages_electricity_production || bms.value.manages_electricity)
    case 'other':
      // Compteurs généraux du bâtiment (électrique/gaz/thermique global,
      // zone_id NULL) : utiles dès qu'un usage BACS quelconque est
      // supervisé par la GTB.
      return !!(
        bms.value.manages_heating || bms.value.manages_cooling ||
        bms.value.manages_ventilation || bms.value.manages_dhw ||
        bms.value.manages_lighting
      )
    default: return false
  }
}
const anyUsageManaged = computed(() => !!bms.value && (
  bms.value.manages_heating || bms.value.manages_cooling ||
  bms.value.manages_ventilation || bms.value.manages_dhw ||
  bms.value.manages_lighting
))
// Périmètre GTB par équipement : défaut = usage (gtbManagesCategory), surchargé
// par gtb_scope_override (1/true = forcé dans, 0/false = forcé hors, null = usage).
const gtbInScope = (d) => {
  if (d.gtb_scope_override === 1 || d.gtb_scope_override === true) return true
  if (d.gtb_scope_override === 0 || d.gtb_scope_override === false) return false
  return gtbManagesCategory(d.system_category)
}
const filteredDevices = computed(() =>
  props.devicesWithMeta.filter(gtbInScope))
const filteredMeters = computed(() =>
  props.metersPresent.filter(m => gtbManagesMeterUsage(m.usage)))

// ─── Mise en page « Nouvelle » : rubriques repliables et guide de gauche ─────────
// Mêmes blocs, mêmes réponses : chaque bloc devient une rubrique (RubricShell) avec son état
// (lib/bms-guide.js), comme la fiche équipement de l'étape Systèmes. Le sommaire de gauche
// devient le guide des rubriques. La mise en page actuelle est inchangée.
const stepMode = inject(AUDIT_STEP_MODE_KEY, null)
const { isGuidedLayout } = useAuditLayout()
const guided = computed(() => !!stepMode?.enabled && isGuidedLayout.value)
const componentsCount = ref(null)
// Même calcul que la règle de validation de l'étape (STEP_DEFINITIONS.bms de la vue).
const rubrics = computed(() => bmsStepRubrics(bms.value, {
  isBacs: audit.isBacs,
  offerLabel: buildyOfferLabel,
  afStatus: document.value?.audit_existing_af_status ?? null,
  afDocsCount: afDocs.value.length,
  protocolLabel: (v) => props.protocolOptions.find(o => o.value === v)?.label || v,
  componentsCount: componentsCount.value,
  devicesWithMeta: props.devicesWithMeta,
  metersPresent: props.metersPresent,
}))
const rubricByKey = computed(() => Object.fromEntries(rubrics.value.map(r => [r.key, r])))
const rubricTotals = computed(() => bmsGuideTotals(rubrics.value))
// Ouverture : le reste à faire d'abord (rubriques incomplètes ouvertes), ou toute l'étape (choix
// mémorisé, commun aux étapes à rubriques) — composables/useStepRubrics.js.
const {
  showAll: showAllRubrics, setShowAll: setShowAllRubrics, showTodo: showTodoRubrics,
  isOpen: isRubricOpen, toggle: toggleRubric, goTo: goToRubric, active: activeRubric,
} = useStepRubrics(rubrics, () => [guided.value, bms.value?.document_id, afDocsLoaded.value])
// Propriétés d'une rubrique pour RubricShell.
function rubric(key) {
  const r = rubricByKey.value[key]
  if (!r) return { title: '', open: true }
  return { title: r.title, icon: r.icon, missing: r.missing, unanswered: r.unanswered, summary: r.summary,
    muted: r.optional, open: isRubricOpen(key) }
}
// Guide de gauche : un clic ouvre la rubrique et l'amène à l'écran ; « Reprendre » enchaîne.
function resumeRubrics() {
  const n = nextBmsRubric(rubrics.value, activeRubric.value)
  if (n) goToRubric(n.key)
}
const railGroups = computed(() => BMS_RUBRIC_GROUPS
  .map(g => ({
    key: g.key,
    label: g.label,
    items: rubrics.value.filter(r => r.group === g.key)
      .map(r => { const status = bmsRubricStatus(r); return { key: r.key, title: r.title, icon: r.icon, status, mark: status.mark } }),
  }))
  .filter(g => g.items.length))
const railProgress = computed(() => ({
  done: rubricTotals.value.done,
  total: rubricTotals.value.count,
  label: rubricsProgressLabel(rubricTotals.value.done, rubricTotals.value.count),
}))
const resumeCount = computed(() => rubrics.value.filter(r => r.state !== 'done').length)
// Les questions sans réponse bloquent la validation : elles sont dans « Reste à faire » du bandeau
// (STEP_DEFINITIONS.bms de la vue), plus dans « Encore à renseigner ».
// Titres de blocs : en majuscules dans la mise en page actuelle, en phrase dans les rubriques.
const blockTitleCls = computed(() => (guided.value
  ? 'text-[13px] font-semibold text-slate-800'
  : 'text-xs font-semibold text-gray-700 uppercase tracking-wider'))

// Ordre canonique des catégories/usages BACS pour tri intra-groupe.
const CATEGORY_ORDER = ['heating', 'cooling', 'ventilation', 'dhw',
  'lighting_indoor', 'lighting_outdoor', 'electricity_production']
const catRank = (c) => {
  const i = CATEGORY_ORDER.indexOf(c)
  return i < 0 ? 99 : i
}
const USAGE_ORDER = ['heating', 'cooling', 'ventilation', 'dhw', 'lighting', 'pv', 'other']
const usageRank = (u) => {
  const i = USAGE_ORDER.indexOf(u)
  return i < 0 ? 99 : i
}
// Labels lisibles pour les types de compteur (source de l'énergie).
const METER_TYPE_LABEL = {
  electric: 'Électrique',
  electric_production: 'Électrique de production',
  gas: 'Gaz',
  thermal: 'Thermique',
  water: 'Eau',
}
const METER_TYPE_ORDER = ['electric', 'gas', 'thermal', 'electric_production', 'water']
const meterTypeRank = (t) => {
  const i = METER_TYPE_ORDER.indexOf(t)
  return i < 0 ? 99 : i
}

// Équipements groupés par zone, puis triés par usage.
const devicesByZone = computed(() => {
  const groups = new Map()
  for (const d of filteredDevices.value) {
    const key = d.zone_name || 'Sans zone'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(d)
  }
  const out = []
  for (const [zone, arr] of groups) {
    arr.sort((a, b) => catRank(a.system_category) - catRank(b.system_category) || (a.name || '').localeCompare(b.name || ''))
    out.push({ zone, devices: arr })
  }
  out.sort((a, b) => a.zone.localeCompare(b.zone))
  return out
})

// Compteurs groupés par type d'énergie, puis par zone, puis triés par usage.
const metersByEnergyThenZone = computed(() => {
  const byType = new Map()
  for (const m of filteredMeters.value) {
    if (!byType.has(m.meter_type)) byType.set(m.meter_type, new Map())
    const zoneKey = m.zone_id ? (m.zone_name || 'Zone ?') : 'Général bâtiment'
    const byZone = byType.get(m.meter_type)
    if (!byZone.has(zoneKey)) byZone.set(zoneKey, [])
    byZone.get(zoneKey).push(m)
  }
  const out = []
  for (const [type, byZone] of byType) {
    const zones = []
    for (const [zone, arr] of byZone) {
      arr.sort((a, b) => usageRank(a.usage) - usageRank(b.usage))
      zones.push({ zone, meters: arr })
    }
    zones.sort((a, b) => {
      // « Général bâtiment » toujours en premier de son groupe énergie.
      if (a.zone === 'Général bâtiment') return -1
      if (b.zone === 'Général bâtiment') return 1
      return a.zone.localeCompare(b.zone)
    })
    out.push({ type, typeLabel: METER_TYPE_LABEL[type] || type, zones })
  }
  out.sort((a, b) => meterTypeRank(a.type) - meterTypeRank(b.type))
  return out
})
// Bascule un champ booléen de la GTB (1/0) + sauvegarde debounced.
function setBmsFlag(field, v) {
  bms.value[field] = v == null ? null : (v ? 1 : 0)
  saveBmsDebounced()
}

// Le refresh du plan d'action + cumul puissance est debouncé : si l'utilisateur
// enchaine plusieurs clics rapides (ce qui arrive sur les tables GTB où on coche
// 10-20 équipements à la suite), on ne déclenche qu'un seul recalcul après 800ms
// d'inactivité au lieu d'un par clic.
let actionItemsRefreshTimer = null
function scheduleActionItemsRefresh() {
  clearTimeout(actionItemsRefreshTimer)
  actionItemsRefreshTimer = setTimeout(() => {
    audit.refreshActionItems().catch(() => {})
  }, 800)
}

async function patchDeviceMb(d, patch) {
  // Cohérence "Operationnel" : si on decoche Integré, on remet aussi
  // l'autre flag a false pour eviter un etat aberrant. (Boolean : le
  // schema serveur z.boolean() refuse les 0/1 et renvoie 400.)
  const fullPatch = { ...patch }
  if ('managed_by_bms' in patch && patch.managed_by_bms === false) {
    fullPatch.bms_integration_out_of_service = false
  }
  // HS + intégré = non opérationnel (miroir de la règle serveur).
  if (patch.managed_by_bms === true && d.out_of_service) {
    fullPatch.bms_integration_out_of_service = true
  }
  Object.assign(d, fullPatch)
  // BUG FIX #10 — `d` provient de devicesWithMeta qui SPREAD chaque device
  // (`...d`) et renvoie une copie plain non reactive par le proxy Vue.
  // Muter la copie n'invalide donc pas le computed devicesWithMeta, et
  // l'UI ne se rafraichit qu'apres le PATCH+debounce+refetch (~1.5s).
  // Mutation directe du device dans le store → devicesWithMeta re-compute
  // instantanement → l'UI reagit sur le premier clic.
  const storeDevice = (audit.devices || []).find(x => x.id === d.id)
  if (storeDevice) Object.assign(storeDevice, fullPatch)
  // PATCH non bloquant : le toggle a déjà réagi visuellement via Object.assign,
  // pas besoin de attendre la réponse serveur pour rendre la main à l'utilisateur.
  updateBacsDevice(d.id, fullPatch)
    .then(scheduleActionItemsRefresh)
    .catch(() => error('Sauvegarde équipement impossible'))
}

async function patchMeter(m, patch) {
  const fullPatch = { ...patch }
  if ('managed_by_bms' in patch && patch.managed_by_bms === false) {
    fullPatch.bms_integration_out_of_service = false
  }
  // HS + intégré = non opérationnel (miroir de la règle serveur).
  if (patch.managed_by_bms === true && m.out_of_service) {
    fullPatch.bms_integration_out_of_service = true
  }
  Object.assign(m, fullPatch)
  // Idem devicesWithMeta : metersPresent peut être un simple filter sur
  // le store, mais on sécurise en synchronisant explicitement le store
  // (aligné sur le pattern patchDeviceMb ci-dessus).
  const storeMeter = (audit.meters || []).find(x => x.id === m.id)
  if (storeMeter) Object.assign(storeMeter, fullPatch)
  updateBacsMeter(m.id, fullPatch)
    .then(scheduleActionItemsRefresh)
    .catch(() => error('Sauvegarde compteur impossible'))
}

function hasNotes(html) {
  if (!html) return false
  return html.replace(/<[^>]*>/g, '').trim().length > 0
}
</script>

<template>
  <CollapsibleSection storage-key="bms" section-id="section-bms" :active="active">
    <template #header>
      <SectionHeader number="6"
                     :title="audit.isBacs ? 'Solution GTB / GTC en place' : 'Solution de supervision en place'"
                     :subtitle="audit.isBacs ? 'Ce que sait faire la GTB, son entretien et la formation de l’exploitant' : 'Inventaire du superviseur en place'"
                     :icon="WrenchScrewdriverIcon" icon-color="text-purple-600"
                     :step="step"
                     @validate="emit('validate-step', $event)"
                     @invalidate="emit('invalidate-step', $event)">
        <template v-if="audit.isBacs" #subtitle-extra>
          <R175Tooltip article="R175-3" />
          <R175Tooltip article="R175-4" />
          <R175Tooltip article="R175-5" />
        </template>
        <template #actions>
          <button
            type="button"
            @click="emit('open-notes', { title: 'Notes GTB', contextLabel: 'Solution GTB / GTC : ' + (bms.existing_solution || 'a renseigner'), entityType: 'bms', entityRef: bms, currentHtml: bms.notes_html || '' })"
            :class="['inline-flex items-center justify-center p-1.5 rounded-md transition',
              hasNotes(bms.notes_html)
                ? 'text-indigo-700 bg-indigo-50 hover:bg-indigo-100'
                : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100']"
            v-tooltip="hasNotes(bms.notes_html) ? 'Modifier les notes de la GTB' : 'Ajouter une note sur la GTB'">
            <PencilSquareIcon class="w-4 h-4" />
          </button>
          <BacsPhotoButton
            v-if="document?.site_uuid && bms.document_id"
            :site-uuid="document.site_uuid"
            :attach-to="{ bms_document_id: bms.document_id }"
            label="GTB" size="md" />
          <VoiceNoteButton
            v-if="document?.site_uuid && bms.document_id"
            :site-uuid="document.site_uuid"
            :attach-to="{ bms_document_id: bms.document_id }"
            label="GTB" size="md" />
        </template>
      </SectionHeader>
    </template>
    <template #summary>
      <span v-if="bms.present === 0" class="italic">Pas de GTB sur le site</span>
      <span v-else-if="bms.existing_solution">
        {{ bms.existing_solution }}<span v-if="bms.existing_solution_brand"> · {{ bms.existing_solution_brand }}</span>
        · suivi 5 ans {{ bms.meets_r175_3_p1 == null ? '?' : (bms.meets_r175_3_p1 ? '✓' : '✗') }}
        · détection dérives {{ bms.meets_r175_3_p2 == null ? '?' : (bms.meets_r175_3_p2 ? '✓' : '✗') }}
        · maintenance {{ bms.has_maintenance_procedures == null ? '?' : (bms.has_maintenance_procedures ? '✓' : '✗') }}
      </span>
      <span v-else class="italic">GTB non renseignée</span>
    </template>
    <PhotoDropzone
      :site-uuid="document?.site_uuid || ''"
      :attach-to="{ bms_document_id: bms.document_id }"
      :enabled="!!(document?.site_uuid && bms.document_id)"
      @changed="emit('refresh-audit-data')">
      <!-- Mise en page « Nouvelle » (GTB présente) : une grille, le guide à gauche sur toute la
           hauteur, la rubrique Présence puis les autres rubriques à droite. -->
      <div :class="guided && bms.present === 1
        ? 'bg-slate-50/70 rounded-b-xl px-5 py-5 grid grid-cols-1 lg:grid-cols-[256px_1fr] gap-x-4 gap-y-3 items-start'
        : 'bg-slate-50/70 rounded-b-xl'">
      <!-- Présence de la GTB : mêmes cases que présent/non concerné des
           usages (card 4). « Pas de GTB » masque toute la saisie R175. -->
      <div :class="!guided ? 'px-5 pt-5 pb-1' : bms.present === 1 ? 'min-w-0 lg:col-start-2 lg:row-start-1' : 'px-5 py-5'">
        <RubricShell :guided="guided" id="bms-block-presence" cls="audit-subcard" v-bind="rubric('presence')"
                     @toggle="toggleRubric('presence')">
        <div class="flex flex-wrap items-center gap-3">
          <p :class="guided ? 'text-sm text-gray-800' : 'text-xs font-semibold text-gray-700 uppercase tracking-wider'">
            Une GTB est-elle présente sur le site ?
          </p>
          <SegmentedToggle :model-value="triState(bms.present)"
                           @update:model-value="v => setGtbPresent(v ? 1 : 0)" />
        </div>
        <p v-if="bms.present == null" class="text-xs text-amber-600 mt-3">
          Indique d'abord si une GTB est présente pour saisir la suite.
        </p>
        <p v-else-if="bms.present === 0" class="text-xs text-gray-500 mt-3">
          Aucune GTB sur le site — une action « Installer une GTB » est ajoutée au plan de mise en conformité.
        </p>

        <!-- Question préalable (mig 206) : le niveau d'offre Buildy Cloud n'a
             de sens que si la GTB en place est une supervision Buildy. -->
        <div v-if="bms.present !== 0" class="mt-4 flex flex-wrap items-center gap-3">
          <p :class="guided ? 'text-sm text-gray-800' : 'text-xs font-semibold text-gray-700 uppercase tracking-wider'">
            La GTB en place est-elle une supervision Buildy ?
          </p>
          <SegmentedToggle :model-value="isBuildySupervision"
                           @update:model-value="setBuildySupervision" />
        </div>

        <!-- Modèle « Supervision Buildy Cloud » : pré-remplissage selon le niveau d'offre. -->
        <div v-if="bms.present !== 0 && isBuildySupervision === true" class="mt-3 rounded-lg border border-gray-200 bg-gray-50/50 px-3 py-2.5">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="text-xs text-gray-700 leading-snug flex-1 min-w-60">
              <div class="font-medium text-gray-800">Quel niveau d'offre Buildy Cloud est souscrit ?</div>
              <div class="text-gray-500 mt-0.5">La carte est pré-remplie pour ce niveau et l'accès « comptes nominatifs » est ajouté à l'étape 10 · Accès.</div>
            </div>
            <!-- Ce que comprend chaque niveau : carte au survol (lib/audit-tips-systems.js). -->
            <div class="inline-flex rounded-lg border border-gray-200 overflow-hidden shrink-0">
              <Tooltip v-for="(lvl, i) in BUILDY_OFFER_LEVELS" :key="lvl.value" :text="bmsLevelTip(lvl.value)">
                <button type="button"
                        :disabled="applyingPreset"
                        @click="applyBuildyPreset(lvl.value)"
                        :class="['h-7 px-3 text-xs font-medium transition whitespace-nowrap disabled:opacity-50',
                                 i > 0 ? 'border-l border-gray-200' : '',
                                 bms.buildy_offer_level === lvl.value ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50']">
                  {{ lvl.label }}
                </button>
              </Tooltip>
            </div>
          </div>
          <div v-if="audit.isBacs && bms.buildy_offer_level && buildyReservesList.length"
               class="mt-2.5 text-xs text-indigo-900 bg-indigo-50 border border-indigo-200 rounded-md px-3 py-2 leading-snug">
            <strong>Conforme au décret BACS, sous réserves.</strong>
            Le niveau {{ buildyOfferLabel(bms.buildy_offer_level) }} assure les fonctions exigées par le décret. Le rapport met en évidence les obligations suivantes, ajoutées au plan comme réserves :
            <ul class="list-disc ml-4 mt-1 space-y-0.5">
              <li v-for="r in buildyReservesList" :key="r.key">{{ r.label }} <R175Tooltip :article="r.article" class="align-middle" /></li>
            </ul>
          </div>
          <div v-else-if="audit.isBacs && bms.buildy_offer_level"
               class="mt-2.5 text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2 leading-snug">
            Le niveau {{ buildyOfferLabel(bms.buildy_offer_level) }} assure les fonctions exigées par le décret, sans réserve liée au niveau d'offre. La formation de l'exploitant reste à attester.
          </div>
        </div>
        </RubricShell>
      </div>

      <div v-if="bms.present === 1"
           :class="guided ? 'contents' : 'px-5 pt-3 pb-5 grid grid-cols-1 lg:grid-cols-[200px_1fr] gap-5'">
        <!-- Sommaire collant sous les en-têtes (page + carte) : un clic saute au bloc.
             Mise en page « Nouvelle » : le guide des rubriques, avec leur état. -->
        <aside class="sticky self-start" :class="guided ? 'lg:col-start-1 lg:row-start-1 lg:row-span-2' : ''"
               :style="{ top: 'calc(var(--audit-sticky-offset, 0px) + 76px)' }">
          <div v-if="guided" data-bms-guide
               class="bg-white rounded-xl ring-1 ring-slate-200 shadow-sm overflow-y-auto max-h-[calc(100vh-var(--audit-sticky-offset,0)-96px)]">
            <AuditGuideRail :title="BMS_GUIDE_TITLE" :progress="railProgress" :groups="railGroups"
                            :active-key="activeRubric" aria-label="Rubriques de la GTB"
                            :resume-label="resumeCount ? rubricsResumeLabel(resumeCount) : ''"
                            :resume-tip="RUBRICS_RESUME_TIP" :done-text="RUBRICS_DONE_TEXT"
                            @select="goToRubric" @resume="resumeRubrics" />
          </div>
          <div v-else class="bg-white rounded-xl border border-slate-200 p-3">
            <h4 class="text-[11px] font-medium font-semibold text-gray-500 mb-3">Progression de la saisie</h4>
            <VerticalStepper :steps="bmsSteps" clickable @select="(i, s) => scrollToBmsBlock(s.anchor)" />
            <div class="mt-4 pt-3 border-t border-gray-100">
              <h4 class="text-[11px] font-medium text-gray-500 mb-1.5">Autres rubriques</h4>
              <ul class="space-y-0.5">
                <li v-for="b in bmsExtraBlocks" :key="b.anchor">
                  <button type="button" @click="scrollToBmsBlock(b.anchor)"
                          class="w-full text-left text-xs text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md -mx-1 px-1 py-0.5 transition">
                    {{ b.label }}
                  </button>
                </li>
              </ul>
            </div>
          </div>
        </aside>
        <div :class="guided ? 'flex flex-col gap-3 min-w-0 lg:col-start-2 lg:row-start-2' : 'space-y-4 min-w-0'">
          <!-- Mise en page « Nouvelle » : le reste à faire d'abord, ou toute l'étape (choix mémorisé). -->
          <div v-if="guided" class="flex flex-wrap items-center justify-between gap-2">
            <p v-if="bms.out_of_service" class="text-xs text-slate-600">{{ BMS_OUT_OF_SERVICE_NOTE }}</p>
            <RubricsFilter class="ml-auto" :show-all="showAllRubrics" @todo="showTodoRubrics" @all="setShowAllRubrics(true)" />
          </div>
          <RubricShell :guided="guided" id="bms-block-identification" cls="audit-subcard" v-bind="rubric('identification')"
                       @toggle="toggleRubric('identification')">
          <h3 v-if="!guided" class="text-xs font-semibold text-gray-700 uppercase tracking-wider mb-3">Identification de la GTB</h3>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label class="block text-xs font-medium text-gray-700 mb-1">Solution en place</label>
              <input v-model="bms.existing_solution" type="text"
                     placeholder="ex : Niagara, Schneider EcoStruxure, Buildy…"
                     @input="saveBmsDebounced"
                     class="input-base" />
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-700 mb-1">Marque / éditeur</label>
              <input v-model="bms.existing_solution_brand" type="text" placeholder="—"
                     @input="saveBmsDebounced"
                     class="input-base" />
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-700 mb-1">Localisation</label>
              <input v-model="bms.location" type="text" placeholder="ex : Local technique sous-sol"
                     @input="saveBmsDebounced"
                     class="input-base" />
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-700 mb-1">Référence modèle</label>
              <input v-model="bms.model_reference" type="text" placeholder="ex : JACE 8000"
                     @input="saveBmsDebounced"
                     class="input-base" />
            </div>
          </div>
          </RubricShell>
          <RubricShell :guided="guided" id="bms-block-protocols" :cls="['audit-subcard', bms.out_of_service ? 'opacity-70' : '']"
                       v-bind="rubric('protocols')" @toggle="toggleRubric('protocols')">
            <div>
              <label class="block text-xs font-medium text-gray-700 mb-1">
                Protocoles de partage des données
                <span class="text-gray-400 font-normal">— vers la supervision Buildy ou un tiers</span>
              </label>
              <ProtocolMultiPicker
                :model-value="bms.provided_protocols"
                :options="protocolOptions"
                size="sm"
                placeholder="Aucun protocole renseigné"
                @update:modelValue="v => { bms.provided_protocols = v; saveBmsDebounced() }" />
            </div>
          </RubricShell>

          <RubricShell :guided="guided" id="bms-block-out-of-service" cls="audit-subcard"
                       v-bind="rubric('out-of-service')" @toggle="toggleRubric('out-of-service')">
            <div class="flex items-center gap-3">
              <span class="text-sm text-gray-700 font-medium">La GTB est-elle hors service ?</span>
              <SegmentedToggle :model-value="triState(bms.out_of_service)"
                               @update:model-value="v => setBmsFlag('out_of_service', v)" />
            </div>
            <p class="text-[11px] text-gray-400 mt-0.5">Le plan d'actions ignore alors les exigences sur la GTB. Les rubriques restent modifiables (notes comprises) pour garder une trace.</p>
          </RubricShell>

          <RubricShell :guided="guided" id="bms-block-af" cls="audit-subcard" v-bind="rubric('af')" @toggle="toggleRubric('af')">
            <div class="flex items-center justify-between gap-2 mb-2">
              <h3 v-if="!guided" class="text-xs font-semibold text-gray-700 uppercase tracking-wider">
                Analyse fonctionnelle de la GTB existante
              </h3>
              <BmsTopicNoteButton class="ml-auto" topic-key="analyse_fonctionnelle"
                                  topic-label="Analyse fonctionnelle de la GTB existante"
                                  @open-notes="emit('open-notes', $event)" />
            </div>
            <!-- La question d'abord : sur « Non », pas de zone de dépôt. -->
            <div class="flex items-center gap-3 mb-3">
              <span class="text-xs text-gray-700">Le document d'analyse fonctionnelle existe-t-il ?</span>
              <SegmentedToggle :model-value="document?.audit_existing_af_status == null ? null : (document?.audit_existing_af_status === 'absent' ? false : true)"
                               @update:model-value="v => emit('save-doc', { audit_existing_af_status: v === false ? 'absent' : (v === true ? 'present' : null) })" />
            </div>
            <div v-if="document?.audit_existing_af_status !== 'absent'">
              <div
                :class="[
                  'border-2 border-dashed rounded-lg px-4 py-5 text-center transition cursor-pointer',
                  afDragOver
                    ? 'border-indigo-500 bg-indigo-50'
                    : 'border-gray-300 bg-gray-50/40 hover:border-indigo-400 hover:bg-indigo-50/30',
                ]"
                @dragover.prevent="afDragOver = true"
                @dragleave.prevent="afDragOver = false"
                @drop.prevent="onAfDrop"
                @click="afFileInput?.click()"
              >
                <input ref="afFileInput" type="file" class="hidden" multiple
                       accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.webp"
                       @change="onAfPick" />
                <DocumentArrowUpIcon :class="['w-8 h-8 mx-auto', afDragOver ? 'text-indigo-500' : 'text-gray-400']" />
                <p class="mt-2 text-sm text-gray-700">
                  <span v-if="afUploading">Téléversement en cours…</span>
                  <span v-else>
                    {{ afDocs.length ? 'Glisser un autre document ici ou' : 'Glisser le document d\'analyse fonctionnelle ici ou' }}
                    <span class="text-indigo-600 font-semibold">parcourir</span>
                  </span>
                </p>
                <p class="mt-1 text-[11px] text-gray-400">PDF, Word, schéma, image…</p>
              </div>
              <ul v-if="afDocs.length" class="mt-2 divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
                <li v-for="d in afDocs" :key="d.id" class="flex items-center gap-2 px-3 py-2">
                  <FontAwesomeIcon :icon="['fas', d.mime_type === 'application/pdf' ? 'file-pdf' : 'file-lines']"
                                   class="h-4 w-4 shrink-0 text-gray-400" />
                  <!-- Étiquette = action + nom complet du document (souvent coupé). -->
                  <button type="button" @click="openAfDoc(d)"
                          class="min-w-0 flex-1 truncate text-left text-sm text-gray-800 hover:text-indigo-700"
                          v-tooltip="afIsPreviewable(d) ? `Voir l’aperçu de « ${d.title} »` : `Télécharger « ${d.title} »`">{{ d.title }}</button>
                  <span class="shrink-0 text-[11px] text-gray-400"
                        v-tooltip="afDate(d.uploaded_at) ? `Déposé le ${afDate(d.uploaded_at)}` : null">
                    {{ [afSize(d.size_bytes), afDate(d.uploaded_at)].filter(Boolean).join(' · ') }}
                  </span>
                  <a :href="getSiteDocumentDownloadUrl(d.id)"
                     class="shrink-0 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                     v-tooltip="'Télécharger ce document'">
                    <FontAwesomeIcon :icon="['fas', 'file-arrow-down']" class="h-3.5 w-3.5" />
                  </a>
                  <button type="button" @click="removeAfDoc(d)"
                          class="shrink-0 rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                          v-tooltip="'Supprimer ce document'">
                    <FontAwesomeIcon :icon="['fas', 'trash-can']" class="h-3.5 w-3.5" />
                  </button>
                </li>
              </ul>
              <div v-if="document?.site_uuid" class="mt-2 flex justify-end gap-1">
                <BacsPhotoButton
                  :site-uuid="document.site_uuid"
                  :attach-to="{ bms_document_id: bms.document_id }"
                  label="Photo du schéma" size="sm" />
                <VoiceNoteButton
                  :site-uuid="document.site_uuid"
                  :attach-to="{ bms_document_id: bms.document_id }"
                  label="GTB" size="sm" />
              </div>
            </div>
            <p v-else class="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
              ⚠ Aucun document d'<strong>analyse fonctionnelle</strong> n'est disponible pour la GTB existante.
            </p>
            <DocumentViewerModal :doc="afViewerDoc" @close="afViewerDoc = null" />
          </RubricShell>

          <RubricShell v-if="audit.docId" :guided="guided" id="bms-block-components" :cls="['audit-subcard', bms.out_of_service ? 'opacity-70' : '']"
                       v-bind="rubric('components')" @toggle="toggleRubric('components')">
            <BmsComponentsTable :document-id="audit.docId" :hide-title="guided" @count="n => (componentsCount = n)" />
          </RubricShell>

          <RubricShell :guided="guided" id="bms-block-usages" :cls="['audit-subcard', bms.out_of_service ? 'opacity-70' : '']"
                       v-bind="rubric('usages')" @toggle="toggleRubric('usages')">
            <div class="flex items-center justify-between gap-2 mb-2">
              <h3 v-if="!guided" class="text-xs font-semibold text-gray-700 uppercase tracking-wider">Usages traités par la GTB</h3>
              <BmsTopicNoteButton class="ml-auto" topic-key="usages" topic-label="Usages traités par la GTB"
                                  @open-notes="emit('open-notes', $event)" />
            </div>
            <p class="text-xs text-gray-500 mb-2">Un usage non coché n'est pas relié à la GTB : le décret peut en exiger le raccordement (obligatoire, ou seulement s'il se rembourse en moins de 10 ans dans un bâtiment existant). Le plan d'actions le signale.</p>
            <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 text-sm">
              <button v-for="u in [
                        { key: 'manages_heating', cat: 'heating', label: 'Chauffage' },
                        { key: 'manages_cooling', cat: 'cooling', label: 'Refroidissement' },
                        { key: 'manages_ventilation', cat: 'ventilation', label: 'Ventilation' },
                        { key: 'manages_dhw', cat: 'dhw', label: 'Eau chaude' },
                        { key: 'manages_lighting', cat: 'lighting_indoor', label: 'Éclairage' },
                      ]"
                      :key="u.key" type="button"
                      @click="bms[u.key] = bms[u.key] ? 0 : 1; saveBmsDebounced()"
                      :class="['flex items-center gap-2 px-2.5 py-2 rounded-lg border-2 transition whitespace-nowrap text-left',
                               bms[u.key]
                                 ? 'border-[#00cd92] bg-emerald-50/60 hover:bg-emerald-50'
                                 : 'border-gray-200 bg-white text-gray-400 hover:border-gray-300 hover:text-gray-600']"
                      v-tooltip="bmsUsageToggleLabel(!!bms[u.key])">
                <SystemCategoryIcon :category="u.cat" size="sm" :with-tooltip="false" />
                <span :class="bms[u.key] ? 'text-gray-800 font-medium' : ''">{{ u.label }}</span>
                <span v-if="bms[u.key]" class="ml-auto text-[#00cd92] font-bold">✓</span>
              </button>
            </div>
          </RubricShell>

          <RubricShell :guided="guided" id="bms-block-integrated" :cls="['audit-subcard space-y-6', bms.out_of_service ? 'opacity-70' : '']"
                       body-cls="space-y-6" v-bind="rubric('integrated')" @toggle="toggleRubric('integrated')">
            <div>
              <div class="flex items-center justify-between gap-2 mb-2">
                <h3 :class="blockTitleCls">
                  Équipements intégrés à la GTB
                  <span class="font-normal normal-case text-gray-500 text-[10px]">— « Opérationnel » = vérifié sur place par l'auditeur</span>
                </h3>
                <BmsTopicNoteButton topic-key="equipements" topic-label="Équipements intégrés à la GTB"
                                    @open-notes="emit('open-notes', $event)" />
              </div>
              <table v-if="filteredDevices.length" class="w-full text-sm">
                <thead class="text-[10px] uppercase text-gray-500 tracking-wider bg-gray-50">
                  <tr>
                    <th class="text-left px-2 py-1 font-semibold">Équipement</th>
                    <th class="text-center py-1 font-semibold w-28" v-tooltip="BMS_COLUMN_TIPS.integratedDevice">Intégré</th>
                    <th class="text-center py-1 font-semibold w-28" v-tooltip="BMS_COLUMN_TIPS.operationalDevice">Opérationnel</th>
                  </tr>
                </thead>
                <tbody v-for="group in devicesByZone" :key="group.zone" class="divide-y divide-gray-100">
                  <tr class="bg-gray-50/60">
                    <td colspan="3" class="px-2 py-1 text-[10px] uppercase tracking-wider text-gray-600 font-semibold">
                      {{ group.zone }}
                    </td>
                  </tr>
                  <tr v-for="d in group.devices" :key="d.id"
                      :class="[d.bms_integration_out_of_service ? 'text-red-700 bg-red-50/40' : '']">
                    <td class="px-2 py-1">
                      <span class="inline-flex items-center gap-2">
                        <SystemCategoryIcon :category="d.system_category" size="sm" />
                        <strong>{{ d.name || d.brand || d.model_reference || 'Sans nom' }}</strong>
                        <span :class="d.bms_integration_out_of_service ? 'text-red-500' : 'text-gray-400'">
                          — {{ systemLabels[d.system_category] || d.system_category }}
                        </span>
                        <span v-if="d.out_of_service" class="text-[11px] text-red-600"
                              v-tooltip="BMS_STATUS_TIPS.deviceOutOfService">Hors service (étape 3)</span>
                      </span>
                    </td>
                    <td class="py-1 text-center">
                      <!-- Un équipement HS peut avoir été intégré à la GTB :
                           la question reste ouverte, seul « Opérationnel » est forcé. -->
                      <CompactToggle compact :model-value="triState(d.managed_by_bms)"
                                     :tooltip="BMS_INTEGRATED_TOGGLE_TIP"
                                     @update:model-value="v => patchDeviceMb(d, { managed_by_bms: !!v })" />
                    </td>
                    <td class="py-1 text-center">
                      <!-- Grisé : la carte (portée par le contrôle) dit pourquoi et quoi faire. -->
                      <CompactToggle compact :model-value="!d.managed_by_bms ? null : d.out_of_service ? false : !d.wired ? null : triState(!d.bms_integration_out_of_service)"
                                     :disabled="!d.managed_by_bms || !!d.out_of_service || !d.wired"
                                     :tooltip="bmsOperationalTip({ kind: 'device', integrated: d.managed_by_bms, outOfService: d.out_of_service, wired: d.wired })"
                                     @update:model-value="v => patchDeviceMb(d, { bms_integration_out_of_service: !v })" />
                    </td>
                  </tr>
                </tbody>
              </table>
              <p v-else-if="!anyUsageManaged" class="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                ⚠ Coche d'abord au moins un usage dans « Usages traités par la GTB » ci-dessus pour voir les équipements concernés.
              </p>
              <p v-else class="text-xs text-gray-400 italic">Aucun équipement saisi dans les usages cochés.</p>
            </div>
            <div>
              <div class="flex items-center justify-between gap-2 mb-2">
                <h3 :class="blockTitleCls">
                  Compteurs intégrés à la GTB
                  <span class="font-normal normal-case text-gray-500 text-[10px]">— uniquement les compteurs présents</span>
                </h3>
                <BmsTopicNoteButton topic-key="compteurs" topic-label="Compteurs intégrés à la GTB"
                                    @open-notes="emit('open-notes', $event)" />
              </div>
              <table v-if="filteredMeters.length" class="w-full text-sm">
                <thead class="text-[10px] uppercase text-gray-500 tracking-wider bg-gray-50">
                  <tr>
                    <th class="text-left px-2 py-1 font-semibold">Compteur</th>
                    <th class="text-center py-1 font-semibold w-28" v-tooltip="BMS_COLUMN_TIPS.integratedMeter">Intégré</th>
                    <th class="text-center py-1 font-semibold w-28" v-tooltip="BMS_COLUMN_TIPS.operationalMeter">Opérationnel</th>
                  </tr>
                </thead>
                <template v-for="typeGroup in metersByEnergyThenZone" :key="typeGroup.type">
                  <tbody class="divide-y divide-gray-100">
                    <tr class="bg-indigo-50/50">
                      <td colspan="3" class="px-2 py-1">
                        <MeterTypePill :type="typeGroup.type" />
                      </td>
                    </tr>
                  </tbody>
                  <tbody v-for="zoneGroup in typeGroup.zones" :key="typeGroup.type + '::' + zoneGroup.zone"
                         class="divide-y divide-gray-100">
                    <tr class="bg-gray-50/60">
                      <td colspan="3" class="px-2 py-1 pl-8 text-[10px] uppercase tracking-wider text-gray-600 font-semibold">
                        {{ zoneGroup.zone }}
                      </td>
                    </tr>
                    <tr v-for="m in zoneGroup.meters" :key="m.id"
                        :class="[m.bms_integration_out_of_service ? 'text-red-700 bg-red-50/40' : '']">
                      <td class="px-2 py-1 pl-8">
                        <span class="inline-flex items-center gap-2">
                          <MeterUsagePill :usage="m.usage" />
                          <span v-if="m.out_of_service" class="text-[11px] text-red-600"
                                v-tooltip="BMS_STATUS_TIPS.meterOutOfService">Hors service (étape 5)</span>
                          <span v-if="m.communicating === 0 || m.communicating === false" class="text-[11px] text-gray-500"
                                v-tooltip="BMS_STATUS_TIPS.meterNotCommunicating">Non communicant (étape 5)</span>
                        </span>
                      </td>
                      <td class="py-1 text-center">
                        <!-- Un compteur HS peut avoir été intégré à la GTB : la
                             question reste ouverte, seul « Opérationnel » est forcé.
                             Un non-communicant, lui, ne peut pas être intégré (carte
                             de la raison portée par le contrôle grisé). -->
                        <CompactToggle compact :model-value="!m.communicating ? null : triState(m.managed_by_bms)"
                                       :disabled="!m.communicating"
                                       :tooltip="bmsMeterIntegratedTip(m.communicating)"
                                       @update:model-value="v => patchMeter(m, { managed_by_bms: !!v })" />
                      </td>
                      <td class="py-1 text-center">
                        <CompactToggle compact :model-value="!m.managed_by_bms ? null : m.out_of_service ? false : !m.wired ? null : triState(!m.bms_integration_out_of_service)"
                                       :disabled="!m.managed_by_bms || !!m.out_of_service || !m.wired"
                                       :tooltip="bmsOperationalTip({ kind: 'meter', integrated: m.managed_by_bms, outOfService: m.out_of_service, wired: m.wired })"
                                       @update:model-value="v => patchMeter(m, { bms_integration_out_of_service: !v })" />
                      </td>
                    </tr>
                  </tbody>
                </template>
              </table>
              <p v-else-if="!anyUsageManaged" class="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                ⚠ Coche d'abord au moins un usage dans « Usages traités par la GTB » ci-dessus pour voir les compteurs concernés.
              </p>
              <p v-else class="text-xs text-gray-400 italic">
                Aucun compteur présent dans les usages cochés.
                <span v-if="meters.length" class="block mt-1">Coche « Présent » à l'étape 5 · Compteurs pour rendre les compteurs disponibles ici.</span>
              </p>
            </div>
          </RubricShell>

          <RubricShell v-if="audit.isBacs" :guided="guided" id="bms-block-r175-3" :cls="['audit-subcard', bms.out_of_service ? 'opacity-70' : '']"
                       v-bind="rubric('capabilities')" @toggle="toggleRubric('capabilities')">
            <div class="flex items-start justify-between gap-2 mb-2">
              <h3 class="text-xs font-semibold text-gray-700 uppercase tracking-wider inline-flex items-center gap-1 flex-wrap">
                <template v-if="!guided">Ce que sait faire la supervision</template>
                <R175Tooltip article="R175-3" />
                <span :class="['inline-flex items-center gap-1 font-normal normal-case text-gray-500', guided ? 'text-xs' : 'text-[10px]']">
                  {{ guided ? 'Dialogue' : '— dialogue' }} avec les équipements et arrêt à la main : vérifiés à l’étape Systèmes
                  <HelpTip size="xs" :tip="BMS_SYSTEM_LEVEL_CHECKS_TIP" />
                </span>
              </h3>
              <BmsTopicNoteButton class="ml-auto" topic-key="r175_3_capacites"
                                  topic-label="Ce que sait faire la supervision"
                                  @open-notes="emit('open-notes', $event)" />
            </div>
            <div class="qa-grid text-sm">
              <div class="qa-question">
                La GTB suit-elle les consommations heure par heure, par zone et par usage, et garde-t-elle ces données 5 ans ?
                <R175Tooltip article="R175-3 1°" class="align-middle" />
              </div>
              <SegmentedToggle :model-value="triState(bms.meets_r175_3_p1)" :disabled="levelLocked"
                               :tooltip="levelLockTip"
                               @update:model-value="v => setBmsFlag('meets_r175_3_p1', v)" />
              <div class="qa-question">
                La GTB repère-t-elle les dérives (comparaison à des valeurs de référence, pertes d'efficacité) et prévient-elle l'exploitant ?
                <R175Tooltip article="R175-3 2°" class="align-middle" />
              </div>
              <SegmentedToggle :model-value="triState(bms.meets_r175_3_p2)" :disabled="levelLocked"
                               :tooltip="levelLockTip"
                               @update:model-value="v => setBmsFlag('meets_r175_3_p2', v)" />
            </div>
            <div v-if="bms.meets_r175_3_p1" class="ml-4 mt-2 space-y-3">
              <div>
                <label class="block text-[11px] text-gray-600 mb-1">Sous quel format les données sont-elles archivées ?</label>
                <input v-model="bms.r175_3_p1_archival_format" type="text" placeholder="ex : CSV, base SQL, API InfluxDB"
                       @input="saveBmsDebounced"
                       class="w-full text-xs px-2 py-1 border border-gray-200 rounded" />
              </div>
              <div class="qa-grid text-sm">
                <div class="qa-question">La conservation des données sur 5 ans a-t-elle été vérifiée sur place ?</div>
                <SegmentedToggle :model-value="triState(bms.r175_3_p1_retention_verified)"
                                 @update:model-value="v => setBmsFlag('r175_3_p1_retention_verified', v)" />
              </div>
            </div>
            <div v-if="bms.meets_r175_3_p2" class="ml-4 mt-2">
              <label class="block text-[11px] text-gray-600 mb-1">Quelles règles, seuils ou alertes de détection sont actives aujourd'hui ?</label>
              <textarea v-model="bms.r175_3_p2_anomaly_rules_html" @input="saveBmsDebounced"
                        placeholder="ex : alerte si ΔT > 5 °C, surconso > 20% j-1, COP < 2.5…"
                        rows="2"
                        class="w-full text-xs px-2 py-1 border border-gray-200 rounded"></textarea>
            </div>
          </RubricShell>

          <RubricShell v-if="audit.isBacs" :guided="guided" id="bms-block-data-provision" :cls="['audit-subcard', bms.out_of_service ? 'opacity-70' : '']"
                       v-bind="rubric('data-provision')" @toggle="toggleRubric('data-provision')">
            <div class="flex items-center justify-between gap-2 mb-2">
              <h3 class="text-xs font-semibold text-gray-700 uppercase tracking-wider inline-flex items-center gap-1">
                <template v-if="!guided">Mise à disposition des données</template>
                <R175Tooltip article="R175-3" />
              </h3>
              <BmsTopicNoteButton class="ml-auto" topic-key="r175_3_mise_dispo"
                                  topic-label="Mise à disposition des données"
                                  @open-notes="emit('open-notes', $event)" />
            </div>
            <div class="qa-grid text-sm">
              <div class="qa-question">Les données sont-elles mises à disposition du <strong>gestionnaire du bâtiment</strong> lorsqu'il les demande ?</div>
              <SegmentedToggle :model-value="triState(bms.data_provision_to_manager)"
                               @update:model-value="v => setBmsFlag('data_provision_to_manager', v)" />
              <div class="qa-question">Chaque <strong>exploitant des systèmes techniques</strong> reçoit-il les données qui le concernent ?</div>
              <SegmentedToggle :model-value="triState(bms.data_provision_to_operators)" :disabled="levelLocked"
                               :tooltip="levelLockTip"
                               @update:model-value="v => setBmsFlag('data_provision_to_operators', v)" />
            </div>
            <template v-if="bms.data_provision_to_manager || bms.data_provision_to_operators">
              <textarea v-model="bms.notes_data_provision" @input="saveBmsDebounced"
                        placeholder="Décris le mécanisme : extraction CSV, accès portail web, API, planning d'envoi…"
                        class="mt-2 input-base text-xs py-1.5" rows="2"></textarea>
              <div class="mt-3 space-y-3">
                <div>
                  <label class="block text-[11px] text-gray-600 mb-1">À quelle fréquence les données sont-elles mises à disposition ?</label>
                  <input v-model="bms.data_provision_frequency" type="text"
                         placeholder="ex : temps réel, quotidien, hebdo, mensuel"
                         @input="saveBmsDebounced"
                         class="w-full text-xs px-2 py-1 border border-gray-200 rounded" />
                </div>
                <div>
                  <label class="block text-[11px] text-gray-600 mb-1">Sous quel format les données sont-elles transmises ?</label>
                  <input v-model="bms.data_provision_format" type="text"
                         placeholder="ex : CSV, PDF mensuel, dashboard web, API"
                         @input="saveBmsDebounced"
                         class="w-full text-xs px-2 py-1 border border-gray-200 rounded" />
                </div>
              </div>
            </template>
          </RubricShell>

          <!-- Item 15 — R175-3 : conservation 5 ans + accès aux données -->
          <RubricShell v-if="audit.isBacs" :guided="guided" id="bms-block-data-storage" :cls="['audit-subcard', bms.out_of_service ? 'opacity-70' : '']"
                       v-bind="rubric('data-storage')" @toggle="toggleRubric('data-storage')">
            <div class="flex items-center justify-between gap-2 mb-2">
              <h3 class="text-xs font-semibold text-gray-700 uppercase tracking-wider inline-flex items-center gap-1">
                <template v-if="!guided">Conservation et accès aux données</template>
                <span :class="['font-normal normal-case text-gray-500', guided ? 'text-xs' : 'text-[10px] ml-1']">{{ guided ? 'Historique de 5 ans' : '(historique de 5 ans)' }}</span>
                <R175Tooltip article="R175-3 1°" />
              </h3>
            </div>
            <div class="qa-grid text-sm">
              <!-- Q1 — Conservation 5 ans (3 valeurs : oui / non / inconnu). Bug corrigé
                   2026-10-12 : `title` (sans effet sur ce composant) → propriété `tooltip`. -->
              <div class="qa-question">Les données sont-elles conservées 5 ans à l'échelle mensuelle ?</div>
              <SegmentedToggle
                :model-value="bms.data_storage_5y_compliant"
                :disabled="levelLocked"
                :tooltip="levelLockTip"
                :options="[
                  { value: 'yes', label: 'Oui', tone: 'green' },
                  { value: 'no', label: 'Non', tone: 'slate' },
                  { value: 'unknown', label: 'Inconnu', tone: 'amber' },
                ]"
                @update:model-value="v => { bms.data_storage_5y_compliant = v; saveBmsDebounced() }"
              />
              <!-- Q3 — Accès propriétaire (ternaire Oui / Partiel / Non) -->
              <div class="qa-question">Le propriétaire accède-t-il directement à ses données ?</div>
              <SegmentedToggle
                :model-value="bms.data_owner_access"
                :options="[
                  { value: 'yes', label: 'Oui', tone: 'green' },
                  { value: 'partial', label: 'Partiel', tone: 'amber' },
                  { value: 'no', label: 'Non', tone: 'slate' },
                ]"
                @update:model-value="v => { bms.data_owner_access = v; saveBmsDebounced() }"
              />
              <!-- Q4 — Accès gestionnaire / exploitants (idem ternaire) -->
              <div class="qa-question">Le gestionnaire et les exploitants ont-ils accès aux données ?</div>
              <SegmentedToggle
                :model-value="bms.gestionnaire_exploitant_access"
                :options="[
                  { value: 'yes', label: 'Oui', tone: 'green' },
                  { value: 'partial', label: 'Partiel', tone: 'amber' },
                  { value: 'no', label: 'Non', tone: 'slate' },
                ]"
                @update:model-value="v => { bms.gestionnaire_exploitant_access = v; saveBmsDebounced() }"
              />
              <!-- Q5 — Export CSV/Excel (binaire) -->
              <div class="qa-question">Les données sont-elles exportables (CSV / Excel) ?</div>
              <SegmentedToggle
                :model-value="bms.export_capability"
                :options="[
                  { value: 'yes', label: 'Oui', tone: 'green' },
                  { value: 'no', label: 'Non', tone: 'slate' },
                ]"
                @update:model-value="v => { bms.export_capability = v; saveBmsDebounced() }"
              />
            </div>
            <!-- Q2 — Localisation du stockage (4 choix exclusifs) : select pleine largeur sous le grid -->
            <div class="mt-3">
              <label class="block text-[11px] text-gray-600 mb-1">Où sont stockées les données ?</label>
              <select v-model="bms.data_storage_location" @change="saveBmsDebounced"
                      class="w-full text-xs px-2 py-1.5 border border-gray-200 rounded-md">
                <option :value="null">— Non renseigné</option>
                <option value="local">Serveur local</option>
                <option value="cloud_editeur">Cloud de l'éditeur</option>
                <option value="cloud_proprietaire">Cloud du propriétaire</option>
                <option value="unknown">Inconnue</option>
              </select>
            </div>
            <div class="mt-2">
              <label class="block text-[11px] text-gray-600 mb-1">Observations sur l'accès aux données</label>
              <textarea v-model="bms.data_access_notes" @input="saveBmsDebounced"
                        placeholder="ex : historisation limitée à 30 j par défaut, compte propriétaire à créer chez l'éditeur…"
                        rows="2"
                        class="w-full text-xs px-2 py-1 border border-gray-200 rounded"></textarea>
            </div>
          </RubricShell>

          <RubricShell v-if="audit.isBacs" :guided="guided" id="bms-block-r175-4-5" :cls="['audit-subcard space-y-4', bms.out_of_service ? 'opacity-70' : '']"
                       body-cls="space-y-4" v-bind="rubric('upkeep')" @toggle="toggleRubric('upkeep')">
            <div>
              <div class="flex items-center justify-between gap-2 mb-2">
                <h3 :class="[blockTitleCls, 'inline-flex items-center gap-1']">
                  Vérifications périodiques de la GTB
                  <R175Tooltip article="R175-4" />
                </h3>
                <BmsTopicNoteButton topic-key="r175_4" topic-label="Vérifications périodiques de la GTB"
                                    @open-notes="emit('open-notes', $event)" />
              </div>
              <div class="qa-grid text-sm">
                <div class="qa-question">Les vérifications périodiques de la GTB sont-elles organisées (contrat de maintenance ou personnel interne compétent) et encadrées par des consignes écrites ?</div>
                <SegmentedToggle :model-value="triState(bms.has_maintenance_procedures)"
                                 @update:model-value="v => setBmsFlag('has_maintenance_procedures', v)" />
              </div>
              <div v-if="bms.has_maintenance_procedures" class="ml-6 mt-2 space-y-3">
                <div>
                  <label class="block text-[11px] text-gray-600 mb-1">Périodicité</label>
                  <input v-model="bms.maintenance_periodicity" type="text"
                         placeholder="ex : trimestrielle, semestrielle, annuelle"
                         @input="saveBmsDebounced"
                         class="w-full text-xs px-2 py-1 border border-gray-200 rounded" />
                </div>
                <div>
                  <label class="block text-[11px] text-gray-600 mb-1">Responsable</label>
                  <input v-model="bms.maintenance_responsible" type="text"
                         placeholder="ex : prestataire X, équipe interne, fournisseur GTB"
                         @input="saveBmsDebounced"
                         class="w-full text-xs px-2 py-1 border border-gray-200 rounded" />
                </div>
              </div>
            </div>
            <div>
              <div class="flex items-center justify-between gap-2 mb-2">
                <h3 :class="[blockTitleCls, 'inline-flex items-center gap-1']">
                  Formation de l’exploitant
                  <R175Tooltip article="R175-5" />
                </h3>
                <BmsTopicNoteButton topic-key="r175_5" topic-label="Formation de l’exploitant"
                                    @open-notes="emit('open-notes', $event)" />
              </div>
              <div class="qa-grid text-sm">
                <div class="qa-question">L'exploitant a-t-il été formé au fonctionnement de la GTB, notamment à son paramétrage (attestation ou feuille d'émargement) ?</div>
                <SegmentedToggle :model-value="triState(bms.operator_trained)"
                                 @update:model-value="v => setBmsFlag('operator_trained', v)" />
              </div>
              <div v-if="bms.operator_trained" class="ml-6 mt-2 space-y-3">
                <div>
                  <label class="block text-[11px] text-gray-600 mb-1">Date de formation</label>
                  <input v-model="bms.operator_training_date" type="date"
                         @input="saveBmsDebounced"
                         class="w-full text-xs px-2 py-1 border border-gray-200 rounded" />
                </div>
                <div>
                  <label class="block text-[11px] text-gray-600 mb-1">Organisme / formateur</label>
                  <input v-model="bms.operator_training_provider" type="text"
                         placeholder="ex : intégrateur GTB, fournisseur"
                         @input="saveBmsDebounced"
                         class="w-full text-xs px-2 py-1 border border-gray-200 rounded" />
                </div>
                <div class="col-span-2">
                  <label class="block text-[11px] text-gray-600 mb-1">Domaines couverts</label>
                  <input v-model="bms.operator_training_topics" type="text"
                         placeholder="ex : paramétrage des consignes, lecture des alarmes, escalade niveau 2"
                         @input="saveBmsDebounced"
                         class="w-full text-xs px-2 py-1 border border-gray-200 rounded" />
                </div>
              </div>
              <p v-if="isBuildySupervision === true || (isBuildySupervision === null && (bms.existing_solution || '').toLowerCase().includes('buildy'))" class="mt-2 text-[11px] text-slate-700 bg-slate-50 border border-slate-200 rounded px-2 py-1">
                Supervision Buildy : l'assistance intégrée facilite la prise en main, mais ne remplace pas la formation de l'exploitant au fonctionnement et au paramétrage de la GTB, à attester (attestation ou feuille d'émargement).
              </p>
            </div>
          </RubricShell>
        </div>
      </div>
      </div>
    </PhotoDropzone>
  </CollapsibleSection>
</template>
