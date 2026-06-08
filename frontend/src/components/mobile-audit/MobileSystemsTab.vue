<script setup>
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import '@/lib/equipment-icons'
import { ref, computed, watch, nextTick, onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useAuditStore } from '@/stores/audit'
import { useNotification } from '@/composables/useNotification'
import { useConfirm } from '@/composables/useConfirm'
import { updateBacsSystem, shareBacsDevice, moveBacsDevice, createBacsDevice, updateBacsDevice, deleteBacsDevice, createBacsSystem, deleteBacsSystem, listSystemCategories, getEquipmentTemplate } from '@/api'
import MobileField from './MobileField.vue'
import MobileSheet from './MobileSheet.vue'
import MobileSelectSheet from './MobileSelectSheet.vue'
import MobileThermalRegulationSheet from './MobileThermalRegulationSheet.vue'
import MobileLibraryPicker from './MobileLibraryPicker.vue'
import SystemCategoryIcon from '@/components/SystemCategoryIcon.vue'
import BacsPhotoButton from '@/components/BacsPhotoButton.vue'
import VoiceNoteButton from '@/components/VoiceNoteButton.vue'
import SystemPartiesPanel from '@/components/audit/SystemPartiesPanel.vue'
import MobileYesNo from './MobileYesNo.vue'
import { COMM_OPTIONS, ENERGY_OPTIONS as ENERGY_OPTIONS_DECORATED, ROLE_OPTIONS as ROLE_OPTIONS_DECORATED, systemUsageLabel, deviceMissingFields, isDeviceComplete, regulationTypesForCategory, GRANULARITY_OPTIONS, deviceRoleAllowsEnergySource } from '@/lib/audit-options'

// Item 8 — type de calcul de puissance par équipement. Vide = automatique.
const POWER_CALC_OPTIONS = [
  { value: 'thermodynamic_max', label: 'Thermodynamique (max chaud/froid)' },
  { value: 'boiler_sum', label: 'Chaudière (somme nominales)' },
  { value: 'joule_sum', label: 'Effet joule (somme élec.)' },
  { value: 'district_heating_substation', label: 'Sous-station réseau' },
  { value: 'out_of_scope', label: 'Hors cumul (secours, process…)' },
]
// Item 3 — bouclage ECS.
const LOOP_OPTIONS = [
  { value: 'looped', label: 'Boucle ECS' },
  { value: 'not_looped', label: 'Pas de boucle' },
  { value: 'unknown', label: 'Inconnu' },
]
// Item 7c — séparabilité du comptage d'un équipement partagé.
const MOBILE_METERING_OPTS = [
  { value: 'yes', label: 'Oui', activeCls: 'bg-emerald-600 text-white border-emerald-600' },
  { value: 'partial', label: 'Partiel', activeCls: 'bg-amber-500 text-white border-amber-500' },
  { value: 'no', label: 'Non', activeCls: 'bg-rose-600 text-white border-rose-600' },
]

const audit = useAuditStore()
const { document, systems, devices, zones, powerSummary, thermal } = storeToRefs(audit)
const { error, success } = useNotification()
const { confirm } = useConfirm()

const isBacs = computed(() => (document.value?.kind || 'bacs_audit') === 'bacs_audit')

// ── Régulation thermique : ouverture du drill-down ──────────────────
// Le panneau inline a été déplacé dans MobileThermalRegulationSheet
// (sous-page tactile) pour alléger la liste des systèmes. Ici on calcule
// juste le résumé compact affiché sur le bouton qui ouvre le sheet.
function thermalFor(zoneId, category) {
  return thermal.value.find(t => t.zone_id === zoneId && (t.category || 'heating') === category)
}

const REGULATION_LABEL = {
  per_room: 'par pièce',
  per_zone: 'par zone',
  central_only: 'centrale',
  none: 'aucune',
}

function thermalStatus(zoneId, category) {
  const t = thermalFor(zoneId, category)
  if (!t) return { label: 'Non concernée', tone: 'neutral' }
  // « Régulation automatique » se déduit de regulation_type (≠ none).
  if (!t.regulation_type || t.regulation_type === 'none') {
    return { label: 'À renseigner', tone: 'warn' }
  }
  const granularity = REGULATION_LABEL[t.regulation_type]
  return { label: `Automatique · ${granularity || t.regulation_type}`, tone: 'ok' }
}

const thermalSheetTarget = ref(null)
function openThermalSheet(zoneId, category) {
  thermalSheetTarget.value = { zoneId, category }
}
function closeThermalSheet() { thermalSheetTarget.value = null }

// ── Navigation drill-down (N1 zones → N2 usages → N3 détail usage) ──
// L'ancienne liste plate dépliait toutes les zones d'un coup, ce qui
// remplissait l'écran. Maintenant on entre par la liste des zones puis
// dans les usages d'une zone, et seulement ensuite dans le détail.
const currentView = ref('zones') // 'zones' | 'usages'
const selectedZoneId = ref(null)
const selectedZone = computed(() =>
  (zones.value || []).find(z => z.zone_id === selectedZoneId.value) || null,
)
const absentUsagesCollapsed = ref(true)
function goToZone(zoneId) {
  selectedZoneId.value = zoneId
  absentUsagesCollapsed.value = true
  currentView.value = 'usages'
  // Repart en haut sur la nouvelle vue, sinon on hérite du scroll précédent.
  nextTick(() => window.scrollTo({ top: 0, behavior: 'instant' }))
}
function goBackToZones() {
  currentView.value = 'zones'
  selectedZoneId.value = null
}

// ── Drill-down par usage ────────────────────────────────────────────
// Taper un usage présent ouvre la page dédiée (équipements + régulation).
const openedUsageId = ref(null)
const openedUsage = computed(() =>
  systems.value.find(s => s.id === openedUsageId.value) || null,
)
function openUsage(s) { openedUsageId.value = s.id }
function closeUsage() { openedUsageId.value = null }

const SYSTEM_LABEL = {
  heating: 'Chauffage',
  cooling: 'Refroidissement',
  ventilation: 'Ventilation',
  dhw: 'ECS',
  lighting_indoor: 'Éclairage intérieur',
  lighting_outdoor: 'Éclairage extérieur',
  electricity_production: 'Production photovoltaïque',
}
// Phrase négative cohérente avec le label positif. Utilisée quand
// l'auditeur a marqué l'usage "Absent" (= not_concerned=true).
const SYSTEM_NEGATIVE_LABEL = {
  heating: 'Pas de chauffage dans cette zone',
  cooling: 'Pas de refroidissement',
  ventilation: 'Pas de ventilation mécanique',
  dhw: 'Pas d\'ECS',
  lighting_indoor: 'Pas d\'éclairage intérieur',
  lighting_outdoor: 'Pas d\'éclairage extérieur',
  electricity_production: 'Pas de production photovoltaïque',
}
// Options décorées (icônes + couleurs) depuis lib/audit-options pour un
// rendu visuel cohérent dans les MobileSelectSheet (énergie mono,
// niveaux multi).
const ENERGY_OPTIONS = ENERGY_OPTIONS_DECORATED
const ROLE_OPTIONS = ROLE_OPTIONS_DECORATED

// Libellé d'un usage : catégorie BACS, ou nom libre si usage manuel.
function usageLabel(s) { return systemUsageLabel(s) }

// Focus inter-tab : MobileChecklistTab (KPIs) bascule ici avec un
// system_id à mettre en avant. En mode drill-down on navigue directement
// dans la zone du système puis on ouvre son détail (présent) ou on le
// laisse visible (à renseigner / absent).
const focusedSystemId = ref(null)
watch(() => audit.pendingFocus, (focus) => {
  if (!focus || focus.kind !== 'systems' || focus.id == null) return
  const sys = systems.value.find(s => s.id === focus.id)
  if (sys) {
    selectedZoneId.value = sys.zone_id
    currentView.value = 'usages'
    focusedSystemId.value = sys.id
    nextTick(() => {
      const el = window.document.querySelector(`[data-system-id="${sys.id}"]`)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
    setTimeout(() => { focusedSystemId.value = null }, 2500)
  }
  audit.pendingFocus = null
}, { immediate: true })

// Toutes les zones (fonctionnelles + techniques), même sans usage : on
// peut y ajouter des usages manuels (zones techniques incluses).
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
    groups.push({ zone_id: z.zone_id, zone_name: z.name, zone_kind: z.kind || 'functional', items: byZone.get(z.zone_id) || [] })
  }
  for (const [zid, items] of byZone) {
    if (seen.has(zid)) continue
    groups.push({ zone_id: zid, zone_name: items[0]?.zone_name, zone_kind: 'functional', items })
  }
  return groups
})

// ── KPI par zone pour le niveau 1 ───────────────────────────────────
// Une zone affiche : la rangée d'icônes des usages présents (lecture
// visuelle rapide) + une pastille rouge si au moins un usage reste « à
// renseigner » (ni présent ni absent décidé).
function zoneCard(g) {
  const presentCategories = []
  const seenCats = new Set()
  let toRenseigner = 0
  for (const s of g.items) {
    if (s.present && !s.not_concerned) {
      // un usage manuel (is_bacs=0) n'a pas de catégorie BACS → on
      // affiche quand même une icône fallback unique
      const key = s.system_category || `manual:${s.id}`
      if (!seenCats.has(key)) {
        seenCats.add(key)
        presentCategories.push({ key, category: s.system_category, isManual: s.is_bacs === 0, label: usageLabel(s) })
      }
    }
    if (!s.present && !s.not_concerned) toRenseigner++
  }
  return {
    ...g,
    presentCategories,
    presentCount: g.items.filter(i => i.present && !i.not_concerned).length,
    totalCount: g.items.length,
    toRenseigner,
  }
}
const functionalZoneCards = computed(() =>
  systemsByZone.value.filter(g => g.zone_kind !== 'technical').map(zoneCard))
const technicalZoneCards = computed(() =>
  systemsByZone.value.filter(g => g.zone_kind === 'technical').map(zoneCard))

// ── Drill-down niveau 2 : liste des usages d'une zone sélectionnée ──
const selectedZoneGroup = computed(() => {
  if (!selectedZoneId.value) return null
  return systemsByZone.value.find(g => g.zone_id === selectedZoneId.value) || null
})
// Décompose en 3 buckets : présents, à renseigner, absents (repliés en bas).
const selectedZoneUsages = computed(() => {
  const g = selectedZoneGroup.value
  if (!g) return { present: [], pending: [], absent: [] }
  const present = [], pending = [], absent = []
  for (const s of g.items) {
    if (s.not_concerned) absent.push(s)
    else if (s.present) present.push(s)
    else pending.push(s)
  }
  return { present, pending, absent }
})
function usageKpi(s) {
  const devs = devicesOf(s.id)
  const power = devs.reduce((sum, d) =>
    sum + (Number(d.power_kw) || 0) * (Number(d.quantity) || 1), 0)
  return {
    deviceCount: devs.length,
    powerKw: Math.round(power * 10) / 10,
  }
}

// Priorité de rôle pour le tri par chaîne énergétique
// (Production → Distribution → Émission → Régulation seule → autre).
// Aligné sur la card 04 desktop (SystemDevicesTable.rolePriority).
const ROLE_PRIORITY_MOB = { production: 1, distribution: 2, emission: 3, regulation: 4 }
function rolePriorityMob(d) {
  const roles = Array.isArray(d.device_role) ? d.device_role : (d.device_role ? [d.device_role] : [])
  if (!roles.length) return 5
  let min = 5
  for (const r of roles) {
    const p = ROLE_PRIORITY_MOB[String(r).toLowerCase()]
    if (p && p < min) min = p
  }
  return min
}
function devicesOf(systemId) {
  const own = devices.value.filter(d => d.system_id === systemId)
  // Mig 143 : inclut les devices partagés vers cet usage.
  const shared = devices.value.filter(d =>
    d.system_id !== systemId && (d.extra_system_ids || []).includes(systemId),
  )
  return [...own, ...shared].sort((a, b) => {
    const pa = rolePriorityMob(a)
    const pb = rolePriorityMob(b)
    if (pa !== pb) return pa - pb
    return (a.name || '').toLowerCase().localeCompare((b.name || '').toLowerCase())
  })
}
function isSharedDevice(d, systemId) {
  return d.system_id !== systemId
}
function deviceOriginZoneName(d) {
  const sys = systems.value.find(s => s.id === d.system_id)
  return sys?.zone_name || 'autre zone'
}

async function patchSystem(s, patch) {
  Object.assign(s, patch)
  try {
    await updateBacsSystem(s.id, patch)
    await audit.refreshActionItems()
  } catch { error('Sauvegarde impossible') }
}

// Item 1 — poids estimé d'un poste (puissance système / puissance site).
function systemPowerKw(s) {
  return devicesOf(s.id).reduce(
    (sum, d) => sum + (Number(d.power_kw) || 0) * (Number(d.quantity) || 1), 0)
}
function systemWeightPct(s) {
  const total = systems.value.reduce((sum, sys) => sum + systemPowerKw(sys), 0)
  if (total <= 0) return null
  return Math.round(systemPowerKw(s) / total * 1000) / 10
}
async function toggleNegligible(s, checked) {
  if (checked) {
    const pct = systemWeightPct(s)
    if (pct != null && pct > 10) {
      const ok = await confirm({
        title: 'Poste potentiellement significatif',
        message: `Ce poste représente environ ${pct} % de la puissance du site (estimation). La règle des 5 % se base sur la consommation réelle — vérifiez avant de l'exempter.`,
        confirmLabel: 'Marquer quand même',
      })
      if (!ok) return
    }
  }
  await patchSystem(s, {
    marked_negligible_under_5pct: checked,
    ...(checked ? {} : { negligible_justification: null }),
  })
}

// Device sheet
const editingDevice = ref(null)
const deviceForm = ref({})
const savingDevice = ref(false)

// Sheet de déplacement / partage d'un device entre usages (mig 143).
const savingShare = ref(false)
async function toggleShareDeviceSystem(systemId, checked) {
  if (savingShare.value || !editingDevice.value?.device) return
  savingShare.value = true
  const dev = editingDevice.value.device
  const next = new Set(dev.extra_system_ids || [])
  if (checked) next.add(systemId); else next.delete(systemId)
  try {
    const { data } = await shareBacsDevice(dev.id, [...next])
    Object.assign(dev, data)
    success(checked ? 'Usage ajouté au partage' : 'Usage retiré du partage')
    await audit.refreshAuditCore()
  } catch (e) {
    error(e.response?.data?.detail || 'Partage impossible')
  } finally {
    savingShare.value = false
  }
}
async function moveDeviceToSystem(systemId) {
  if (savingShare.value || !editingDevice.value?.device || systemId === editingDevice.value.device.system_id) return
  savingShare.value = true
  const dev = editingDevice.value.device
  try {
    const { data } = await moveBacsDevice(dev.id, systemId)
    Object.assign(dev, data)
    if (editingDevice.value) editingDevice.value.system = systems.value.find(s => s.id === systemId) || editingDevice.value.system
    success('Système déplacé')
    await audit.refreshAuditCore()
  } catch (e) {
    error(e.response?.data?.detail || 'Déplacement impossible')
  } finally {
    savingShare.value = false
  }
}
// Systèmes candidats au partage : tous les usages sauf le primaire du device.
function shareCandidateSystems() {
  const dev = editingDevice.value?.device
  if (!dev) return []
  return (systems.value || []).filter(s => s.id !== dev.system_id)
}
// Mapping icônes/couleurs par catégorie d'usage (aligné SystemCategoryIcon).
const SYSTEM_CATEGORY_DECOR = {
  heating:                { icon: 'fa-fire',        color: '#dc2626' },
  cooling:                { icon: 'fa-snowflake',   color: '#0891b2' },
  ventilation:            { icon: 'fa-fan',         color: '#64748b' },
  dhw:                    { icon: 'fa-faucet',      color: '#0284c7' },
  lighting_indoor:        { icon: 'fa-lightbulb',   color: '#f59e0b' },
  lighting_outdoor:       { icon: 'fa-tower-cell',  color: '#f59e0b' },
  electricity_production: { icon: 'fa-solar-panel', color: '#16a34a' },
}
// Options « usage principal » pour le MobileSelectSheet de déplacement.
// Triées par zone puis usage, décorées avec icône/couleur de catégorie.
function decorateSystemOption(s) {
  const decor = SYSTEM_CATEGORY_DECOR[s.system_category] || { icon: 'fa-cube', color: '#6b7280' }
  const usage = usageLabel(s)
  const zone = s.zone_name || 'Zone non précisée'
  return {
    value: s.id,
    label: usage,                            // libellé court (popover groupé : la zone est déjà en sous-titre)
    chipLabel: `${zone} · ${usage}`,         // libellé complet pour le trigger / la pilule sélectionnée
    hint: zone,
    icon: decor.icon,
    color: decor.color,
    _zone: zone,
    _zoneOrder: (s.zone_position ?? 999),
  }
}
function sortByZoneThenUsage(a, b) {
  if (a._zoneOrder !== b._zoneOrder) return a._zoneOrder - b._zoneOrder
  if (a._zone !== b._zone) return a._zone.localeCompare(b._zone, 'fr')
  return a.label.localeCompare(b.label, 'fr')
}
const moveSystemOptions = computed(() =>
  (systems.value || []).map(decorateSystemOption).sort(sortByZoneThenUsage))
// Options « Aussi présent dans » : même décor + tri, mais on exclut le
// système primaire courant.
const shareSystemOptions = computed(() => {
  const dev = editingDevice.value?.device
  if (!dev) return []
  return (systems.value || [])
    .filter(s => s.id !== dev.system_id)
    .map(decorateSystemOption)
    .sort(sortByZoneThenUsage)
})
// Liste des ids actuellement partagés (pour binding multi-select).
const extraSystemIds = computed(() =>
  Array.isArray(editingDevice.value?.device?.extra_system_ids)
    ? editingDevice.value.device.extra_system_ids
    : [])
// Toggle bulk : remplace l'ensemble extra_system_ids par la sélection
// multi-select courante (fire-and-forget vers shareBacsDevice).
async function updateExtraSystemIds(nextIds) {
  if (savingShare.value || !editingDevice.value?.device) return
  savingShare.value = true
  const dev = editingDevice.value.device
  try {
    const { data } = await shareBacsDevice(dev.id, nextIds || [])
    Object.assign(dev, data)
    success('Partage mis à jour')
    await audit.refreshAuditCore()
  } catch (e) {
    error(e.response?.data?.detail || 'Partage impossible')
  } finally {
    savingShare.value = false
  }
}

// ─── Ajout / suppression d'un usage manuel (non BACS) ────────────────
// Bibliothèque de catégories pour le choix d'usage.
const categoryLibrary = ref([])
onMounted(async () => {
  try {
    const { data } = await listSystemCategories()
    categoryLibrary.value = data || []
  } catch { /* silencieux */ }
})
const categoryOptions = computed(() => categoryLibrary.value.map(c => ({
  value: c.key, label: c.label, icon: c.icon_value, color: c.icon_color,
})))

const addingUsageZone = ref(null)
const newUsageValue = ref(null)
function startAddUsage(zoneId) { addingUsageZone.value = zoneId; newUsageValue.value = null }
function cancelAddUsage() { addingUsageZone.value = null; newUsageValue.value = null }
async function confirmAddUsage(zoneId) {
  const v = (newUsageValue.value || '').toString().trim()
  if (!v) return
  const cat = categoryLibrary.value.find(c => c.key === v)
  const payload = cat
    ? { zone_id: zoneId, label: cat.label, library_category_key: cat.key }
    : { zone_id: zoneId, label: v }
  try {
    await createBacsSystem(audit.docId, payload)
    cancelAddUsage()
    await audit.refreshAuditCore()
  } catch (e) {
    error(e.response?.data?.detail || 'Ajout de l\'usage impossible')
  }
}
async function removeUsage(s) {
  const ok = await confirm({
    title: 'Supprimer cet usage ?',
    message: `« ${usageLabel(s)} » et ses systèmes seront supprimés.`,
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

// Bibliothèque de modèles (préfiltrée par catégorie)
const libraryDevicePickerSystem = ref(null)
function openLibraryDevicePicker(system) {
  libraryDevicePickerSystem.value = {
    id: system.id,
    system_category: system.system_category,
    is_bacs: system.is_bacs,
    library_category_key: system.library_category_key,
    zone_name: zones.value.find(z => z.zone_id === system.zone_id)?.name || '',
  }
}

function openCreateDevice(system) {
  deviceForm.value = {
    name: '', brand: '', model_reference: '', power_kw: null,
    // Item 8 — puissance frigorifique + type de calcul + secours.
    power_kw_cooling: null, power_calculation_type: null, is_backup: null,
    // Identification — quantité + âge (parité desktop DeviceEditModal).
    quantity: 1, age_years: null,
    // Multi-rôle (mig 117) : array.
    energy_source: null, device_role: [], location: '',
    // Communication : protocoles multi (string JSON) + câblé + ternaire
    // `is_communicating` (mig 185).
    is_communicating: null, communication_protocols: null, wired: null,
    // Régulation (mig 183 + 184 + 187) : ternaire + sous-champs par niveau.
    has_regulation: null, regulation_integrated: null,
    regulator_brand: null, regulator_model_reference: null,
    regulation_type_production: null, regulator_location_production: null,
    regulation_type_distribution: null, regulator_location_distribution: null,
    regulation_type_emission: null, regulation_granularity: null,
    regulator_location_emission: null,
    // État R175-3 4° + Hors service. null = non répondu (cf. mig 172).
    meets_r175_3_p4: null, meets_r175_3_p4_autonomous: null, out_of_service: null,
    // Item 7c — séparabilité du comptage (équipement partagé).
    metering_separable: null, metering_separable_note: '',
    // Mig 172 — validation forcée manuelle.
    validation_forced: null,
    // Mig 175 — équipement multi-bâtiments (déplacé du système).
    serves_multiple_buildings: null,
  }
  editingDevice.value = { mode: 'create', system }
}
function openEditDevice(d, currentSystem) {
  // Si le device est partagé (system_id !== currentSystem.id), on utilise
  // son système d'origine pour le sheet d'édition : c'est sa zone d'origine
  // qui doit s'afficher comme « Origine » dans le sélecteur de partage.
  const originSystem = systems.value.find(s => s.id === d.system_id) || currentSystem
  // Multi-rôle : normalise device_role en array (mig 117).
  const role = Array.isArray(d.device_role) ? d.device_role : (d.device_role ? [d.device_role] : [])
  deviceForm.value = { ...d, device_role: role }
  editingDevice.value = { mode: 'edit', system: originSystem, device: d }
}
function closeDevice() { editingDevice.value = null }

async function saveDevice() {
  savingDevice.value = true
  try {
    const payload = {
      name: deviceForm.value.name?.trim() || null,
      brand: deviceForm.value.brand?.trim() || null,
      model_reference: deviceForm.value.model_reference?.trim() || null,
      power_kw: deviceForm.value.power_kw === '' || deviceForm.value.power_kw === null ? null : Number(deviceForm.value.power_kw),
      // Item 8 — puissance frigorifique + type de calcul + équipement de secours.
      power_kw_cooling: deviceForm.value.power_kw_cooling === '' || deviceForm.value.power_kw_cooling === null ? null : Number(deviceForm.value.power_kw_cooling),
      power_calculation_type: deviceForm.value.power_calculation_type || null,
      is_backup: triBool(deviceForm.value.is_backup),
      validation_forced: triBool(deviceForm.value.validation_forced),
      energy_source: deviceForm.value.energy_source,
      device_role: Array.isArray(deviceForm.value.device_role) ? deviceForm.value.device_role : [],
      location: deviceForm.value.location?.trim() || null,
      // Identification — quantité + âge (parité desktop).
      quantity: deviceForm.value.quantity === '' || deviceForm.value.quantity == null ? 1 : Math.max(1, parseInt(deviceForm.value.quantity, 10) || 1),
      age_years: deviceForm.value.age_years === '' || deviceForm.value.age_years == null ? null : Math.max(0, parseInt(deviceForm.value.age_years, 10) || 0),
      // Communication (regroupe Protocoles + Câblé pour cohérence desktop).
      is_communicating: triBool(deviceForm.value.is_communicating),
      communication_protocols: deviceForm.value.communication_protocols ?? null,
      // Le legacy `communication_protocol` (single) est nullé : la source
      // de vérité côté écriture est désormais `communication_protocols`
      // (cohérent avec patchDevice de SystemDevicesTable).
      communication_protocol: null,
      wired: triBool(deviceForm.value.wired),
      // Régulation — mêmes champs que DeviceEditModal desktop.
      has_regulation: triBool(deviceForm.value.has_regulation),
      regulation_integrated: triBool(deviceForm.value.regulation_integrated),
      regulator_brand: deviceForm.value.regulator_brand?.trim() || null,
      regulator_model_reference: deviceForm.value.regulator_model_reference?.trim() || null,
      regulation_type_production: deviceForm.value.regulation_type_production || null,
      regulator_location_production: deviceForm.value.regulator_location_production || null,
      regulation_type_distribution: deviceForm.value.regulation_type_distribution || null,
      regulator_location_distribution: deviceForm.value.regulator_location_distribution || null,
      regulation_type_emission: deviceForm.value.regulation_type_emission || null,
      regulation_granularity: deviceForm.value.regulation_granularity || null,
      regulator_location_emission: deviceForm.value.regulator_location_emission || null,
      // État R175-3 4° + Hors service. null = non répondu.
      meets_r175_3_p4: triBool(deviceForm.value.meets_r175_3_p4),
      meets_r175_3_p4_autonomous: triBool(deviceForm.value.meets_r175_3_p4_autonomous),
      out_of_service: triBool(deviceForm.value.out_of_service),
      // Item 7c — séparabilité du comptage (équipement partagé).
      metering_separable: deviceForm.value.metering_separable || null,
      metering_separable_note: deviceForm.value.metering_separable_note?.trim() || null,
      // Mig 175 — équipement dessert plusieurs bâtiments (cas F).
      serves_multiple_buildings: triBool(deviceForm.value.serves_multiple_buildings),
    }
    if (!payload.name && !payload.brand && !payload.model_reference) {
      error('Renseigne au moins un nom, une marque ou une référence')
      return
    }
    if (editingDevice.value.mode === 'create') {
      // Le POST /devices ne persiste que les champs de base ; on complète
      // aussitôt par un PATCH pour enregistrer toggles, puissances et flags
      // (conformité R175-3, secours, validation forcée…) saisis dans la
      // même feuille — sinon ces réponses seraient perdues.
      const { data: created } = await createBacsDevice(editingDevice.value.system.id, payload)
      if (created?.id) await updateBacsDevice(created.id, payload)
      await audit.refreshAuditCore()
      success('Équipement ajouté')
    } else {
      const { data } = await updateBacsDevice(editingDevice.value.device.id, payload)
      Object.assign(editingDevice.value.device, data)
      await audit.refreshAuditCore()
      success('Équipement mis à jour')
    }
    closeDevice()
  } catch (e) {
    error(e.response?.data?.detail || 'Sauvegarde impossible')
  } finally {
    savingDevice.value = false
  }
}

async function removeDevice(d) {
  const ok = await confirm({
    title: 'Supprimer cet équipement ?',
    message: `« ${d.name || d.brand || d.model_reference || `Équipement #${d.id}`} »`,
    confirmLabel: 'Supprimer', danger: true,
  })
  if (!ok) return
  try {
    await deleteBacsDevice(d.id)
    await audit.refreshAuditCore()
    if (editingDevice.value?.device?.id === d.id) closeDevice()
  } catch {
    error('Suppression impossible')
  }
}

// Helper tri-état : 0/1/null → false/true/null. Les boutons Oui/Non
// (MobileYesNo) émettent des booléens ; le payload doit rester booléen|null.
const triBool = (v) => (v == null ? null : !!v)

// ── Complétude de l'équipement en cours d'édition (logique partagée) ─
const deviceMissing = computed(() =>
  editingDevice.value
    ? deviceMissingFields(deviceForm.value, editingDevice.value.system?.system_category)
    : [])
const deviceComplete = computed(() =>
  editingDevice.value
    ? isDeviceComplete(deviceForm.value, editingDevice.value.system?.system_category)
    : false)
const deviceForced = computed(() => !!deviceForm.value?.validation_forced)

// ── Niveaux (device_role) — pilote l'affichage des champs régulation ─
const deviceRole = computed(() =>
  Array.isArray(deviceForm.value.device_role)
    ? deviceForm.value.device_role
    : (deviceForm.value.device_role ? [deviceForm.value.device_role] : []))
const hasProductionRole   = computed(() => deviceRole.value.includes('production'))
const hasDistributionRole = computed(() => deviceRole.value.includes('distribution'))
const hasEmissionRole     = computed(() => deviceRole.value.includes('emission'))

// ── Régulation : template d'équipement (mig 184 — surcharges types). ──
const deviceTemplate = ref(null)
watch(() => deviceForm.value.equipment_template_id, async (id) => {
  if (!id) { deviceTemplate.value = null; return }
  try { const { data } = await getEquipmentTemplate(id); deviceTemplate.value = data }
  catch { deviceTemplate.value = null }
}, { immediate: true })
const deviceCategoryForRegulation = computed(() => editingDevice.value?.system?.system_category || null)
const regulationProductionOptions = computed(() =>
  regulationTypesForCategory('production',   deviceCategoryForRegulation.value, deviceTemplate.value?.regulation_production_types))
const regulationDistributionOptions = computed(() =>
  regulationTypesForCategory('distribution', deviceCategoryForRegulation.value, deviceTemplate.value?.regulation_distribution_types))
const regulationEmissionOptions = computed(() =>
  regulationTypesForCategory('emission',     deviceCategoryForRegulation.value, deviceTemplate.value?.regulation_emission_types))
// Détails régulateur cachés UNIQUEMENT si régulation explicitement « Intégrée ».
const showRegulatorDetails = computed(() =>
  !(deviceForm.value.regulation_integrated === 1 || deviceForm.value.regulation_integrated === true))
// Toggle has_regulation : ajoute/retire automatiquement 'regulation' dans device_role.
function setHasRegulation(v) {
  const roles = new Set(deviceRole.value)
  deviceForm.value.has_regulation = v
  if (v === true) {
    roles.add('regulation')
    deviceForm.value.device_role = [...roles]
  } else if (v === false) {
    roles.delete('regulation')
    deviceForm.value.device_role = [...roles]
    deviceForm.value.regulator_brand = null
    deviceForm.value.regulator_model_reference = null
    deviceForm.value.regulation_integrated = null
    deviceForm.value.regulation_type_production = null
    deviceForm.value.regulator_location_production = null
    deviceForm.value.regulation_type_distribution = null
    deviceForm.value.regulator_location_distribution = null
    deviceForm.value.regulation_type_emission = null
    deviceForm.value.regulation_granularity = null
    deviceForm.value.regulator_location_emission = null
  }
}
// ── Toggle is_communicating : Oui → garde protocoles ; Non → efface. ──
function setIsCommunicating(v) {
  deviceForm.value.is_communicating = v
  if (v === false) {
    deviceForm.value.communication_protocols = null
  }
}
// ── Protocoles : MobileSelectSheet multi prend un Array, la DB stocke
//    un JSON.stringify. On wrappe avec parse/stringify, et on filtre les
//    options « non_communicant » / « absent » qui sont portées par le
//    toggle is_communicating ci-dessus (parité desktop).
const protocolOptionsPwa = computed(() =>
  COMM_OPTIONS.filter(o => o.value !== 'non_communicant' && o.value !== 'absent')
)
const protocolsArray = computed(() => {
  const raw = deviceForm.value.communication_protocols
  if (!raw) return []
  try {
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr : []
  } catch {
    return raw ? [raw] : []
  }
})
function updateProtocols(arr) {
  if (!Array.isArray(arr) || !arr.length) {
    deviceForm.value.communication_protocols = null
  } else {
    deviceForm.value.communication_protocols = JSON.stringify(arr)
  }
}
// Options de zones (label + value identiques, creatable côté UI).
const zoneOptionsForReg = computed(() => {
  const all = audit.zones || []
  const isTech = z => /techn|local.*technique|lt/i.test(`${z.kind || ''} ${z.name || ''}`)
  const tech = all.filter(isTech)
  const rest = all.filter(z => !isTech(z))
  return [...tech, ...rest].filter(z => z.name).map(z => ({ value: z.name, label: z.name }))
})
// Granularité R175-6 — import shared.

// Titre du sheet d'édition équipement : nom de l'équipement courant
// (ou marque+ref, ou label de l'usage en fallback). Permet à l'auditeur
// de toujours savoir ce qu'il édite dans le header sticky.
const deviceSheetTitle = computed(() => {
  if (!editingDevice.value) return ''
  if (editingDevice.value.mode === 'create') return 'Nouvel équipement'
  const d = deviceForm.value || editingDevice.value.device || {}
  const parts = []
  if (d.name) parts.push(d.name)
  else if (d.brand || d.model_reference) parts.push([d.brand, d.model_reference].filter(Boolean).join(' '))
  if (parts.length) return parts.join(' ')
  return editingDevice.value.system ? usageLabel(editingDevice.value.system) : 'Équipement'
})

// ── Puissance conditionnelle (chaud / froid selon l'usage desservi) ─
const POWER_RELEVANT = new Set(['heating', 'cooling', 'ventilation', 'dhw'])
const servedCategories = computed(() => {
  const cats = new Set()
  const sys = editingDevice.value?.system
  if (sys?.system_category) cats.add(sys.system_category)
  const extra = editingDevice.value?.device?.extra_system_ids || []
  for (const s of (systems.value || [])) {
    if (extra.includes(s.id) && s.system_category) cats.add(s.system_category)
  }
  return cats
})
const showPowerFields = computed(() => POWER_RELEVANT.has(editingDevice.value?.system?.system_category))
const hasHeating = computed(() => servedCategories.value.has('heating'))
const hasCooling = computed(() => servedCategories.value.has('cooling'))
const showHeatPower = computed(() => showPowerFields.value && (hasHeating.value || !hasCooling.value))
const showCoolPower = computed(() => showPowerFields.value && hasCooling.value)
const heatPowerLabel = computed(() => (hasHeating.value ? 'Puissance chaud (kW)' : 'Puissance (kW)'))
// `power_kw` est la colonne lue par le cumul R175-2 et le PDF ; `power_kw_cooling`
// n'est qu'un complément réservé aux équipements réversibles. Froid seul →
// power_kw ; réversible (chaud ET froid) → froid dans power_kw_cooling.
const coolPowerField = computed(() => (showHeatPower.value ? 'power_kw_cooling' : 'power_kw'))
</script>

<template>
  <div class="p-3 space-y-3">
    <!-- ───────────────── N1 — Liste des zones ───────────────── -->
    <template v-if="currentView === 'zones'">
      <!-- Stat puissance globale -->
      <div class="bg-white rounded-2xl border border-gray-200 p-4 flex items-center gap-4">
        <div class="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-600 inline-flex items-center justify-center">
          <FontAwesomeIcon :icon="['fas', 'screwdriver-wrench']" class="w-6 h-6" />
        </div>
        <div class="flex-1 min-w-0">
          <p class="text-2xl font-medium text-gray-900 leading-none">
            {{ powerSummary.heating_cooling_total_kw || 0 }} <span class="text-sm text-gray-500">kW</span>
          </p>
          <p class="text-xs text-gray-500 mt-1">Chauffage + climatisation cumulé</p>
        </div>
      </div>

      <!-- Zones fonctionnelles -->
      <div v-if="functionalZoneCards.length">
        <div class="px-1 pb-1.5">
          <p class="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            Zones fonctionnelles ({{ functionalZoneCards.length }})
          </p>
        </div>
        <div class="bg-white rounded-2xl border border-gray-200 overflow-hidden divide-y divide-gray-100">
          <button
            v-for="g in functionalZoneCards"
            :key="g.zone_id"
            type="button"
            @click="goToZone(g.zone_id)"
            class="w-full flex items-center gap-3 px-4 py-4 text-left active:bg-gray-50"
          >
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2">
                <p class="text-base font-medium text-gray-900 truncate leading-tight">{{ g.zone_name }}</p>
                <span v-if="g.toRenseigner > 0"
                      class="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded-full bg-red-100 text-red-700"
                      :title="`${g.toRenseigner} usage(s) à renseigner`">
                  <span class="w-1.5 h-1.5 rounded-full bg-red-500"></span>
                  {{ g.toRenseigner }} à renseigner
                </span>
              </div>
              <div class="mt-2 flex items-center gap-2 flex-wrap">
                <span v-for="cat in g.presentCategories" :key="cat.key"
                      class="inline-flex items-center justify-center w-7 h-7 rounded-full bg-gray-50"
                      :title="cat.label">
                  <SystemCategoryIcon v-if="cat.category" :category="cat.category" size="sm" :with-tooltip="false" />
                  <FontAwesomeIcon v-else :icon="['fas', 'circle-question']" class="w-4 h-4 text-gray-400" />
                </span>
                <span v-if="!g.presentCategories.length" class="text-xs text-gray-400 italic">
                  Aucun usage renseigné
                </span>
              </div>
            </div>
            <div class="flex flex-col items-end shrink-0">
              <span class="text-sm font-medium text-gray-600">{{ g.presentCount }}/{{ g.totalCount }}</span>
              <FontAwesomeIcon :icon="['fas', 'chevron-right']" class="w-5 h-5 text-gray-300 mt-1" />
            </div>
          </button>
        </div>
      </div>

      <!-- Zones techniques -->
      <div v-if="technicalZoneCards.length">
        <div class="px-1 pb-1.5">
          <p class="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            Zones techniques ({{ technicalZoneCards.length }})
          </p>
        </div>
        <div class="bg-white rounded-2xl border border-gray-200 overflow-hidden divide-y divide-gray-100">
          <button
            v-for="g in technicalZoneCards"
            :key="g.zone_id"
            type="button"
            @click="goToZone(g.zone_id)"
            class="w-full flex items-center gap-3 px-4 py-4 text-left active:bg-gray-50"
          >
            <div class="flex-1 min-w-0">
              <p class="text-base font-medium text-gray-900 truncate leading-tight">{{ g.zone_name }}</p>
              <div class="mt-2 flex items-center gap-2 flex-wrap">
                <span v-for="cat in g.presentCategories" :key="cat.key"
                      class="inline-flex items-center justify-center w-7 h-7 rounded-full bg-gray-50"
                      :title="cat.label">
                  <SystemCategoryIcon v-if="cat.category" :category="cat.category" size="sm" :with-tooltip="false" />
                  <FontAwesomeIcon v-else :icon="['fas', 'circle-question']" class="w-4 h-4 text-gray-400" />
                </span>
                <span v-if="!g.presentCategories.length" class="text-xs text-gray-400 italic">
                  Hors décret BACS
                </span>
              </div>
            </div>
            <div class="flex flex-col items-end shrink-0">
              <span v-if="g.totalCount" class="text-sm font-medium text-gray-600">{{ g.presentCount }}/{{ g.totalCount }}</span>
              <FontAwesomeIcon :icon="['fas', 'chevron-right']" class="w-5 h-5 text-gray-300 mt-1" />
            </div>
          </button>
        </div>
      </div>

      <!-- Empty global -->
      <div v-if="!functionalZoneCards.length && !technicalZoneCards.length"
           class="bg-white rounded-2xl border border-dashed border-gray-300 p-8 text-center">
        <FontAwesomeIcon :icon="['fas', 'screwdriver-wrench']" class="w-10 h-10 text-gray-300 mx-auto" />
        <p class="text-sm text-gray-500 mt-3">Pas encore de systèmes</p>
        <p class="text-xs text-gray-500 mt-1">Crée d'abord des zones, les systèmes apparaîtront ici</p>
      </div>
    </template>

    <!-- ───────────────── N2 — Liste des usages d'une zone ───────────────── -->
    <template v-else-if="currentView === 'usages' && selectedZoneGroup">
      <!-- Header sticky : retour + nom de zone + compteur -->
      <div class="sticky top-0 -mx-3 -mt-3 px-3 pt-3 pb-2 bg-white z-10 border-b border-gray-100">
        <div class="flex items-center gap-2">
          <button type="button" @click="goBackToZones"
                  class="shrink-0 w-10 h-10 inline-flex items-center justify-center rounded-xl text-gray-700 active:bg-gray-100"
                  aria-label="Retour aux zones">
            <FontAwesomeIcon :icon="['fas', 'chevron-left']" class="w-5 h-5" />
          </button>
          <div class="flex-1 min-w-0">
            <p class="text-xs font-semibold text-gray-400 uppercase tracking-wider">Zones › {{ selectedZoneGroup.zone_kind === 'technical' ? 'Technique' : 'Fonctionnelle' }}</p>
            <p class="text-base font-semibold text-gray-900 truncate leading-tight">{{ selectedZoneGroup.zone_name }}</p>
          </div>
          <span class="shrink-0 text-xs text-gray-500">
            {{ selectedZoneUsages.present.length }}/{{ selectedZoneGroup.items.length }}
          </span>
        </div>
      </div>

      <!-- Usages présents : toute la card est cliquable (drill-in détail). -->
      <div v-if="selectedZoneUsages.present.length" class="bg-white rounded-2xl border border-gray-200 overflow-hidden divide-y divide-gray-100">
        <div v-for="s in selectedZoneUsages.present" :key="s.id"
             :data-system-id="s.id"
             :class="['transition',
                      focusedSystemId === s.id ? 'bg-amber-50 ring-2 ring-amber-300' : '']">
          <!-- Zone cliquable principale : icône + label + KPI + régulation -->
          <button type="button" @click="openUsage(s)"
                  class="w-full flex items-center gap-3 px-4 pt-4 pb-3 text-left active:bg-gray-50">
            <SystemCategoryIcon :category="s.system_category" size="md" />
            <div class="flex-1 min-w-0">
              <p class="text-base font-medium text-gray-900 truncate leading-tight">{{ usageLabel(s) }}</p>
              <p class="text-xs text-gray-500 mt-0.5">
                <span>{{ usageKpi(s).deviceCount }} équipement{{ usageKpi(s).deviceCount > 1 ? 's' : '' }}</span>
                <span v-if="usageKpi(s).powerKw > 0"> · {{ usageKpi(s).powerKw }} kW</span>
              </p>
              <p v-if="isBacs && (s.system_category === 'heating' || s.system_category === 'cooling') && thermalFor(s.zone_id, s.system_category)"
                 :class="['text-xs truncate mt-0.5',
                          thermalStatus(s.zone_id, s.system_category).tone === 'warn' ? 'text-red-600 font-medium' :
                          thermalStatus(s.zone_id, s.system_category).tone === 'ok' ? 'text-emerald-700' : 'text-gray-500']">
                Régulation thermique · {{ thermalStatus(s.zone_id, s.system_category).label }}
              </p>
            </div>
            <span v-if="s.is_bacs === 0" role="button" tabindex="0"
                  @click.stop="removeUsage(s)" @keydown.enter.stop="removeUsage(s)"
                  class="shrink-0 w-10 h-10 inline-flex items-center justify-center rounded-xl text-gray-500 active:bg-red-50 active:text-red-600 cursor-pointer"
                  aria-label="Supprimer cet usage">
              <FontAwesomeIcon :icon="['fas', 'trash']" class="w-5 h-5" />
            </span>
            <FontAwesomeIcon :icon="['fas', 'chevron-right']" class="w-5 h-5 text-gray-300 shrink-0" />
          </button>
          <!-- Actions secondaires : changer le statut sans entrer dans le détail -->
          <div class="px-4 pb-3 grid grid-cols-2 gap-2">
            <button type="button"
                    @click.stop="patchSystem(s, { present: true, not_concerned: false })"
                    class="pwa-button border-2 border-emerald-500 bg-emerald-50 text-emerald-700">
              ✓ Présent
            </button>
            <button type="button"
                    @click.stop="patchSystem(s, { present: false, not_concerned: true })"
                    class="pwa-button pwa-button--idle border-2">
              ✕ Marquer absent
            </button>
          </div>
        </div>
      </div>

      <!-- Usages à renseigner -->
      <div v-if="selectedZoneUsages.pending.length" class="bg-white rounded-2xl border border-gray-200 overflow-hidden divide-y divide-gray-100">
        <div class="px-4 py-2.5 bg-amber-50 border-b border-amber-200">
          <p class="text-xs font-semibold text-amber-800 uppercase tracking-wider">
            À renseigner ({{ selectedZoneUsages.pending.length }})
          </p>
        </div>
        <div v-for="s in selectedZoneUsages.pending" :key="s.id"
             :data-system-id="s.id"
             :class="['px-4 py-4 transition',
                      focusedSystemId === s.id ? 'bg-amber-50 ring-2 ring-amber-300' : '']">
          <div class="flex items-center gap-3">
            <SystemCategoryIcon :category="s.system_category" size="md" />
            <div class="flex-1 min-w-0">
              <p class="text-base font-medium text-gray-900 truncate leading-tight">{{ usageLabel(s) }}</p>
              <p class="text-xs text-gray-500 mt-0.5">Présent ou absent dans cette zone ?</p>
            </div>
            <button v-if="s.is_bacs === 0" type="button" @click.stop="removeUsage(s)"
                    class="shrink-0 w-10 h-10 inline-flex items-center justify-center rounded-xl text-gray-500 active:bg-red-50 active:text-red-600"
                    aria-label="Supprimer cet usage">
              <FontAwesomeIcon :icon="['fas', 'trash']" class="w-5 h-5" />
            </button>
          </div>
          <div class="mt-3 grid grid-cols-2 gap-2">
            <button type="button"
                    @click="patchSystem(s, { present: true, not_concerned: false })"
                    class="pwa-button pwa-button--idle border-2">
              ✓ Présent
            </button>
            <button type="button"
                    @click="patchSystem(s, { present: false, not_concerned: true })"
                    class="pwa-button pwa-button--idle border-2">
              ✕ Absent
            </button>
          </div>
        </div>
      </div>

      <!-- Ajout manuel d'un usage -->
      <div>
        <div v-if="addingUsageZone === selectedZoneGroup.zone_id" class="bg-white rounded-2xl border border-gray-200 p-4 space-y-2">
          <p class="text-xs text-gray-500">Choisir une catégorie ou saisir un nom libre</p>
          <MobileSelectSheet
            v-model="newUsageValue"
            :options="categoryOptions"
            :creatable="true"
            title="Catégorie d'usage"
            placeholder="— Catégorie ou nom —"
          />
          <div class="flex gap-2">
            <button type="button" @click="confirmAddUsage(selectedZoneGroup.zone_id)" :disabled="!newUsageValue"
                    class="flex-1 min-h-11 py-3 text-base font-medium text-white bg-emerald-600 disabled:opacity-50 rounded-xl">
              Ajouter
            </button>
            <button type="button" @click="cancelAddUsage"
                    class="px-4 min-h-11 py-3 text-base text-gray-600 bg-gray-100 rounded-xl">
              Annuler
            </button>
          </div>
        </div>
        <button v-else type="button" @click="startAddUsage(selectedZoneGroup.zone_id)"
                class="w-full min-h-11 inline-flex items-center justify-center gap-2 px-3 py-3 text-base font-medium text-indigo-700 border-2 border-dashed border-indigo-300 active:border-indigo-400 active:bg-indigo-50 rounded-2xl transition">
          <FontAwesomeIcon :icon="['fas', 'plus']" class="w-5 h-5 shrink-0" /> Ajouter un usage personnalisé
        </button>
      </div>

      <!-- Section repliée : usages absents -->
      <div v-if="selectedZoneUsages.absent.length" class="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <button type="button"
                @click="absentUsagesCollapsed = !absentUsagesCollapsed"
                class="w-full flex items-center gap-2 px-4 py-3 active:bg-gray-50">
          <FontAwesomeIcon :icon="['fas', 'chevron-down']"
                           :class="['w-4 h-4 text-gray-500 transition-transform shrink-0',
                                    absentUsagesCollapsed ? '-rotate-90' : '']" />
          <p class="flex-1 text-left text-sm font-medium text-gray-700">
            Usages absents ({{ selectedZoneUsages.absent.length }})
          </p>
        </button>
        <div v-show="!absentUsagesCollapsed" class="divide-y divide-gray-100 border-t border-gray-100">
          <div v-for="s in selectedZoneUsages.absent" :key="s.id"
               :data-system-id="s.id"
               class="px-4 py-3 opacity-60">
            <div class="flex items-center gap-3">
              <SystemCategoryIcon :category="s.system_category" size="sm" />
              <div class="flex-1 min-w-0">
                <p class="text-sm font-medium text-gray-700 truncate leading-tight">{{ usageLabel(s) }}</p>
                <p class="text-xs text-gray-500 mt-0.5 italic">
                  {{ SYSTEM_NEGATIVE_LABEL[s.system_category] || (s.is_bacs === 0 ? 'Usage non concerné' : 'Non concerné') }}
                </p>
              </div>
              <button type="button"
                      @click="patchSystem(s, { present: true, not_concerned: false })"
                      class="shrink-0 min-h-11 px-3 py-2 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl">
                Réactiver
              </button>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- Page dédiée d'un usage : équipements + régulation thermique. -->
    <MobileSheet
      :open="!!openedUsage"
      :title="openedUsage ? usageLabel(openedUsage) : ''"
      hide-save
      @close="closeUsage"
    >
      <div v-if="openedUsage" class="p-4 space-y-4">
        <div class="flex items-center gap-2 text-gray-500">
          <FontAwesomeIcon :icon="['fas', 'map-pin']" class="w-3.5 h-3.5 shrink-0" />
          <p class="text-sm font-medium">{{ openedUsage.zone_name }}</p>
        </div>

        <!-- Item 3 — bouclage ECS (catégorie dhw) -->
        <section v-if="openedUsage.system_category === 'dhw'"
                 class="bg-white rounded-2xl border border-gray-200 p-4 space-y-2">
          <p class="text-xs font-semibold text-gray-600 uppercase tracking-wider">Bouclage ECS</p>
          <div class="grid grid-cols-3 gap-2">
            <button v-for="opt in LOOP_OPTIONS" :key="opt.value" type="button"
                    @click="patchSystem(openedUsage, { is_looped: opt.value })"
                    :class="['tap-target rounded-xl border px-2 py-3 text-sm font-medium transition',
                             openedUsage.is_looped === opt.value
                               ? 'bg-indigo-600 border-indigo-600 text-white'
                               : 'bg-white border-gray-200 text-gray-600 active:bg-gray-50']">
              {{ opt.label }}
            </button>
          </div>
          <p v-if="openedUsage.is_looped === 'looped'" class="text-xs text-amber-700 leading-relaxed">
            Boucle ECS : l'arrêt est interdit (arrêté du 30 nov. 2005 — risque légionelle).
          </p>
        </section>

        <!-- Item 1 — règle des 5 % : poste considéré comme négligeable -->
        <section class="bg-white rounded-2xl border border-gray-200 p-4 space-y-3">
          <button type="button"
                  @click="toggleNegligible(openedUsage, !openedUsage.marked_negligible_under_5pct)"
                  class="w-full text-left tap-target flex items-start justify-between gap-3">
            <div class="flex-1 min-w-0">
              <p class="text-base text-gray-900 font-medium">Poste négligeable (&lt; 5 %)</p>
              <p class="text-sm text-gray-500 mt-0.5 leading-relaxed">
                Exempté de mise en conformité R175-3
                <span v-if="systemWeightPct(openedUsage) != null"
                      :class="systemWeightPct(openedUsage) > 10 ? 'text-amber-600 font-semibold' : ''">
                  · poids estimé ~{{ systemWeightPct(openedUsage) }} %
                </span>
              </p>
            </div>
            <span :class="['mt-1 shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-md border-2 transition',
                           openedUsage.marked_negligible_under_5pct
                             ? 'bg-emerald-500 border-emerald-500 text-white'
                             : 'bg-white border-gray-300']" aria-hidden="true">
              <svg v-if="openedUsage.marked_negligible_under_5pct" viewBox="0 0 16 16" class="w-5 h-5">
                <path d="M3 8l3.5 3.5L13 4" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </span>
          </button>
          <input v-if="openedUsage.marked_negligible_under_5pct"
                 type="text"
                 :value="openedUsage.negligible_justification || ''"
                 @change="e => patchSystem(openedUsage, { negligible_justification: e.target.value })"
                 placeholder="Justification (ex : petits ballons individuels…)"
                 class="pwa-input" />
        </section>

        <!-- Item 4 — assujettissement : parties prenantes + flags cas E/F -->
        <section class="bg-white rounded-2xl border border-gray-200 p-4">
          <p class="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2">Assujettissement</p>
          <SystemPartiesPanel :system="openedUsage" />
        </section>

        <!-- Carte Équipements : en-tête / liste séparée / pied d'actions -->
        <section class="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <div class="px-4 py-2.5 bg-gray-50 border-b border-gray-200">
            <p class="text-xs font-semibold text-gray-600 uppercase tracking-wider">
              Équipements<span v-if="devicesOf(openedUsage.id).length" class="text-gray-400 font-normal"> · {{ devicesOf(openedUsage.id).length }}</span>
            </p>
          </div>
          <div class="divide-y divide-gray-100">
            <button
              v-for="d in devicesOf(openedUsage.id)"
              :key="d.id"
              @click="openEditDevice(d, openedUsage)"
              :class="[
                'w-full flex items-center gap-2 px-4 py-3.5 active:bg-gray-50 text-left',
                isSharedDevice(d, openedUsage.id) ? 'bg-emerald-50/60' : '',
              ]"
            >
              <div class="flex-1 min-w-0">
                <p
                  v-if="isSharedDevice(d, openedUsage.id)"
                  class="text-xs font-semibold uppercase tracking-wider text-emerald-700 mb-0.5"
                >
                  Partagé depuis « {{ deviceOriginZoneName(d) }} »
                </p>
                <p class="text-base font-semibold text-gray-900 truncate leading-tight">
                  {{ d.name || d.brand || d.model_reference || `Équipement #${d.id}` }}
                  <span v-if="d.is_backup === 1 || d.is_backup === true"
                        class="inline-flex items-center justify-center align-middle ml-1 px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wider rounded bg-amber-100 text-amber-700 border border-amber-300">
                    Secours
                  </span>
                </p>
                <p class="text-sm text-gray-500 truncate mt-0.5">
                  <span v-if="d.brand">{{ d.brand }}</span>
                  <span v-if="d.power_kw"> · {{ d.power_kw }} kW</span>
                </p>
              </div>
              <FontAwesomeIcon :icon="['fas', 'chevron-right']" class="w-5 h-5 text-gray-300 shrink-0" />
            </button>
            <p v-if="!devicesOf(openedUsage.id).length" class="px-4 py-5 text-sm text-gray-500 text-center">
              Aucun équipement — ajoute-en ci-dessous.
            </p>
          </div>
          <div class="p-3 border-t border-gray-200 bg-gray-50 space-y-2">
            <button
              @click="openCreateDevice(openedUsage)"
              class="pwa-button pwa-button--add whitespace-nowrap"
            >
              <FontAwesomeIcon :icon="['fas', 'plus']" class="w-5 h-5 shrink-0" /> Ajouter un équipement
            </button>
            <button
              @click="openLibraryDevicePicker(openedUsage)"
              class="w-full inline-flex items-center justify-center gap-2 px-3 py-2.5 text-sm text-emerald-700 bg-white active:bg-emerald-50 border border-emerald-300 rounded-xl font-medium whitespace-nowrap"
            >
              <FontAwesomeIcon :icon="['fas', 'book-open']" class="w-4 h-4 shrink-0" /> Depuis la bibliothèque
            </button>
          </div>
        </section>

        <!-- Régulation thermique R175-6 -->
        <button
          v-if="isBacs && (openedUsage.system_category === 'heating' || openedUsage.system_category === 'cooling') && thermalFor(openedUsage.zone_id, openedUsage.system_category)"
          type="button"
          @click="openThermalSheet(openedUsage.zone_id, openedUsage.system_category)"
          class="w-full tap-target flex items-center gap-3 px-4 py-3.5 bg-amber-50 border border-amber-300 rounded-2xl active:bg-amber-100 text-left"
        >
          <span class="w-10 h-10 rounded-xl bg-amber-100 text-amber-700 inline-flex items-center justify-center text-base shrink-0">🌡️</span>
          <div class="flex-1 min-w-0">
            <p class="text-sm font-semibold text-amber-900 truncate">
              Régulation thermique <span class="font-normal opacity-70">— R175-6</span>
            </p>
            <p :class="['text-xs mt-0.5 truncate',
                        thermalStatus(openedUsage.zone_id, openedUsage.system_category).tone === 'warn' ? 'text-red-600 font-semibold' :
                        thermalStatus(openedUsage.zone_id, openedUsage.system_category).tone === 'ok' ? 'text-emerald-700 font-medium' : 'text-gray-600']">
              {{ thermalStatus(openedUsage.zone_id, openedUsage.system_category).label }}
            </p>
          </div>
          <FontAwesomeIcon :icon="['fas', 'chevron-right']" class="w-5 h-5 text-amber-500 shrink-0" />
        </button>
      </div>
    </MobileSheet>

    <!-- Sheet édition device : titre = nom de l'équipement courant
         (ou « Nouvel équipement » en création). -->
    <MobileSheet
      :open="!!editingDevice"
      :title="deviceSheetTitle"
      :saving="savingDevice"
      @close="closeDevice"
      @save="saveDevice"
    >
      <div class="p-4 space-y-4">
        <p v-if="editingDevice?.system" class="text-xs text-gray-500">
          {{ usageLabel(editingDevice.system) }} —
          {{ editingDevice.system.zone_name }}
        </p>

        <!-- Complétude de l'équipement (logique partagée avec le desktop) -->
        <div :class="['rounded-xl px-4 py-3 text-sm flex items-start gap-2',
                      deviceComplete
                        ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                        : 'bg-amber-50 text-amber-800 border border-amber-200']">
          <span class="font-semibold shrink-0">{{ deviceComplete ? '✓' : '⚠' }}</span>
          <span v-if="deviceForced">
            Validation forcée manuellement — l'équipement est considéré validé.
            <template v-if="deviceMissing.length"> Non renseigné : <strong>{{ deviceMissing.join(', ') }}</strong>.</template>
          </span>
          <span v-else-if="deviceComplete">Équipement complet — pris en compte dans la validation de l'étape.</span>
          <span v-else>
            Équipement incomplet — il reste à renseigner : <strong>{{ deviceMissing.join(', ') }}</strong>.
          </span>
        </div>

        <!-- Le toggle disparait quand l'equipement est complet (plus
             besoin de forcer). Aligne sur le pattern desktop : si l'auditeur
             a deja force et complete ensuite, le toggle masque a vraisement
             plus de raison d'etre. Pour defaire un forcage actif sur un
             equipement encore incomplet, on garde le toggle visible. -->
        <MobileYesNo
          v-if="!deviceComplete"
          label="Forcer la validation de cet équipement ?"
          description="À activer si certaines informations resteront définitivement inconnues. L'équipement sera considéré validé même incomplet."
          :model-value="deviceForm.validation_forced"
          @update:model-value="v => deviceForm.validation_forced = v"
        />

        <!-- Photos terrain en TÊTE (mode édition uniquement : un device en
             cours de création n'a pas encore d'id pour rattacher les photos). -->
        <div v-if="editingDevice?.mode === 'edit' && document?.site_uuid"
             class="bg-white rounded-xl border border-gray-200 px-4 py-3">
          <p class="text-xs font-medium text-gray-600 uppercase tracking-wider mb-2">Photos</p>
          <BacsPhotoButton
            :site-uuid="document.site_uuid"
            :attach-to="{ device_id: editingDevice.device.id }"
            :label="editingDevice.device.name || editingDevice.device.brand || `Équipement #${editingDevice.device.id}`"
            size="md"
          />
        </div>
        <div v-if="editingDevice?.mode === 'edit' && document?.site_uuid"
             class="bg-white rounded-xl border border-gray-200 px-4 py-3">
          <p class="text-xs font-medium text-gray-600 uppercase tracking-wider mb-2">Notes vocales</p>
          <VoiceNoteButton
            :site-uuid="document.site_uuid"
            :attach-to="{ device_id: editingDevice.device.id }"
            :label="editingDevice.device.name || editingDevice.device.brand || `Équipement #${editingDevice.device.id}`"
            size="md"
          />
        </div>

        <MobileField label="Nom">
          <input
            v-model="deviceForm.name"
            type="text"
            placeholder="ex : Chaudière gaz principale"
            autocapitalize="sentences"
            class="pwa-input"
          />
        </MobileField>

        <div class="grid grid-cols-2 gap-3">
          <MobileField label="Marque">
            <input
              v-model="deviceForm.brand"
              type="text"
              placeholder="ex : Atlantic"
              autocapitalize="words"
              class="pwa-input"
            />
          </MobileField>
          <MobileField label="Référence">
            <input
              v-model="deviceForm.model_reference"
              type="text"
              placeholder="ex : Varmax 70"
              class="pwa-input"
            />
          </MobileField>
        </div>

        <!-- Identification — Quantité + Âge (parité desktop). -->
        <div class="grid grid-cols-2 gap-3">
          <MobileField label="Quantité">
            <input
              v-model.number="deviceForm.quantity"
              type="number"
              inputmode="numeric"
              pattern="[0-9]*"
              min="1"
              step="1"
              placeholder="1"
              class="pwa-input pwa-input--num"
            />
          </MobileField>
          <MobileField label="Âge (années)">
            <input
              v-model.number="deviceForm.age_years"
              type="number"
              inputmode="numeric"
              pattern="[0-9]*"
              min="0"
              step="1"
              placeholder="—"
              class="pwa-input pwa-input--num"
            />
          </MobileField>
        </div>

        <!-- Puissance conditionnelle : chaud / froid selon l'usage desservi.
             Les deux champs uniquement pour un équipement réversible
             (chauffage ET refroidissement). -->
        <template v-if="showPowerFields">
          <div :class="showHeatPower && showCoolPower ? 'grid grid-cols-2 gap-3' : ''">
            <MobileField v-if="showHeatPower" :label="heatPowerLabel">
              <input
                v-model.number="deviceForm.power_kw"
                type="number"
                inputmode="decimal"
                pattern="[0-9.,]*"
                min="0"
                step="0.1"
                placeholder="—"
                class="pwa-input pwa-input--num"
              />
            </MobileField>
            <MobileField v-if="showCoolPower" label="Puissance froid (kW)">
              <input
                v-model.number="deviceForm[coolPowerField]"
                type="number"
                inputmode="decimal"
                pattern="[0-9.,]*"
                min="0"
                step="0.1"
                placeholder="—"
                class="pwa-input pwa-input--num"
              />
            </MobileField>
          </div>

          <MobileField label="Type de calcul de puissance">
            <MobileSelectSheet
              v-model="deviceForm.power_calculation_type"
              :options="POWER_CALC_OPTIONS"
              title="Type de calcul de puissance"
              placeholder="— Calcul automatique —"
            />
          </MobileField>
        </template>

        <!-- Fonction(s) d'abord : l'énergie n'apparaît qu'ensuite, et
             SEULEMENT si la fonction inclut Production (doctrine mig 194).
             Pour un radiateur à eau chaude ou un ventilo-convecteur, pas
             d'énergie primaire — elle est portée par l'équipement amont. -->
        <MobileField label="Fonction(s) de l'équipement">
          <MobileSelectSheet
            :model-value="Array.isArray(deviceForm.device_role) ? deviceForm.device_role : (deviceForm.device_role ? [deviceForm.device_role] : [])"
            @update:model-value="v => deviceForm.device_role = v"
            :options="ROLE_OPTIONS"
            :multiple="true"
            title="Rôles"
            placeholder="Production / Distribution / Émission / Régulation"
          />
          <p class="text-xs text-gray-500 mt-1.5 leading-snug">
            <strong>Production</strong> = transforme une énergie primaire (gaz, élec, soleil) en chaleur, froid ou lumière. <strong>Émission seule</strong> = reçoit un fluide d'un autre équipement (radiateur à eau, ventilo-convecteur…).
          </p>
        </MobileField>

        <MobileField v-if="deviceRoleAllowsEnergySource(deviceForm.device_role)"
                     label="Énergie primaire consommée">
          <MobileSelectSheet
            v-model="deviceForm.energy_source"
            :options="ENERGY_OPTIONS"
            title="Énergie primaire"
            placeholder="— Sélectionner —"
          />
        </MobileField>
        <div v-else class="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-600 leading-snug">
          Énergie et puissance non saisissables ici — les kW de cet émetteur sont déjà comptabilisés via la puissance du producteur amont (chaudière, UE DRV, chiller, sous-station). Les saisir ici ferait du double comptage R175-2. Si l'équipement transforme directement de l'énergie primaire en chaleur / froid / lumière (convecteur élec direct, VMC, luminaire LED…), ajoute la fonction <strong>Production</strong> ci-dessus.
        </div>

        <MobileField label="Localisation">
          <input
            v-model="deviceForm.location"
            type="text"
            placeholder="ex : Local technique sous-sol"
            autocapitalize="sentences"
            class="pwa-input"
          />
        </MobileField>

        <!-- Régulation (parité desktop) : Oui/Non, intégrée/déportée,
             marque/référence régulateur, types et localisations par niveau
             (production / distribution / émission), granularité R175-6. -->
        <div class="space-y-3 pt-2">
          <p class="text-xs font-medium text-gray-600 uppercase tracking-wider">Régulation</p>
          <MobileYesNo
            label="L'équipement dispose-t-il d'une régulation ?"
            description="Régulation intégrée (thermostat embarqué) ou externe (régulateur séparé). Si Oui, le niveau « Régulation » est ajouté automatiquement."
            :model-value="deviceForm.has_regulation"
            @update:model-value="setHasRegulation"
          />
          <template v-if="!!deviceForm.has_regulation">
            <MobileYesNo
              label="La régulation est-elle intégrée ou déportée ?"
              description="Intégrée = thermostat embarqué, contrôle natif PAC. Déportée = régulateur séparé (Siemens, GTB, sonde déportée…). Si intégrée, marque/référence sont celles de l'équipement."
              :yes-label="'Intégrée'" :no-label="'Déportée'"
              :model-value="deviceForm.regulation_integrated"
              @update:model-value="v => deviceForm.regulation_integrated = v"
            />
            <div v-if="showRegulatorDetails" class="grid grid-cols-2 gap-3">
              <MobileField label="Marque du régulateur">
                <input v-model="deviceForm.regulator_brand" type="text" placeholder="ex : Siemens"
                       class="pwa-input" />
              </MobileField>
              <MobileField label="Référence">
                <input v-model="deviceForm.regulator_model_reference" type="text" placeholder="ex : RVS43.143"
                       class="pwa-input" />
              </MobileField>
            </div>
            <template v-if="hasProductionRole">
              <MobileField label="Type de régulation de production">
                <MobileSelectSheet v-model="deviceForm.regulation_type_production"
                  :options="regulationProductionOptions" :creatable="true"
                  title="Type de régulation production" placeholder="Loi d'eau, cascade…" />
              </MobileField>
              <MobileField v-if="showRegulatorDetails" label="Localisation de la régulation de production">
                <MobileSelectSheet v-model="deviceForm.regulator_location_production"
                  :options="zoneOptionsForReg" :creatable="true"
                  title="Localisation" placeholder="Chaufferie, local technique…" />
              </MobileField>
            </template>
            <template v-if="hasDistributionRole">
              <MobileField label="Type de régulation de distribution">
                <MobileSelectSheet v-model="deviceForm.regulation_type_distribution"
                  :options="regulationDistributionOptions" :creatable="true"
                  title="Type de régulation distribution" placeholder="Vanne 3 voies, débit variable…" />
              </MobileField>
              <MobileField v-if="showRegulatorDetails" label="Localisation de la régulation de distribution">
                <MobileSelectSheet v-model="deviceForm.regulator_location_distribution"
                  :options="zoneOptionsForReg" :creatable="true"
                  title="Localisation" placeholder="Gaine technique, sous-sol…" />
              </MobileField>
            </template>
            <template v-if="hasEmissionRole">
              <MobileField label="Type de régulation d'émission">
                <MobileSelectSheet v-model="deviceForm.regulation_type_emission"
                  :options="regulationEmissionOptions" :creatable="true"
                  title="Type de régulation émission" placeholder="Thermostat, présence…" />
              </MobileField>
              <MobileField label="Granularité R175-6">
                <MobileSelectSheet v-model="deviceForm.regulation_granularity"
                  :options="GRANULARITY_OPTIONS" :creatable="true"
                  title="Granularité R175-6" placeholder="Par pièce / Par zone / Centralisée…" />
              </MobileField>
              <MobileField v-if="showRegulatorDetails" label="Localisation de la régulation d'émission">
                <MobileSelectSheet v-model="deviceForm.regulator_location_emission"
                  :options="zoneOptionsForReg" :creatable="true"
                  title="Localisation" placeholder="Bureau, salle de réunion…" />
              </MobileField>
            </template>
          </template>
        </div>

        <!-- Communication : ternaire is_communicating, puis Protocoles
             (masqués si is_communicating !== true), puis liaison câblée. -->
        <div class="space-y-2 pt-2">
          <p class="text-xs font-medium text-gray-600 uppercase tracking-wider">Communication &amp; conformité R175-3</p>
          <MobileYesNo
            label="L'équipement est-il communicant ?"
            description="Réponds Oui ou Non. Si Oui, sélectionne au moins un protocole."
            :model-value="deviceForm.is_communicating"
            @update:model-value="setIsCommunicating"
          />
          <MobileField v-if="!!deviceForm.is_communicating" label="Protocole(s)">
            <MobileSelectSheet
              :model-value="protocolsArray"
              :options="protocolOptionsPwa"
              :multiple="true"
              title="Protocoles de communication"
              placeholder="Sélectionner un ou plusieurs protocoles"
              @update:model-value="updateProtocols"
            />
          </MobileField>
          <MobileYesNo
            label="L'équipement est-il relié à la GTB par une liaison câblée ?"
            description="Liaison câblée dédiée vers la supervision — la base de l'interopérabilité exigée par le décret (R175-3 §3)."
            :model-value="deviceForm.wired"
            @update:model-value="v => deviceForm.wired = v"
          />
        </div>

        <!-- État & conformité R175-3 4° — boutons Oui / Non tri-état. -->
        <div class="space-y-2">
          <p class="text-xs font-medium text-gray-600 uppercase tracking-wider">État &amp; conformité</p>
          <MobileYesNo
            label="Peut-on arrêter l'équipement manuellement, sur place ?"
            description="R175-3 §4 — coupure directe sur place, sans passer par la supervision."
            :model-value="deviceForm.meets_r175_3_p4"
            @update:model-value="v => deviceForm.meets_r175_3_p4 = v"
          />
          <MobileYesNo
            label="L'équipement redémarre-t-il de façon autonome après une coupure ?"
            description="R175-3 §4 — reprise seule après coupure de courant, sans intervention d'un technicien."
            :model-value="deviceForm.meets_r175_3_p4_autonomous"
            @update:model-value="v => deviceForm.meets_r175_3_p4_autonomous = v"
          />
          <!-- Ordre desktop : is_backup AVANT out_of_service. -->
          <MobileYesNo
            label="Est-ce un équipement de secours ?"
            description="Relève qui ne tourne qu'en cas de panne, pointe extrême ou maintenance (typique : 2ᵉ chaudière en cascade quelques heures par an). Puissance exclue du cumul BACS (seuils 70 / 290 kW). Si elle tourne en permanence en complément, laisser sur Non."
            :model-value="deviceForm.is_backup"
            @update:model-value="v => deviceForm.is_backup = v"
          />
          <MobileYesNo
            label="L'équipement est-il hors service ?"
            description="Équipement hors d'usage — ignoré dans le plan de mise en conformité."
            :model-value="deviceForm.out_of_service"
            @update:model-value="v => deviceForm.out_of_service = v"
          />
          <!-- Mig 175 — multi-bâtiments déplacé du système vers le device.
               Chaudière commune, GPC, sous-station… qui dessert plusieurs
               bâtiments du site (cas F d'assujettissement). -->
          <MobileYesNo
            label="Cet équipement dessert-il plusieurs bâtiments du site ?"
            description="Chaudière commune, groupe de production de chaleur, sous-station… Tous les propriétaires du site deviennent alors assujettis ensemble (cas F)."
            :model-value="deviceForm.serves_multiple_buildings"
            @update:model-value="v => deviceForm.serves_multiple_buildings = v"
          />
        </div>

        <template v-if="editingDevice?.mode === 'edit'">
          <!-- Déplacer / partager entre usages (mig 143). -->
          <MobileField label="Usage principal">
            <MobileSelectSheet
              :model-value="editingDevice.device.system_id"
              :options="moveSystemOptions"
              :group-by-hint="true"
              title="Déplacer vers un usage"
              placeholder="— Usage —"
              @update:model-value="moveDeviceToSystem"
            />
          </MobileField>
          <MobileField label="Aussi présent dans"
                       hint="Sélectionne les autres usages où cet équipement physique est aussi présent. Options groupées par zone, icône colorée par catégorie.">
            <MobileSelectSheet
              v-if="shareSystemOptions.length"
              :model-value="extraSystemIds"
              :options="shareSystemOptions"
              :multiple="true"
              :group-by-hint="true"
              title="Aussi présent dans"
              placeholder="— Aucun partage —"
              @update:model-value="updateExtraSystemIds"
            />
            <p v-else class="pwa-body italic">Aucun autre usage disponible.</p>
          </MobileField>

          <!-- Item 7c — séparabilité du comptage : visible uniquement quand
               l'équipement est partagé entre plusieurs zones / usages. -->
          <template v-if="(editingDevice.device.extra_system_ids || []).length">
            <MobileField label="Comptage séparable"
                         hint="Le comptage de chaque zone desservie par cet équipement partagé peut-il être séparé ? Un comptage non séparable regroupe les zones en une seule zone fonctionnelle de suivi.">
              <div class="flex gap-2">
                <button v-for="opt in MOBILE_METERING_OPTS" :key="opt.value" type="button"
                        @click="deviceForm.metering_separable = deviceForm.metering_separable === opt.value ? null : opt.value"
                        :class="deviceForm.metering_separable === opt.value
                          ? opt.activeCls
                          : 'bg-white text-gray-600 border-gray-200'"
                        class="flex-1 min-h-11 px-3 rounded-lg border font-medium transition">
                  {{ opt.label }}
                </button>
              </div>
            </MobileField>
            <MobileField label="Justification du comptage"
                         hint="Justification courte : circuit hydraulique unique, colonnes montantes communes, tableaux électriques distincts…">
              <input
                v-model="deviceForm.metering_separable_note"
                type="text"
                placeholder="ex : circuit hydraulique unique"
                autocapitalize="sentences"
                class="pwa-input w-full"
              />
            </MobileField>
          </template>

          <div class="pt-4 border-t border-gray-200">
            <button
              @click="removeDevice(editingDevice.device)"
              class="pwa-button pwa-button--danger w-full bg-red-50 text-red-600 border-red-200"
            >
              <FontAwesomeIcon :icon="['fas', 'trash']" class="w-5 h-5" />
              Supprimer l'équipement
            </button>
          </div>
        </template>
      </div>
    </MobileSheet>

    <!-- Bibliothèque en page plein écran iOS-natif (MobileSheet) -->
    <MobileLibraryPicker
      v-if="libraryDevicePickerSystem"
      :system="libraryDevicePickerSystem"
      :system-label="usageLabel(libraryDevicePickerSystem)"
      :zone-name="libraryDevicePickerSystem.zone_name || ''"
      @close="libraryDevicePickerSystem = null"
      @added="audit.refreshAuditCore()"
    />

    <!-- Sous-page régulation thermique R175-6 -->
    <MobileThermalRegulationSheet
      :open="!!thermalSheetTarget"
      :zone-id="thermalSheetTarget?.zoneId"
      :category="thermalSheetTarget?.category || 'heating'"
      @close="closeThermalSheet"
    />

  </div>
</template>
