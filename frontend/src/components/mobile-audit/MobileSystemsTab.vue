<script setup>
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import '@/lib/equipment-icons'
import { ref, computed, watch, nextTick, onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useAuditStore } from '@/stores/audit'
import { useNotification } from '@/composables/useNotification'
import { useConfirm } from '@/composables/useConfirm'
import { updateBacsSystem, shareBacsDevice, moveBacsDevice, createBacsDevice, updateBacsDevice, deleteBacsDevice, createBacsSystem, deleteBacsSystem, listSystemCategories } from '@/api'
import MobileField from './MobileField.vue'
import MobileSheet from './MobileSheet.vue'
import MobileSelectSheet from './MobileSelectSheet.vue'
import MobileThermalRegulationSheet from './MobileThermalRegulationSheet.vue'
import MobileLibraryPicker from './MobileLibraryPicker.vue'
import SystemCategoryIcon from '@/components/SystemCategoryIcon.vue'
import BacsPhotoButton from '@/components/BacsPhotoButton.vue'
import VoiceNoteButton from '@/components/VoiceNoteButton.vue'
import SearchableSelect from '@/components/SearchableSelect.vue'
import ProtocolMultiPicker from '@/components/ProtocolMultiPicker.vue'
import { COMM_OPTIONS, ENERGY_OPTIONS as ENERGY_OPTIONS_DECORATED, ROLE_OPTIONS as ROLE_OPTIONS_DECORATED, systemUsageLabel } from '@/lib/audit-options'

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

// ── Drill-down par usage ────────────────────────────────────────────
// La liste par zone n'affiche que les usages + leur présent/absent.
// Taper un usage présent ouvre une page dédiée avec ses équipements et
// sa régulation thermique.
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
// rendu visuel cohérent dans le MobileSelectSheet (énergie) et le
// SearchableSelect (niveaux multi-select).
const ENERGY_OPTIONS = ENERGY_OPTIONS_DECORATED
const ROLE_OPTIONS = ROLE_OPTIONS_DECORATED

// Libellé d'un usage : catégorie BACS, ou nom libre si usage manuel.
function usageLabel(s) { return systemUsageLabel(s) }

const collapsedZones = ref(new Set())

// Focus inter-tab : MobileChecklistTab navigue ici avec un system_id à
// mettre en avant. On déplie la zone, scrolle vers la card, et applique
// un anneau ambre temporaire pour l'identifier visuellement.
const focusedSystemId = ref(null)
watch(() => audit.pendingFocus, (focus) => {
  if (!focus || focus.kind !== 'systems' || focus.id == null) return
  const sys = systems.value.find(s => s.id === focus.id)
  if (sys) {
    collapsedZones.value.delete(sys.zone_id)
    collapsedZones.value = new Set(collapsedZones.value)
    focusedSystemId.value = sys.id
    nextTick(() => {
      const el = window.document.querySelector(`[data-system-id="${sys.id}"]`)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
    setTimeout(() => { focusedSystemId.value = null }, 2500)
  }
  audit.pendingFocus = null
}, { immediate: true })

function toggleZone(zoneId) {
  const s = new Set(collapsedZones.value)
  if (s.has(zoneId)) s.delete(zoneId); else s.add(zoneId)
  collapsedZones.value = s
}

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

function devicesOf(systemId) {
  const own = devices.value.filter(d => d.system_id === systemId)
  // Mig 143 : inclut les devices partagés vers cet usage.
  const shared = devices.value.filter(d =>
    d.system_id !== systemId && (d.extra_system_ids || []).includes(systemId),
  )
  return [...own, ...shared]
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
// Options « usage principal » pour le MobileSelectSheet de déplacement.
const moveSystemOptions = computed(() => (systems.value || []).map(s => ({
  value: s.id,
  label: `${s.zone_name || 'Zone'} — ${usageLabel(s)}`,
})))

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
    // Multi-rôle (mig 117) : array.
    energy_source: null, device_role: [], location: '',
    // Communication : protocoles multi (string JSON) + câblé.
    communication_protocols: null, wired: false,
    // État R175-3 4° + Hors service.
    meets_r175_3_p4: false, meets_r175_3_p4_autonomous: false, out_of_service: false,
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
      energy_source: deviceForm.value.energy_source,
      device_role: Array.isArray(deviceForm.value.device_role) ? deviceForm.value.device_role : [],
      location: deviceForm.value.location?.trim() || null,
      // Communication (regroupe Protocoles + Câblé pour cohérence desktop).
      communication_protocols: deviceForm.value.communication_protocols ?? null,
      // Le legacy `communication_protocol` (single) est nullé : la source
      // de vérité côté écriture est désormais `communication_protocols`
      // (cohérent avec patchDevice de SystemDevicesTable).
      communication_protocol: null,
      wired: !!deviceForm.value.wired,
      // État R175-3 4° + Hors service.
      meets_r175_3_p4: !!deviceForm.value.meets_r175_3_p4,
      meets_r175_3_p4_autonomous: !!deviceForm.value.meets_r175_3_p4_autonomous,
      out_of_service: !!deviceForm.value.out_of_service,
    }
    if (!payload.name && !payload.brand && !payload.model_reference) {
      error('Renseigne au moins un nom, une marque ou une référence')
      return
    }
    if (editingDevice.value.mode === 'create') {
      await createBacsDevice(editingDevice.value.system.id, payload)
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
</script>

<template>
  <div class="p-3 space-y-3">
    <!-- Stat puissance -->
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

    <!-- Liste par zone -->
    <div v-if="systemsByZone.length" class="space-y-3">
      <div
        v-for="g in systemsByZone"
        :key="g.zone_id"
        class="bg-white rounded-2xl border border-gray-200 overflow-hidden"
      >
        <!-- Header zone -->
        <button
          type="button"
          @click="toggleZone(g.zone_id)"
          class="w-full flex items-center gap-2 px-4 py-3 border-b border-gray-100 active:bg-gray-50"
        >
          <FontAwesomeIcon :icon="['fas', 'chevron-down']"
            :class="['w-4 h-4 text-gray-500 transition-transform shrink-0',
                     collapsedZones.has(g.zone_id) ? '-rotate-90' : '']"
          />
          <p class="flex-1 min-w-0 text-base font-medium text-gray-900 truncate text-left">{{ g.zone_name }}</p>
          <span class="text-xs text-gray-500 shrink-0">{{ g.items.filter(i => i.present).length }}/{{ g.items.length }}</span>
        </button>

        <!-- Systèmes -->
        <div v-show="!collapsedZones.has(g.zone_id)" class="divide-y divide-gray-100">
          <div v-for="s in g.items" :key="s.id"
               :data-system-id="s.id"
               :class="['px-4 py-4 transition',
                        s.not_concerned ? 'opacity-50 bg-gray-50' : '',
                        focusedSystemId === s.id ? 'bg-amber-50 ring-2 ring-amber-300' : '']">
            <div class="flex items-center gap-3">
              <SystemCategoryIcon :category="s.system_category" size="md" />
              <div class="flex-1 min-w-0">
                <p class="text-base font-medium text-gray-900 truncate leading-tight">
                  {{ usageLabel(s) }}
                </p>
                <p v-if="s.not_concerned" class="text-sm text-gray-500 mt-1 italic">
                  {{ SYSTEM_NEGATIVE_LABEL[s.system_category] || (s.is_bacs === 0 ? "Usage non concerné" : "Non concerné") }}
                </p>
                <p v-else-if="!s.present" class="text-xs text-gray-500 mt-1">
                  À renseigner : présent ou absent ?
                </p>
              </div>
              <button v-if="s.is_bacs === 0" type="button" @click.stop="removeUsage(s)"
                      class="shrink-0 w-10 h-10 inline-flex items-center justify-center rounded-xl text-gray-500 active:bg-red-50 active:text-red-600"
                      aria-label="Supprimer cet usage">
                <FontAwesomeIcon :icon="['fas', 'trash']" class="w-5 h-5" />
              </button>
            </div>
            <!-- Segmented control 2 états : Présent / Absent (= not_concerned).
                 Le présent/absent concerne l'usage, donc reste sur cette liste. -->
            <div class="mt-3 grid grid-cols-2 gap-2">
              <button type="button"
                      @click="patchSystem(s, { present: true, not_concerned: false })"
                      :class="['min-h-11 py-3 px-3 text-base font-medium rounded-xl border-2 transition',
                               s.present && !s.not_concerned
                                 ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                                 : 'border-gray-200 bg-white text-gray-600']">
                ✓ Présent
              </button>
              <button type="button"
                      @click="patchSystem(s, { present: false, not_concerned: true })"
                      :class="['min-h-11 py-3 px-3 text-base font-medium rounded-xl border-2 transition',
                               s.not_concerned
                                 ? 'border-gray-400 bg-gray-100 text-gray-700'
                                 : 'border-gray-200 bg-white text-gray-600']">
                ✕ Absent
              </button>
            </div>

            <!-- Drill-in : ouvre la page dédiée de l'usage (équipements +
                 régulation thermique). Visible seulement si l'usage est présent. -->
            <button v-if="s.present" type="button" @click="openUsage(s)"
                    class="mt-2 w-full flex items-center gap-3 px-3 py-3.5 bg-gray-50 active:bg-gray-100 rounded-xl text-left">
              <div class="flex-1 min-w-0">
                <p class="text-sm font-medium text-gray-800">
                  {{ devicesOf(s.id).length }} équipement{{ devicesOf(s.id).length > 1 ? 's' : '' }}
                </p>
                <p v-if="isBacs && (s.system_category === 'heating' || s.system_category === 'cooling') && thermalFor(s.zone_id, s.system_category)"
                   :class="['text-xs mt-0.5 truncate',
                            thermalStatus(s.zone_id, s.system_category).tone === 'warn' ? 'text-red-600 font-medium' :
                            thermalStatus(s.zone_id, s.system_category).tone === 'ok' ? 'text-emerald-700' : 'text-gray-500']">
                  Régulation thermique · {{ thermalStatus(s.zone_id, s.system_category).label }}
                </p>
                <p v-else class="text-xs text-gray-500 mt-0.5">Voir les équipements</p>
              </div>
              <FontAwesomeIcon :icon="['fas', 'chevron-right']" class="w-5 h-5 text-gray-300 shrink-0" />
            </button>
          </div>
          <!-- Ajout manuel d'un usage (hors décret BACS / zones techniques) -->
          <div class="px-4 py-3">
            <div v-if="addingUsageZone === g.zone_id" class="space-y-2">
              <p class="text-xs text-gray-500">Choisir une catégorie ou saisir un nom libre</p>
              <MobileSelectSheet
                v-model="newUsageValue"
                :options="categoryOptions"
                :creatable="true"
                title="Catégorie d'usage"
                placeholder="— Catégorie ou nom —"
              />
              <div class="flex gap-2">
                <button type="button" @click="confirmAddUsage(g.zone_id)" :disabled="!newUsageValue"
                        class="flex-1 min-h-11 py-3 text-base font-medium text-white bg-emerald-600 disabled:opacity-50 rounded-xl">
                  Ajouter
                </button>
                <button type="button" @click="cancelAddUsage"
                        class="px-4 min-h-11 py-3 text-base text-gray-600 bg-gray-100 rounded-xl">
                  Annuler
                </button>
              </div>
            </div>
            <button v-else type="button" @click="startAddUsage(g.zone_id)"
                    class="w-full min-h-11 inline-flex items-center justify-center gap-2 py-3 text-base font-medium text-indigo-600 bg-indigo-50 rounded-xl">
              <FontAwesomeIcon :icon="['fas', 'plus']" class="w-5 h-5 shrink-0" /> Ajouter un usage
            </button>
          </div>
        </div>
      </div>
    </div>
    <div v-else class="bg-white rounded-2xl border border-dashed border-gray-300 p-8 text-center">
      <FontAwesomeIcon :icon="['fas', 'screwdriver-wrench']" class="w-10 h-10 text-gray-300 mx-auto" />
      <p class="text-sm text-gray-500 mt-3">Pas encore de systèmes</p>
      <p class="text-xs text-gray-500 mt-1">Crée d'abord des zones, les systèmes apparaîtront ici</p>
    </div>

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
                  class="text-[10px] font-semibold uppercase tracking-wider text-emerald-700 mb-0.5"
                >
                  Partagé depuis « {{ deviceOriginZoneName(d) }} »
                </p>
                <p class="text-base font-semibold text-gray-900 truncate leading-tight">
                  {{ d.name || d.brand || d.model_reference || `Équipement #${d.id}` }}
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
          <div class="flex items-stretch gap-1.5 p-3 border-t border-gray-200 bg-gray-50">
            <button
              @click="openCreateDevice(openedUsage)"
              class="flex-1 inline-flex items-center justify-center gap-2 px-3 py-3.5 text-base text-white bg-emerald-600 active:bg-emerald-700 rounded-xl font-medium whitespace-nowrap"
            >
              <FontAwesomeIcon :icon="['fas', 'plus']" class="w-5 h-5 shrink-0" /> Ajouter
            </button>
            <button
              @click="openLibraryDevicePicker(openedUsage)"
              class="flex-1 inline-flex items-center justify-center gap-2 px-3 py-3.5 text-base text-emerald-700 bg-white active:bg-emerald-50 border border-emerald-300 rounded-xl font-medium whitespace-nowrap"
            >
              <FontAwesomeIcon :icon="['fas', 'book-open']" class="w-5 h-5 shrink-0" /> Bibliothèque
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
          <span class="w-10 h-10 rounded-xl bg-amber-100 text-amber-700 inline-flex items-center justify-center text-lg shrink-0">🌡️</span>
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

    <!-- Sheet édition device -->
    <MobileSheet
      :open="!!editingDevice"
      :title="editingDevice?.mode === 'create' ? 'Nouvel équipement' : 'Équipement'"
      :saving="savingDevice"
      @close="closeDevice"
      @save="saveDevice"
    >
      <div class="p-4 space-y-4">
        <p v-if="editingDevice?.system" class="text-xs text-gray-500">
          {{ usageLabel(editingDevice.system) }} —
          {{ editingDevice.system.zone_name }}
        </p>

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
            class="w-full px-4 py-3.5 text-base border border-gray-200 rounded-xl bg-white"
          />
        </MobileField>

        <div class="grid grid-cols-2 gap-3">
          <MobileField label="Marque">
            <input
              v-model="deviceForm.brand"
              type="text"
              placeholder="ex : Atlantic"
              autocapitalize="words"
              class="w-full px-4 py-3.5 text-base border border-gray-200 rounded-xl bg-white"
            />
          </MobileField>
          <MobileField label="Référence">
            <input
              v-model="deviceForm.model_reference"
              type="text"
              placeholder="ex : Varmax 70"
              class="w-full px-4 py-3.5 text-base border border-gray-200 rounded-xl bg-white"
            />
          </MobileField>
        </div>

        <MobileField label="Puissance (kW)">
          <input
            v-model.number="deviceForm.power_kw"
            type="number"
            inputmode="decimal"
            pattern="[0-9.,]*"
            min="0"
            step="0.1"
            placeholder="—"
            class="w-full px-4 py-3 border border-gray-200 rounded-xl bg-white text-right font-medium"
          />
        </MobileField>

        <MobileField label="Énergie">
          <MobileSelectSheet
            v-model="deviceForm.energy_source"
            :options="ENERGY_OPTIONS"
            title="Choisir une énergie"
            placeholder="— Sélectionner —"
          />
        </MobileField>

        <MobileField label="Niveau(x)">
          <SearchableSelect
            v-model="deviceForm.device_role"
            :options="ROLE_OPTIONS"
            :multiple="true"
            :clearable="true"
            :creatable="true"
            placeholder="Sélectionner un ou plusieurs niveaux"
          />
        </MobileField>

        <MobileField label="Localisation">
          <input
            v-model="deviceForm.location"
            type="text"
            placeholder="ex : Local technique sous-sol"
            autocapitalize="sentences"
            class="w-full px-4 py-3.5 text-base border border-gray-200 rounded-xl bg-white"
          />
        </MobileField>

        <!-- Communication : Protocoles d'abord puis Câblé (regroupement
             cohérent avec la sous-section desktop). -->
        <div class="space-y-2">
          <p class="text-xs font-medium text-gray-600 uppercase tracking-wider">Communication</p>
          <MobileField label="Protocole(s)">
            <ProtocolMultiPicker
              :model-value="deviceForm.communication_protocols ?? null"
              :options="COMM_OPTIONS"
              size="sm"
              placeholder="Aucun protocole"
              @update:modelValue="v => deviceForm.communication_protocols = v"
            />
          </MobileField>
          <button
            type="button"
            @click="deviceForm.wired = !deviceForm.wired"
            class="w-full text-left tap-target flex items-start justify-between gap-3 px-4 py-4 bg-white rounded-xl border border-gray-200 active:bg-gray-50"
          >
            <div class="flex-1 min-w-0">
              <p class="text-base text-gray-900 font-medium">Câblé</p>
              <p class="text-sm text-gray-500 mt-0.5 leading-relaxed">
                Communication câblée vers la GTB
              </p>
            </div>
            <span
              :class="['mt-1 shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-md border-2 transition',
                       deviceForm.wired
                         ? 'bg-emerald-500 border-emerald-500 text-white'
                         : 'bg-white border-gray-300']"
              aria-hidden="true"
            >
              <svg v-if="deviceForm.wired" viewBox="0 0 16 16" class="w-5 h-5">
                <path d="M3 8l3.5 3.5L13 4" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </span>
          </button>
        </div>

        <!-- État R175-3 4° + Hors service. Boutons toggle plein-largeur. -->
        <div class="space-y-2">
          <p class="text-xs font-medium text-gray-600 uppercase tracking-wider">État</p>
          <button
            type="button"
            @click="deviceForm.meets_r175_3_p4 = !deviceForm.meets_r175_3_p4"
            class="w-full text-left tap-target flex items-start justify-between gap-3 px-4 py-4 bg-white rounded-xl border border-gray-200 active:bg-gray-50"
          >
            <div class="flex-1 min-w-0">
              <p class="text-base text-gray-900 font-medium">Arrêt manuel possible</p>
              <p class="text-sm text-gray-500 mt-0.5 leading-relaxed">R175-3 4° — coupure manuelle</p>
            </div>
            <span
              :class="['mt-1 shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-md border-2 transition',
                       deviceForm.meets_r175_3_p4
                         ? 'bg-emerald-500 border-emerald-500 text-white'
                         : 'bg-white border-gray-300']"
              aria-hidden="true"
            >
              <svg v-if="deviceForm.meets_r175_3_p4" viewBox="0 0 16 16" class="w-5 h-5">
                <path d="M3 8l3.5 3.5L13 4" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </span>
          </button>
          <button
            type="button"
            @click="deviceForm.meets_r175_3_p4_autonomous = !deviceForm.meets_r175_3_p4_autonomous"
            class="w-full text-left tap-target flex items-start justify-between gap-3 px-4 py-4 bg-white rounded-xl border border-gray-200 active:bg-gray-50"
          >
            <div class="flex-1 min-w-0">
              <p class="text-base text-gray-900 font-medium">Reprise autonome</p>
              <p class="text-sm text-gray-500 mt-0.5 leading-relaxed">R175-3 4° — fonctionne sans la GTB</p>
            </div>
            <span
              :class="['mt-1 shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-md border-2 transition',
                       deviceForm.meets_r175_3_p4_autonomous
                         ? 'bg-emerald-500 border-emerald-500 text-white'
                         : 'bg-white border-gray-300']"
              aria-hidden="true"
            >
              <svg v-if="deviceForm.meets_r175_3_p4_autonomous" viewBox="0 0 16 16" class="w-5 h-5">
                <path d="M3 8l3.5 3.5L13 4" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </span>
          </button>
          <button
            type="button"
            @click="deviceForm.out_of_service = !deviceForm.out_of_service"
            class="w-full text-left tap-target flex items-start justify-between gap-3 px-4 py-4 bg-white rounded-xl border border-gray-200 active:bg-gray-50"
          >
            <div class="flex-1 min-w-0">
              <p class="text-base font-medium" :class="deviceForm.out_of_service ? 'text-red-700' : 'text-gray-900'">Hors service</p>
              <p class="text-sm text-gray-500 mt-0.5 leading-relaxed">Ignoré dans le plan d'action</p>
            </div>
            <span
              :class="['mt-1 shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-md border-2 transition',
                       deviceForm.out_of_service
                         ? 'bg-red-600 border-red-600 text-white'
                         : 'bg-white border-gray-300']"
              aria-hidden="true"
            >
              <svg v-if="deviceForm.out_of_service" viewBox="0 0 16 16" class="w-5 h-5">
                <path d="M4 4l8 8M4 12l8-8" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
              </svg>
            </span>
          </button>
        </div>

        <template v-if="editingDevice?.mode === 'edit'">
          <!-- Déplacer / partager entre usages (mig 143). -->
          <MobileField label="Usage principal">
            <MobileSelectSheet
              :model-value="editingDevice.device.system_id"
              :options="moveSystemOptions"
              title="Déplacer vers un usage"
              placeholder="— Usage —"
              @update:model-value="moveDeviceToSystem"
            />
          </MobileField>
          <div class="pt-2">
            <p class="text-xs font-medium text-gray-600 uppercase tracking-wider mb-2">
              <FontAwesomeIcon :icon="['fas', 'share-nodes']" class="w-3.5 h-3.5 inline -mt-0.5 mr-1" />
              Aussi présent dans
            </p>
            <div class="bg-white rounded-2xl border border-gray-200 divide-y divide-gray-100">
              <label
                v-for="sys in shareCandidateSystems()"
                :key="sys.id"
                class="px-4 py-3 flex items-center gap-3 cursor-pointer active:bg-gray-50"
              >
                <input
                  type="checkbox"
                  :checked="(editingDevice.device.extra_system_ids || []).includes(sys.id)"
                  :disabled="savingShare"
                  @change="e => toggleShareDeviceSystem(sys.id, e.target.checked)"
                  class="w-5 h-5 rounded border-gray-300 shrink-0"
                />
                <span class="text-base text-gray-700 truncate">{{ sys.zone_name }} — {{ usageLabel(sys) }}</span>
              </label>
              <p
                v-if="!shareCandidateSystems().length"
                class="px-4 py-4 text-sm text-gray-500 italic text-center"
              >
                Aucun autre usage disponible.
              </p>
            </div>
          </div>

          <div class="pt-4 border-t border-gray-200">
            <button
              @click="removeDevice(editingDevice.device)"
              class="w-full inline-flex items-center justify-center gap-2 px-4 py-3 text-red-600 bg-red-50 border border-red-200 rounded-xl font-medium"
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
