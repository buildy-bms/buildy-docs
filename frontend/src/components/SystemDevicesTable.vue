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
import PhotoDropzone from './PhotoDropzone.vue'
import ProtocolMultiPicker from './ProtocolMultiPicker.vue'
import BacsRefBadge from './BacsRefBadge.vue'

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
const inputCls = 'w-full text-sm px-2 py-1 border border-gray-200 rounded-sm hover:border-gray-300 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500/30 transition bg-white'
const selectCls = 'w-full text-sm px-2 py-1 border border-gray-200 rounded-sm hover:border-gray-300 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500/30 text-center transition bg-white'
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
  <div class="bg-slate-50 border-t border-gray-200 px-3 py-3">
    <!-- Header avec puissance totale + bouton + vert -->
    <div class="flex items-center justify-between mb-2 flex-wrap gap-2 min-w-0">
      <div class="flex items-center gap-3 text-xs text-gray-600 min-w-0 flex-1">
        <BacsRefBadge kind="systems" :id="system.id" />
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

    <!-- Devices : layout en cards (1 par equipement) plutot qu'une
         table 14 colonnes. Chaque card a 2 rangees d'inputs :
         (1) identification (nom, marque, ref, energie, puissance, loc)
         (2) R175 + protocoles + actions (cable, arret, autonome, etc.) -->
    <div v-if="devices.length" class="space-y-2">
      <PhotoDropzone v-for="d in devices" :key="d.id"
          :site-uuid="siteUuid || ''"
          :attach-to="{ device_id: d.id }"
          :enabled="!!siteUuid"
          @changed="refreshPhotos">
        <div :class="['group bg-white border border-gray-200 rounded-lg p-2.5 transition hover:border-gray-300',
                      d.out_of_service ? 'opacity-50 bg-gray-50' : '']">
          <!-- Ligne 1 : identification (micro-labels au-dessus) -->
          <div class="grid grid-cols-12 gap-2 items-end">
            <div class="col-span-12 md:col-span-3">
              <label class="block text-[10px] uppercase tracking-wider text-gray-500 mb-0.5">Nom</label>
              <input type="text" :value="d.name" placeholder="ex : Chaudière gaz"
                     @blur="e => e.target.value !== (d.name || '') && patchDevice(d, { name: e.target.value || null })"
                     :class="inputCls" class="placeholder:italic placeholder:text-gray-400 font-medium" />
            </div>
            <div class="col-span-6 md:col-span-2">
              <label class="block text-[10px] uppercase tracking-wider text-gray-500 mb-0.5">Marque</label>
              <input type="text" :value="d.brand" placeholder="ex : Atlantic"
                     @blur="e => e.target.value !== (d.brand || '') && patchDevice(d, { brand: e.target.value || null })"
                     :class="inputCls" class="placeholder:italic placeholder:text-gray-400" />
            </div>
            <div class="col-span-6 md:col-span-2">
              <label class="block text-[10px] uppercase tracking-wider text-gray-500 mb-0.5">Référence</label>
              <input type="text" :value="d.model_reference" placeholder="ex : Varmax 70"
                     @blur="e => e.target.value !== (d.model_reference || '') && patchDevice(d, { model_reference: e.target.value || null })"
                     :class="inputCls" class="placeholder:italic placeholder:text-gray-400" />
            </div>
            <div class="col-span-4 md:col-span-1">
              <label class="block text-[10px] uppercase tracking-wider text-gray-500 mb-0.5">Puissance</label>
              <input type="number" min="0" step="0.1" :value="d.power_kw" placeholder="kW"
                     @blur="e => patchDevice(d, { power_kw: e.target.value === '' ? null : parseFloat(e.target.value) })"
                     :class="inputCls" class="text-right placeholder:text-gray-400" />
            </div>
            <div class="col-span-4 md:col-span-2">
              <label class="block text-[10px] uppercase tracking-wider text-gray-500 mb-0.5">Énergie</label>
              <select :value="d.energy_source"
                      @change="e => patchDevice(d, { energy_source: e.target.value || null })"
                      :class="selectCls">
                <option :value="null">—</option>
                <option v-for="o in ENERGY_OPTIONS.filter(x => x.value)" :key="o.value" :value="o.value">{{ o.label }}</option>
              </select>
            </div>
            <div class="col-span-4 md:col-span-2">
              <label class="block text-[10px] uppercase tracking-wider text-gray-500 mb-0.5">Nature</label>
              <select :value="d.device_role"
                      @change="e => patchDevice(d, { device_role: e.target.value || null })"
                      :class="selectCls">
                <option :value="null">—</option>
                <option v-for="o in ROLE_OPTIONS.filter(x => x.value)" :key="o.value" :value="o.value">{{ o.label }}</option>
              </select>
            </div>
          </div>

          <!-- Ligne 2 : localisation + GTB + actions -->
          <div class="mt-3 flex flex-wrap items-center gap-2">
            <div class="flex-1 min-w-32">
              <label class="block text-[10px] uppercase tracking-wider text-gray-500 mb-0.5">Localisation</label>
              <input type="text" :value="d.location" placeholder="ex : Local technique sous-sol"
                     @blur="e => e.target.value !== (d.location || '') && patchDevice(d, { location: e.target.value || null })"
                     :class="inputCls" class="w-full placeholder:italic placeholder:text-gray-400" />
            </div>

            <!-- R175-3 4° + cable comm GTB en pills cliquables -->
            <button type="button"
                    @click="patchDevice(d, { wired: !d.wired })"
                    :class="['pill border', d.wired ? 'tone-success' : 'tone-muted']"
                    title="Communication câblée vers la GTB">
              <span>{{ d.wired ? '✓' : '○' }}</span> Câblé
            </button>
            <button type="button"
                    @click="patchDevice(d, { meets_r175_3_p4: !d.meets_r175_3_p4 })"
                    :class="['pill border', d.meets_r175_3_p4 ? 'tone-success' : 'tone-muted']"
                    title="R175-3 4° — Arrêt manuel possible">
              <span>{{ d.meets_r175_3_p4 ? '✓' : '○' }}</span> Arrêt manuel
            </button>
            <button type="button"
                    @click="patchDevice(d, { meets_r175_3_p4_autonomous: !d.meets_r175_3_p4_autonomous })"
                    :class="['pill border', d.meets_r175_3_p4_autonomous ? 'tone-success' : 'tone-muted']"
                    title="R175-3 4° — Reprise autonome de la GTB">
              <span>{{ d.meets_r175_3_p4_autonomous ? '✓' : '○' }}</span> Autonome
            </button>

            <div class="w-44">
              <ProtocolMultiPicker
                :model-value="d.communication_protocols || (d.communication_protocol && d.communication_protocol !== 'non_communicant' ? JSON.stringify([d.communication_protocol]) : null)"
                :options="COMM_OPTIONS"
                size="xs"
                @update:modelValue="v => patchDevice(d, { communication_protocols: v, communication_protocol: null })"
              />
            </div>

            <button type="button" @click="emit('open-device-notes', d)"
                    :class="['inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded-md border transition',
                      hasNotes(d.notes_html || d.notes)
                        ? 'border-indigo-300 text-indigo-700 bg-indigo-50 hover:bg-indigo-100'
                        : 'border-gray-300 text-gray-600 hover:bg-gray-50']"
                    :title="hasNotes(d.notes_html || d.notes) ? 'Modifier les notes' : 'Ajouter des notes'">
              <PencilSquareIcon class="w-3.5 h-3.5" />
              {{ hasNotes(d.notes_html || d.notes) ? 'Notes' : '+ Notes' }}
            </button>

            <input type="file" accept="image/*" class="hidden"
                   :ref="el => { if (el) fileInputs[d.id] = el }"
                   @change="e => onPhotoSelected({ ...d, system_id: system.id }, e)" />
            <button @click="pickPhotoFor(d.id)"
                    class="inline-flex items-center gap-1 text-gray-500 hover:text-indigo-600 transition px-1.5"
                    :title="`Ajouter une photo (${(photosByDevice[d.id] || []).length} photo${(photosByDevice[d.id] || []).length > 1 ? 's' : ''})`">
              <CameraIcon class="w-4 h-4" />
              <span v-if="(photosByDevice[d.id] || []).length" class="text-[10px] font-mono">
                {{ (photosByDevice[d.id] || []).length }}
              </span>
            </button>

            <label class="inline-flex items-center gap-1 text-[11px] cursor-pointer text-red-600"
                   title="Hors-Service — ignoré dans le plan d'action">
              <input type="checkbox" :checked="!!d.out_of_service"
                     @change="e => patchDevice(d, { out_of_service: e.target.checked })"
                     class="rounded border-gray-300 accent-red-500" />
              HS
            </label>

            <div class="flex items-center gap-1 ml-auto opacity-0 group-hover:opacity-100 transition">
              <button @click="dupDevice(d)" class="text-gray-400 hover:text-indigo-600 p-1 transition" title="Dupliquer">
                <DocumentDuplicateIcon class="w-4 h-4" />
              </button>
              <button @click="removeDevice(d)" class="text-gray-400 hover:text-red-600 p-1 transition" title="Supprimer">
                <TrashIcon class="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </PhotoDropzone>
    </div>
  </div>
</template>
