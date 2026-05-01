<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { TrashIcon, PlusIcon, CameraIcon, PencilSquareIcon, DocumentDuplicateIcon } from '@heroicons/vue/24/outline'
import {
  createBacsDevice, updateBacsDevice, deleteBacsDevice, duplicateBacsDevice,
  listSiteDocuments, uploadSiteDocument, deleteSiteDocument,
  getSiteDocumentDownloadUrl,
} from '@/api'
import { useNotification } from '@/composables/useNotification'
import { useConfirm } from '@/composables/useConfirm'
import PhotoDropTr from './PhotoDropTr.vue'
import ProtocolMultiPicker from './ProtocolMultiPicker.vue'

/**
 * Sous-table éditable des équipements (devices) d'un système BACS donné.
 * Affichée sous chaque ligne (catégorie × zone) de la section 3.
 *
 * Affiche aussi les 3 cases au niveau du système :
 *  - Communicant (R175-3 §3)
 *  - Arrêt manuel possible (R175-3 §4)
 *  - Fonctionnement autonome (R175-3 §4)
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

const ENERGY_OPTIONS = [
  { value: null, label: 'Énergie' },
  { value: 'gas', label: 'Gaz' },
  { value: 'electric', label: 'Électrique' },
  { value: 'wood', label: 'Bois' },
  { value: 'heat_pump', label: 'PAC' },
  { value: 'district_heating', label: 'Réseau de chaleur' },
  { value: 'fuel_oil', label: 'Fioul' },
  { value: 'solar', label: 'Solaire' },
  { value: 'biomass', label: 'Biomasse' },
  { value: 'autre', label: 'Autre' },
]
const ROLE_OPTIONS = [
  { value: null, label: 'Nature' },
  { value: 'production', label: 'Production' },
  { value: 'distribution', label: 'Distribution' },
  { value: 'emission', label: 'Émission' },
  { value: 'regulation', label: 'Régulation' },
  { value: 'autre', label: 'Autre' },
]
const COMM_OPTIONS = [
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

const newDevice = ref({
  name: '', brand: '', model_reference: '', power_kw: null,
  energy_source: null, device_role: null, communication_protocol: null,
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
const inputCls = 'w-full px-1.5 py-1 border border-gray-200 rounded-sm hover:border-gray-300 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500/30 transition bg-white'
const selectCls = 'w-full px-1.5 py-1 border border-gray-200 rounded-sm hover:border-gray-300 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500/30 text-center transition bg-white'
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
      device_role: newDevice.value.device_role,
      communication_protocol: newDevice.value.communication_protocol,
      location: newDevice.value.location || null,
      notes: newDevice.value.notes || null,
    })
    newDevice.value = {
      name: '', brand: '', model_reference: '', power_kw: null,
      energy_source: null, device_role: null, communication_protocol: null,
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
  <div class="bg-gray-50/40 px-3 py-2">
    <!-- Header avec puissance totale + bouton + vert -->
    <div class="flex items-center justify-between mb-2 flex-wrap gap-2 min-w-0">
      <div class="flex items-center gap-3 text-xs text-gray-600 min-w-0 flex-1">
        <span class="font-semibold text-gray-700 truncate">{{ systemLabel }}</span>
        <span v-if="totalPowerKw > 0" class="text-emerald-700 font-mono whitespace-nowrap">
          {{ totalPowerKw }} kW total ({{ devices.length }} {{ devices.length > 1 ? 'systèmes' : 'système' }})
        </span>
        <span v-else class="text-gray-400 italic whitespace-nowrap">aucun système saisi</span>
      </div>
      <button
        type="button"
        @click="emit('add-device', system)"
        class="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-sm whitespace-nowrap shrink-0"
      >
        <PlusIcon class="w-3.5 h-3.5" /> Ajouter un système
      </button>
    </div>

    <!-- Table devices -->
    <table class="w-full text-xs border-collapse">
      <thead v-if="devices.length" class="text-[10px] uppercase text-gray-500 tracking-wider bg-gray-50">
        <tr>
          <th class="text-center py-1.5 px-2 whitespace-nowrap font-semibold border-b border-gray-200 min-w-32">Nom</th>
          <th class="text-center py-1.5 px-2 whitespace-nowrap font-semibold border-b border-gray-200 w-32">Nature</th>
          <th class="text-center py-1.5 px-2 whitespace-nowrap font-semibold border-b border-gray-200 min-w-28">Marque</th>
          <th class="text-center py-1.5 px-2 whitespace-nowrap font-semibold border-b border-gray-200 min-w-28">Référence</th>
          <th class="text-center py-1.5 px-2 whitespace-nowrap font-semibold border-b border-gray-200 w-32">Énergie</th>
          <th class="text-center py-1.5 px-2 whitespace-nowrap font-semibold border-b border-gray-200 w-24">Puissance&nbsp;(kW)</th>
          <th class="text-center py-1.5 px-2 whitespace-nowrap font-semibold border-b border-gray-200 min-w-32">Localisation</th>
          <th class="text-center py-1.5 px-2 whitespace-nowrap font-semibold border-b border-gray-200 w-14" title="Câblé physiquement à la GTB">Câblé</th>
          <th class="text-center py-1.5 px-2 whitespace-nowrap font-semibold border-b border-gray-200 w-44">Communication</th>
          <th class="text-center py-1.5 px-2 whitespace-nowrap font-semibold border-b border-gray-200 w-20" title="R175-3 §4 — L'utilisateur peut arrêter manuellement l'équipement">Arrêt manuel</th>
          <th class="text-center py-1.5 px-2 whitespace-nowrap font-semibold border-b border-gray-200 w-20" title="R175-3 §4 — La GTB reprend automatiquement la main de manière autonome">Autonome</th>
          <th class="text-center py-1.5 px-2 whitespace-nowrap font-semibold border-b border-gray-200 min-w-40">Notes</th>
          <th class="text-center py-1.5 px-2 whitespace-nowrap font-semibold border-b border-gray-200 w-12" title="Équipement Hors-Service — pas d'action corrective générée">HS</th>
          <th class="text-center py-1.5 px-2 font-semibold border-b border-gray-200 w-12" title="Photos rattachées à cet équipement">📷</th>
          <th class="text-center py-1.5 px-2 font-semibold border-b border-gray-200 w-8"></th>
        </tr>
      </thead>
      <tbody>
        <PhotoDropTr v-for="d in devices" :key="d.id"
            :row-class="['group border-b border-gray-100 hover:bg-gray-50/60 transition', d.out_of_service ? 'opacity-50' : ''].join(' ')"
            :site-uuid="siteUuid || ''"
            :attach-to="{ device_id: d.id }"
            :enabled="!!siteUuid"
            @changed="refreshPhotos">
          <td class="py-1 px-1">
            <input type="text" :value="d.name" placeholder="Nom"
                   @blur="e => e.target.value !== (d.name || '') && patchDevice(d, { name: e.target.value || null })"
                   :class="inputCls" class="placeholder:italic placeholder:text-gray-400" />
          </td>
          <td class="py-1 px-1">
            <select :value="d.device_role"
                    @change="e => patchDevice(d, { device_role: e.target.value || null })"
                    :class="selectCls">
              <option v-for="o in ROLE_OPTIONS" :key="o.value || 'null'" :value="o.value">{{ o.label }}</option>
            </select>
          </td>
          <td class="py-1 px-1">
            <input type="text" :value="d.brand" placeholder="Marque"
                   @blur="e => e.target.value !== (d.brand || '') && patchDevice(d, { brand: e.target.value || null })"
                   :class="inputCls" class="placeholder:italic placeholder:text-gray-400" />
          </td>
          <td class="py-1 px-1">
            <input type="text" :value="d.model_reference" placeholder="Référence"
                   @blur="e => e.target.value !== (d.model_reference || '') && patchDevice(d, { model_reference: e.target.value || null })"
                   :class="inputCls" class="placeholder:italic placeholder:text-gray-400" />
          </td>
          <td class="py-1 px-1">
            <select :value="d.energy_source"
                    @change="e => patchDevice(d, { energy_source: e.target.value || null })"
                    :class="selectCls">
              <option v-for="o in ENERGY_OPTIONS" :key="o.value || 'null'" :value="o.value">{{ o.label }}</option>
            </select>
          </td>
          <td class="py-1 px-1">
            <input type="number" min="0" step="0.1" :value="d.power_kw" placeholder="—"
                   @blur="e => patchDevice(d, { power_kw: e.target.value === '' ? null : parseFloat(e.target.value) })"
                   :class="inputCls" class="text-center placeholder:text-gray-400" />
          </td>
          <td class="py-1 px-1">
            <input type="text" :value="d.location" placeholder="Localisation"
                   @blur="e => e.target.value !== (d.location || '') && patchDevice(d, { location: e.target.value || null })"
                   :class="inputCls" class="placeholder:italic placeholder:text-gray-400" />
          </td>
          <td class="py-1 px-1 text-center">
            <input type="checkbox" :checked="!!d.wired"
                   @change="e => patchDevice(d, { wired: e.target.checked })"
                   class="rounded border-gray-300"
                   title="Câblé physiquement à la GTB" />
          </td>
          <td class="py-1 px-1">
            <ProtocolMultiPicker
              :model-value="d.communication_protocols || (d.communication_protocol && d.communication_protocol !== 'non_communicant' ? JSON.stringify([d.communication_protocol]) : null)"
              :options="COMM_OPTIONS"
              size="xs"
              @update:modelValue="v => patchDevice(d, { communication_protocols: v, communication_protocol: null })"
            />
          </td>
          <td class="py-1 px-1 text-center">
            <input type="checkbox" :checked="!!d.meets_r175_3_p4"
                   @change="e => patchDevice(d, { meets_r175_3_p4: e.target.checked })"
                   class="rounded border-gray-300" />
          </td>
          <td class="py-1 px-1 text-center">
            <input type="checkbox" :checked="!!d.meets_r175_3_p4_autonomous"
                   @change="e => patchDevice(d, { meets_r175_3_p4_autonomous: e.target.checked })"
                   class="rounded border-gray-300" />
          </td>
          <td class="py-1 px-1 text-center">
            <button
              type="button"
              @click="emit('open-device-notes', d)"
              :class="['inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded border transition',
                hasNotes(d.notes_html || d.notes)
                  ? 'border-indigo-300 text-indigo-700 bg-indigo-50 hover:bg-indigo-100'
                  : 'border-gray-300 text-gray-500 hover:bg-gray-50']"
              :title="hasNotes(d.notes_html || d.notes) ? 'Modifier les notes' : 'Ajouter des notes'"
            >
              <PencilSquareIcon class="w-3.5 h-3.5" />
              {{ hasNotes(d.notes_html || d.notes) ? 'Notes' : '+ Notes' }}
            </button>
          </td>
          <td class="py-1 px-1 text-center">
            <input type="checkbox" :checked="!!d.out_of_service"
                   @change="e => patchDevice(d, { out_of_service: e.target.checked })"
                   class="rounded border-gray-300 accent-red-500" />
          </td>
          <td class="py-1 px-1 text-center">
            <input type="file" accept="image/*" class="hidden"
                   :ref="el => { if (el) fileInputs[d.id] = el }"
                   @change="e => onPhotoSelected({ ...d, system_id: system.id }, e)" />
            <button @click="pickPhotoFor(d.id)"
                    class="inline-flex items-center gap-1 text-gray-500 hover:text-indigo-600 transition"
                    :title="`Ajouter une photo (${(photosByDevice[d.id] || []).length} photo${(photosByDevice[d.id] || []).length > 1 ? 's' : ''})`">
              <CameraIcon class="w-3.5 h-3.5" />
              <span v-if="(photosByDevice[d.id] || []).length" class="text-[10px] font-mono">
                {{ (photosByDevice[d.id] || []).length }}
              </span>
            </button>
          </td>
          <td class="py-1 px-1 text-center">
            <button @click="dupDevice(d)" class="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-indigo-600 transition mr-1" title="Dupliquer">
              <DocumentDuplicateIcon class="w-3.5 h-3.5" />
            </button>
            <button @click="removeDevice(d)" class="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-600 transition" title="Supprimer">
              <TrashIcon class="w-3.5 h-3.5" />
            </button>
          </td>
        </PhotoDropTr>
      </tbody>
    </table>
  </div>
</template>
