<script setup>
import { ref, computed, watch, nextTick, inject, onMounted, onBeforeUnmount } from 'vue'
import { storeToRefs } from 'pinia'
import Sortable from 'sortablejs'
import { WrenchScrewdriverIcon, ChevronDownIcon, ChevronUpIcon, PencilSquareIcon, Bars3Icon, PlusIcon, TrashIcon, Cog6ToothIcon } from '@heroicons/vue/24/outline'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import '@/lib/equipment-icons'
import CollapsibleSection from '@/components/CollapsibleSection.vue'
import R175Tooltip from '@/components/R175Tooltip.vue'
import SectionHeader from '@/components/audit/SectionHeader.vue'
import SystemCategoryIcon from '@/components/SystemCategoryIcon.vue'
import SystemSettingsModal from '@/components/audit/SystemSettingsModal.vue'
import CreateSystemModal from '@/components/audit/CreateSystemModal.vue'
import SegmentedToggle from '@/components/audit/SegmentedToggle.vue'
import Tooltip from '@/components/Tooltip.vue'
import HelpTip from '@/components/HelpTip.vue'
import { useAuditStore } from '@/stores/audit'
import { useNotification } from '@/composables/useNotification'
import { useConfirm } from '@/composables/useConfirm'
import { systemUsageLabel } from '@/lib/audit-options'
import {
  CATEGORY_FULL_LABELS, TECHNICAL_ZONE_TIP, POWER_SUMMARY_TIPS, SYSTEM_PRESENCE_TOGGLE_TIP, SYSTEM_NO_DEVICE_TIP,
  SYSTEM_NOT_PRESENT_TIPS, NOT_CONCERNED_EXPAND_TIP, DHW_LOOP_TIP, DHW_LOOP_MISSING_TIP, DHW_LOOP_LEGIONELLA_TIP, NEGLIGIBLE_TIP,
  powerDiscrepancyTip, missingPowerTip, notConcernedChipTip, systemDevicesSummaryTip,
} from '@/lib/audit-tips-systems'
import { faTableCellsLarge } from '@fortawesome/free-solid-svg-icons'
import {
  updateBacsSystem, reorderBacsSystems, deleteBacsSystem, listSystemCategories,
  duplicateBacsDevice, deleteBacsDevice,
} from '@/api'
import AuditSubTabs from '@/components/audit/AuditSubTabs.vue'
import SystemsPresenceMatrix from '@/components/audit/SystemsPresenceMatrix.vue'
import SystemDeviceList from '@/components/audit/SystemDeviceList.vue'
import SystemsGuideRail from '@/components/audit/SystemsGuideRail.vue'
import SystemsGuideSummary from '@/components/audit/SystemsGuideSummary.vue'
import SystemsGuidePanel from '@/components/audit/SystemsGuidePanel.vue'
import DeviceAddGuidedModal from '@/components/audit/DeviceAddGuidedModal.vue'
import { AUDIT_STEP_MODE_KEY } from '@/lib/audit-steps-ui'
import { flashAuditTarget } from '@/lib/audit-reveal'
import { fluidStyle } from '@/lib/system-fluids'
import {
  indexChecks, zoneGuide, guideTotals, guideStops, nextStop, checkCells, deviceMissing,
  missingShort, MISSING_POWER_CODE,
} from '@/lib/systems-guide'
import {
  guideBadges, zoneGuideTabTip, synthesisGuideTabTip, stopReasonLabel,
  hiddenByFilterText, SHOW_ALL_LABEL, missingPowersLabel, missingPowersTip,
  usageFilterText, SHOW_ALL_USAGES_LABEL,
} from '@/lib/audit-tips-systems-guide'

// Section 3 — Systèmes techniques par zone (R175-1 4° + R175-3 3°/4°).
const props = defineProps({
  systemsByZone: { type: Array, required: true },
  devicesBySystem: { type: Object, required: true },
  hiddenNotConcernedCount: { type: Number, default: 0 },
  collapsedSystems: { type: Set, required: true },
  systemLabels: { type: Object, required: true },
  systemNegativeLabels: { type: Object, required: true },
  zoneNatures: { type: Array, required: true },
  step: { type: Object, default: null },
  active: { type: Boolean, default: false },
})
const showNotConcernedSystems = defineModel('showNotConcernedSystems', { type: Boolean, default: false })
const emit = defineEmits([
  'open-notes', 'validate-step', 'invalidate-step',
  'toggle-system-collapsed',
])

const audit = useAuditStore()
const { document, powerSummary } = storeToRefs(audit)
const { error } = useNotification()
const { confirm } = useConfirm()

// Libellé d'un usage : catégorie BACS, ou nom libre si usage manuel.
function usageLabel(s) { return systemUsageLabel(s) }

// Tri-état pour les SegmentedToggle : null → aucun bouton sélectionné.
const triState = (v) => (v == null ? null : !!v)

async function patchSystem(s, patch) {
  Object.assign(s, patch)
  try {
    await updateBacsSystem(s.id, patch)
    await audit.refreshActionItems()
  } catch { error('Sauvegarde système impossible') }
}

// Présence d'un usage : contrôle segmenté binaire « Présent / Non concerné ». Tant que rien n'est
// saisi, aucun bouton n'est sélectionné. « Présent » en vert Buildy, texte navy (contraste 8:1).
const PRESENCE_OPTIONS = [
  { value: 'present', label: 'Présent', tone: 'mint' },
  { value: 'not_concerned', label: 'Non concerné', tone: 'slate' },
]
function presenceValue(s) {
  return s.not_concerned ? 'not_concerned' : (s.present ? 'present' : null)
}
function setPresence(s, val) {
  if (val === 'present') patchSystem(s, { present: true, not_concerned: false })
  else patchSystem(s, { present: false, not_concerned: true })
}

// Item 3 — bouclage ECS : 3 états.
const LOOP_OPTIONS = [
  { value: 'looped', label: 'Bouclée' },
  { value: 'not_looped', label: 'Non bouclée' },
  { value: 'unknown', label: 'Inconnu' },
]

// Item 1 — poids estimé d'un poste (puissance système / puissance totale
// site). Aide à la décision : > 10 % → l'auditeur est averti avant
// d'activer le flag « négligeable ».
function systemPowerKw(s) {
  const devs = props.devicesBySystem[s.id] || []
  return devs.reduce((sum, d) => sum + (Number(d.power_kw) || 0) * (Number(d.quantity) || 1), 0)
}

// Un système coché « présent » doit avoir au moins un équipement saisi
// (primaire OU partagé depuis un autre système via extra_system_ids,
// cf. mig 143). Sinon l'audit n'est pas exploitable (PDF, plan d'action,
// calcul de puissance R175-2). Signalé visuellement par un badge ambré
// dans le header de la card.
function isSystemPresentWithoutDevices(s) {
  if (!s.present) return false
  const primaries = props.devicesBySystem[s.id] || []
  if (primaries.length > 0) return false
  // Devices partagés depuis un autre système (le système courant est
  // listé dans `device.extra_system_ids`). On regarde le store global.
  const all = audit.devices || []
  const shared = all.some(d =>
    d.system_id !== s.id && (d.extra_system_ids || []).includes(s.id)
  )
  return !shared
}
// Résumé affiché dans l'en-tête d'une carte système (mode étape), à la place
// de la ligne « Refroidissement — X kW total » du tableau : nombre
// d'équipements affichés (propres + partagés depuis un autre système) et
// puissance des équipements propres (même calcul que SystemDeviceList :
// puissance froid des réversibles sur un système Refroidissement).
function devicePowerField(s, d) {
  if (s.system_category !== 'cooling') return 'power_kw'
  const ids = new Set([d.system_id, ...(d.extra_system_ids || [])])
  const reversible = (audit.systems || []).some(x => ids.has(x.id) && x.system_category === 'heating')
  return reversible ? 'power_kw_cooling' : 'power_kw'
}
function deviceSummary(s) {
  const own = props.devicesBySystem[s.id] || []
  const shared = (audit.devices || []).filter(d =>
    d.system_id !== s.id && (d.extra_system_ids || []).includes(s.id))
  const count = own.length + shared.length
  const kw = Math.round(own.reduce((t, d) =>
    t + (Number(d[devicePowerField(s, d)]) || 0) * (Number(d.quantity) || 1), 0) * 10) / 10
  if (!count) return ''
  const parts = [`${count} équipement${count > 1 ? 's' : ''}`]
  if (shared.length) {
    parts.push(shared.length === count
      ? `partagé${count > 1 ? 's' : ''} depuis une autre zone`
      : `dont ${shared.length} partagé${shared.length > 1 ? 's' : ''}`)
  }
  if (kw > 0) parts.push(`${kw.toLocaleString('fr-FR')} kW`)
  return parts.join(' · ')
}
// Carte du résumé : équipements propres / partagés, puissance des équipements propres.
function deviceSummaryTip(s) {
  const own = (props.devicesBySystem[s.id] || [])
  const shared = (audit.devices || []).filter(d =>
    d.system_id !== s.id && (d.extra_system_ids || []).includes(s.id)).length
  const kw = Math.round(own.reduce((t, d) =>
    t + (Number(d[devicePowerField(s, d)]) || 0) * (Number(d.quantity) || 1), 0) * 10) / 10
  return systemDevicesSummaryTip({ own: own.length, shared, kw, summary: deviceSummary(s) })
}
function sitePowerKw() {
  let total = 0
  for (const g of props.systemsByZone) {
    for (const s of g.items) total += systemPowerKw(s)
  }
  return total
}
function systemWeightPct(s) {
  const total = sitePowerKw()
  if (total <= 0) return null
  const pct = systemPowerKw(s) / total * 100
  return Math.round(pct * 10) / 10
}
async function toggleNegligible(s, checked) {
  // Avertissement si le poids estimé dépasse 10 % — l'auditeur peut quand
  // même confirmer (la règle des 5 % se base sur la conso réelle, pas la
  // puissance ; le poids par puissance n'est qu'une approximation).
  if (checked) {
    const pct = systemWeightPct(s)
    if (pct != null && pct > 10) {
      const ok = await confirm({
        title: 'Poste potentiellement significatif',
        message: `Ce poste représente environ ${pct} % de la puissance du site (estimation par puissance). La règle des 5 % se base sur la consommation réelle — vérifie avant de l'exempter.`,
        confirmLabel: 'Marquer quand même négligeable',
      })
      if (!ok) return
    }
    // Fix M — R175-2 §5 : justification textuelle obligatoire (FAQ
    // ministère juin 2025). Le backend refuse le flag=1 sans texte. On
    // prompt inline pour ne pas faire capoter le PATCH en 400.
    const existing = (s.negligible_justification || '').trim()
    const text = window.prompt(
      'Justifie l\'exemption par la règle des 5 % (FAQ ministérielle n° 16) — ex : « petits ballons ECS individuels », « groupe de secours ». La part s\'apprécie sur tous les équipements de même fonction du bâtiment.\n\nLa justification est obligatoire.',
      existing,
    )
    if (text == null) return  // annulation
    const trimmed = text.trim()
    if (!trimmed) return  // vide → skip
    await patchSystem(s, {
      marked_negligible_under_5pct: true,
      negligible_justification: trimmed,
    })
    return
  }
  await patchSystem(s, {
    marked_negligible_under_5pct: checked,
    ...(checked ? {} : { negligible_justification: null }),
  })
}

// ─── Ajout d'un système (mig 182) ────────────────────────────────────
// Bibliothèque de catégories d'usage personnalisées passée à CreateSystemModal
// pour proposer des catégories « hors décret » (bornes de recharge, etc.) en
// plus des 7 catégories BACS standard.
const categoryLibrary = ref([])
onMounted(async () => {
  try {
    const { data } = await listSystemCategories()
    categoryLibrary.value = data || []
  } catch { /* silencieux — la modale fonctionne aussi sans bibliothèque */ }
})

// Modale paramètres système (poste négligeable 5 % + surcharge parties).
// Cf. SystemSettingsModal.vue — les 2 anciens flags sous-station /
// multi-bâtiments sont supprimés au niveau système (dérivés ailleurs).
const settingsSystem = ref(null)
function openSystemSettings(s) { settingsSystem.value = s }
function closeSystemSettings() { settingsSystem.value = null }

// ─── Filtre par usage (catégorie BACS) ─────────────────────────────────
// Sémantique « inclusive » : par défaut le set est VIDE → aucun filtre
// actif → tout est affiché. Cliquer un pill l'AJOUTE au filtre : la card
// montre alors uniquement les catégories du filtre (équivalent OR multi-
// sélection). Re-cliquer un pill actif le retire ; quand le set redevient
// vide, on retombe sur l'affichage complet par défaut. Plus intuitif
// qu'une logique « tout-puis-on-désélectionne » (incident 2026-05-27 où
// l'auditeur cliquait Chauffage pour le filtrer ET cachait Chauffage).
const USAGE_FILTER_OPTIONS = [
  { value: 'heating',                 label: 'Chauffage' },
  { value: 'cooling',                 label: 'Refroidissement' },
  { value: 'ventilation',             label: 'Ventilation' },
  { value: 'dhw',                     label: 'ECS' },
  { value: 'lighting_indoor',         label: 'Écl. intérieur' },
  { value: 'lighting_outdoor',        label: 'Écl. extérieur' },
  { value: 'electricity_production',  label: 'Production PV' },
]
const usageFilterOptions = USAGE_FILTER_OPTIONS
const usageFilter = ref(new Set()) // vide par défaut = aucun filtre
function toggleUsageFilter(v) {
  // Préserve la position du header dans le viewport (sans ça, le retrait
  // de rows raccourcit la page et le navigateur clamp le scroll vers le
  // haut, faisant sauter le sticky).
  const headerEl = window.document.querySelector('#section-systems header')
  const beforeTop = headerEl ? headerEl.getBoundingClientRect().top : null
  const s = new Set(usageFilter.value)
  if (s.has(v)) s.delete(v); else s.add(v)
  usageFilter.value = s
  if (beforeTop != null && headerEl) {
    nextTick(() => {
      const afterTop = headerEl.getBoundingClientRect().top
      const delta = afterTop - beforeTop
      if (Math.abs(delta) > 1) window.scrollBy({ top: delta, behavior: 'instant' })
    })
  }
}
function resetUsageFilter() {
  usageFilter.value = new Set()
}

// Applique le filtre : si vide → tout affiché ; sinon → on garde tout
// usage non BACS (toujours visible) + les usages BACS dont la catégorie
// est dans le filtre.
const filteredSystemsByZone = computed(() => {
  const active = usageFilter.value
  if (!active.size) return props.systemsByZone
  return props.systemsByZone
    .map(g => ({
      ...g,
      items: (g.items || []).filter(s => !s.is_bacs || active.has(s.system_category)),
    }))
    .filter(g => g.items.length > 0)
})

// ─── Mode étape (page audit à onglets) : une zone affichée à la fois ───
// Sous-onglets de zones (mémorisés par audit). Chaque zone est montée à sa
// 1re ouverture puis conservée. Les usages « non concernés » passent en
// pastilles grisées (toujours visibles, « Présent » en 1 clic) ; « Afficher
// en détail » redonne les lignes complètes (v-model showNotConcernedSystems,
// persisté par la vue sous `bacs-show-not-concerned`).
const stepMode = inject(AUDIT_STEP_MODE_KEY, null)
const isStepMode = computed(() => !!stepMode?.enabled)
const zoneStorageKey = () => `bacs-systems-zone:${audit.docId}`
// 1er onglet de la barre des zones : « Synthèse des systèmes » (tableau de
// présence de toutes les zones). Les autres onglets affichent une zone seule.
const SYNTHESIS_TAB = 'synthesis'
const activeZoneId = ref(null)
const isSynthesis = computed(() => activeZoneId.value === SYNTHESIS_TAB)
const visitedZones = ref(new Set())
function selectZone(zid) {
  if (zid == null) return
  activeZoneId.value = zid
  if (zid !== SYNTHESIS_TAB) visitedZones.value.add(zid)
  try { localStorage.setItem(zoneStorageKey(), String(zid)) } catch { /* navigation privée */ }
}

// Onglets des zones : pastilles « à compléter » (nombre), « ! à vérifier », « ? sans réponse », et
// carte de la zone (lib/audit-tips-systems-guide.js).
const zoneTabs = computed(() => {
  const tabs = zoneStates.value.map((z) => {
    const g = props.systemsByZone.find(x => x.zone_id === z.zoneId)
    return {
      key: z.zoneId,
      label: z.zoneName,
      tag: g?.zone_kind === 'technical' ? 'tech.' : null,
      badges: guideBadges(z),
      tooltip: zoneGuideTabTip({
        name: z.zoneName, nature: natureLabelOf(g), technical: g?.zone_kind === 'technical',
        present: z.present, total: z.systems.length, done: z.done,
        incomplete: z.incompleteDevices, empty: z.emptySystems, loops: z.loops, toCheck: z.toCheck, unanswered: z.unanswered,
      }),
    }
  })
  const t = guideTotals(zoneStates.value)
  return [{
    key: SYNTHESIS_TAB,
    label: 'Synthèse des systèmes',
    icon: faTableCellsLarge,
    iconColor: '#4f46e5',
    badges: guideBadges(t),
    tooltip: synthesisGuideTabTip({ zones: t.zones, incomplete: t.incompleteDevices, empty: t.emptySystems, loops: t.loops, toCheck: t.toCheck, unanswered: t.unanswered }),
  }, ...tabs]
})

// Onglet par défaut : le dernier consulté (synthèse ou zone), sinon la
// synthèse. Réévalué si la zone active disparaît.
watch(() => props.systemsByZone.map(g => g.zone_id).join(','), () => {
  const ids = props.systemsByZone.map(g => g.zone_id)
  if (!ids.length || activeZoneId.value === SYNTHESIS_TAB || ids.includes(activeZoneId.value)) return
  let saved = null
  try { saved = localStorage.getItem(zoneStorageKey()) } catch { /* */ }
  if (saved !== null && ids.includes(Number(saved))) { selectZone(Number(saved)); return }
  selectZone(SYNTHESIS_TAB)
}, { immediate: true })

// En mode étape, pas de filtre d'usage (boutons masqués) : le tableau de
// présence donne la vue par usage, toutes les zones restent en onglets.
const displayGroups = computed(() => isStepMode.value ? props.systemsByZone : filteredSystemsByZone.value)
const ncCompact = computed(() => isStepMode.value && !showNotConcernedSystems.value)
function rowItems(g) { return ncCompact.value ? g.items.filter(s => !s.not_concerned) : g.items }
function ncItems(g) { return ncCompact.value ? g.items.filter(s => s.not_concerned) : [] }
// Libellé d'une pastille : même texte que la ligne (catégorie + nom du
// système entre parenthèses, ou nom de l'usage personnalisé).
function ncChipLabel(s) {
  if (!s.is_bacs) return s.custom_label || 'Usage personnalisé'
  return usageLabel(s) + (s.custom_label ? ` (${s.custom_label})` : '')
}

// Liens croisés (plan d'actions, régulation, check-list) : la vue appelle
// prepareReveal avant de chercher l'élément → bonne zone, filtre levé,
// système déplié.
async function prepareReveal({ kind, id }) {
  const dev = kind === 'device' ? (audit.devices || []).find(d => d.id === id) : null
  const sys = (audit.systems || []).find(s => s.id === (dev ? dev.system_id : id))
  if (!sys) return
  if (isStepMode.value) selectZone(sys.zone_id)
  if (sys.is_bacs && usageFilter.value.size && !usageFilter.value.has(sys.system_category)) resetUsageFilter()
  if (dev && props.collapsedSystems.has(sys.id)) emit('toggle-system-collapsed', sys.id)
  // Lien vers un équipement : on ouvre aussi sa fiche.
  if (dev && isStepMode.value) openDevice(dev, sys)
  await nextTick()
}
defineExpose({ prepareReveal, selectZone })

// ─── Fiche équipement (mode étape) ─────────────────────────────────────
// La liste des équipements est en lecture ; un clic ouvre la fiche à
// droite (formulaire complet de DeviceEditModal, en panneau). Navigation
// précédent / suivant dans la zone, liste « à compléter » quand aucune
// fiche n'est ouverte.
const selectedDeviceId = ref(null)
const selectedSystemId = ref(null) // système depuis lequel la fiche est ouverte
const panelDevice = computed(() => (audit.devices || []).find(d => d.id === selectedDeviceId.value) || null)
const panelSystem = computed(() => (audit.systems || []).find(s => s.id === selectedSystemId.value) || null)
const panelSystemLabel = computed(() => {
  const s = panelSystem.value
  if (!s) return ''
  return s.is_bacs ? usageLabel(s) : (s.custom_label || 'Usage personnalisé')
})
const panelZoneName = computed(() => panelSystem.value?.zone_name || '')

// Même ordre que la liste : Production → Distribution → Émission →
// Régulation, puis nom.
const ROLE_ORDER = { production: 1, distribution: 2, emission: 3, regulation: 4 }
function rolePriorityOf(d) {
  const roles = Array.isArray(d.device_role) ? d.device_role : (d.device_role ? [d.device_role] : [])
  if (!roles.length) return 5
  return Math.min(...roles.map(r => ROLE_ORDER[String(r).toLowerCase()] || 5))
}
const zoneDeviceEntries = computed(() => {
  const g = displayGroups.value.find(x => x.zone_id === activeZoneId.value)
  if (!g) return []
  const out = []
  for (const s of g.items) {
    if (!s.present) continue
    // Un seul usage affiché (filtre du guide) : précédent / suivant restent dans cet usage.
    if (effectiveUsageFilter.value != null && s.id !== effectiveUsageFilter.value) continue
    const own = props.devicesBySystem[s.id] || []
    const shared = (audit.devices || []).filter(d =>
      d.system_id !== s.id && (d.extra_system_ids || []).includes(s.id))
    const list = [...own, ...shared].sort((a, b) =>
      (rolePriorityOf(a) - rolePriorityOf(b))
      || (a.name || '').toLowerCase().localeCompare((b.name || '').toLowerCase()))
    for (const d of list) out.push({ device: d, system: s })
  }
  return out
})
const panelIndex = computed(() => zoneDeviceEntries.value.findIndex(e =>
  e.device.id === selectedDeviceId.value && e.system.id === selectedSystemId.value))
const prevEntry = computed(() => (panelIndex.value > 0 ? zoneDeviceEntries.value[panelIndex.value - 1] : null))
const nextEntry = computed(() => (panelIndex.value >= 0 && panelIndex.value < zoneDeviceEntries.value.length - 1
  ? zoneDeviceEntries.value[panelIndex.value + 1] : null))

function openDevice(d, s) {
  selectedDeviceId.value = d.id
  selectedSystemId.value = s.id
}
function openDeviceEntry(e) { if (e) openDevice(e.device, e.system) }
function closeDevice() {
  selectedDeviceId.value = null
  selectedSystemId.value = null
}
// Changement de zone : la fiche d'un équipement d'une autre zone se ferme
// (pas en passant par la synthèse : la fiche se retrouve au retour dans la zone).
watch(activeZoneId, (zid) => {
  if (zid === SYNTHESIS_TAB) return
  if (selectedDeviceId.value != null && panelIndex.value < 0) closeDevice()
})
function deviceDisplayName(d) {
  return d.name || [d.brand, d.model_reference].filter(Boolean).join(' ') || `Équipement #${d.id}`
}
function openDeviceNotes() {
  const d = panelDevice.value
  if (!d) return
  emit('open-notes', {
    title: 'Notes équipement',
    contextLabel: deviceDisplayName(d) + ' - ' + panelSystemLabel.value + ' / ' + panelZoneName.value,
    entityType: 'device', entityRef: d,
    currentHtml: d.notes_html || d.notes || '',
  })
}
async function duplicatePanelDevice() {
  const d = panelDevice.value
  if (!d) return
  try {
    await duplicateBacsDevice(d.id)
    await refreshAuditData()
  } catch { error('Duplication impossible') }
}
async function removePanelDevice() {
  const d = panelDevice.value
  if (!d) return
  const ok = await confirm({
    title: 'Supprimer cet équipement ?',
    message: `« ${deviceDisplayName(d)} »`,
    confirmLabel: 'Supprimer', danger: true,
  })
  if (!ok) return
  try {
    await deleteBacsDevice(d.id)
    closeDevice()
    await refreshAuditData()
  } catch { error('Suppression impossible') }
}

// ─── Le reste à faire en tête ─────────────────────────────────
// lib/systems-guide.js : à compléter, à vérifier (règles du pré-contrôle de livraison), sans
// réponse, avec un parcours point par point.

// Pré-contrôle de livraison (points « à vérifier ») : relu à l'ouverture de
// l'étape puis, après chaque modification, une fois la saisie posée.
const precheck = ref(null)
let precheckTimer = null
async function loadPrecheck() {
  if (!audit.isBacs || !audit.docId) return
  try {
    const res = await fetch(`/api/bacs-audit/${audit.docId}/precheck`)
    if (res.ok) precheck.value = await res.json()
  } catch { /* hors ligne : on garde le dernier état connu */ }
}
function schedulePrecheck() {
  clearTimeout(precheckTimer)
  precheckTimer = setTimeout(loadPrecheck, 1200)
}
watch(() => props.active, (a) => { if (a) loadPrecheck() }, { immediate: true })
watch(() => [audit.devices, audit.systems], () => {
  if (props.active) schedulePrecheck()
}, { deep: true })
onBeforeUnmount(() => clearTimeout(precheckTimer))

// Équipements de production sans puissance (cumul du site incomplet), sauf
// ceux dont la puissance est déclarée inconnue (le rapport dit déjà que le
// cumul est un minimum).
const missingPowerIds = computed(() => {
  const ids = powerSummary.value?.power_summary?.incompletePowerDeviceIds || []
  const unknown = new Set((audit.devices || []).filter(d => d.power_kw_unknown).map(d => d.id))
  return ids.filter(id => !unknown.has(id))
})
const checkIndex = computed(() => indexChecks(precheck.value, { missingPowerIds: missingPowerIds.value }))
const guideSystemsById = computed(() => new Map((audit.systems || []).map(s => [s.id, s])))
const guideCtx = computed(() => ({
  devicesBySystem: props.devicesBySystem, allDevices: audit.devices || [], index: checkIndex.value,
  systemsById: guideSystemsById.value,
}))
const zoneStates = computed(() => props.systemsByZone.map(g => zoneGuide(g, guideCtx.value)))
const zoneStateById = computed(() => Object.fromEntries(zoneStates.value.map(z => [z.zoneId, z])))
const guideStopList = computed(() => guideStops(zoneStates.value))
// Points « à vérifier » par équipement, tels que le guide les compte (une puissance exigée et vide
// est « à compléter », pas « à vérifier » : même chiffre dans la liste, le filtre et les onglets).
const checksByDevice = computed(() => {
  const out = {}
  for (const z of zoneStates.value) {
    for (const x of z.systems) {
      for (const e of [...x.devices, ...x.shared]) if (e.checks.length) out[e.device.id] = e.checks
    }
  }
  return out
})
// Puissances manquantes (pastille de l'en-tête, maquette piste D) : exigées et vides, ou point
// « à vérifier » du cumul ; un clic ouvre la première.
const missingPowerStops = computed(() => {
  const out = []
  for (const z of zoneStates.value) {
    for (const x of z.systems) {
      if (!x.present) continue
      for (const e of [...x.devices, ...x.shared.filter(sh => sh.countsHere)]) {
        if (e.missing.some(m => missingShort(m) === 'puissance') || e.checks.some(f => f.code === MISSING_POWER_CODE)) {
          out.push({ kind: 'device', zoneId: z.zoneId, systemId: x.system.id, deviceId: e.device.id })
        }
      }
    }
  }
  return out
})
const activeZoneState = computed(() => zoneStateById.value[activeZoneId.value] || null)
const activeZoneGroup = computed(() => props.systemsByZone.find(g => g.zone_id === activeZoneId.value) || null)
const matrixGuide = computed(() => ({
  byZone: zoneStateById.value,
  totals: guideTotals(zoneStates.value),
  checkCells: checkCells(zoneStates.value),
  stops: guideStopList.value.length,
}))
function zoneStopsCount(zoneId) { return guideStopList.value.filter(s => s.zoneId === zoneId).length }
function natureLabelOf(g) {
  return g?.zone_nature ? (props.zoneNatures.find(z => z.value === g.zone_nature)?.label || g.zone_nature) : ''
}

// Filtre des équipements (tous / à compléter / à vérifier), remis à zéro à chaque zone.
const guideFilter = ref('all')
watch(activeZoneId, () => { guideFilter.value = 'all'; guideUsageFilter.value = null })
// Filtre par usage (guide de la zone) : null = tous les usages ; sinon seul ce système est
// affiché. Ignoré si l'usage n'est plus dans le guide (passé « non concerné », autre zone).
const guideUsageFilter = ref(null)
const effectiveUsageFilter = computed(() => {
  const id = guideUsageFilter.value
  if (id == null) return null
  const sys = activeZoneState.value?.systems.find(x => x.system.id === id)
  return sys && sys.status !== 'not_concerned' ? id : null
})
const usageFilterSystem = computed(() => (effectiveUsageFilter.value == null ? null
  : (audit.systems || []).find(s => s.id === effectiveUsageFilter.value) || null))
// État de l'usage filtré (lignes « reste à faire », compteurs du filtre des équipements).
const filteredZoneState = computed(() => {
  if (effectiveUsageFilter.value == null || !activeZoneGroup.value) return null
  const g = activeZoneGroup.value
  return zoneGuide({ ...g, items: g.items.filter(s => s.id === effectiveUsageFilter.value) }, guideCtx.value)
})
function summaryZoneOf(g) {
  return g.zone_id === activeZoneId.value && filteredZoneState.value ? filteredZoneState.value : zoneStateById.value[g.zone_id]
}
function setUsageFilter(id) {
  guideUsageFilter.value = id
  // Fiche ouverte sur un équipement d'un autre usage : refermée (elle n'est plus dans la liste).
  if (id != null && panelDevice.value && selectedSystemId.value !== id) closeDevice()
  if (id != null) scrollToSystem(id)
}
// Un point du parcours (ou un lien du résumé) dans un autre usage : le filtre le suit.
function followUsage(systemId) {
  if (effectiveUsageFilter.value != null && systemId != null && systemId !== effectiveUsageFilter.value) {
    guideUsageFilter.value = systemId
  }
}
function guidedRows(g) {
  let items = rowItems(g)
  if (g.zone_id === activeZoneId.value && effectiveUsageFilter.value != null) {
    items = items.filter(s => s.id === effectiveUsageFilter.value)
  }
  if (guideFilter.value === 'all') return items
  const z = zoneStateById.value[g.zone_id]
  const keep = new Set((z?.systems || [])
    .filter(x => (guideFilter.value === 'check' ? x.toCheck : x.toComplete))
    .map(x => x.system.id))
  return items.filter(s => keep.has(s.id))
}
// Équipements masqués par le filtre (mention « N équipements masqués », « Tout afficher »).
function hiddenByFilter(g) {
  if (guideFilter.value === 'all') return 0
  const z = summaryZoneOf(g)
  let n = 0
  for (const x of z?.systems || []) {
    if (!x.present) continue
    for (const e of [...x.devices, ...x.shared]) {
      const keep = guideFilter.value === 'check' ? e.checks.length : e.missing.length
      if (!keep) n++
    }
  }
  return n
}

// Usage mis en avant dans le guide : le dernier rejoint, ou celui de la fiche ouverte.
const guideActiveSystemId = ref(null)
watch(selectedSystemId, (id) => { if (id != null) guideActiveSystemId.value = id })
function scrollToSystem(systemId) {
  nextTick(() => {
    const el = [...window.document.querySelectorAll(`#section-systems [data-system-id="${systemId}"]`)]
      .find(e => e.offsetParent !== null)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    flashAuditTarget(el)
  })
}
function goToSystem(sys) {
  if (!sys) return
  followUsage(sys.id)
  guideActiveSystemId.value = sys.id
  if (sys.zone_id != null && activeZoneId.value !== sys.zone_id) selectZone(sys.zone_id)
  scrollToSystem(sys.id)
}
function scrollToDeviceRow(deviceId) {
  nextTick(() => {
    const el = [...window.document.querySelectorAll(`#section-systems [data-device-id="${deviceId}"]`)]
      .find(e => e.offsetParent !== null)
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  })
}
// Parcours : ouvre un point (fiche d'un équipement, ou ligne d'un usage).
function goToStop(stop) {
  if (!stop) return
  guideFilter.value = 'all'
  followUsage(stop.systemId)
  if (activeZoneId.value !== stop.zoneId) selectZone(stop.zoneId)
  const sys = (audit.systems || []).find(s => s.id === stop.systemId)
  if (stop.kind === 'device') {
    const dev = (audit.devices || []).find(d => d.id === stop.deviceId)
    if (dev && sys) {
      if (props.collapsedSystems.has(sys.id)) emit('toggle-system-collapsed', sys.id)
      openDevice(dev, sys)
      scrollToDeviceRow(dev.id)
    }
    return
  }
  closeDevice()
  goToSystem(sys)
}
function resumeZone() {
  goToStop(guideStopList.value.find(s => s.zoneId === activeZoneId.value) || null)
}
function resumeAll() { goToStop(guideStopList.value[0] || null) }
const panelNextStop = computed(() => (selectedDeviceId.value != null
  ? nextStop(guideStopList.value, zoneStates.value, { systemId: selectedSystemId.value, deviceId: selectedDeviceId.value })
  : null))
function stopLabel(stop) {
  if (!stop) return ''
  const zone = stop.zoneId !== activeZoneId.value
    ? (props.systemsByZone.find(g => g.zone_id === stop.zoneId)?.zone_name || '') : ''
  let base
  if (stop.kind === 'device') {
    base = deviceDisplayName((audit.devices || []).find(d => d.id === stop.deviceId) || { id: stop.deviceId })
  } else {
    const sys = (audit.systems || []).find(s => s.id === stop.systemId)
    base = `${sys ? ncChipLabel(sys) : 'Usage'} (${stopReasonLabel(stop.reason)})`
  }
  return zone ? `${base}, ${zone}` : base
}
const panelChecks = computed(() => (selectedDeviceId.value != null ? (checkIndex.value.byDevice.get(selectedDeviceId.value) || []) : []))
const panelMissing = computed(() => {
  const d = panelDevice.value
  const s = panelSystem.value
  return d && s ? deviceMissing(d, (audit.systems || []).find(x => x.id === d.system_id)?.system_category || s.system_category) : []
})
// Pré-contrôle renvoyé après une correction automatique : pris tel quel.
function onPanelPrecheck(p) { if (p) precheck.value = p }

// Ajouter un équipement : la fenêtre reste ouverte pour
// enchaîner ; le dernier équipement ajouté s'ouvre dans la fiche.
const guidedAdd = ref(null) // { system, systemLabel, zoneName }
function openGuidedAdd(sys, zoneName) {
  guidedAdd.value = { system: sys, systemLabel: ncChipLabel(sys), zoneName: zoneName || sys.zone_name || '' }
}
async function onGuidedAdded(dev) {
  const sys = guidedAdd.value?.system
  await refreshAuditData()
  const fresh = (audit.devices || []).find(d => d.id === dev?.id)
  if (fresh && sys) openDevice(fresh, sys)
}
async function onGuidedCreated() {
  const sys = guidedAdd.value?.system
  if (!sys) return
  const before = new Set((audit.devices || []).filter(d => d.system_id === sys.id).map(d => d.id))
  await refreshAuditData()
  const fresh = (audit.devices || []).filter(d => d.system_id === sys.id && !before.has(d.id)).sort((a, b) => b.id - a.id)[0]
  if (fresh) openDevice(fresh, sys)
}

// Guide réduit à ses icônes quand la place manque (largeur de la zone mesurée).
const guideAreaRef = ref(null)
const guideAreaWidth = ref(0)
let guideAreaObs = null
let guideAreaRaf = 0
watch(guideAreaRef, (el, old) => {
  if (typeof ResizeObserver === 'undefined') return
  // Mise à jour à l'image suivante : réduire le guide pendant la mesure relancerait la mesure
  // dans la même image (Safari le signale en erreur).
  if (!guideAreaObs) {
    guideAreaObs = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width)
      if (w === guideAreaWidth.value) return
      cancelAnimationFrame(guideAreaRaf)
      guideAreaRaf = requestAnimationFrame(() => { guideAreaWidth.value = w })
    })
  }
  if (old) guideAreaObs.unobserve(old)
  if (el) guideAreaObs.observe(el)
})
onBeforeUnmount(() => { cancelAnimationFrame(guideAreaRaf); guideAreaObs?.disconnect(); guideAreaObs = null })
const railCollapsed = computed(() => guideAreaWidth.value > 0 && guideAreaWidth.value < 820)

// Fiche guidée : hauteur = place réellement visible sous son bord haut (pas encore collée en haut
// de page, elle commence plus bas) ; son pied (« Suivant à reprendre ») reste ainsi à l'écran.
const guideAsideRef = ref(null)
const guidePanelMaxH = ref('')
let guidePanelRaf = 0
function updateGuidePanelMaxH() {
  cancelAnimationFrame(guidePanelRaf)
  guidePanelRaf = requestAnimationFrame(() => {
    const el = guideAsideRef.value
    if (!el) return
    // Jamais plus haute que la place sous les barres collantes (sinon, zone courte, la fiche
    // grandit, ne peut plus rester collée et passe sous les barres).
    const stickyTop = parseFloat(window.getComputedStyle(el).top) || 0
    const top = Math.max(stickyTop, el.getBoundingClientRect().top)
    // En fin de zone, la fiche s'arrête au bas de la liste : bornée là aussi, son en-tête reste
    // visible sous les barres (elle défile alors à l'intérieur).
    const areaBottom = guideAreaRef.value?.getBoundingClientRect().bottom ?? Infinity
    const room = Math.min(window.innerHeight - top - 16, areaBottom - top)
    guidePanelMaxH.value = `${Math.max(320, Math.round(room))}px`
  })
}
watch(guideAsideRef, (el) => {
  window.removeEventListener('scroll', updateGuidePanelMaxH)
  window.removeEventListener('resize', updateGuidePanelMaxH)
  if (!el) return
  window.addEventListener('scroll', updateGuidePanelMaxH, { passive: true })
  window.addEventListener('resize', updateGuidePanelMaxH)
  updateGuidePanelMaxH()
})
onBeforeUnmount(() => {
  cancelAnimationFrame(guidePanelRaf)
  window.removeEventListener('scroll', updateGuidePanelMaxH)
  window.removeEventListener('resize', updateGuidePanelMaxH)
})

// Hauteurs collantes (mode étape) : la barre des zones colle sous l'en-tête
// de la carte, la fiche sous la barre. Mesurées (ResizeObserver) et posées
// en variables CSS sur la section (--systems-header-h, --systems-tabs-h).
const zoneTabsBarRef = ref(null)
let stickyObs = null
function applyStickyHeights() {
  const section = window.document.getElementById('section-systems')
  if (!section) return
  const header = section.firstElementChild
  if (header) section.style.setProperty('--systems-header-h', `${Math.round(header.getBoundingClientRect().height)}px`)
  const bar = zoneTabsBarRef.value
  if (bar) section.style.setProperty('--systems-tabs-h', `${Math.round(bar.getBoundingClientRect().height)}px`)
}
onMounted(() => {
  if (typeof ResizeObserver === 'undefined') return
  stickyObs = new ResizeObserver(() => applyStickyHeights())
  const header = window.document.getElementById('section-systems')?.firstElementChild
  if (header) stickyObs.observe(header)
  nextTick(applyStickyHeights)
})
watch(zoneTabsBarRef, (el, old) => {
  if (!stickyObs) return
  if (old) stickyObs.unobserve(old)
  if (el) { stickyObs.observe(el); nextTick(applyStickyHeights) }
})
onBeforeUnmount(() => { stickyObs?.disconnect(); stickyObs = null })

// Tableau de présence : case « — » (usage absent de la zone) → fenêtre
// « Ajouter un système » pré-remplie avec la zone et l'usage.
function onMatrixAddSystem({ zoneId, zoneName, category }) {
  selectZone(zoneId)
  createSystemForZone.value = { id: zoneId, name: zoneName }
  createSystemInitial.value = { category: category === '__other' ? '__custom__' : category, label: '' }
}

// Tableau de présence : clic sur une zone (et éventuellement un usage).
function onMatrixSelect({ zoneId, category }) {
  selectZone(zoneId)
  if (!category) {
    // Clic sur une zone : on descend jusqu'à son détail (sous la barre des zones).
    nextTick(() => {
      const el = [...window.document.querySelectorAll(`#section-systems [data-zone-id="${zoneId}"]`)]
        .find(e => e.offsetParent !== null)
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
    return
  }
  nextTick(() => {
    const g = props.systemsByZone.find(x => x.zone_id === zoneId)
    const target = category === '__other'
      ? g?.items.find(s => !s.is_bacs)
      : g?.items.find(s => s.is_bacs && s.system_category === category)
    if (!target) return
    const el = [...window.document.querySelectorAll(`#section-systems [data-system-id="${target.id}"]`)]
      .find(e => e.offsetParent !== null)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    flashAuditTarget(el)
  })
}

// Mig 182 : modale dédiée pour ajouter un système (BACS standard ou usage
// hors décret). Remplace le picker inline qui ne supportait que les usages
// non BACS via custom:uuid. Désormais on peut créer N systèmes BACS de
// même catégorie dans une même zone (ex: 2 chaudières indépendantes).
const createSystemForZone = ref(null) // { id, name } ou null
const createSystemInitial = ref(null) // { category, label } ou null pour le raccourci « + similaire »
function openCreateSystem(zone) {
  createSystemForZone.value = zone
  createSystemInitial.value = null
}
function openCreateSystemLike(s, g) {
  // Pré-remplit la modale avec la catégorie du système source et un nom
  // suggéré (le custom_label + suffixe « (2) » si déjà numéroté, sinon le
  // label de catégorie + « (2) »). L'auditeur peut tout réécrire.
  const base = (s.custom_label && s.custom_label.trim()) || usageLabel(s) || 'Système'
  const m = base.match(/^(.*)\((\d+)\)\s*$/)
  const suggestion = m ? `${m[1].trim()} (${parseInt(m[2], 10) + 1})` : `${base} (2)`
  // Pour les non-BACS (system_category = 'custom:<uuid>'), on ne peut pas
  // dupliquer la catégorie telle quelle — fallback sur l'option « Autre
  // usage » côté modale. Pour les BACS standard, on passe la catégorie.
  const category = s.is_bacs ? s.system_category : '__custom__'
  createSystemForZone.value = { id: g.zone_id, name: g.zone_name }
  createSystemInitial.value = { category, label: suggestion }
}
function closeCreateSystem() {
  createSystemForZone.value = null
  createSystemInitial.value = null
}
async function onSystemCreated() {
  closeCreateSystem()
  await audit.refreshAuditCore()
}

// ─── Renommage inline du custom_label d'un système ────────────────────
// Le nom apparaît entre parenthèses à côté de la catégorie pour les
// systèmes BACS standard (« Chauffage (Chaudière gaz centrale) »), ou en
// libellé principal pour les usages personnalisés. Clic sur la zone →
// input → blur ou Enter pour saver, Échap pour annuler.
const editingNameId = ref(null)
const editingNameValue = ref('')
const nameInputRefs = new Map()
function setNameInputRef(id, el) {
  if (el) nameInputRefs.set(id, el)
  else nameInputRefs.delete(id)
}
function startEditName(s) {
  editingNameId.value = s.id
  editingNameValue.value = s.custom_label || ''
  nextTick(() => nameInputRefs.get(s.id)?.focus?.())
}
function cancelEditName() {
  editingNameId.value = null
  editingNameValue.value = ''
}
// Suppression d'un système autorisée si :
//  - usage non BACS (is_bacs=0) : toujours
//  - usage BACS : seulement si au moins un autre système BACS de même
//    (zone × catégorie) existe (= doublon). On garde toujours 1 racine
//    pour préserver la matrice R175.
function canDeleteSystem(s, g) {
  if (s.is_bacs === 0) return true
  const siblings = (g.items || []).filter(x =>
    x.id !== s.id && x.is_bacs === 1 && x.system_category === s.system_category
  )
  return siblings.length > 0
}

async function saveSystemName(s) {
  // Pas de save si on a déjà reset (blur post-Enter).
  if (editingNameId.value !== s.id) return
  const next = editingNameValue.value.trim() || null
  const current = s.custom_label || null
  editingNameId.value = null
  editingNameValue.value = ''
  if (next === current) return
  try {
    await updateBacsSystem(s.id, { custom_label: next })
    await audit.refreshAuditCore()
  } catch (e) {
    error(e.response?.data?.detail || 'Renommage impossible')
  }
}
async function removeUsage(s) {
  const ok = await confirm({
    title: 'Supprimer cet usage ?',
    message: `« ${usageLabel(s)} » et tous ses systèmes techniques seront supprimés.`,
    confirmLabel: 'Supprimer', danger: true,
  })
  if (!ok) return
  try {
    await deleteBacsSystem(s.id)
    await audit.refreshAuditCore()
  } catch (e) {
    error(e.response?.data?.detail || 'Suppression impossible')
  }
}

function refreshAuditData() { return audit.refreshAuditCore() }
function hasNotes(html) {
  if (!html) return false
  return html.replace(/<[^>]*>/g, '').trim().length > 0
}

// Drag & drop des cartes système, INTRA-zone uniquement (le système ne
// change pas de zone — la zone_id est une FK invariante ici). À chaque
// onEnd, on relit l'ordre du DOM de la zone déplacée et on POST la liste
// complète de la zone : les systèmes non affichés en carte (pastilles
// « non concerné », usages filtrés) gardent leur rang. Le serveur ne
// renumérote que les ids reçus ; les zones ne s'entremêlent pas (tri
// z.position, puis s.position).
const zoneListRefs = ref({})
const sortables = []
function setZoneListRef(zoneId, el) {
  if (el) zoneListRefs.value[zoneId] = el
  else delete zoneListRefs.value[zoneId]
}
function teardownSortables() {
  while (sortables.length) { try { sortables.pop().destroy() } catch { /* ignore */ } }
}
function setupSortables() {
  teardownSortables()
  for (const [, el] of Object.entries(zoneListRefs.value)) {
    if (!el) continue
    const s = Sortable.create(el, {
      draggable: '.system-card',
      handle: '.drag-handle',
      animation: 150,
      ghostClass: 'sortable-ghost',
      onEnd: async (evt) => {
        if (evt.oldIndex === evt.newIndex) return
        const g = props.systemsByZone.find(x => String(x.zone_id) === evt.from.dataset.zoneList)
        if (!g) return
        const domIds = [...evt.from.querySelectorAll('.system-card')]
          .map(card => parseInt(card.getAttribute('data-id'), 10))
          .filter(Boolean)
        const visible = new Set(domIds)
        let k = 0
        const allIds = g.items.map(s => (visible.has(s.id) ? domIds[k++] : s.id))
        try {
          await reorderBacsSystems(audit.docId, allIds)
          await audit.refreshAuditCore()
        } catch {
          error('Réorganisation impossible')
          await audit.refreshAuditCore()
        }
      },
    })
    sortables.push(s)
  }
}
// Recrée les Sortable quand les données changent, quand une zone est montée
// pour la 1re fois (onglet) ou quand les non concernés changent d'affichage.
watch([() => props.systemsByZone, () => visitedZones.value.size, showNotConcernedSystems, guideFilter], async () => {
  await nextTick()
  setupSortables()
}, { immediate: true, flush: 'post', deep: true })
onBeforeUnmount(teardownSortables)
</script>

<template>
  <CollapsibleSection storage-key="systems" section-id="section-systems" :active="active">
    <template #header>
      <SectionHeader number="3" :title="'Systèmes techniques par zone'"
                     :subtitle="audit.isBacs ? 'Usages et équipements de chaque zone, et leur lien avec la GTB' : 'Inventaire des systèmes'"
                     :icon="WrenchScrewdriverIcon" icon-color="text-indigo-600"
                     :step="step"
                     @validate="emit('validate-step', $event)"
                     @invalidate="emit('invalidate-step', $event)">
        <template v-if="audit.isBacs" #subtitle-extra>
          <R175Tooltip article="R175-1 4°" />
          <R175Tooltip article="R175-3" />
        </template>
        <!-- Filtres usage centrés dans la rangée du header. Restent
             visibles dans le sticky au scroll. Couleurs douces : actif
             = white + bordure + icône colorée, inactif = gray-50
             grayscale. Absents en mode étape : le tableau de présence
             donne déjà la vue par usage (clic sur une case = zone + usage). -->
        <template v-if="!isStepMode" #center>
          <div class="flex items-center flex-wrap gap-1 justify-center" @click.stop>
            <button v-for="cat in usageFilterOptions" :key="cat.value"
                    type="button" @click.stop="toggleUsageFilter(cat.value)"
                    :class="['inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium transition whitespace-nowrap border',
                             usageFilter.has(cat.value)
                               ? 'bg-white text-indigo-700 border-indigo-300 shadow-sm'
                               : 'bg-gray-50 text-gray-400 border-gray-200 hover:bg-white hover:text-gray-600']"
                    v-tooltip="usageFilter.has(cat.value) ? 'Retirer ce filtre' : `Filtrer : ${CATEGORY_FULL_LABELS[cat.value] || cat.label}`">
              <SystemCategoryIcon :category="cat.value" size="sm" :with-tooltip="false" :class="usageFilter.has(cat.value) ? '' : 'opacity-50 grayscale'" />
              {{ cat.label }}
            </button>
          </div>
        </template>
        <template #actions>
          <!-- Item 5 — cumul automatique des puissances chaud / froid -->
          <span v-if="powerSummary.power_summary" class="text-xs text-gray-600 whitespace-nowrap flex items-center gap-2">
            <span v-tooltip="POWER_SUMMARY_TIPS.heat">Chaud <strong class="font-semibold tabular-nums text-red-600">{{ powerSummary.power_summary.heatKw }} kW</strong></span>
            <span class="text-gray-300">·</span>
            <span v-tooltip="POWER_SUMMARY_TIPS.cool">Froid <strong class="font-semibold tabular-nums text-cyan-600">{{ powerSummary.power_summary.coolKw }} kW</strong></span>
            <span class="text-gray-300">·</span>
            <span v-tooltip="POWER_SUMMARY_TIPS.retained">Retenue <strong class="font-semibold tabular-nums text-emerald-700">{{ powerSummary.power_summary.retainedKw }} kW</strong></span>
            <span v-if="powerSummary.power_summary.discrepancy"
                  class="text-amber-600 font-medium"
                  v-tooltip="powerDiscrepancyTip({ pct: powerSummary.power_summary.discrepancyPct, manualKw: powerSummary.power_summary.manualKw, autoKw: powerSummary.power_summary.autoKw })">
              ⚠ écart {{ powerSummary.power_summary.discrepancyPct }} %
            </span>
            <!-- Règle protective d'assujettissement : warning si des
                 puissances manquent et que le total auto est sous le
                 seuil 70 kW. L'audit est présumé assujetti par défaut. -->
            <button v-if="missingPowerStops.length" type="button" data-guide-missing-power
                    class="rounded-full px-2 py-0.5 text-[11px] font-medium bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200 hover:bg-rose-100"
                    v-tooltip="() => missingPowersTip(missingPowerStops.length, !!powerSummary.power_summary.presumedSubjectDueToMissingData)"
                    @click="goToStop(missingPowerStops[0])">
              {{ missingPowersLabel(missingPowerStops.length) }}
            </button>
            <span v-else-if="powerSummary.power_summary.presumedSubjectDueToMissingData"
                  class="text-amber-700 font-medium"
                  v-tooltip="missingPowerTip(powerSummary.power_summary.incompletePowerCount)">
              ⚠ {{ powerSummary.power_summary.incompletePowerCount }} sans puissance
            </span>
          </span>
          <span v-else class="text-xs text-gray-600 whitespace-nowrap" v-tooltip="POWER_SUMMARY_TIPS.total">
            Chauffage et climatisation :
            <strong class="font-semibold tabular-nums text-emerald-700">{{ powerSummary.heating_cooling_total_kw || 0 }} kW</strong>
          </span>
        </template>
      </SectionHeader>
    </template>
    <template #summary>
      <span v-if="systemsByZone.length">
        {{ systemsByZone.flatMap(g => g.items).filter(s => s.present).length }} système{{ systemsByZone.flatMap(g => g.items).filter(s => s.present).length > 1 ? 's' : '' }} actif{{ systemsByZone.flatMap(g => g.items).filter(s => s.present).length > 1 ? 's' : '' }}
        · total chauffage et climatisation {{ powerSummary.heating_cooling_total_kw || 0 }} kW
        <span v-if="hiddenNotConcernedCount"> · {{ hiddenNotConcernedCount }} non concerné{{ hiddenNotConcernedCount > 1 ? 's' : '' }}</span>
      </span>
      <span v-else class="italic">Pas encore de systèmes saisis</span>
    </template>
    <div class="px-3 py-3 bg-gray-50">
      <!-- Mode étape : barre des zones en tête, collante sous l'en-tête de la
           carte (hauteur mesurée : --systems-header-h). 1er onglet « Synthèse
           des systèmes » = tableau de présence ; les autres = une zone seule. -->
      <div v-if="isStepMode && systemsByZone.length" ref="zoneTabsBarRef"
           class="sticky z-[5] -mx-3 px-3 pt-1 pb-2 mb-2 bg-gray-50/95 backdrop-blur"
           :style="{ top: 'calc(var(--audit-sticky-offset, 0px) + var(--systems-header-h, 64px))' }">
        <!-- Barre des zones. -->
        <div class="@container flex items-center gap-2">
          <AuditSubTabs
            class="flex-1 min-w-0"
            data-audit-subtabs="systems-zones"
            scroll-hints
            id-prefix="systems-zone"
            aria-label="Synthèse et zones du site"
            :items="zoneTabs"
            :model-value="activeZoneId"
            @update:model-value="selectZone"
          />
        </div>
      </div>
      <!-- Onglet « Synthèse des systèmes » : tableau de présence zones × usages
           (vue d'ensemble, ✓ / ✗ en un clic, accès direct à une zone ou un usage). -->
      <SystemsPresenceMatrix
        v-if="isStepMode && systemsByZone.length"
        v-show="isSynthesis"
        :collapsible="false"
        :groups="systemsByZone"
        :devices-by-system="devicesBySystem"
        :all-devices="audit.devices || []"
        :active-zone-id="activeZoneId"
        :guide="matrixGuide"
        @select="onMatrixSelect"
        @set-presence="({ system, value }) => setPresence(system, value)"
        @add-system="onMatrixAddSystem"
        @resume="resumeAll" />
      <!-- Mode étape : liste des équipements à gauche, fiche à droite (onglet d'une zone). -->
      <div v-show="!isStepMode || !isSynthesis" :class="isStepMode ? 'flex items-start gap-3' : ''">
      <!-- ═══ Le guide des usages à gauche, le reste à faire en tête,
           un seul tableau pour la zone (usages en groupes), la fiche à droite si ouverte. ═══ -->
      <div ref="guideAreaRef" data-guide-area
           class="flex-1 min-w-0 flex items-stretch rounded-xl bg-white ring-1 ring-slate-200 shadow-sm">
        <div v-if="activeZoneState && activeZoneGroup"
             :class="['shrink-0 border-r border-slate-100', railCollapsed ? 'w-14' : 'w-60']">
          <SystemsGuideRail
            class="sticky"
            :style="{ top: 'calc(var(--audit-sticky-offset, 0px) + var(--systems-header-h, 64px) + var(--systems-tabs-h, 52px) + 8px)' }"
            :zone="activeZoneState"
            :nature-label="natureLabelOf(activeZoneGroup)"
            :stops-count="zoneStopsCount(activeZoneId)"
            :filter-system-id="effectiveUsageFilter"
            :collapsed="railCollapsed"
            :label-of="ncChipLabel"
            @filter="setUsageFilter"
            @resume="resumeZone" />
        </div>
        <!-- Fond gris clair : les cartes d'usage (blanches) s'en détachent. -->
        <div :class="['flex-1 min-w-0 p-3 bg-slate-100/70', activeZoneState && activeZoneGroup ? 'rounded-r-xl' : 'rounded-xl']">
          <template v-for="g in systemsByZone" :key="g.zone_id">
          <div v-if="visitedZones.has(g.zone_id)" v-show="activeZoneId === g.zone_id"
               :data-zone-id="g.zone_id" class="flex flex-col gap-3">
            <p v-if="g.zone_kind === 'technical'" class="flex items-center gap-2 text-xs text-gray-500">
              <span class="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-200 text-slate-600 whitespace-nowrap"
                    v-tooltip="TECHNICAL_ZONE_TIP">hors décret BACS</span>
            </p>
            <SystemsGuideSummary
              v-if="zoneStateById[g.zone_id]"
              :zone="summaryZoneOf(g)"
              :label-of="ncChipLabel"
              :name-of="deviceDisplayName"
              :compact="!!panelDevice"
              v-model:filter="guideFilter"
              @open-device="({ device, system }) => { followUsage(system.id); openDevice(device, system); scrollToDeviceRow(device.id) }"
              @go-system="goToSystem"
              @add-device="sys => openGuidedAdd(sys, g.zone_name)" />
            <p v-if="!g.items.length" class="px-2 py-3 text-sm text-gray-500 italic">
              Aucun usage dans cette zone pour l'instant.
            </p>
            <!-- Un seul usage affiché (filtre du guide de gauche) : rappel, retour à tous les usages. -->
            <p v-if="g.zone_id === activeZoneId && usageFilterSystem" class="flex items-center gap-2 px-1 text-xs text-slate-600"
               data-guide-usage-filter>
              {{ usageFilterText(ncChipLabel(usageFilterSystem)) }}
              <button type="button" @click="setUsageFilter(null)"
                      class="font-medium text-indigo-700 underline underline-offset-2">{{ SHOW_ALL_USAGES_LABEL }}</button>
            </p>
            <!-- Un bloc par usage : carte blanche, bandeau de tête teinté de la couleur de l'usage
                 (comme un circuit sur un schéma technique). En-tête de colonnes commun au-dessus :
                 colonnes alignées d'un usage à l'autre. -->
            <div v-if="rowItems(g).length" class="flex flex-col gap-1.5">
              <SystemDeviceList v-if="g.items.some(s => s.present)" header-only :compact="!!panelDevice"
                                :system="g.items.find(s => s.present)" />
              <div :data-zone-list="g.zone_id" :ref="el => setZoneListRef(g.zone_id, el)" class="flex flex-col gap-3">
                <div v-for="s in guidedRows(g)" :key="s.id" :data-id="s.id" :data-system-id="s.id"
                     :style="fluidStyle(s.system_category)"
                     :class="['system-card guide-usage bg-white rounded-xl overflow-hidden ring-1',
                              s.not_concerned ? 'opacity-60 ring-slate-300' : 'ring-slate-200']">
                  <!-- En-tête de l'usage. -->
                  <div :class="['guide-usage-head flex flex-wrap items-center gap-x-2 gap-y-1.5 px-3 py-2.5',
                                s.present && !collapsedSystems.has(s.id) && 'has-body']">
                    <button type="button"
                            class="drag-handle p-0.5 -ml-0.5 text-gray-400 hover:text-gray-700 cursor-grab active:cursor-grabbing"
                            v-tooltip="'Glisser pour changer l’ordre'">
                      <Bars3Icon class="w-3.5 h-3.5" />
                    </button>
                    <button v-if="s.present" type="button" @click="emit('toggle-system-collapsed', s.id)"
                            class="p-0.5 -ml-0.5 text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded transition shrink-0"
                            v-tooltip="collapsedSystems.has(s.id) ? 'Déplier ce système' : 'Replier ce système'">
                      <ChevronDownIcon v-if="collapsedSystems.has(s.id)" class="w-3.5 h-3.5" />
                      <ChevronUpIcon v-else class="w-3.5 h-3.5" />
                    </button>
                    <span class="guide-usage-tile w-8 h-8 shrink-0 rounded-lg inline-flex items-center justify-center bg-white">
                      <SystemCategoryIcon :category="s.system_category" size="sm" />
                    </span>
                    <span class="font-semibold text-[15px] text-indigo-600 whitespace-nowrap cursor-pointer truncate max-w-[40%]"
                          v-tooltip.overflow
                          @click="s.present && emit('toggle-system-collapsed', s.id)">
                      {{ s.is_bacs ? usageLabel(s) : (s.custom_label || 'Usage personnalisé') }}
                    </span>
                    <template v-if="editingNameId === s.id">
                      <span v-if="s.is_bacs" class="text-sm text-gray-500 shrink-0">(</span>
                      <input :ref="el => setNameInputRef(s.id, el)" type="text"
                             v-model="editingNameValue"
                             :placeholder="s.is_bacs ? 'ex : Chaudière gaz centrale' : 'Nom du système'"
                             @blur="saveSystemName(s)"
                             @keydown.enter="saveSystemName(s)"
                             @keydown.escape="cancelEditName"
                             class="h-7 px-2 text-sm border border-indigo-300 rounded bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 min-w-40" />
                      <span v-if="s.is_bacs" class="text-sm text-gray-500 shrink-0">)</span>
                    </template>
                    <span v-else-if="s.is_bacs && s.custom_label"
                          @click="startEditName(s)"
                          class="text-sm text-gray-600 truncate cursor-text hover:text-gray-900 hover:bg-white rounded px-1 max-w-[30%]"
                          v-tooltip="`Renommer « ${s.custom_label} »`">
                      ({{ s.custom_label }})
                    </span>
                    <button v-else-if="s.is_bacs" type="button" @click="startEditName(s)"
                            class="text-[11px] text-gray-600 hover:text-indigo-700 hover:bg-indigo-50 rounded px-1.5 py-0.5 transition shrink-0"
                            v-tooltip="'Nommer ce système (ex. chaudière gaz)'">
                      + nom
                    </button>
                    <button v-else type="button" @click="startEditName(s)" class="btn-icon shrink-0"
                            v-tooltip="'Renommer ce système'">
                      <PencilSquareIcon class="w-3.5 h-3.5" />
                    </button>
                    <span v-if="s.present && deviceSummary(s) && !panelDevice"
                          class="min-w-0 truncate text-xs text-gray-600"
                          v-tooltip="() => deviceSummaryTip(s)">
                      {{ deviceSummary(s) }}
                    </span>
                    <span v-else-if="isSystemPresentWithoutDevices(s)"
                          class="shrink-0 px-2 py-0.5 text-[11px] font-medium text-amber-800 bg-amber-50 ring-1 ring-inset ring-amber-300 rounded-full whitespace-nowrap"
                          v-tooltip="SYSTEM_NO_DEVICE_TIP">
                      Sans équipement
                    </span>
                    <span class="flex-1"></span>
                    <span :class="!s.present && !s.not_concerned ? 'rounded-lg outline-1 outline-dashed outline-slate-500 outline-offset-1' : 'contents'">
                      <SegmentedToggle :model-value="presenceValue(s)" :options="PRESENCE_OPTIONS"
                                       :tooltip="SYSTEM_PRESENCE_TOGGLE_TIP"
                                       @update:model-value="v => setPresence(s, v)" />
                    </span>
                    <div class="flex items-center gap-1 shrink-0">
                      <Tooltip :text="s.present ? 'Paramètres de ce système' : SYSTEM_NOT_PRESENT_TIPS.settings">
                        <button type="button" :disabled="!s.present" @click="openSystemSettings(s)" class="btn-icon">
                          <Cog6ToothIcon class="w-4 h-4" />
                        </button>
                      </Tooltip>
                      <Tooltip :text="!s.present ? SYSTEM_NOT_PRESENT_TIPS.notes : (hasNotes(s.notes_html || s.notes) ? 'Modifier les notes de ce système' : 'Ajouter une note à ce système')">
                        <button type="button" :disabled="!s.present"
                                @click="emit('open-notes', { title: 'Notes systeme', contextLabel: (usageLabel(s)) + ' - ' + g.zone_name, entityType: 'system', entityRef: s, currentHtml: s.notes_html || s.notes || '' })"
                                :class="['btn-icon', hasNotes(s.notes_html || s.notes) && 'is-active']">
                          <PencilSquareIcon class="w-4 h-4" />
                        </button>
                      </Tooltip>
                      <button type="button" @click="openCreateSystemLike(s, g)" class="btn-icon"
                              v-tooltip="'Ajouter un système du même usage'">
                        <FontAwesomeIcon :icon="['fas', 'clone']" class="w-4 h-4" />
                      </button>
                      <button v-if="canDeleteSystem(s, g)" type="button" @click="removeUsage(s)"
                              class="btn-icon btn-icon-danger" v-tooltip="'Supprimer ce système'">
                        <TrashIcon class="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <!-- Bouclage ECS, poste négligeable. -->
                  <div v-if="s.present && !collapsedSystems.has(s.id) && (s.system_category === 'dhw' || s.marked_negligible_under_5pct)"
                       class="px-3 py-2.5 space-y-2 border-b border-slate-100 bg-white">
                    <div v-if="s.system_category === 'dhw'" class="flex items-center gap-2 flex-wrap">
                      <span class="inline-flex items-center gap-1 text-xs font-medium text-gray-600 whitespace-nowrap">
                        Bouclage de l’eau chaude
                        <HelpTip size="xs" :tip="DHW_LOOP_TIP" />
                      </span>
                      <div :class="['inline-flex rounded-md overflow-hidden border',
                                    s.is_looped ? 'border-gray-200' : 'border-amber-400 ring-2 ring-amber-200/70']">
                        <button v-for="opt in LOOP_OPTIONS" :key="opt.value" type="button"
                                @click="patchSystem(s, { is_looped: opt.value })"
                                :class="['px-2.5 py-1 text-xs whitespace-nowrap transition',
                                         s.is_looped === opt.value ? 'bg-indigo-600 text-white font-medium' : 'bg-white text-gray-600 hover:bg-gray-50']">
                          {{ opt.label }}
                        </button>
                      </div>
                      <span v-if="!s.is_looped" class="text-[11px] font-medium text-amber-700 whitespace-nowrap"
                            v-tooltip="DHW_LOOP_MISSING_TIP">à renseigner</span>
                      <span v-if="s.is_looped === 'looped'" class="inline-flex items-center gap-1 text-[11px] text-amber-700 italic">
                        Eau chaude bouclée : pas d’arrêt en période d’occupation (risque de légionelle).
                        <HelpTip size="xs" :tip="DHW_LOOP_LEGIONELLA_TIP" />
                      </span>
                    </div>
                    <div v-if="s.marked_negligible_under_5pct"
                         class="flex items-center gap-2 rounded-md bg-amber-50 border border-amber-200 px-2.5 py-1.5">
                      <HelpTip :tip="NEGLIGIBLE_TIP" />
                      <div class="text-[11px] text-amber-800 leading-snug">
                        <strong>Poste négligeable (&lt; 5 %)</strong>
                        <span v-if="s.negligible_justification" class="text-amber-700"> — {{ s.negligible_justification }}</span>
                      </div>
                    </div>
                  </div>
                  <SystemDeviceList
                    v-if="s.present && !collapsedSystems.has(s.id)"
                    :compact="!!panelDevice"
                    :filter="guideFilter"
                    :checks="checksByDevice"
                    :system="s"
                    :devices="devicesBySystem[s.id] || []"
                    :selected-id="selectedSystemId === s.id ? selectedDeviceId : null"
                    :site-uuid="document?.site_uuid"
                    @select="d => openDevice(d, s)"
                    @changed="refreshAuditData"
                    @add-device="sys => openGuidedAdd(sys, g.zone_name)" />
                </div>
              </div>
            </div>
            <p v-if="hiddenByFilter(g)" class="flex items-center gap-2 text-xs text-gray-600">
              {{ hiddenByFilterText(hiddenByFilter(g)) }}
              <button type="button" @click="guideFilter = 'all'" class="font-medium text-indigo-700 underline underline-offset-2">{{ SHOW_ALL_LABEL }}</button>
            </p>
            <!-- Usages « non concernés » : pastilles, « Présent » en 1 clic (comme aujourd'hui). -->
            <div v-if="ncItems(g).length && !(g.zone_id === activeZoneId && usageFilterSystem)" class="flex flex-wrap items-center gap-1.5 px-1">
              <span class="text-[11px] text-gray-600 mr-1">
                Non concerné{{ ncItems(g).length > 1 ? 's' : '' }} ({{ ncItems(g).length }}) :
              </span>
              <button v-for="s in ncItems(g)" :key="s.id" type="button"
                      :data-system-id="s.id" data-audit-nc-chip
                      @click="setPresence(s, 'present')"
                      v-tooltip="notConcernedChipTip(ncChipLabel(s), hasNotes(s.notes_html || s.notes))"
                      class="inline-flex items-center gap-1.5 h-7 pl-1.5 pr-2 rounded-full border border-dashed border-gray-400 bg-gray-50 text-xs text-gray-700 hover:border-emerald-500 hover:bg-emerald-50 hover:text-emerald-800 transition">
                <SystemCategoryIcon :category="s.system_category" size="sm" :with-tooltip="false" class="opacity-60 grayscale" />
                <span>{{ ncChipLabel(s) }}</span>
                <FontAwesomeIcon v-if="hasNotes(s.notes_html || s.notes)" :icon="['fas', 'pen-to-square']" class="w-2.5 h-2.5 text-indigo-400" />
                <FontAwesomeIcon :icon="['fas', 'plus']" class="w-2.5 h-2.5" />
              </button>
              <button type="button" data-audit-nc-expand
                      @click="showNotConcernedSystems = true"
                      class="ml-auto text-[11px] text-gray-600 hover:text-gray-900 underline underline-offset-2"
                      v-tooltip="NOT_CONCERNED_EXPAND_TIP">
                Afficher en détail
              </button>
            </div>
            <div v-else-if="showNotConcernedSystems && g.items.some(s => s.not_concerned)" class="flex justify-end px-1">
              <button type="button" data-audit-nc-collapse
                      @click="showNotConcernedSystems = false"
                      class="text-[11px] text-gray-600 hover:text-gray-900 underline underline-offset-2">
                Regrouper les non concernés en pastilles
              </button>
            </div>
            <button type="button" @click="openCreateSystem({ id: g.zone_id, name: g.zone_name })"
                    class="self-start inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-indigo-700 rounded-lg hover:bg-indigo-50 transition">
              <PlusIcon class="w-4 h-4 shrink-0" /> Ajouter un système
            </button>
          </div>
          </template>
          <div v-if="!systemsByZone.length" class="px-5 py-6 text-center text-sm text-gray-500">
            Aucune zone définie pour ce site. Ajoute-en depuis la section ci-dessus.
          </div>
        </div>
      </div>
      <!-- Fiche équipement : tous les champs de l'équipement, précédent / suivant dans la zone. Elle
           n'apparaît qu'ouverte (la liste prend sinon toute la largeur). -->
      <!-- Largeur : 440 px au moins, puis 38 % de l'étape jusqu'à 620 px (grands écrans : la fiche
           respire au lieu de laisser la place vide à la liste). -->
      <aside v-if="panelDevice && panelSystem" ref="guideAsideRef"
             class="w-[clamp(440px,38%,620px)] shrink-0 sticky self-start"
             :style="{ top: 'calc(var(--audit-sticky-offset, 0px) + var(--systems-header-h, 64px) + var(--systems-tabs-h, 52px) + 8px)' }"
             data-device-panel>
        <SystemsGuidePanel
          :device="panelDevice"
          :system="panelSystem"
          :system-label="panelSystemLabel"
          :zone-name="panelZoneName"
          :index="panelIndex"
          :total="zoneDeviceEntries.length"
          :has-prev="!!prevEntry"
          :has-next="!!nextEntry"
          :checks="panelChecks"
          :missing="panelMissing"
          :next-label="panelNextStop ? stopLabel(panelNextStop) : ''"
          :site-uuid="document?.site_uuid || null"
          :audit-id="audit.docId"
          :systems="audit.systems || []"
          :has-notes="hasNotes(panelDevice.notes_html || panelDevice.notes)"
          :max-height="guidePanelMaxH || 'calc(100vh - var(--audit-sticky-offset, 0px) - var(--systems-header-h, 64px) - var(--systems-tabs-h, 52px) - 24px)'"
          @prev="openDeviceEntry(prevEntry)"
          @next="openDeviceEntry(nextEntry)"
          @close="closeDevice"
          @notes="openDeviceNotes"
          @duplicate="duplicatePanelDevice"
          @remove="removePanelDevice"
          @changed="refreshAuditData"
          @next-stop="goToStop(panelNextStop)"
          @precheck="onPanelPrecheck" />
      </aside>
      </div>
    </div>
    <!-- Modale paramètres système : 5 % + surcharge parties assujetties -->
    <SystemSettingsModal
      v-if="settingsSystem"
      :system="settingsSystem"
      :system-weight-pct="systemWeightPct(settingsSystem)"
      @close="closeSystemSettings"
      @patched="refreshAuditData" />
    <!-- Modale création d'un système (catégorie + nom). Mig 182. -->
    <CreateSystemModal
      v-if="createSystemForZone"
      :zone="createSystemForZone"
      :library-categories="categoryLibrary"
      :initial="createSystemInitial"
      :zone-systems="systemsByZone.find(g => g.zone_id === createSystemForZone.id)?.items || []"
      @close="closeCreateSystem"
      @created="onSystemCreated" />
    <!-- Ajout d'un équipement : recherche d'abord, fiche ouverte ensuite. -->
    <DeviceAddGuidedModal
      v-if="guidedAdd"
      :system="guidedAdd.system"
      :system-label="guidedAdd.systemLabel"
      :zone-name="guidedAdd.zoneName"
      @close="guidedAdd = null"
      @added="onGuidedAdded"
      @created="onGuidedCreated" />
  </CollapsibleSection>
</template>

<style scoped>
/* Chaque usage a sa couleur de circuit (lib/system-fluids.js). */
.guide-usage-head { background: var(--fluid-tint); }
.guide-usage-head.has-body { border-bottom: 1px solid color-mix(in srgb, var(--fluid) 22%, transparent); }
.guide-usage-tile { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--fluid) 35%, transparent); }
</style>
