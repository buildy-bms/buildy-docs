<script setup>
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import '@/lib/equipment-icons'
import { ref, computed, watch, nextTick, onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useAuditStore } from '@/stores/audit'
import { useNotification } from '@/composables/useNotification'
import { useConfirm } from '@/composables/useConfirm'
import { createBacsMeter, updateBacsMeter, deleteBacsMeter } from '@/api'
import MobileField from './MobileField.vue'
import MobileSheet from './MobileSheet.vue'
import MobileSelectSheet from './MobileSelectSheet.vue'
import MeterTypePill from '@/components/MeterTypePill.vue'
import MeterUsagePill from '@/components/MeterUsagePill.vue'
import BacsPhotoButton from '@/components/BacsPhotoButton.vue'
import VoiceNoteButton from '@/components/VoiceNoteButton.vue'
import SegmentedToggle from '@/components/SegmentedToggle.vue'

const audit = useAuditStore()
const { document, meters, zones } = storeToRefs(audit)
const { error, success } = useNotification()
const { confirm } = useConfirm()

// ── Navigation drill-down (N1 énergies → N2 group → N3 liste) ───────
// Avant : liste plate des compteurs. Maintenant : on entre par l'énergie
// (élec / gaz / eau / thermique), puis on choisit de filtrer « Par usage »
// ou « Par zone » via un toggle global persisté (localStorage), puis on
// voit les compteurs filtrés. L'édition reste dans le MobileSheet existant.
const GROUP_BY_STORAGE_KEY = 'audit.meters.groupBy'
const currentView = ref('energies') // 'energies' | 'group' | 'list'
const selectedEnergy = ref(null)    // meter_type ∈ METER_TYPES
const selectedGroupKey = ref(null)  // usage ('heating'…) ou zone_id (number)
const groupBy = ref('usage')        // 'usage' | 'zone' — persisté
onMounted(() => {
  try {
    const v = window.localStorage.getItem(GROUP_BY_STORAGE_KEY)
    if (v === 'usage' || v === 'zone') groupBy.value = v
  } catch { /* localStorage indispo en SSR / private */ }
})
function setGroupBy(v) {
  groupBy.value = v
  try { window.localStorage.setItem(GROUP_BY_STORAGE_KEY, v) } catch { /* idem */ }
}
function goToEnergy(energy) {
  selectedEnergy.value = energy
  selectedGroupKey.value = null
  currentView.value = 'group'
  nextTick(() => window.scrollTo({ top: 0, behavior: 'instant' }))
}
function goToList(groupKey) {
  selectedGroupKey.value = groupKey
  currentView.value = 'list'
  nextTick(() => window.scrollTo({ top: 0, behavior: 'instant' }))
}
// Raccourci « Compteur général de site » depuis N1 : liste directement
// les compteurs sans zone_id, toutes énergies confondues (mode dédié).
function goToGeneralList() {
  selectedEnergy.value = '__general__'
  selectedGroupKey.value = null
  currentView.value = 'list'
  nextTick(() => window.scrollTo({ top: 0, behavior: 'instant' }))
}
function goBackToEnergies() {
  currentView.value = 'energies'
  selectedEnergy.value = null
  selectedGroupKey.value = null
}
function goBackToGroup() {
  // Depuis la liste des compteurs généraux, le retour remonte à N1
  // (pas de N2 « groupes » pour ce raccourci).
  if (selectedEnergy.value === '__general__') {
    goBackToEnergies()
    return
  }
  currentView.value = 'group'
  selectedGroupKey.value = null
}

// Décorées (icon + color) pour rendu visuel dans MobileSelectSheet.
// Couleurs cohérentes avec MeterUsagePill / MeterTypePill (rendu liste).
const METER_USAGES = [
  { value: 'heating',  label: 'Chauffage',      icon: 'fa-fire',          color: '#dc2626' },
  { value: 'cooling',  label: 'Refroidissement',  icon: 'fa-snowflake',     color: '#0ea5e9' },
  { value: 'dhw',      label: 'ECS',            icon: 'fa-faucet-drip',   color: '#0891b2' },
  { value: 'pv',       label: 'Production PV',  icon: 'fa-solar-panel',   color: '#facc15' },
  { value: 'lighting', label: 'Éclairage',      icon: 'fa-lightbulb',     color: '#eab308' },
  { value: 'other',    label: 'Autre',          icon: 'fa-circle-question', color: '#6b7280' },
]
const METER_TYPES = [
  { value: 'electric',            label: 'Électrique',            icon: 'fa-bolt',         color: '#eab308' },
  { value: 'electric_production', label: 'Électrique production', icon: 'fa-solar-panel',  color: '#facc15' },
  { value: 'gas',                 label: 'Gaz',                   icon: 'fa-fire-flame-curved', color: '#f97316' },
  { value: 'water',               label: 'Eau',                   icon: 'fa-droplet',      color: '#0ea5e9' },
  { value: 'thermal',             label: 'Thermique',             icon: 'fa-temperature-half', color: '#dc2626' },
]
const PROTOCOLS = [
  { value: 'modbus_tcp', label: 'Modbus TCP' },
  { value: 'modbus_rtu', label: 'Modbus RTU' },
  { value: 'bacnet_ip', label: 'BACnet IP' },
  { value: 'bacnet_mstp', label: 'BACnet MS/TP' },
  { value: 'knx', label: 'KNX' },
  { value: 'mbus', label: 'M-Bus' },
  { value: 'mqtt', label: 'MQTT' },
  { value: 'lorawan', label: 'LoRaWAN' },
  { value: 'autre', label: 'Autre' },
]
function usageLabel(v) { return METER_USAGES.find(u => u.value === v)?.label || v }

// Options de zone pour le MobileSelectSheet : « Compteur général » +
// chaque zone du document. value=null représente le compteur principal.
const ZONE_OPTIONS = computed(() => [
  { value: null, label: 'Compteur général', hint: 'compteur principal du site' },
  ...zones.value.map(z => ({ value: z.zone_id, label: z.name })),
])

// Options de localisation physique : zones techniques en tête (un compteur
// est généralement installé dans un local technique), puis fonctionnelles.
const LOCATION_OPTIONS = computed(() => {
  const tech = []
  const fnal = []
  for (const z of (zones.value || [])) {
    if ((z.kind || 'functional') === 'technical') tech.push(z)
    else fnal.push(z)
  }
  return [
    ...tech.map(z => ({ value: z.zone_id, label: z.name, icon: 'fa-screwdriver-wrench', color: '#64748b' })),
    ...fnal.map(z => ({ value: z.zone_id, label: z.name, icon: 'fa-map-pin', color: '#6366f1' })),
  ]
})

const stats = computed(() => ({
  total: meters.value.length,
  present: meters.value.filter(m => m.present_actual).length,
  missing: meters.value.filter(m => m.required && !m.present_actual && !m.out_of_service).length,
}))

// ── KPI niveau 1 : une card par énergie + compteur général ──────────
// On affiche TOUTES les énergies (même celles à 0 compteur) pour montrer
// le plan de comptage complet ; les énergies sans compteur sont grisées.
function metersOfEnergy(energy) {
  return meters.value.filter(m => m.meter_type === energy)
}
const energyCards = computed(() => METER_TYPES.map(et => {
  const arr = metersOfEnergy(et.value)
  return {
    ...et,
    total: arr.length,
    present: arr.filter(m => m.present_actual).length,
    missing: arr.filter(m => m.required && !m.present_actual && !m.out_of_service).length,
  }
}))
// Compteurs « généraux » = zone_id null, tous types confondus.
const generalMeters = computed(() => meters.value.filter(m => !m.zone_id))

// ── N2 — groupes (usage ou zone) à l'intérieur d'une énergie ────────
const selectedEnergyMeta = computed(() =>
  METER_TYPES.find(et => et.value === selectedEnergy.value) || null)
const selectedEnergyMeters = computed(() =>
  selectedEnergy.value ? metersOfEnergy(selectedEnergy.value) : [])

function buildGroups() {
  const list = selectedEnergyMeters.value
  if (groupBy.value === 'usage') {
    // Un bucket par catégorie présente dans les compteurs de l'énergie.
    const map = new Map()
    for (const m of list) {
      const key = m.usage || 'other'
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(m)
    }
    return METER_USAGES
      .filter(u => map.has(u.value))
      .map(u => ({
        key: u.value,
        label: u.label,
        icon: u.icon,
        color: u.color,
        meters: map.get(u.value) || [],
      }))
  }
  // groupBy === 'zone' : zones fonctionnelles puis techniques (uniquement
  // celles qui ont au moins 1 compteur de cette énergie). Compteurs
  // « généraux » regroupés dans un bucket spécial en tête.
  const map = new Map()
  let general = []
  for (const m of list) {
    if (!m.zone_id) { general.push(m); continue }
    if (!map.has(m.zone_id)) map.set(m.zone_id, [])
    map.get(m.zone_id).push(m)
  }
  const groups = []
  if (general.length) {
    groups.push({ key: '__general__', label: 'Compteur général de site', kind: 'general', meters: general })
  }
  for (const z of (zones.value || [])) {
    if (!map.has(z.zone_id)) continue
    groups.push({
      key: z.zone_id,
      label: z.name,
      kind: z.kind || 'functional',
      meters: map.get(z.zone_id) || [],
    })
  }
  return groups
}
const energyGroups = computed(() => (selectedEnergy.value ? buildGroups() : []))

// ── N3 — liste des compteurs filtrés (énergie + groupe) ─────────────
const filteredMeters = computed(() => {
  // Raccourci « Compteur général de site » : tous les compteurs sans
  // zone, toutes énergies confondues.
  if (selectedEnergy.value === '__general__') {
    return generalMeters.value
  }
  if (!selectedEnergy.value || selectedGroupKey.value == null) return []
  const list = selectedEnergyMeters.value
  if (groupBy.value === 'usage') {
    return list.filter(m => (m.usage || 'other') === selectedGroupKey.value)
  }
  if (selectedGroupKey.value === '__general__') {
    return list.filter(m => !m.zone_id)
  }
  return list.filter(m => m.zone_id === selectedGroupKey.value)
})
const selectedGroupLabel = computed(() => {
  if (selectedEnergy.value === '__general__') return 'Compteur général de site'
  const g = energyGroups.value.find(x => x.key === selectedGroupKey.value)
  return g?.label || ''
})
const isGeneralListMode = computed(() => selectedEnergy.value === '__general__')

// Sheet
const editing = ref(null)
const editForm = ref({})
const saving = ref(false)

function openCreate() {
  editForm.value = {
    zone_id: zones.value[0]?.zone_id || null,
    usage: 'heating',
    meter_type: 'thermal',
    required: true,
  }
  editing.value = { mode: 'create' }
}
function openEdit(m) {
  editForm.value = { ...m }
  editing.value = { mode: 'edit', meter: m }
}
function close() { editing.value = null }

// Titre dynamique du sheet d'édition : zone + usage du compteur courant.
const meterSheetTitle = computed(() => {
  if (!editing.value) return ''
  if (editing.value.mode === 'create') return 'Nouveau compteur'
  const m = editing.value.meter || editForm.value || {}
  const zone = m.zone_name || 'Général'
  const usage = usageLabel(m.usage)
  return `${zone} · ${usage}`
})

// Ouverture directe depuis l'onglet Docs (KPIs couverture photo).
watch(() => audit.pendingFocus, (focus) => {
  if (!focus || focus.kind !== 'meters' || focus.id == null) return
  const meter = meters.value.find(m => m.id === focus.id)
  if (meter) openEdit(meter)
  audit.pendingFocus = null
}, { immediate: true })

async function save() {
  saving.value = true
  try {
    // Compteur général (zone_id null) : la notion d'usage n'a pas de
    // sens (un compteur de tête mesure toute l'énergie du site, pas un
    // usage particulier). On force « other » à la sauvegarde — cohérent
    // avec le desktop.
    const usage = editForm.value.zone_id ? editForm.value.usage : 'other'
    if (editing.value.mode === 'create') {
      await createBacsMeter(document.value.id, {
        zone_id: editForm.value.zone_id || null,
        usage,
        meter_type: editForm.value.meter_type,
        required: !!editForm.value.required,
      })
      await audit.refreshAuditCore()
      success('Compteur ajouté')
    } else {
      const patch = {
        zone_id: editForm.value.zone_id || null,
        usage,
        meter_type: editForm.value.meter_type,
        required: !!editForm.value.required,
        present_actual: !!editForm.value.present_actual,
        communicating: !!editForm.value.communicating,
        wired: !!editForm.value.wired,
        out_of_service: !!editForm.value.out_of_service,
        // Localisation physique (zone technique d'installation),
        // saisie uniquement si le compteur est présent.
        location_zone_id: editForm.value.present_actual
          ? (editForm.value.location_zone_id || null)
          : null,
        communication_protocols: editForm.value.communication_protocols || null,
        notes_html: editForm.value.notes_html || null,
      }
      const { data } = await updateBacsMeter(editing.value.meter.id, patch)
      Object.assign(editing.value.meter, data)
      await audit.refreshActionItems()
      success('Compteur mis à jour')
    }
    close()
  } catch (e) {
    error(e.response?.data?.detail || 'Sauvegarde impossible')
  } finally {
    saving.value = false
  }
}

async function remove(m) {
  const ok = await confirm({
    title: 'Supprimer ce compteur ?',
    message: `${m.zone_name || 'Compteur général'} — ${usageLabel(m.usage)}`,
    confirmLabel: 'Supprimer',
    danger: true,
  })
  if (!ok) return
  try {
    await deleteBacsMeter(m.id)
    await audit.refreshAuditCore()
    if (editing.value?.meter?.id === m.id) close()
  } catch {
    error('Suppression impossible')
  }
}

// Toggle protocol single value (mobile-friendly UI)
const editProtocols = computed({
  get: () => {
    const raw = editForm.value.communication_protocols
    if (!raw) return []
    try { return typeof raw === 'string' ? JSON.parse(raw) : raw } catch { return [] }
  },
  set: (v) => {
    editForm.value.communication_protocols = v && v.length ? JSON.stringify(v) : null
  }
})
function toggleProtocol(p) {
  const arr = [...editProtocols.value]
  const idx = arr.indexOf(p)
  if (idx >= 0) arr.splice(idx, 1)
  else arr.push(p)
  editProtocols.value = arr
}
</script>

<template>
  <div class="p-3 space-y-3">
    <!-- ───────────────── N1 — Liste des énergies ───────────────── -->
    <template v-if="currentView === 'energies'">
      <!-- Stats globales -->
      <div class="grid grid-cols-3 gap-2">
        <div class="bg-white rounded-xl border border-gray-200 p-4 text-center">
          <p class="text-3xl font-medium text-gray-900 leading-none">{{ stats.total }}</p>
          <p class="text-sm text-gray-500 mt-1.5">Total</p>
        </div>
        <div class="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-center">
          <p class="text-3xl font-medium text-emerald-700 leading-none">{{ stats.present }}</p>
          <p class="text-sm text-emerald-600 mt-1.5">Présents</p>
        </div>
        <div :class="['rounded-xl border p-4 text-center',
                      stats.missing > 0 ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200']">
          <p :class="['text-3xl font-medium leading-none', stats.missing > 0 ? 'text-red-700' : 'text-gray-700']">
            {{ stats.missing }}
          </p>
          <p :class="['text-sm mt-1.5', stats.missing > 0 ? 'text-red-600' : 'text-gray-500']">Manquants</p>
        </div>
      </div>

      <!-- Toggle Par usage / Par zone (persisté localStorage) -->
      <div class="bg-white rounded-2xl border border-gray-200 p-1.5 flex gap-1">
        <button type="button" @click="setGroupBy('usage')"
                :class="['flex-1 min-h-11 px-3 py-2.5 text-sm font-medium rounded-xl transition',
                         groupBy === 'usage' ? 'bg-indigo-600 text-white' : 'text-gray-600 active:bg-gray-50']">
          Par usage
        </button>
        <button type="button" @click="setGroupBy('zone')"
                :class="['flex-1 min-h-11 px-3 py-2.5 text-sm font-medium rounded-xl transition',
                         groupBy === 'zone' ? 'bg-indigo-600 text-white' : 'text-gray-600 active:bg-gray-50']">
          Par zone
        </button>
      </div>

      <!-- Cards énergies -->
      <div class="bg-white rounded-2xl border border-gray-200 overflow-hidden divide-y divide-gray-100">
        <button
          v-for="e in energyCards"
          :key="e.value"
          type="button"
          @click="e.total > 0 && goToEnergy(e.value)"
          :disabled="e.total === 0"
          :class="['w-full flex items-center gap-3 px-4 py-4 text-left transition',
                   e.total > 0 ? 'active:bg-gray-50' : 'opacity-50']"
        >
          <span class="w-11 h-11 rounded-xl inline-flex items-center justify-center shrink-0"
                :style="{ background: e.color + '1a', color: e.color }">
            <FontAwesomeIcon :icon="['fas', e.icon.replace(/^fa-/, '')]" class="w-5 h-5" />
          </span>
          <div class="flex-1 min-w-0">
            <p class="text-base font-semibold text-gray-900 truncate leading-tight">{{ e.label }}</p>
            <p class="text-xs text-gray-500 mt-0.5">
              <span v-if="e.total === 0">Aucun compteur</span>
              <template v-else>
                <span>{{ e.total }} compteur{{ e.total > 1 ? 's' : '' }}</span>
                <span class="mx-1 text-gray-300">·</span>
                <span class="text-emerald-700 font-medium">{{ e.present }} présent{{ e.present > 1 ? 's' : '' }}</span>
                <template v-if="e.missing > 0">
                  <span class="mx-1 text-gray-300">·</span>
                  <span class="text-red-700 font-medium">{{ e.missing }} manquant{{ e.missing > 1 ? 's' : '' }}</span>
                </template>
              </template>
            </p>
          </div>
          <FontAwesomeIcon v-if="e.total > 0" :icon="['fas', 'chevron-right']" class="w-5 h-5 text-gray-300 shrink-0" />
        </button>
      </div>

      <!-- Compteurs généraux (raccourci, hors énergie) -->
      <button v-if="generalMeters.length"
              type="button"
              @click="goToGeneralList()"
              class="w-full bg-white rounded-2xl border border-gray-200 px-4 py-3.5 flex items-center gap-3 text-left active:bg-gray-50">
        <FontAwesomeIcon :icon="['fas', 'building-circle-arrow-right']" class="w-5 h-5 text-gray-500 shrink-0" />
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium text-gray-800">Compteur général de site</p>
          <p class="text-xs text-gray-500 mt-0.5">{{ generalMeters.length }} compteur{{ generalMeters.length > 1 ? 's' : '' }} non rattaché à une zone</p>
        </div>
        <FontAwesomeIcon :icon="['fas', 'chevron-right']" class="w-4 h-4 text-gray-300 shrink-0" />
      </button>

      <button
        type="button"
        @click="openCreate"
        class="pwa-button pwa-button--add mt-2"
      >
        <FontAwesomeIcon :icon="['fas', 'plus']" class="w-5 h-5 shrink-0" />
        Ajouter un compteur
      </button>
    </template>

    <!-- ───────────────── N2 — Groupes (usage ou zone) ───────────────── -->
    <template v-else-if="currentView === 'group' && selectedEnergyMeta">
      <!-- Header sticky : retour + énergie -->
      <div class="sticky top-0 -mx-3 -mt-3 px-3 pt-3 pb-2 bg-white z-10 border-b border-gray-100">
        <div class="flex items-center gap-2">
          <button type="button" @click="goBackToEnergies"
                  class="shrink-0 w-10 h-10 inline-flex items-center justify-center rounded-xl text-gray-700 active:bg-gray-100"
                  aria-label="Retour aux énergies">
            <FontAwesomeIcon :icon="['fas', 'chevron-left']" class="w-5 h-5" />
          </button>
          <span class="w-9 h-9 rounded-xl inline-flex items-center justify-center shrink-0"
                :style="{ background: selectedEnergyMeta.color + '1a', color: selectedEnergyMeta.color }">
            <FontAwesomeIcon :icon="['fas', selectedEnergyMeta.icon.replace(/^fa-/, '')]" class="w-4 h-4" />
          </span>
          <div class="flex-1 min-w-0">
            <p class="text-xs font-semibold text-gray-400 uppercase tracking-wider">Énergies › {{ groupBy === 'usage' ? 'Par usage' : 'Par zone' }}</p>
            <p class="text-base font-semibold text-gray-900 truncate leading-tight">{{ selectedEnergyMeta.label }}</p>
          </div>
        </div>
      </div>

      <!-- Toggle Par usage / Par zone (reproduit en N2 pour switcher rapidement) -->
      <div class="bg-white rounded-2xl border border-gray-200 p-1.5 flex gap-1">
        <button type="button" @click="setGroupBy('usage')"
                :class="['flex-1 min-h-11 px-3 py-2.5 text-sm font-medium rounded-xl transition',
                         groupBy === 'usage' ? 'bg-indigo-600 text-white' : 'text-gray-600 active:bg-gray-50']">
          Par usage
        </button>
        <button type="button" @click="setGroupBy('zone')"
                :class="['flex-1 min-h-11 px-3 py-2.5 text-sm font-medium rounded-xl transition',
                         groupBy === 'zone' ? 'bg-indigo-600 text-white' : 'text-gray-600 active:bg-gray-50']">
          Par zone
        </button>
      </div>

      <!-- Liste des groupes -->
      <div v-if="energyGroups.length" class="bg-white rounded-2xl border border-gray-200 overflow-hidden divide-y divide-gray-100">
        <button
          v-for="g in energyGroups"
          :key="g.key"
          type="button"
          @click="goToList(g.key)"
          class="w-full flex items-center gap-3 px-4 py-4 text-left active:bg-gray-50"
        >
          <!-- Icône colorée à gauche : par usage = icône d'usage colorée,
               par zone = pictogramme générique de zone (gris). -->
          <span v-if="groupBy === 'usage' && g.icon"
                class="w-10 h-10 rounded-xl inline-flex items-center justify-center shrink-0"
                :style="{ background: g.color + '1a', color: g.color }">
            <FontAwesomeIcon :icon="['fas', g.icon.replace(/^fa-/, '')]" class="w-5 h-5" />
          </span>
          <span v-else
                :class="['w-10 h-10 rounded-xl inline-flex items-center justify-center shrink-0',
                         g.kind === 'technical' ? 'bg-slate-100 text-slate-600' : 'bg-indigo-50 text-indigo-600']">
            <FontAwesomeIcon :icon="['fas', g.kind === 'general' ? 'building-circle-arrow-right' : g.kind === 'technical' ? 'screwdriver-wrench' : 'map-pin']" class="w-5 h-5" />
          </span>
          <div class="flex-1 min-w-0">
            <p class="text-base font-medium text-gray-900 truncate leading-tight">
              {{ g.label }}
              <span v-if="g.kind === 'technical'" class="ml-1 text-xs font-normal text-gray-400">(technique)</span>
            </p>
            <p class="text-xs text-gray-500 mt-0.5">
              <span>{{ g.meters.length }} compteur{{ g.meters.length > 1 ? 's' : '' }}</span>
              <span class="mx-1 text-gray-300">·</span>
              <span class="text-emerald-700 font-medium">{{ g.meters.filter(m => m.present_actual).length }} présent{{ g.meters.filter(m => m.present_actual).length > 1 ? 's' : '' }}</span>
            </p>
          </div>
          <FontAwesomeIcon :icon="['fas', 'chevron-right']" class="w-5 h-5 text-gray-300 shrink-0" />
        </button>
      </div>
      <div v-else class="text-center py-8 bg-white rounded-2xl border border-dashed border-gray-300">
        <FontAwesomeIcon :icon="['fas', 'bolt']" class="w-8 h-8 text-gray-300 mx-auto" />
        <p class="text-sm text-gray-500 mt-2">Aucun compteur de cette énergie</p>
      </div>
    </template>

    <!-- ───────────────── N3 — Liste des compteurs filtrés ───────────────── -->
    <template v-else-if="currentView === 'list' && (selectedEnergyMeta || isGeneralListMode)">
      <!-- Header sticky : retour + énergie › groupe (ou « Compteur général ») -->
      <div class="sticky top-0 -mx-3 -mt-3 px-3 pt-3 pb-2 bg-white z-10 border-b border-gray-100">
        <div class="flex items-center gap-2">
          <button type="button" @click="goBackToGroup"
                  class="shrink-0 w-10 h-10 inline-flex items-center justify-center rounded-xl text-gray-700 active:bg-gray-100"
                  aria-label="Retour">
            <FontAwesomeIcon :icon="['fas', 'chevron-left']" class="w-5 h-5" />
          </button>
          <span v-if="isGeneralListMode"
                class="w-9 h-9 rounded-xl inline-flex items-center justify-center shrink-0 bg-gray-100 text-gray-600">
            <FontAwesomeIcon :icon="['fas', 'building-circle-arrow-right']" class="w-4 h-4" />
          </span>
          <span v-else
                class="w-9 h-9 rounded-xl inline-flex items-center justify-center shrink-0"
                :style="{ background: selectedEnergyMeta.color + '1a', color: selectedEnergyMeta.color }">
            <FontAwesomeIcon :icon="['fas', selectedEnergyMeta.icon.replace(/^fa-/, '')]" class="w-4 h-4" />
          </span>
          <div class="flex-1 min-w-0">
            <p v-if="isGeneralListMode" class="text-xs font-semibold text-gray-400 uppercase tracking-wider truncate">
              Hors zone · toutes énergies
            </p>
            <p v-else class="text-xs font-semibold text-gray-400 uppercase tracking-wider truncate">
              {{ selectedEnergyMeta.label }} › {{ groupBy === 'usage' ? 'Usage' : 'Zone' }}
            </p>
            <p class="text-base font-semibold text-gray-900 truncate leading-tight">{{ selectedGroupLabel }}</p>
          </div>
          <span class="shrink-0 text-xs text-gray-500">{{ filteredMeters.length }}</span>
        </div>
      </div>

      <!-- Liste des compteurs -->
      <div v-if="filteredMeters.length" class="bg-white rounded-2xl border border-gray-200 overflow-hidden divide-y divide-gray-100">
        <button
          v-for="m in filteredMeters"
          :key="m.id"
          type="button"
          @click="openEdit(m)"
          :class="['w-full flex items-center gap-3 px-4 py-4 text-left active:bg-gray-50',
                   m.out_of_service ? 'opacity-50' : '',
                   m.required && !m.present_actual && !m.out_of_service ? 'bg-red-50/40' : '']"
        >
          <FontAwesomeIcon :icon="['fas', 'triangle-exclamation']"
            v-if="m.required && !m.present_actual && !m.out_of_service"
            class="w-6 h-6 text-red-500 shrink-0"
          />
          <div class="flex-1 min-w-0">
            <p class="text-base font-medium text-gray-900 truncate leading-tight">{{ m.zone_name || 'Compteur général' }}</p>
            <div class="flex items-center gap-1.5 mt-2 flex-wrap">
              <MeterTypePill :type="m.meter_type" />
              <MeterUsagePill :usage="m.usage" />
              <span v-if="m.present_actual" class="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-emerald-100 text-emerald-700">Présent</span>
              <span v-if="m.communicating" class="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-indigo-100 text-indigo-700">Communicant</span>
              <span v-if="m.out_of_service" class="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-gray-200 text-gray-600">HS</span>
            </div>
          </div>
          <FontAwesomeIcon :icon="['fas', 'chevron-right']" class="w-5 h-5 text-gray-300 shrink-0" />
        </button>
      </div>
      <div v-else class="text-center py-8 bg-white rounded-2xl border border-dashed border-gray-300">
        <FontAwesomeIcon :icon="['fas', 'bolt']" class="w-8 h-8 text-gray-300 mx-auto" />
        <p class="text-sm text-gray-500 mt-2">Aucun compteur dans ce groupe</p>
      </div>

      <button
        type="button"
        @click="openCreate"
        class="pwa-button pwa-button--add mt-2"
      >
        <FontAwesomeIcon :icon="['fas', 'plus']" class="w-5 h-5 shrink-0" />
        Ajouter un compteur
      </button>
    </template>

    <MobileSheet
      :open="!!editing"
      :title="meterSheetTitle"
      :saving="saving"
      @close="close"
      @save="save"
    >
      <div class="p-4 space-y-4">
        <!-- Photos terrain en TÊTE (mode édition uniquement). -->
        <div v-if="editing?.mode === 'edit' && document?.site_uuid"
             class="bg-white rounded-xl border border-gray-200 px-4 py-3">
          <p class="text-xs font-medium text-gray-600 uppercase tracking-wider mb-2">Photos</p>
          <BacsPhotoButton
            :site-uuid="document.site_uuid"
            :attach-to="{ meter_id: editing.meter.id }"
            :label="(editing.meter.zone_name || 'Général') + ' / ' + usageLabel(editing.meter.usage)"
            size="md"
          />
        </div>
        <div v-if="editing?.mode === 'edit' && document?.site_uuid"
             class="bg-white rounded-xl border border-gray-200 px-4 py-3">
          <p class="text-xs font-medium text-gray-600 uppercase tracking-wider mb-2">Notes vocales</p>
          <VoiceNoteButton
            :site-uuid="document.site_uuid"
            :attach-to="{ meter_id: editing.meter.id }"
            :label="(editing.meter.zone_name || 'Général') + ' / ' + usageLabel(editing.meter.usage)"
            size="md"
          />
        </div>

        <MobileField label="Zone" hint="Le local fonctionnel où se trouve ce compteur. « Compteur général » = compteur principal du site, pas attaché à une zone précise.">
          <MobileSelectSheet
            v-model="editForm.zone_id"
            :options="ZONE_OPTIONS"
            title="Choisir une zone"
            placeholder="Compteur général"
          />
        </MobileField>

        <MobileField :label="editForm.zone_id ? 'Type d\'énergie' : 'Énergie mesurée'"
                     hint="Quelle énergie ce compteur mesure : électrique, gaz, eau, ou thermique (kWh chaud/froid via débit + ΔT).">
          <MobileSelectSheet
            v-model="editForm.meter_type"
            :options="METER_TYPES"
            title="Type d'énergie mesurée"
            placeholder="— Sélectionner —"
          />
        </MobileField>

        <!-- Compteur général (zone null) : pas d'usage à choisir, la notion
             n'a pas de sens pour un compteur de tête de site (cohérent avec
             le desktop). -->
        <MobileField v-if="editForm.zone_id" label="Catégorie" hint="À quoi sert l'énergie mesurée : chauffage, climatisation, ECS (eau chaude sanitaire), production photovoltaïque, éclairage…">
          <MobileSelectSheet
            v-model="editForm.usage"
            :options="METER_USAGES"
            title="Catégorie d'usage"
            placeholder="— Sélectionner —"
          />
        </MobileField>

        <MobileField label="État du compteur">
          <div class="space-y-2">
            <div class="flex items-start justify-between gap-3 px-4 py-4 bg-white border border-gray-200 rounded-xl">
              <div class="flex-1 min-w-0">
                <p class="text-base font-medium text-gray-700">Requis par R175 ?</p>
                <p class="text-xs text-gray-500 mt-1 leading-relaxed">
                  Le décret R175-3 1° impose un sous-comptage de chaque usage soumis (chauffage, clim, ECS, éclairage…). Répondre Oui si ce compteur EST requis par le décret.
                </p>
              </div>
              <SegmentedToggle size="lg" :model-value="!!editForm.required"
                               @update:model-value="v => (editForm.required = v)" class="mt-1 shrink-0" />
            </div>
            <template v-if="editing?.mode === 'edit'">
              <div class="flex items-start justify-between gap-3 px-4 py-4 bg-white border border-gray-200 rounded-xl">
                <div class="flex-1 min-w-0">
                  <p class="text-base font-medium text-gray-700">Présent physiquement sur site ?</p>
                  <p class="text-xs text-gray-500 mt-1">Le compteur existe et est installé, peu importe s'il communique ou pas.</p>
                </div>
                <SegmentedToggle size="lg" :model-value="!!editForm.present_actual"
                                 @update:model-value="v => (editForm.present_actual = v)" class="mt-1 shrink-0" />
              </div>
              <div v-if="editForm.present_actual"
                   class="bg-white border border-gray-200 rounded-xl overflow-hidden">
                <div class="flex items-start justify-between gap-3 px-4 py-4">
                  <div class="flex-1 min-w-0">
                    <p class="text-base font-medium text-gray-700">Communicant ?</p>
                    <p class="text-xs text-gray-500 mt-1">Le compteur peut transmettre ses index par un protocole (Modbus, M-Bus, KNX, MQTT…). Pas seulement un afficheur.</p>
                  </div>
                  <SegmentedToggle size="lg" :model-value="!!editForm.communicating"
                                   @update:model-value="v => (editForm.communicating = v)" class="mt-1 shrink-0" />
                </div>
                <!-- Protocoles : visibles si Oui, juste sous la question
                     (sinon l'auditeur les cherchait plus bas, illisible). -->
                <div v-if="editForm.communicating && editing?.mode === 'edit'"
                     class="px-4 pb-4 pt-1 border-t border-gray-100 bg-gray-50/50">
                  <p class="pwa-label">Protocoles</p>
                  <div class="grid grid-cols-2 gap-2">
                    <button
                      v-for="p in PROTOCOLS"
                      :key="p.value"
                      type="button"
                      @click="toggleProtocol(p.value)"
                      :class="['pwa-button border',
                        editProtocols.includes(p.value)
                          ? 'bg-indigo-50 border-indigo-300 text-indigo-700'
                          : 'pwa-button--idle']"
                    >
                      {{ p.label }}
                    </button>
                  </div>
                </div>
              </div>
              <div v-if="editForm.present_actual"
                   class="flex items-start justify-between gap-3 px-4 py-4 bg-white border border-gray-200 rounded-xl">
                <div class="flex-1 min-w-0">
                  <p class="text-base font-medium text-gray-700">Câblé vers la GTB ?</p>
                  <p class="text-xs text-gray-500 mt-1">Le câble (RS485, Ethernet…) est physiquement raccordé à la GTB du site. Le compteur communique vraiment, pas seulement potentiellement.</p>
                </div>
                <SegmentedToggle size="lg" :model-value="!!editForm.wired"
                                 @update:model-value="v => (editForm.wired = v)" class="mt-1 shrink-0" />
              </div>
              <div class="flex items-start justify-between gap-3 px-4 py-4 bg-white border border-gray-200 rounded-xl">
                <div class="flex-1 min-w-0">
                  <p class="text-base font-medium text-red-600">Hors service ?</p>
                  <p class="text-xs text-gray-500 mt-1">Compteur HS, débranché, ou inaccessible. Sera ignoré dans le plan d'action.</p>
                </div>
                <SegmentedToggle size="lg" yes-danger :model-value="!!editForm.out_of_service"
                                 @update:model-value="v => (editForm.out_of_service = v)" class="mt-1 shrink-0" />
              </div>
            </template>
          </div>
        </MobileField>

        <!-- Localisation physique (zone technique d'installation),
             visible uniquement si Présent. Utile pour le ratissage terrain. -->
        <MobileField v-if="editing?.mode === 'edit' && editForm.present_actual"
                     label="Localisation"
                     hint="Où le compteur est-il physiquement installé (local technique, TGBT, armoire…) ? Distinct de la zone desservie.">
          <MobileSelectSheet
            v-model="editForm.location_zone_id"
            :options="LOCATION_OPTIONS"
            title="Localisation physique"
            placeholder="— Non précisée"
          />
        </MobileField>

        <MobileField v-if="editing?.mode === 'edit' && editForm.communicating" label="Protocoles">
          <div class="grid grid-cols-2 gap-2">
            <button
              v-for="p in PROTOCOLS"
              :key="p.value"
              type="button"
              @click="toggleProtocol(p.value)"
              :class="['min-h-11 px-3 py-3 text-base rounded-xl border transition',
                editProtocols.includes(p.value)
                  ? 'bg-indigo-50 border-indigo-300 text-indigo-700 font-medium'
                  : 'bg-white border-gray-200 text-gray-600']"
            >
              {{ p.label }}
            </button>
          </div>
        </MobileField>

        <template v-if="editing?.mode === 'edit' && document?.site_uuid">
          <div class="pt-4 border-t border-gray-200">
            <button
              @click="remove(editing.meter)"
              class="pwa-button pwa-button--danger w-full bg-red-50 text-red-600 border-red-200"
            >
              <FontAwesomeIcon :icon="['fas', 'trash']" class="w-5 h-5" />
              Supprimer le compteur
            </button>
          </div>
        </template>
      </div>
    </MobileSheet>
  </div>
</template>
