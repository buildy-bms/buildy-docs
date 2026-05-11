<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { TrashIcon, PlusIcon, CameraIcon, PencilSquareIcon, DocumentDuplicateIcon, BookOpenIcon, ChevronDownIcon } from '@heroicons/vue/24/outline'
import {
  createBacsDevice, updateBacsDevice, deleteBacsDevice, duplicateBacsDevice,
  listSiteDocuments, uploadSiteDocument, deleteSiteDocument,
  getSiteDocumentDownloadUrl,
} from '@/api'
import { useNotification } from '@/composables/useNotification'
import { useConfirm } from '@/composables/useConfirm'
import PhotoDropTr from './PhotoDropTr.vue'
import ProtocolMultiPicker from './ProtocolMultiPicker.vue'
import SearchableSelect from './SearchableSelect.vue'
import DeviceZoneSharing from './DeviceZoneSharing.vue'
import DataTableSortHeader from './DataTableSortHeader.vue'
import { useTableSort } from '@/composables/useTableSort'
import { useAuditStore } from '@/stores/audit'

/**
 * Sous-table éditable des équipements (devices) d'un système BACS donné.
 * Affichée sous chaque ligne (catégorie × zone) de la section 3.
 *
 * Affiche aussi les 3 cases au niveau du système :
 *  - Communicant (R175-3 3°)
 *  - Arrêt manuel possible (R175-3 4°)
 *  - Fonctionnement autonome (R175-3 4°)
 */
const props = defineProps({
  system: { type: Object, required: true },
  devices: { type: Array, required: true, default: () => [] },
  systemLabel: { type: String, required: true },
  siteUuid: { type: String, default: null },
})
const emit = defineEmits(['changed', 'system-updated', 'open-device-notes', 'add-device', 'add-device-from-library'])

function hasNotes(htmlOrText) {
  if (!htmlOrText) return false
  return !!String(htmlOrText).replace(/<[^>]*>/g, '').trim()
}

const { error } = useNotification()
const { confirm } = useConfirm()

// Liste des zones du document, alimentée par les systèmes existants
// (chacun porte zone_id + zone_name via JOIN backend). C'est plus
// robuste que auditStore.zones qui dépend de site_id : un audit sans
// site rattaché n'a pas son store.zones rempli, mais ses systèmes ont
// toujours leur zone_id puisque c'est une FK obligatoire.
const auditStore = useAuditStore()
const documentZones = computed(() => {
  const map = new Map()
  for (const s of auditStore.systems || []) {
    if (s.zone_id != null && !map.has(s.zone_id)) {
      map.set(s.zone_id, { zone_id: s.zone_id, name: s.zone_name || `Zone #${s.zone_id}` })
    }
  }
  // Complète avec les zones du store si dispo (au cas où l'audit a des
  // zones définies sans système matricé encore).
  for (const z of auditStore.zones || []) {
    if (!map.has(z.zone_id)) map.set(z.zone_id, { zone_id: z.zone_id, name: z.name })
  }
  return [...map.values()]
})

// Source partagee : lib/audit-options.js (icones + couleurs synchronises)
import { ENERGY_OPTIONS, ROLE_OPTIONS, COMM_OPTIONS } from '@/lib/audit-options'

// Devices partagés depuis une autre zone du document (mig 98) : un device
// dont le système parent est dans une autre zone, mais dont les extra_zone_ids
// contiennent zone_id du système courant ET dont la catégorie matche.
// Affichés en plus des devices propres avec un badge « Partagé depuis ».
const sharedDevices = computed(() => {
  const all = auditStore.devices || []
  return all.filter(d => {
    if (d.system_id === props.system.id) return false
    if (!(d.extra_zone_ids || []).includes(props.system.zone_id)) return false
    const originSys = (auditStore.systems || []).find(s => s.id === d.system_id)
    return originSys?.system_category === props.system.system_category
  })
})

// Tri : factorisé via composable. 3 clics : asc → desc → désactivé.
const { sortKey, sortDir, toggleSort, sortedRows } = useTableSort()
function sortValue(d, key) {
  switch (key) {
    case 'name': return (d.name || '').toLowerCase()
    case 'brand': return (d.brand || '').toLowerCase()
    case 'model_reference': return (d.model_reference || '').toLowerCase()
    case 'quantity': return Number(d.quantity) || 1
    case 'age_years': return Number(d.age_years) || 0
    case 'power_kw': return Number(d.power_kw) || 0
    case 'energy_source': return (d.energy_source || '').toLowerCase()
    case 'location': return (d.location || '').toLowerCase()
    default: return ''
  }
}

const displayDevices = computed(() =>
  sortedRows([...props.devices, ...sharedDevices.value], sortValue)
)

function isSharedFromOtherZone(d) {
  return d.system_id !== props.system.id
}
function originZoneNameFor(d) {
  const sys = (auditStore.systems || []).find(s => s.id === d.system_id)
  return sys?.zone_name || 'autre zone'
}
// Pour le sélecteur DeviceZoneSharing : l'« origine » est la zone du
// système parent du device (pas du système courant). Sur la vue miroir
// dans une zone extra, le système courant n'est PAS l'origine.
function originZoneIdOf(d) {
  if (d.system_id === props.system.id) return props.system.zone_id
  const sys = (auditStore.systems || []).find(s => s.id === d.system_id)
  return sys?.zone_id ?? props.system.zone_id
}

const newDevice = ref({
  name: '', brand: '', model_reference: '', power_kw: null,
  // Multi-rôle : array (mig 117).
  energy_source: null, device_role: [], communication_protocol: null,
  location: '', notes: '',
})

// Photos par device (charge depuis site_documents filtre par bacs_audit_device_id)
const photosByDevice = ref({})  // device_id -> [doc, ...]
async function refreshPhotos() {
  if (!props.siteUuid) return
  try {
    const { data } = await listSiteDocuments(props.siteUuid)
    const out = {}
    for (const doc of data) {
      if (!doc.bacs_audit_device_id) continue
      if (!out[doc.bacs_audit_device_id]) out[doc.bacs_audit_device_id] = []
      out[doc.bacs_audit_device_id].push(doc)
    }
    photosByDevice.value = out
  } catch { /* silencieux */ }
}
const fileInputs = ref({})
function pickPhotoFor(deviceId) {
  fileInputs.value[deviceId]?.click()
}
async function onPhotoSelected(d, e) {
  const file = e.target.files?.[0]
  e.target.value = ''
  if (!file) return
  if (!props.siteUuid) {
    error('Audit non rattaché à un site, impossible d\'uploader des photos')
    return
  }
  try {
    const fd = new FormData()
    fd.append('file', file)
    const title = `Photo ${d.name || d.brand || `équipement #${d.id}`} — ${file.name}`
    await uploadSiteDocument(props.siteUuid, fd, {
      title,
      category: 'autre',
      bacs_audit_system_id: d.system_id,
      bacs_audit_device_id: d.id,
    })
    success('Photo ajoutée')
    refreshPhotos()
  } catch (err) {
    error(err.response?.data?.detail || 'Upload impossible')
  }
}
async function removePhoto(photo) {
  const ok = await confirm({
    title: 'Supprimer cette photo ?',
    message: photo.title,
    confirmLabel: 'Supprimer', danger: true,
  })
  if (!ok) return
  try {
    await deleteSiteDocument(photo.id)
    refreshPhotos()
  } catch {
    error('Suppression impossible')
  }
}

watch(() => props.siteUuid, refreshPhotos)
watch(() => props.devices.length, refreshPhotos)
onMounted(refreshPhotos)

// Classes CSS partagees pour coherence visuelle (inputs + selects)
// Compact : px-2 py-1 (28px hauteur) au lieu de la version large py-2
// (40px). Cette card est dense, plus besoin du padding "premium" — on
// reste sur rounded-md + ring/30 qui suffit visuellement.
const inputCls = 'w-full text-sm px-2 py-1 border border-gray-200 rounded-md hover:border-gray-300 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 transition bg-white'
const selectCls = 'w-full text-sm px-2 py-1 border border-gray-200 rounded-md hover:border-gray-300 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-center transition bg-white'
const inputAddCls = 'w-full px-1.5 py-1 border border-indigo-200 bg-white rounded-sm focus:outline-none focus:ring-1 focus:ring-indigo-500/30 placeholder:italic placeholder:text-gray-400'
const selectAddCls = 'w-full px-1.5 py-1 border border-indigo-200 bg-white rounded-sm focus:outline-none focus:ring-1 focus:ring-indigo-500/30 text-center'

const totalPowerKw = computed(() =>
  props.devices.reduce((s, d) => s + (Number(d.power_kw) || 0), 0)
)

async function addDevice() {
  if (!newDevice.value.name && !newDevice.value.brand && !newDevice.value.model_reference) {
    error('Renseigne au moins un nom, une marque ou une référence')
    return
  }
  try {
    await createBacsDevice(props.system.id, {
      name: newDevice.value.name || null,
      brand: newDevice.value.brand || null,
      model_reference: newDevice.value.model_reference || null,
      power_kw: newDevice.value.power_kw === '' ? null : Number(newDevice.value.power_kw),
      energy_source: newDevice.value.energy_source,
      // Multi-rôle : envoie array (peut être vide → backend coerce en null).
      device_role: Array.isArray(newDevice.value.device_role) ? newDevice.value.device_role : [],
      communication_protocol: newDevice.value.communication_protocol,
      location: newDevice.value.location || null,
      notes: newDevice.value.notes || null,
    })
    newDevice.value = {
      name: '', brand: '', model_reference: '', power_kw: null,
      energy_source: null, device_role: [], communication_protocol: null,
      location: '', notes: '',
    }
    emit('changed')
  } catch (e) {
    error(e.response?.data?.detail || 'Création impossible')
  }
}

async function patchDevice(d, patch) {
  try {
    const { data } = await updateBacsDevice(d.id, patch)
    Object.assign(d, data)
    emit('changed')
  } catch {
    error('Sauvegarde impossible')
  }
}

async function dupDevice(d) {
  try {
    await duplicateBacsDevice(d.id)
    emit('changed')
  } catch {
    error('Duplication impossible')
  }
}

// Menu déroulant du split button « Ajouter un système »
const addMenuOpen = ref(false)
const addMenuRef = ref(null)
function toggleAddMenu() { addMenuOpen.value = !addMenuOpen.value }
function closeAddMenu() { addMenuOpen.value = false }
function onClickAddManual() {
  closeAddMenu()
  emit('add-device', props.system)
}
function onClickAddFromLibrary() {
  closeAddMenu()
  emit('add-device-from-library', props.system)
}
function onAddMenuDocClick(e) {
  if (addMenuRef.value && !addMenuRef.value.contains(e.target)) closeAddMenu()
}
onMounted(() => document.addEventListener('mousedown', onAddMenuDocClick))
onBeforeUnmount(() => document.removeEventListener('mousedown', onAddMenuDocClick))

async function removeDevice(d) {
  const ok = await confirm({
    title: 'Supprimer cet équipement ?',
    message: `« ${d.name || d.brand || d.model_reference || `Équipement #${d.id}`} »`,
    confirmLabel: 'Supprimer', danger: true,
  })
  if (!ok) return
  try {
    await deleteBacsDevice(d.id)
    emit('changed')
  } catch {
    error('Suppression impossible')
  }
}
</script>

<template>
  <div class="bg-slate-50 border-t border-gray-200 px-3 py-3">
    <!-- Header avec puissance totale + bouton + vert -->
    <div class="flex items-center justify-between mb-2 flex-wrap gap-2 min-w-0">
      <div class="flex items-center gap-3 text-xs text-gray-600 min-w-0 flex-1">
        <span class="font-semibold text-gray-700 truncate">{{ systemLabel }}</span>
        <span v-if="totalPowerKw > 0" class="text-emerald-700 font-mono whitespace-nowrap">
          {{ totalPowerKw }} kW total ({{ devices.length }} {{ devices.length > 1 ? 'systèmes' : 'système' }})
        </span>
        <span v-else class="text-gray-400 italic whitespace-nowrap">aucun système saisi</span>
      </div>
      <!-- Split button : action principale = formulaire manuel,
           déroulante = bibliothèque pré-filtrée sur la catégorie. -->
      <div ref="addMenuRef" class="relative inline-flex shrink-0 whitespace-nowrap">
        <button
          type="button"
          @click="onClickAddManual"
          class="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-l-lg shadow-sm whitespace-nowrap"
        >
          <PlusIcon class="w-3.5 h-3.5 shrink-0" /> Ajouter un système
        </button>
        <button
          type="button"
          @click="toggleAddMenu"
          :aria-expanded="addMenuOpen"
          aria-label="Plus d'options pour ajouter"
          class="inline-flex items-center justify-center px-1.5 py-1 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-r-lg shadow-sm border-l border-emerald-700 shrink-0"
        >
          <ChevronDownIcon class="w-3.5 h-3.5 shrink-0" />
        </button>
        <div
          v-if="addMenuOpen"
          class="absolute right-0 top-full mt-1 z-20 bg-white border border-gray-200 rounded-lg shadow-lg w-60 py-1 text-sm"
        >
          <button
            type="button"
            @click="onClickAddManual"
            class="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 whitespace-nowrap"
          >
            <PlusIcon class="w-4 h-4 text-gray-500 shrink-0" />
            <span>Saisir manuellement</span>
          </button>
          <button
            type="button"
            @click="onClickAddFromLibrary"
            class="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-emerald-50 hover:text-emerald-700 whitespace-nowrap"
          >
            <BookOpenIcon class="w-4 h-4 text-emerald-600 shrink-0" />
            <span>Depuis la bibliothèque</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Vrai data-table : en-têtes triables, bordures, lignes alternées,
         look table standard. Auto-largeur des colonnes au contenu. -->
    <div v-if="displayDevices.length" class="overflow-x-auto -mx-3 px-3">
      <table class="data-table w-full text-sm">
        <thead>
          <tr>
            <DataTableSortHeader sort-key="name" :active-key="sortKey" :dir="sortDir" @toggle="toggleSort">Nom</DataTableSortHeader>
            <DataTableSortHeader sort-key="brand" :active-key="sortKey" :dir="sortDir" @toggle="toggleSort">Marque</DataTableSortHeader>
            <DataTableSortHeader sort-key="model_reference" :active-key="sortKey" :dir="sortDir" @toggle="toggleSort">Référence</DataTableSortHeader>
            <DataTableSortHeader sort-key="quantity" :active-key="sortKey" :dir="sortDir" @toggle="toggleSort">Qté</DataTableSortHeader>
            <DataTableSortHeader sort-key="age_years" :active-key="sortKey" :dir="sortDir" @toggle="toggleSort">Âge</DataTableSortHeader>
            <DataTableSortHeader sort-key="power_kw" :active-key="sortKey" :dir="sortDir" @toggle="toggleSort">Puiss.</DataTableSortHeader>
            <DataTableSortHeader sort-key="energy_source" :active-key="sortKey" :dir="sortDir" @toggle="toggleSort">Énergie</DataTableSortHeader>
            <th>Rôle</th>
            <DataTableSortHeader sort-key="location" :active-key="sortKey" :dir="sortDir" @toggle="toggleSort">Localisation</DataTableSortHeader>
            <th>Communication</th>
            <th>État</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <PhotoDropTr
            v-for="d in displayDevices"
            :key="d.id"
            :site-uuid="siteUuid || ''"
            :attach-to="{ device_id: d.id }"
            :enabled="!!siteUuid"
            :row-class="[d.out_of_service ? 'opacity-60' : '',
                         isSharedFromOtherZone(d) ? 'bg-emerald-50/30' : ''].join(' ')"
            @changed="refreshPhotos">
            <!-- Nom (le badge "Partagé depuis" est porté par la couleur
                 de fond verte de la ligne et le tooltip du bouton partage).
                 Largeur auto au contenu : pas de min-w. -->
            <td class="px-2 py-2 align-middle">
              <input type="text" :value="d.name" placeholder="Nommer ce système"
                     @blur="e => e.target.value !== (d.name || '') && patchDevice(d, { name: e.target.value || null })"
                     :size="Math.max((d.name || '').length, 18)"
                     class="font-semibold text-gray-900 bg-transparent border-0 px-0 focus:outline-none focus:ring-0 placeholder:font-normal placeholder:text-gray-300 placeholder:italic" />
            </td>
            <!-- Marque -->
            <td class="px-2 py-2 align-middle">
              <input type="text" :value="d.brand" placeholder="Atlantic"
                     @blur="e => e.target.value !== (d.brand || '') && patchDevice(d, { brand: e.target.value || null })"
                     :class="inputCls" class="min-w-32 placeholder:italic placeholder:text-gray-300" />
            </td>
            <!-- Référence -->
            <td class="px-2 py-2 align-middle">
              <input type="text" :value="d.model_reference" placeholder="Varmax 70"
                     @blur="e => e.target.value !== (d.model_reference || '') && patchDevice(d, { model_reference: e.target.value || null })"
                     :class="inputCls" class="min-w-32 placeholder:italic placeholder:text-gray-300" />
            </td>
            <!-- Quantité (par défaut 1, mig 134) -->
            <td class="px-2 py-2 align-middle whitespace-nowrap">
              <div class="w-14 mx-auto">
                <input type="number" min="1" step="1" :value="d.quantity ?? 1"
                       @blur="e => patchDevice(d, { quantity: Math.max(1, parseInt(e.target.value, 10) || 1) })"
                       :class="inputCls" class="text-center" />
              </div>
            </td>
            <!-- Âge en années (mig 135, propriété du device) -->
            <td class="px-2 py-2 align-middle whitespace-nowrap">
              <div class="w-16 mx-auto">
                <input type="number" min="0" step="1" :value="d.age_years ?? ''" placeholder="—"
                       @blur="e => patchDevice(d, { age_years: e.target.value === '' ? null : Math.max(0, parseInt(e.target.value, 10) || 0) })"
                       :class="inputCls" class="text-center placeholder:text-gray-300" />
              </div>
            </td>
            <!-- Puissance -->
            <td class="px-2 py-2 align-middle whitespace-nowrap">
              <div class="relative w-20 mx-auto">
                <input type="number" min="0" step="0.1" :value="d.power_kw" placeholder="—"
                       @blur="e => patchDevice(d, { power_kw: e.target.value === '' ? null : parseFloat(e.target.value) })"
                       :class="inputCls" class="text-right pr-6 placeholder:text-gray-300" />
                <span class="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-gray-400 pointer-events-none">kW</span>
              </div>
            </td>
            <!-- Énergie -->
            <td class="px-2 py-2 align-middle whitespace-nowrap">
              <div class="min-w-28">
                <SearchableSelect
                  :model-value="d.energy_source"
                  @update:model-value="v => patchDevice(d, { energy_source: v || null })"
                  :options="ENERGY_OPTIONS"
                  :clearable="false"
                  size="sm"
                  placeholder="Énergie"
                />
              </div>
            </td>
            <!-- Rôle -->
            <td class="px-2 py-2 align-middle whitespace-nowrap">
              <div class="min-w-32">
                <SearchableSelect
                  :model-value="Array.isArray(d.device_role) ? d.device_role : (d.device_role ? [d.device_role] : [])"
                  @update:model-value="v => patchDevice(d, { device_role: Array.isArray(v) ? v : [] })"
                  :options="ROLE_OPTIONS"
                  :multiple="true"
                  :clearable="true"
                  :creatable="true"
                  size="sm"
                  placeholder="Rôle"
                />
              </div>
            </td>
            <!-- Localisation -->
            <td class="px-2 py-2 align-middle">
              <input type="text" :value="d.location" placeholder="ex : Local technique"
                     @blur="e => e.target.value !== (d.location || '') && patchDevice(d, { location: e.target.value || null })"
                     :class="inputCls" class="min-w-40 placeholder:italic placeholder:text-gray-300" />
            </td>
            <!-- Communication : protocoles + câblé sur la même ligne -->
            <td class="px-2 py-2 align-middle whitespace-nowrap">
              <div class="flex items-center gap-1.5 min-w-48">
                <div class="flex-1 min-w-0">
                  <ProtocolMultiPicker
                    :model-value="d.communication_protocols || (d.communication_protocol && d.communication_protocol !== 'non_communicant' ? JSON.stringify([d.communication_protocol]) : null)"
                    :options="COMM_OPTIONS"
                    size="xs"
                    placeholder="Aucun protocole"
                    @update:modelValue="v => patchDevice(d, { communication_protocols: v, communication_protocol: null })"
                  />
                </div>
                <button type="button"
                        @click="patchDevice(d, { wired: !d.wired })"
                        :class="['flag-pill shrink-0', d.wired ? 'flag-on' : 'flag-off']"
                        v-tooltip="'Communication câblée vers la GTB'">
                  <span class="flag-ico">{{ d.wired ? '✓' : '✗' }}</span> Câblé
                </button>
              </div>
            </td>
            <!-- État : Arrêt manuel + Autonome + HS -->
            <td class="px-2 py-2 align-middle whitespace-nowrap">
              <div class="flex items-center gap-1">
                <button type="button"
                        @click="patchDevice(d, { meets_r175_3_p4: !d.meets_r175_3_p4 })"
                        :class="['flag-pill', d.meets_r175_3_p4 ? 'flag-on' : 'flag-off']"
                        v-tooltip="'R175-3 4° — Arrêt manuel possible'">
                  <span class="flag-ico">{{ d.meets_r175_3_p4 ? '✓' : '✗' }}</span> Arrêt
                </button>
                <button type="button"
                        @click="patchDevice(d, { meets_r175_3_p4_autonomous: !d.meets_r175_3_p4_autonomous })"
                        :class="['flag-pill', d.meets_r175_3_p4_autonomous ? 'flag-on' : 'flag-off']"
                        v-tooltip="'R175-3 4° — Reprise autonome de la GTB'">
                  <span class="flag-ico">{{ d.meets_r175_3_p4_autonomous ? '✓' : '✗' }}</span> Auto.
                </button>
                <button type="button"
                        @click="patchDevice(d, { out_of_service: !d.out_of_service })"
                        :class="['flag-pill', d.out_of_service ? 'flag-danger-on' : 'flag-off']"
                        title="Hors service — ignoré dans le plan d'action">
                  <span class="flag-ico">{{ d.out_of_service ? '✕' : '○' }}</span> HS
                </button>
              </div>
            </td>
            <!-- Actions : icones seules + tooltip (compteur photo en badge) -->
            <td class="px-2 py-2 align-middle whitespace-nowrap">
              <div class="inline-flex items-center gap-0.5">
                <button type="button" @click="emit('open-device-notes', d)"
                        :class="['p-1.5 rounded-md transition',
                          hasNotes(d.notes_html || d.notes)
                            ? 'text-indigo-700 bg-indigo-50 hover:bg-indigo-100'
                            : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100']"
                        v-tooltip="hasNotes(d.notes_html || d.notes) ? 'Modifier les notes' : 'Ajouter une note'">
                  <PencilSquareIcon class="w-4 h-4" />
                </button>
                <input type="file" accept="image/*" class="hidden"
                       :ref="el => { if (el) fileInputs[d.id] = el }"
                       @change="e => onPhotoSelected({ ...d, system_id: system.id }, e)" />
                <button @click="pickPhotoFor(d.id)"
                        :class="['relative p-1.5 rounded-md transition',
                                 (photosByDevice[d.id] || []).length
                                   ? 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100'
                                   : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100']"
                        v-tooltip="(photosByDevice[d.id] || []).length
                          ? `${(photosByDevice[d.id] || []).length} photo${(photosByDevice[d.id] || []).length > 1 ? 's' : ''}`
                          : 'Ajouter une photo'">
                  <CameraIcon class="w-4 h-4" />
                  <span v-if="(photosByDevice[d.id] || []).length"
                        class="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 inline-flex items-center justify-center text-[9px] font-semibold bg-emerald-600 text-white rounded-full">
                    {{ (photosByDevice[d.id] || []).length }}
                  </span>
                </button>
                <DeviceZoneSharing
                  :device="d"
                  :origin-zone-id="originZoneIdOf(d)"
                  :zones="documentZones"
                  @updated="emit('changed')" />
                <span class="w-px h-5 bg-gray-200 mx-0.5"></span>
                <button @click="dupDevice(d)" class="text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 p-1.5 rounded transition" v-tooltip="'Dupliquer'">
                  <DocumentDuplicateIcon class="w-4 h-4" />
                </button>
                <button @click="removeDevice(d)" class="text-gray-400 hover:text-red-600 hover:bg-red-50 p-1.5 rounded transition" v-tooltip="'Supprimer'">
                  <TrashIcon class="w-4 h-4" />
                </button>
              </div>
            </td>
          </PhotoDropTr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<!-- Styles factorisés dans frontend/src/assets/main.css → classe .data-table -->
<style scoped>
/* Petits ajustements scoped : forcer le justify-content center sur les
   flex internes d'une cellule (groupes de pills, actions). Le main.css
   ne peut pas cibler les enfants directs sans tomber dans des sélecteurs
   trop génériques. */
.data-table tbody td > div.flex {
  justify-content: center;
}
</style>
