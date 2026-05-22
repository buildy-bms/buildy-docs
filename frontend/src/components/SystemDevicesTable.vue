<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { TrashIcon, PlusIcon, CameraIcon, PencilSquareIcon, DocumentDuplicateIcon, Cog6ToothIcon } from '@heroicons/vue/24/outline'
import {
  createBacsDevice, updateBacsDevice, deleteBacsDevice, duplicateBacsDevice,
  listSiteDocuments, uploadSiteDocument, deleteSiteDocument,
  getSiteDocumentDownloadUrl,
} from '@/api'
import { useNotification } from '@/composables/useNotification'
import { useConfirm } from '@/composables/useConfirm'
import PhotoDropTr from './PhotoDropTr.vue'
import SearchableSelect from './SearchableSelect.vue'
import DeviceMoveShare from './DeviceMoveShare.vue'
import VoiceNoteButton from './VoiceNoteButton.vue'
import DataTableSortHeader from './DataTableSortHeader.vue'
import DeviceEditModal from './audit/DeviceEditModal.vue'
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
const emit = defineEmits(['changed', 'system-updated', 'open-device-notes', 'add-device'])

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
// Tous les systèmes (zone × usage) de l'audit — alimente DeviceMoveShare.
const documentSystems = computed(() => auditStore.systems || [])

// Source partagee : lib/audit-options.js (icones + couleurs synchronises)
import { ENERGY_OPTIONS, isDeviceComplete } from '@/lib/audit-options'

// Item 3c — les puissances nominales (chaud / froid) n'ont de sens que pour
// les systèmes qui mettent en jeu une puissance thermique ou aéraulique.
// Masquées pour l'éclairage et la production d'électricité (où elles
// n'alimentent ni le cumul R175-2 ni un calcul utile).
const POWER_RELEVANT_CATEGORIES = new Set(['heating', 'cooling', 'ventilation', 'dhw'])
const showPower = computed(() => POWER_RELEVANT_CATEGORIES.has(props.system?.system_category))

// Champ de puissance pertinent pour l'usage de CE tableau. Dans un usage
// refroidissement, un équipement réversible (qui sert aussi un usage
// chauffage) porte sa puissance froid dans `power_kw_cooling` ; un
// équipement de froid seul la porte dans `power_kw`. Ailleurs : `power_kw`.
function powerFieldFor(d) {
  if (props.system?.system_category !== 'cooling') return 'power_kw'
  const ids = new Set([d.system_id, ...(d.extra_system_ids || [])])
  const reversible = (auditStore.systems || []).some(
    s => ids.has(s.id) && s.system_category === 'heating')
  return reversible ? 'power_kw_cooling' : 'power_kw'
}

// Item 3 — modale d'édition détaillée d'un équipement (désengorge la ligne).
const editingDevice = ref(null)

// Devices partagés depuis un autre usage (mig 143) : un device dont le
// système primaire est ailleurs mais dont les extra_system_ids contiennent
// l'id du système courant. Affichés en plus des devices propres.
const sharedDevices = computed(() => {
  const all = auditStore.devices || []
  return all.filter(d =>
    d.system_id !== props.system.id &&
    (d.extra_system_ids || []).includes(props.system.id)
  )
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
    case 'power_kw': return Number(d[powerFieldFor(d)]) || 0
    case 'energy_source': return (d.energy_source || '').toLowerCase()
    case 'location': return (d.location || '').toLowerCase()
    default: return ''
  }
}

const displayDevices = computed(() =>
  sortedRows([...props.devices, ...sharedDevices.value], sortValue)
)

// Un device affiché ici mais dont le système primaire est ailleurs =
// partagé depuis un autre usage.
function isSharedFromOtherZone(d) {
  return d.system_id !== props.system.id
}
function originZoneNameFor(d) {
  const sys = (auditStore.systems || []).find(s => s.id === d.system_id)
  return sys?.zone_name || 'autre zone'
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

// Puissance totale du système : somme des puissances × quantité de chaque
// équipement (un équipement saisi en quantité 3 compte 3 fois).
const totalPowerKw = computed(() =>
  Math.round(
    props.devices.reduce((s, d) => s + (Number(d[powerFieldFor(d)]) || 0) * (Number(d.quantity) || 1), 0) * 10,
  ) / 10
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

// Ouvre la modale d'ajout d'équipement à 2 onglets (bibliothèque / manuel).
function onClickAddDevice() {
  emit('add-device', props.system)
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
    emit('changed')
  } catch {
    error('Suppression impossible')
  }
}
</script>

<template>
  <div class="bg-slate-50 border-t border-gray-200 px-3 py-3">
    <!-- Header avec puissance totale -->
    <div class="flex items-center mb-2 flex-wrap gap-2 min-w-0">
      <div class="flex items-center gap-3 text-xs text-gray-600 min-w-0 flex-1">
        <span v-truncate-tooltip class="font-semibold text-gray-700 truncate">{{ systemLabel }}</span>
        <span v-if="totalPowerKw > 0" class="text-emerald-700 font-mono whitespace-nowrap">
          {{ totalPowerKw }} kW total ({{ devices.length }} {{ devices.length > 1 ? 'systèmes' : 'système' }})
        </span>
        <span v-else class="text-gray-400 italic whitespace-nowrap">aucun système saisi</span>
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
            <DataTableSortHeader sort-key="age_years" :active-key="sortKey" :dir="sortDir" @toggle="toggleSort">Âge</DataTableSortHeader>
            <DataTableSortHeader sort-key="power_kw" :active-key="sortKey" :dir="sortDir" @toggle="toggleSort">Puissance</DataTableSortHeader>
            <DataTableSortHeader sort-key="energy_source" :active-key="sortKey" :dir="sortDir" @toggle="toggleSort">Énergie</DataTableSortHeader>
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
                     :class="inputCls"
                     class="min-w-40 font-semibold text-gray-900 placeholder:font-normal placeholder:text-gray-300 placeholder:italic" />
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
            <!-- Âge en années (mig 135, propriété du device) -->
            <td class="px-2 py-2 align-middle whitespace-nowrap">
              <div class="w-16 mx-auto">
                <input type="number" min="0" step="1" :value="d.age_years ?? ''" placeholder="—"
                       @blur="e => patchDevice(d, { age_years: e.target.value === '' ? null : Math.max(0, parseInt(e.target.value, 10) || 0) })"
                       :class="inputCls" class="text-center placeholder:text-gray-300" />
              </div>
            </td>
            <!-- Puissance — item 3c : masquée hors usages thermiques. Le
                 détail (frigorifique + type de calcul) est dans la modale. -->
            <td class="px-2 py-2 align-middle whitespace-nowrap">
              <div v-if="!showPower" class="text-center text-xs text-gray-300"
                   v-tooltip="'Sans objet pour cet usage'">—</div>
              <div v-else class="relative w-24 mx-auto">
                <input type="number" min="0" step="0.1" :value="d[powerFieldFor(d)]" placeholder="—"
                       @blur="e => patchDevice(d, { [powerFieldFor(d)]: e.target.value === '' ? null : parseFloat(e.target.value) })"
                       :class="inputCls" class="text-right pr-9 placeholder:text-gray-300"
                       v-tooltip="system.system_category === 'cooling' ? 'Puissance froid pour cet usage — détail chaud/froid dans la modale' : 'Puissance chaud / nominale — détail chaud/froid dans la modale'" />
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
            <!-- Actions : Modifier (modale détaillée) + notes / photo / etc. -->
            <td class="px-2 py-2 align-middle whitespace-nowrap">
              <div class="inline-flex items-center gap-1">
                <button type="button" @click="editingDevice = d"
                        :class="['inline-flex items-center gap-1 px-2 py-1 mr-0.5 text-xs font-medium rounded-md transition whitespace-nowrap',
                          isDeviceComplete(d, system.system_category)
                            ? 'text-indigo-700 bg-indigo-50 hover:bg-indigo-100'
                            : 'text-red-700 bg-red-50 hover:bg-red-100']"
                        v-tooltip="isDeviceComplete(d, system.system_category)
                          ? 'Modifier l\'équipement'
                          : 'Équipement incomplet — à compléter avant de valider l\'étape Systèmes'">
                  <Cog6ToothIcon class="w-3.5 h-3.5 shrink-0" /> Modifier
                </button>
                <button type="button" @click="emit('open-device-notes', d)"
                        :class="['btn-icon', hasNotes(d.notes_html || d.notes) && 'is-active']"
                        v-tooltip="hasNotes(d.notes_html || d.notes) ? 'Modifier les notes' : 'Ajouter une note'">
                  <PencilSquareIcon class="w-4 h-4" />
                </button>
                <input type="file" accept="image/*" class="hidden"
                       :ref="el => { if (el) fileInputs[d.id] = el }"
                       @change="e => onPhotoSelected({ ...d, system_id: system.id }, e)" />
                <button @click="pickPhotoFor(d.id)"
                        :class="['btn-icon relative', (photosByDevice[d.id] || []).length && 'is-success']"
                        v-tooltip="(photosByDevice[d.id] || []).length
                          ? `${(photosByDevice[d.id] || []).length} photo${(photosByDevice[d.id] || []).length > 1 ? 's' : ''}`
                          : 'Ajouter une photo'">
                  <CameraIcon class="w-4 h-4" />
                  <span v-if="(photosByDevice[d.id] || []).length"
                        class="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 inline-flex items-center justify-center text-[9px] font-semibold bg-emerald-600 text-white rounded-full">
                    {{ (photosByDevice[d.id] || []).length }}
                  </span>
                </button>
                <VoiceNoteButton
                  v-if="siteUuid"
                  :site-uuid="siteUuid"
                  :attach-to="{ device_id: d.id }"
                  :label="d.name || d.brand || `Système #${d.id}`" />
                <DeviceMoveShare
                  :device="d"
                  :systems="documentSystems"
                  @updated="emit('changed')" />
                <span class="w-px h-5 bg-gray-200 mx-0.5"></span>
                <button @click="dupDevice(d)" class="btn-icon" v-tooltip="'Dupliquer'">
                  <DocumentDuplicateIcon class="w-4 h-4" />
                </button>
                <button @click="removeDevice(d)" class="btn-icon btn-icon-danger" v-tooltip="'Supprimer'">
                  <TrashIcon class="w-4 h-4" />
                </button>
              </div>
            </td>
          </PhotoDropTr>
        </tbody>
      </table>
    </div>

    <!-- Bouton d'ajout unique, pleine largeur : ouvre la modale à 2 onglets
         (bibliothèque préfiltrée + saisie manuelle). -->
    <div class="mt-2">
      <button
        type="button"
        @click="onClickAddDevice"
        class="btn-add"
      >
        <PlusIcon class="w-4 h-4 shrink-0" /> Ajouter un équipement
      </button>
    </div>

    <!-- Modale d'édition détaillée de l'équipement (item 3). -->
    <DeviceEditModal
      v-if="editingDevice"
      :device="editingDevice"
      :system="system"
      :system-label="systemLabel"
      :zone-name="system.zone_name || ''"
      @changed="emit('changed')"
      @close="editingDevice = null"
    />
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
