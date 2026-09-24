<script setup>
import { ref, computed, watch, nextTick, inject, onMounted, onBeforeUnmount } from 'vue'
import { storeToRefs } from 'pinia'
import Sortable from 'sortablejs'
import { WrenchScrewdriverIcon, MapPinIcon, ChevronDownIcon, ChevronUpIcon, PencilSquareIcon, Bars3Icon, PlusIcon, TrashIcon, Cog6ToothIcon } from '@heroicons/vue/24/outline'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import '@/lib/equipment-icons'
import CollapsibleSection from '@/components/CollapsibleSection.vue'
import R175Tooltip from '@/components/R175Tooltip.vue'
import SectionHeader from '@/components/audit/SectionHeader.vue'
import SystemCategoryIcon from '@/components/SystemCategoryIcon.vue'
import SystemDevicesTable from '@/components/SystemDevicesTable.vue'
import SystemSettingsModal from '@/components/audit/SystemSettingsModal.vue'
import CreateSystemModal from '@/components/audit/CreateSystemModal.vue'
import SegmentedToggle from '@/components/audit/SegmentedToggle.vue'
import { useAuditStore } from '@/stores/audit'
import { useNotification } from '@/composables/useNotification'
import { useConfirm } from '@/composables/useConfirm'
import { systemUsageLabel, isDeviceComplete, deviceMissingFields } from '@/lib/audit-options'
import {
  updateBacsSystem, reorderBacsSystems, deleteBacsSystem, listSystemCategories,
  duplicateBacsDevice, deleteBacsDevice,
} from '@/api'
import AuditSubTabs from '@/components/audit/AuditSubTabs.vue'
import SystemsPresenceMatrix from '@/components/audit/SystemsPresenceMatrix.vue'
import SystemDeviceList from '@/components/audit/SystemDeviceList.vue'
import DeviceEditModal from '@/components/audit/DeviceEditModal.vue'
import DeviceMoveShare from '@/components/DeviceMoveShare.vue'
import BacsPhotoButton from '@/components/BacsPhotoButton.vue'
import VoiceNoteButton from '@/components/VoiceNoteButton.vue'
import { AUDIT_STEP_MODE_KEY } from '@/lib/audit-steps-ui'
import { flashAuditTarget } from '@/lib/audit-reveal'

// Couleur d'accent par categorie de systeme : aligne avec
// SystemCategoryIcon, sert de border-l-4 pour mieux distinguer les
// categories quand plusieurs sont presentes dans une zone.
const CATEGORY_BORDER = {
  heating: 'border-l-red-400',
  cooling: 'border-l-cyan-400',
  ventilation: 'border-l-slate-400',
  dhw: 'border-l-blue-400',
  lighting_indoor: 'border-l-amber-400',
  lighting_outdoor: 'border-l-amber-500',
  electricity_production: 'border-l-emerald-500',
}

// Section 3 — Systèmes techniques par zone (R175-1 4° + R175-3 3°/4°).
const props = defineProps({
  systemsByZone: { type: Array, required: true },
  devicesBySystem: { type: Object, required: true },
  hiddenNotConcernedCount: { type: Number, default: 0 },
  collapsedZones: { type: Set, required: true },
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
  'toggle-zone-collapsed', 'toggle-system-collapsed',
  'add-device',
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

// Présence d'un usage : contrôle segmenté binaire « Présent / Non concerné »
// remplaçant les deux anciennes cases. Tant que rien n'est saisi, aucun
// bouton n'est sélectionné.
const PRESENCE_OPTIONS = [
  { value: 'present', label: 'Présent', tone: 'green' },
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
  { value: 'looped', label: 'Boucle ECS' },
  { value: 'not_looped', label: 'Pas de boucle' },
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
// puissance des équipements propres (même calcul que SystemDevicesTable :
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
        message: `Ce poste représente environ ${pct} % de la puissance du site (estimation par puissance). La règle des 5 % se base sur la consommation réelle — vérifiez avant de l'exempter.`,
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
const activeZoneId = ref(null)
const visitedZones = ref(new Set())
function selectZone(zid) {
  if (zid == null) return
  activeZoneId.value = zid
  visitedZones.value.add(zid)
  try { localStorage.setItem(zoneStorageKey(), String(zid)) } catch { /* navigation privée */ }
}

// Points à reprendre dans une zone (même règle que l'étape « Systèmes » de la
// vue : équipements incomplets des usages présents) + usages sans réponse et
// usages présents sans équipement.
function zoneTodo(g) {
  let incomplete = 0
  for (const s of g.items) {
    if (!s.present) continue
    for (const d of (props.devicesBySystem[s.id] || [])) {
      if (!isDeviceComplete(d, s.system_category)) incomplete++
    }
  }
  const noDevice = g.items.filter(isSystemPresentWithoutDevices).length
  const unanswered = g.items.filter(s => !s.present && !s.not_concerned).length
  return { incomplete, noDevice, unanswered }
}

const zoneTabs = computed(() => props.systemsByZone.map(g => {
  const total = g.items.length
  const active = g.items.filter(s => s.present).length
  const { incomplete, noDevice, unanswered } = zoneTodo(g)
  const warn = [
    incomplete && `${incomplete} équipement${incomplete > 1 ? 's' : ''} incomplet${incomplete > 1 ? 's' : ''} (bouton « Modifier » rouge)`,
    noDevice && `${noDevice} usage${noDevice > 1 ? 's' : ''} présent${noDevice > 1 ? 's' : ''} sans équipement`,
    unanswered && `${unanswered} usage${unanswered > 1 ? 's' : ''} sans réponse (Présent / Non concerné)`,
  ].filter(Boolean)
  const natureLabel = g.zone_nature ? (props.zoneNatures.find(z => z.value === g.zone_nature)?.label || g.zone_nature) : null
  return {
    key: g.zone_id,
    label: g.zone_name || 'Zone sans nom',
    meta: `${active} actif${active > 1 ? 's' : ''} / ${total}`,
    tag: g.zone_kind === 'technical' ? 'tech.' : null,
    badge: incomplete || null,
    badgeTone: 'amber',
    dot: !incomplete && (noDevice || unanswered) ? 'amber' : null,
    tooltip: [
      g.zone_name + (natureLabel ? ` — ${natureLabel}` : ''),
      g.zone_kind === 'technical' ? 'Zone technique (hors décret BACS)' : null,
      `${active} usage${active > 1 ? 's' : ''} présent${active > 1 ? 's' : ''} sur ${total}`,
      ...warn,
    ].filter(Boolean).join('\n'),
  }
}))

// Zone par défaut : dernière consultée, sinon la 1re qui a un point à
// reprendre, sinon la 1re. Réévaluée si la zone active disparaît.
watch(() => props.systemsByZone.map(g => g.zone_id).join(','), () => {
  const ids = props.systemsByZone.map(g => g.zone_id)
  if (!ids.length || ids.includes(activeZoneId.value)) return
  let saved = NaN
  try { saved = Number(localStorage.getItem(zoneStorageKey())) } catch { /* */ }
  if (ids.includes(saved)) { selectZone(saved); return }
  const todo = props.systemsByZone.find(g => {
    const t = zoneTodo(g)
    return t.incomplete || t.noDevice || t.unanswered
  })
  selectZone(todo ? todo.zone_id : ids[0])
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
// Équipements propres de la zone encore incomplets (les partagés sont
// comptés dans leur zone d'origine, comme l'étape).
const zoneIncompleteDevices = computed(() => zoneDeviceEntries.value
  .filter(e => e.device.system_id === e.system.id && !isDeviceComplete(e.device, e.system.system_category))
  .map(e => ({ ...e, missing: deviceMissingFields(e.device, e.system.system_category).length })))

function openDevice(d, s) {
  selectedDeviceId.value = d.id
  selectedSystemId.value = s.id
}
function openDeviceEntry(e) { if (e) openDevice(e.device, e.system) }
function closeDevice() {
  selectedDeviceId.value = null
  selectedSystemId.value = null
}
// « Agrandir » : même fiche dans une grande fenêtre (mode modale de
// DeviceEditModal). Les deux lisent et écrivent le même équipement du store :
// le panneau reste à jour. Refermée à chaque changement d'équipement.
const deviceExpanded = ref(false)
watch(selectedDeviceId, () => { deviceExpanded.value = false })
// Changement de zone : la fiche d'un équipement d'une autre zone se ferme.
watch(activeZoneId, () => {
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
watch([() => props.systemsByZone, () => visitedZones.value.size, showNotConcernedSystems], async () => {
  await nextTick()
  setupSortables()
}, { immediate: true, flush: 'post', deep: true })
onBeforeUnmount(teardownSortables)
</script>

<template>
  <CollapsibleSection storage-key="systems" section-id="section-systems" :active="active">
    <template #header>
      <SectionHeader number="3" :title="'Systèmes techniques par zone'"
                     :subtitle="audit.isBacs ? 'R175-1 4° + R175-3 3°, 4°' : 'Inventaire des systèmes'"
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
                    v-tooltip="usageFilter.has(cat.value) ? `Retirer « ${cat.label} » du filtre` : `Filtrer sur « ${cat.label} »`">
              <SystemCategoryIcon :category="cat.value" size="sm" :class="usageFilter.has(cat.value) ? '' : 'opacity-50 grayscale'" />
              {{ cat.label }}
            </button>
          </div>
        </template>
        <template #actions>
          <!-- Item 5 — cumul automatique des puissances chaud / froid -->
          <span v-if="powerSummary.power_summary" class="text-xs text-gray-600 whitespace-nowrap flex items-center gap-2">
            <span>Chaud <strong class="font-mono text-red-600">{{ powerSummary.power_summary.heatKw }} kW</strong></span>
            <span class="text-gray-300">·</span>
            <span>Froid <strong class="font-mono text-cyan-600">{{ powerSummary.power_summary.coolKw }} kW</strong></span>
            <span class="text-gray-300">·</span>
            <span>Retenue <strong class="font-mono text-emerald-700">{{ powerSummary.power_summary.retainedKw }} kW</strong></span>
            <span v-if="powerSummary.power_summary.discrepancy"
                  class="text-amber-600 font-medium"
                  v-tooltip="`Écart de ${powerSummary.power_summary.discrepancyPct} % entre la valeur saisie (${powerSummary.power_summary.manualKw} kW) et le cumul calculé (${powerSummary.power_summary.autoKw} kW).`">
              ⚠ écart {{ powerSummary.power_summary.discrepancyPct }} %
            </span>
            <!-- Règle protective d'assujettissement : warning si des
                 puissances manquent et que le total auto est sous le
                 seuil 70 kW. L'audit est présumé assujetti par défaut. -->
            <span v-if="powerSummary.power_summary.presumedSubjectDueToMissingData"
                  class="text-amber-700 font-medium"
                  v-tooltip="`${powerSummary.power_summary.incompletePowerCount} équipement(s) thermique(s) sans puissance saisie. L'audit est présumé assujetti par défaut (au-dessus du seuil 70 kW). Compléter les puissances pour affiner le verdict.`">
              ⚠ {{ powerSummary.power_summary.incompletePowerCount }} sans puissance
            </span>
          </span>
          <span v-else class="text-xs text-gray-600 whitespace-nowrap">
            Chauffage + clim :
            <strong class="font-mono text-emerald-700">{{ powerSummary.heating_cooling_total_kw || 0 }} kW</strong>
          </span>
        </template>
      </SectionHeader>
    </template>
    <template #summary>
      <span v-if="systemsByZone.length">
        {{ systemsByZone.flatMap(g => g.items).filter(s => s.present).length }} système{{ systemsByZone.flatMap(g => g.items).filter(s => s.present).length > 1 ? 's' : '' }} actif{{ systemsByZone.flatMap(g => g.items).filter(s => s.present).length > 1 ? 's' : '' }}
        · total chauffage + clim {{ powerSummary.heating_cooling_total_kw || 0 }} kW
        <span v-if="hiddenNotConcernedCount"> · {{ hiddenNotConcernedCount }} non concerné{{ hiddenNotConcernedCount > 1 ? 's' : '' }}</span>
      </span>
      <span v-else class="italic">Pas encore de systèmes saisis</span>
    </template>
    <div class="px-3 py-3 bg-gray-50">
      <!-- Mode étape : tableau de présence zones × usages (vue d'ensemble,
           ✓ / ✗ en un clic, accès direct à une zone ou un usage). -->
      <SystemsPresenceMatrix
        v-if="isStepMode && systemsByZone.length"
        class="mb-3"
        :groups="systemsByZone"
        :devices-by-system="devicesBySystem"
        :all-devices="audit.devices || []"
        :active-zone-id="activeZoneId"
        @select="onMatrixSelect"
        @set-presence="({ system, value }) => setPresence(system, value)"
        @add-system="onMatrixAddSystem" />
      <!-- Mode étape : sous-onglets de zones sous le tableau, collants sous
           l'en-tête de la carte (hauteur mesurée : --systems-header-h). -->
      <div v-if="isStepMode && systemsByZone.length" ref="zoneTabsBarRef"
           class="sticky z-[5] -mx-3 px-3 pt-1 pb-2 mb-2 bg-gray-50/95 backdrop-blur"
           :style="{ top: 'calc(var(--audit-sticky-offset, 0px) + var(--systems-header-h, 64px))' }">
        <AuditSubTabs
          data-audit-subtabs="systems-zones"
          id-prefix="systems-zone"
          aria-label="Zones du site"
          :items="zoneTabs"
          :model-value="activeZoneId"
          @update:model-value="selectZone"
        />
      </div>
      <!-- Mode étape : liste des équipements à gauche, fiche à droite. -->
      <div :class="isStepMode ? 'flex items-start gap-3' : ''">
      <div :class="isStepMode ? 'flex-1 min-w-0' : ''">
      <!-- Les usages "non concerné" restent toujours visibles (grisés et
           atténués via la classe opacity-60 + bordure dashed sur la card),
           pour permettre à l'auditeur de les remettre actifs facilement
           sans avoir à toggle un flag d'affichage. -->
      <div class="space-y-3">
        <template v-for="g in displayGroups" :key="g.zone_id">
        <!-- Mode étape : zone montée à sa 1re ouverture, puis conservée. -->
        <div v-if="!isStepMode || visitedZones.has(g.zone_id)"
             v-show="!isStepMode || activeZoneId === g.zone_id"
             :data-zone-id="g.zone_id"
             :class="isStepMode ? '' : 'bg-slate-100/60 border border-slate-200 rounded-lg p-3'">
          <!-- Mode étape : le sous-onglet porte déjà le nom de la zone et le
               compte d'usages → simple ligne d'info (nature, hors décret).
               Hauteur fixe (h-7) sur une seule ligne : le panneau « Fiche
               équipement » est décalé d'autant (mt-7) pour que son haut
               s'aligne sur la 1re carte. -->
          <div v-if="isStepMode" class="flex items-center gap-2 px-1 h-7 min-w-0 text-xs text-gray-500">
            <MapPinIcon class="w-3.5 h-3.5 text-indigo-400 shrink-0" />
            <span class="truncate min-w-0"><span class="font-medium text-gray-700">{{ g.zone_name }}</span><span v-if="g.zone_nature"> · {{ zoneNatures.find(z => z.value === g.zone_nature)?.label || g.zone_nature }}</span></span>
            <span v-if="g.zone_kind === 'technical'"
                  class="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-200 text-slate-600 whitespace-nowrap">
              hors décret BACS
            </span>
            <span class="ml-auto shrink-0 whitespace-nowrap">
              {{ g.items.filter(s => s.present).length }} usage{{ g.items.filter(s => s.present).length > 1 ? 's' : '' }} présent{{ g.items.filter(s => s.present).length > 1 ? 's' : '' }}
              sur {{ g.items.length }}
            </span>
          </div>
          <div v-else class="flex items-center gap-2 pb-2 border-b border-gray-100"
               :class="collapsedZones.has(g.zone_id) ? '' : 'mb-3'">
            <button v-if="!isStepMode" type="button" @click="emit('toggle-zone-collapsed', g.zone_id)"
                    class="p-1 -ml-1 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded transition shrink-0"
                    v-tooltip="collapsedZones.has(g.zone_id) ? 'Déplier la zone' : 'Replier la zone'">
              <ChevronDownIcon v-if="collapsedZones.has(g.zone_id)" class="w-4 h-4" />
              <ChevronUpIcon v-else class="w-4 h-4" />
            </button>
            <MapPinIcon class="w-5 h-5 text-indigo-500" />
            <span :class="['font-semibold text-lg text-gray-900', !isStepMode && 'cursor-pointer']"
                  @click="!isStepMode && emit('toggle-zone-collapsed', g.zone_id)">{{ g.zone_name }}</span>
            <span v-if="g.zone_nature" class="text-xs text-gray-500 italic">— {{ zoneNatures.find(z => z.value === g.zone_nature)?.label || g.zone_nature }}</span>
            <span v-if="g.zone_kind === 'technical'"
                  class="text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-200 text-slate-600 whitespace-nowrap">
              hors décret BACS
            </span>
            <span class="ml-auto text-[10px] text-gray-400">
              {{ g.items.filter(s => s.present).length }} actif{{ g.items.filter(s => s.present).length > 1 ? 's' : '' }}
              / {{ g.items.length }}
            </span>
          </div>
          <div v-show="isStepMode || !collapsedZones.has(g.zone_id)" class="space-y-2"
               :data-zone-list="g.zone_id"
               :ref="el => setZoneListRef(g.zone_id, el)">
            <p v-if="isStepMode && !g.items.length" class="px-2 py-3 text-sm text-gray-500 italic">
              Aucun usage dans cette zone pour l'instant.
            </p>
            <template v-for="s in rowItems(g)" :key="s.id">
              <!-- Pas de PhotoDropzone autour de la catégorie : drops scopés
                   au système (device card) uniquement, voir SystemDevicesTable.
                   Les usages "non concerné" restent visibles (grisés via
                   opacity-60 + bordure dashed dans le :class plus bas). -->
              <div :data-id="s.id" :data-system-id="s.id"
                   :class="['system-card rounded-lg border bg-white',
                            s.present ? ['border-gray-200 border-l-4 shadow-sm', CATEGORY_BORDER[s.system_category] || 'border-l-indigo-400']
                                      : (s.not_concerned ? 'border-dashed border-gray-200 bg-gray-50/40 opacity-60'
                                                          : 'border-gray-200 bg-gray-50/40')]">
                <!-- Header de catégorie : grid à colonnes fixes. Largeurs :
                     drag 20px, chevron 20px, picto 28px, label 240px (truncate),
                     contrôle segmenté présence en auto, puis 1fr pour pousser
                     les actions à droite. -->
                <div :class="['px-3 grid items-center gap-3 bg-white rounded-t-lg', isStepMode ? 'py-1.5' : 'py-2']"
                     :style="'grid-template-columns: 20px 20px 28px minmax(240px, auto) auto minmax(0, 1fr);'">
                  <button type="button"
                          class="drag-handle p-0.5 -ml-0.5 text-gray-300 hover:text-gray-600 cursor-grab active:cursor-grabbing"
                          v-tooltip="'Glisser pour réordonner'">
                    <Bars3Icon class="w-3.5 h-3.5" />
                  </button>
                  <button v-if="s.present" type="button" @click="emit('toggle-system-collapsed', s.id)"
                          class="p-0.5 -ml-0.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded transition shrink-0"
                          v-tooltip="collapsedSystems.has(s.id) ? 'Déplier la catégorie' : 'Replier la catégorie'">
                    <ChevronDownIcon v-if="collapsedSystems.has(s.id)" class="w-3.5 h-3.5" />
                    <ChevronUpIcon v-else class="w-3.5 h-3.5" />
                  </button>
                  <span v-else></span>
                  <SystemCategoryIcon :category="s.system_category" size="md" />
                  <!-- Titre : libellé de la catégorie (Chauffage / Refroidissement…)
                       + nom du système entre parenthèses, inline-éditable au clic.
                       Pour les usages BACS standard : « Chauffage (Chaudière gaz
                       centrale) ». Pour les usages personnalisés (is_bacs=0) :
                       le custom_label est déjà le label affiché par usageLabel,
                       on l'expose en édition directement. -->
                  <div class="flex items-center gap-1 min-w-0">
                    <span class="font-medium text-sm text-gray-800 whitespace-nowrap cursor-pointer truncate shrink-0"
                          @click="s.present && emit('toggle-system-collapsed', s.id)">
                      {{ s.is_bacs ? usageLabel(s) : (s.custom_label || 'Usage personnalisé') }}
                    </span>
                    <!-- Input inline pour le nom du système. Visible quand l'auditeur
                         clique sur la zone (parens). Save sur blur / Enter. Pour BACS
                         le nom s'affiche entre parenthèses ; pour non-BACS, c'est le
                         libellé principal qui est édité. -->
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
                          class="text-sm text-gray-600 truncate cursor-text hover:text-gray-900 hover:bg-gray-50 rounded px-1"
                          v-tooltip="'Cliquer pour renommer ce système'">
                      ({{ s.custom_label }})
                    </span>
                    <button v-else-if="s.is_bacs" type="button" @click="startEditName(s)"
                            class="text-[11px] text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded px-1.5 py-0.5 transition shrink-0"
                            v-tooltip="'Donner un nom à ce système (ex: Chaudière gaz centrale)'">
                      + nom
                    </button>
                    <button v-else type="button" @click="startEditName(s)"
                            class="btn-icon shrink-0"
                            v-tooltip="'Renommer ce système'">
                      <PencilSquareIcon class="w-3.5 h-3.5" />
                    </button>
                    <!-- Badge : système coché présent mais sans équipement saisi.
                         Pas bloquant, juste signaler à l'auditeur. Le détail
                         (« ajoute une chaudière… ») apparaît aussi en encart
                         dans le contenu déplié. -->
                    <span v-if="isSystemPresentWithoutDevices(s)"
                          class="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium text-amber-700 bg-amber-50 border border-amber-300 rounded-full shrink-0 whitespace-nowrap"
                          v-tooltip="'Aucun équipement saisi. Ajoute au moins une chaudière, une unité DRV, etc.'">
                      ⚠ Aucun équipement
                    </span>
                    <!-- Mode étape : résumé des équipements (remplace la ligne
                         d'en-tête du tableau, supprimée pour gagner de la place). -->
                    <span v-if="isStepMode && s.present && deviceSummary(s)"
                          class="ml-1 text-xs text-gray-500 whitespace-nowrap">
                      {{ deviceSummary(s) }}
                    </span>
                  </div>
                  <SegmentedToggle :model-value="presenceValue(s)" :options="PRESENCE_OPTIONS"
                                   @update:model-value="v => setPresence(s, v)" />
                  <div class="flex items-center gap-1 shrink-0 justify-self-end">
                    <!-- Paramètres système : poste négligeable + surcharge parties -->
                    <button
                      type="button"
                      :disabled="!s.present"
                      @click="openSystemSettings(s)"
                      class="btn-icon"
                      v-tooltip="'Paramètres du système (poste négligeable, parties assujetties)'">
                      <Cog6ToothIcon class="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      :disabled="!s.present"
                      @click="emit('open-notes', { title: 'Notes systeme', contextLabel: (usageLabel(s)) + ' - ' + g.zone_name, entityType: 'system', entityRef: s, currentHtml: s.notes_html || s.notes || '' })"
                      :class="['btn-icon', hasNotes(s.notes_html || s.notes) && 'is-active']"
                      v-tooltip="hasNotes(s.notes_html || s.notes) ? 'Modifier les notes' : 'Ajouter une note'">
                      <PencilSquareIcon class="w-4 h-4" />
                    </button>
                    <!-- Raccourci : ajouter un système similaire (même
                         catégorie + même zone, nom pré-rempli pour aider
                         l'auditeur à différencier les 2 équipements). -->
                    <button type="button"
                            @click="openCreateSystemLike(s, g)"
                            class="btn-icon"
                            v-tooltip="'Ajouter un système similaire dans cette zone'">
                      <FontAwesomeIcon :icon="['fas', 'clone']" class="w-4 h-4" />
                    </button>
                    <!-- Suppression : usages manuels (non BACS) toujours,
                         OU systèmes BACS dupliqués (au moins 1 sibling). -->
                    <button v-if="canDeleteSystem(s, g)" type="button"
                            @click="removeUsage(s)"
                            class="btn-icon btn-icon-danger"
                            v-tooltip="'Supprimer ce système'">
                      <TrashIcon class="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <!-- Items 1 & 3 — caractérisation BACS du système (visible
                     quand le système est présent et déplié) :
                     · bouclage ECS (catégorie dhw uniquement)
                     · règle des 5 % — poste considéré négligeable -->
                <div v-if="s.present && !collapsedSystems.has(s.id) && (s.system_category === 'dhw' || s.marked_negligible_under_5pct)"
                     :class="['px-3 border-t border-gray-100 bg-slate-50/60', isStepMode ? 'py-2 space-y-2' : 'py-2.5 space-y-2.5']">
                  <!-- Item 3 — bouclage ECS -->
                  <div v-if="s.system_category === 'dhw'" class="flex items-center gap-2 flex-wrap">
                    <span class="text-xs font-medium text-gray-600 whitespace-nowrap">Bouclage ECS :</span>
                    <div class="inline-flex rounded-md overflow-hidden border border-gray-200">
                      <button v-for="opt in LOOP_OPTIONS" :key="opt.value" type="button"
                              @click="patchSystem(s, { is_looped: opt.value })"
                              :class="['px-2.5 py-1 text-xs whitespace-nowrap transition',
                                       s.is_looped === opt.value
                                         ? 'bg-indigo-600 text-white font-medium'
                                         : 'bg-white text-gray-600 hover:bg-gray-50']">
                        {{ opt.label }}
                      </button>
                    </div>
                    <span v-if="s.is_looped === 'looped'" class="text-[11px] text-amber-700 italic">
                      Boucle ECS : arrêt interdit (arrêté du 30 nov. 2005 — risque légionelle).
                    </span>
                  </div>
                  <!-- Items 1 & 4 (poste négligeable + surcharge parties)
                       déplacés dans SystemSettingsModal (bouton ⚙️ au-dessus).
                       Affichage en lecture seule des deux indicateurs clés
                       (badge négligeable + badge assujetti) si renseignés,
                       pour que le contenu de la modal reste visible d'un
                       coup d'œil sur la card. -->
                  <div v-if="s.marked_negligible_under_5pct"
                       class="flex items-center gap-2 rounded-md bg-amber-50 border border-amber-200 px-2.5 py-1.5">
                    <span class="text-sm">ℹ️</span>
                    <div class="text-[11px] text-amber-800 leading-snug">
                      <strong>Poste négligeable (&lt; 5 %)</strong>
                      <span v-if="s.negligible_justification" class="text-amber-700"> — {{ s.negligible_justification }}</span>
                    </div>
                  </div>
                </div>

                <!-- Mode étape : liste en lecture, clic = fiche à droite. -->
                <SystemDeviceList
                  v-if="isStepMode && s.present && !collapsedSystems.has(s.id)"
                  :system="s"
                  :devices="devicesBySystem[s.id] || []"
                  :selected-id="selectedSystemId === s.id ? selectedDeviceId : null"
                  :site-uuid="document?.site_uuid"
                  @select="d => openDevice(d, s)"
                  @changed="refreshAuditData"
                  @add-device="sys => emit('add-device', { id: sys.id, system_category: sys.system_category, zone_name: g.zone_name, is_bacs: sys.is_bacs, custom_label: sys.custom_label, library_category_key: sys.library_category_key })" />
                <SystemDevicesTable
                  v-else-if="s.present && !collapsedSystems.has(s.id)"
                  :compact="isStepMode"
                  :system="s"
                  :devices="devicesBySystem[s.id] || []"
                  :system-label="usageLabel(s)"
                  :site-uuid="document?.site_uuid"
                  @changed="refreshAuditData"
                  @system-updated="patch => patchSystem(s, patch)"
                  @open-device-notes="d => emit('open-notes', {
                    title: 'Notes equipement',
                    contextLabel: (d.name || 'Equipement') + ' - ' + (usageLabel(s)) + ' / ' + g.zone_name,
                    entityType: 'device', entityRef: d,
                    currentHtml: d.notes_html || d.notes || ''
                  })"
                  @add-device="sys => emit('add-device', { id: sys.id, system_category: sys.system_category, zone_name: g.zone_name, is_bacs: sys.is_bacs, custom_label: sys.custom_label, library_category_key: sys.library_category_key })" />
              </div>
            </template>
            <!-- Mode étape : usages « non concernés » regroupés en pastilles
                 grisées — toujours visibles, un clic les repasse « Présent ».
                 « Afficher en détail » redonne les lignes complètes (renommer,
                 dupliquer, supprimer, glisser). -->
            <div v-if="ncItems(g).length"
                 class="flex flex-wrap items-center gap-1.5 px-1 py-1.5">
              <span class="text-[11px] text-gray-500 mr-1">
                Non concerné{{ ncItems(g).length > 1 ? 's' : '' }} ({{ ncItems(g).length }}) :
              </span>
              <button v-for="s in ncItems(g)" :key="s.id" type="button"
                      :data-system-id="s.id" data-audit-nc-chip
                      @click="setPresence(s, 'present')"
                      v-tooltip="`${ncChipLabel(s)} — non concerné dans cette zone. Cliquer pour le marquer « Présent ».${hasNotes(s.notes_html || s.notes) ? '\nCe système a une note (visible avec « Afficher en détail »).' : ''}`"
                      class="inline-flex items-center gap-1.5 h-7 pl-1.5 pr-2 rounded-full border border-dashed border-gray-300 bg-gray-50 text-xs text-gray-500 hover:border-emerald-400 hover:bg-emerald-50 hover:text-emerald-700 transition">
                <SystemCategoryIcon :category="s.system_category" size="sm" class="opacity-60 grayscale" />
                <span>{{ ncChipLabel(s) }}</span>
                <FontAwesomeIcon v-if="hasNotes(s.notes_html || s.notes)" :icon="['fas', 'pen-to-square']" class="w-2.5 h-2.5 text-indigo-400" />
                <FontAwesomeIcon :icon="['fas', 'plus']" class="w-2.5 h-2.5" />
              </button>
              <button type="button" data-audit-nc-expand
                      @click="showNotConcernedSystems = true"
                      class="ml-auto text-[11px] text-gray-500 hover:text-gray-800 underline underline-offset-2"
                      v-tooltip="'Afficher les usages non concernés en lignes complètes (renommer, dupliquer, supprimer, réordonner)'">
                Afficher en détail
              </button>
            </div>
            <div v-else-if="isStepMode && showNotConcernedSystems && g.items.some(s => s.not_concerned)"
                 class="flex justify-end px-1">
              <button type="button" data-audit-nc-collapse
                      @click="showNotConcernedSystems = false"
                      class="text-[11px] text-gray-500 hover:text-gray-800 underline underline-offset-2">
                Regrouper les non concernés en pastilles
              </button>
            </div>
            <!-- Mig 182 : ouverture d'une modale pour ajouter un système
                 (catégorie BACS standard OU usage hors décret). Le bouton
                 unique remplace l'ancien picker inline (limité aux usages
                 manuels). On peut désormais créer N systèmes BACS de même
                 catégorie dans une même zone (ex: 2 chaudières indépendantes). -->
            <button type="button" @click="openCreateSystem({ id: g.zone_id, name: g.zone_name })"
                    :class="isStepMode
                      ? 'inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-indigo-700 rounded-lg hover:bg-indigo-50 transition'
                      : 'btn-add'">
              <PlusIcon class="w-4 h-4 shrink-0" /> Ajouter un système
            </button>
          </div>
        </div>
        </template>
      </div>
      <div v-if="!systemsByZone.length" class="px-5 py-6 text-center text-sm text-gray-500">
        Aucune zone définie pour ce site. Ajoute-en depuis la section ci-dessus.
      </div>
      </div>
      <!-- Fiche équipement (mode étape) : tous les champs de l'équipement,
           précédent / suivant dans la zone ; sinon, ce qu'il reste à compléter. -->
      <!-- mt-7 = hauteur de la ligne de zone (h-7) : haut aligné sur la
           1re carte système (le décalage ne compte plus une fois collé). -->
      <aside v-if="isStepMode && systemsByZone.length"
             class="w-[440px] shrink-0 sticky self-start mt-7"
             :style="{ top: 'calc(var(--audit-sticky-offset, 0px) + var(--systems-header-h, 64px) + var(--systems-tabs-h, 52px) + 8px)' }"
             data-device-panel>
        <div v-if="panelDevice && panelSystem"
             class="bg-white rounded-xl ring-1 ring-slate-200 shadow-md overflow-hidden flex flex-col"
             :style="{ maxHeight: 'calc(100vh - var(--audit-sticky-offset, 0px) - var(--systems-header-h, 64px) - var(--systems-tabs-h, 52px) - 24px)' }">
          <header class="px-4 pt-3 pb-2 border-b border-slate-100">
            <div class="flex items-start gap-2">
              <div class="min-w-0 flex-1">
                <p class="text-[11px] text-gray-500 truncate">{{ panelZoneName }} › {{ panelSystemLabel }}</p>
                <h3 class="text-sm font-medium text-gray-900 truncate">{{ deviceDisplayName(panelDevice) }}</h3>
              </div>
              <div class="flex items-center gap-1 shrink-0">
                <button type="button" class="btn-icon" :disabled="!prevEntry" @click="openDeviceEntry(prevEntry)"
                        v-tooltip="'Équipement précédent'">
                  <FontAwesomeIcon :icon="['fas', 'chevron-left']" class="w-3 h-3" />
                </button>
                <span v-if="panelIndex >= 0" class="text-[11px] text-gray-500 tabular-nums px-0.5">
                  {{ panelIndex + 1 }}/{{ zoneDeviceEntries.length }}
                </span>
                <button type="button" class="btn-icon" :disabled="!nextEntry" @click="openDeviceEntry(nextEntry)"
                        v-tooltip="'Équipement suivant'">
                  <FontAwesomeIcon :icon="['fas', 'chevron-right']" class="w-3 h-3" />
                </button>
                <button type="button" class="btn-icon" @click="deviceExpanded = true"
                        v-tooltip="'Agrandir la fiche'" aria-label="Agrandir la fiche">
                  <FontAwesomeIcon :icon="['fas', 'up-right-and-down-left-from-center']" class="w-3 h-3" />
                </button>
                <button type="button" class="btn-icon" @click="closeDevice" v-tooltip="'Fermer la fiche'">
                  <FontAwesomeIcon :icon="['fas', 'xmark']" class="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            <!-- Actions de l'équipement (auparavant sur la ligne du tableau) -->
            <div class="mt-2 flex items-center gap-1 flex-wrap">
              <button type="button" @click="openDeviceNotes"
                      :class="['btn-icon', hasNotes(panelDevice.notes_html || panelDevice.notes) && 'is-active']"
                      v-tooltip="hasNotes(panelDevice.notes_html || panelDevice.notes) ? 'Modifier les notes' : 'Ajouter une note'">
                <FontAwesomeIcon :icon="['fas', 'pen-to-square']" class="w-3.5 h-3.5" />
              </button>
              <BacsPhotoButton
                v-if="document?.site_uuid"
                :key="`photo-${panelDevice.id}`"
                :site-uuid="document.site_uuid"
                :attach-to="{ device_id: panelDevice.id, system_id: panelSystem.id }"
                :label="deviceDisplayName(panelDevice)" />
              <VoiceNoteButton
                v-if="document?.site_uuid"
                :key="`voice-${panelDevice.id}`"
                :site-uuid="document.site_uuid"
                :attach-to="{ device_id: panelDevice.id }"
                :label="deviceDisplayName(panelDevice)" />
              <DeviceMoveShare
                :key="`move-${panelDevice.id}`"
                :device="panelDevice"
                :systems="audit.systems || []"
                @updated="refreshAuditData" />
              <span class="w-px h-5 bg-gray-200 mx-0.5"></span>
              <button type="button" class="btn-icon" @click="duplicatePanelDevice" v-tooltip="'Dupliquer'">
                <FontAwesomeIcon :icon="['fas', 'clone']" class="w-3.5 h-3.5" />
              </button>
              <button type="button" class="btn-icon btn-icon-danger" @click="removePanelDevice" v-tooltip="'Supprimer'">
                <FontAwesomeIcon :icon="['fas', 'trash']" class="w-3.5 h-3.5" />
              </button>
            </div>
          </header>
          <div class="overflow-y-auto min-h-0 flex-1">
            <DeviceEditModal
              :key="`edit-${panelDevice.id}-${panelSystem.id}`"
              panel
              :device="panelDevice"
              :system="panelSystem"
              :system-label="panelSystemLabel"
              :zone-name="panelZoneName"
              @changed="refreshAuditData"
              @close="closeDevice" />
          </div>
          <!-- Fiche agrandie (grande fenêtre, téléportée dans <body>) -->
          <DeviceEditModal
            v-if="deviceExpanded"
            :key="`edit-full-${panelDevice.id}-${panelSystem.id}`"
            :device="panelDevice"
            :system="panelSystem"
            :system-label="panelSystemLabel"
            :zone-name="panelZoneName"
            @changed="refreshAuditData"
            @close="deviceExpanded = false" />
        </div>
        <div v-else class="bg-white rounded-xl ring-1 ring-slate-200 p-4">
          <h3 class="text-xs font-semibold uppercase tracking-wider text-gray-600">Fiche équipement</h3>
          <p class="mt-2 text-sm text-gray-600">
            Clique sur un équipement pour ouvrir sa fiche : tous ses champs et ce qu'il reste à compléter.
          </p>
          <div v-if="zoneIncompleteDevices.length" class="mt-3">
            <p class="text-xs font-medium text-amber-800">
              À compléter dans cette zone ({{ zoneIncompleteDevices.length }})
            </p>
            <ul class="mt-1.5 space-y-1">
              <li v-for="e in zoneIncompleteDevices" :key="`${e.system.id}-${e.device.id}`" class="flex items-center gap-2 text-xs">
                <button type="button" @click="openDeviceEntry(e)"
                        class="text-left text-indigo-700 hover:text-indigo-900 hover:underline truncate">
                  {{ deviceDisplayName(e.device) }}
                </button>
                <span class="text-gray-400 shrink-0">· {{ e.system.is_bacs ? usageLabel(e.system) : (e.system.custom_label || 'Usage') }}</span>
                <span class="ml-auto shrink-0 px-1.5 py-px rounded-full bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200">
                  {{ e.missing }}
                </span>
              </li>
            </ul>
          </div>
          <p v-else class="mt-3 text-xs text-emerald-700">✓ Tous les équipements de cette zone sont complets.</p>
        </div>
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
      @close="closeCreateSystem"
      @created="onSystemCreated" />
  </CollapsibleSection>
</template>
