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
import PhotoDropzone from './PhotoDropzone.vue'
import ProtocolMultiPicker from './ProtocolMultiPicker.vue'
import SearchableSelect from './SearchableSelect.vue'

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

// Source partagee : lib/audit-options.js (icones + couleurs synchronises)
import { ENERGY_OPTIONS, ROLE_OPTIONS, COMM_OPTIONS } from '@/lib/audit-options'

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

    <!-- Devices : layout dense 2 rangées (specs + GTB) avec header
         dédié à droite pour les méta-actions (Notes / Photo / HS) afin
         de ne plus mélanger ces actions au flux d'édition.
         PhotoDropzone wrap chaque card → drops scoped au système. -->
    <div v-if="devices.length" class="space-y-2">
      <PhotoDropzone v-for="d in devices" :key="d.id"
          :site-uuid="siteUuid || ''"
          :attach-to="{ device_id: d.id }"
          :enabled="!!siteUuid"
          @changed="refreshPhotos">
        <div :class="['group bg-white border border-gray-200 rounded-lg px-3 py-2.5 hover:border-gray-300 transition',
                      d.out_of_service ? 'opacity-60 bg-gray-50' : '']">
          <!-- HEADER : nom dominant + méta-actions alignées à droite -->
          <div class="flex items-center gap-2 mb-2">
            <div class="flex-1 min-w-0">
              <input type="text" :value="d.name" placeholder="Nommer ce système (ex : Chaudière gaz principale)"
                     @blur="e => e.target.value !== (d.name || '') && patchDevice(d, { name: e.target.value || null })"
                     class="w-full text-[15px] font-semibold text-gray-900 bg-transparent border-0 px-0 focus:outline-none focus:ring-0 placeholder:font-normal placeholder:text-gray-300 placeholder:italic" />
            </div>
            <div class="flex items-center gap-1.5 shrink-0">
              <button type="button" @click="emit('open-device-notes', d)"
                      :class="['inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md border transition',
                        hasNotes(d.notes_html || d.notes)
                          ? 'border-indigo-200 text-indigo-700 bg-indigo-50 hover:bg-indigo-100'
                          : 'border-gray-200 text-gray-500 bg-white hover:border-gray-300 hover:text-gray-700']"
                      :title="hasNotes(d.notes_html || d.notes) ? 'Modifier les notes' : 'Ajouter une note'">
                <PencilSquareIcon class="w-3.5 h-3.5" />
                <span v-if="hasNotes(d.notes_html || d.notes)">Notes</span>
                <span v-else>+ Notes</span>
              </button>
              <input type="file" accept="image/*" class="hidden"
                     :ref="el => { if (el) fileInputs[d.id] = el }"
                     @change="e => onPhotoSelected({ ...d, system_id: system.id }, e)" />
              <button @click="pickPhotoFor(d.id)"
                      :class="['inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md border transition',
                               (photosByDevice[d.id] || []).length
                                 ? 'border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100'
                                 : 'border-gray-200 text-gray-500 bg-white hover:border-gray-300 hover:text-gray-700']"
                      :title="`${(photosByDevice[d.id] || []).length} photo${(photosByDevice[d.id] || []).length > 1 ? 's' : ''}`">
                <CameraIcon class="w-3.5 h-3.5" />
                <span v-if="(photosByDevice[d.id] || []).length">{{ (photosByDevice[d.id] || []).length }}</span>
                <span v-else>+ Photo</span>
              </button>
              <!-- HS = pill cohérente avec Câblé/Arrêt manuel/Autonome,
                   mais semantique destructive (rouge si actif) -->
              <button type="button"
                      @click="patchDevice(d, { out_of_service: !d.out_of_service })"
                      :class="['flag-pill', d.out_of_service ? 'flag-danger-on' : 'flag-off']"
                      title="Hors service — ignoré dans le plan d'action">
                <span class="flag-ico">{{ d.out_of_service ? '✕' : '○' }}</span> HS
              </button>
              <span class="w-px h-5 bg-gray-200 mx-0.5"></span>
              <button @click="dupDevice(d)" class="text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 p-1 rounded transition" title="Dupliquer">
                <DocumentDuplicateIcon class="w-4 h-4" />
              </button>
              <button @click="removeDevice(d)" class="text-gray-400 hover:text-red-600 hover:bg-red-50 p-1 rounded transition" title="Supprimer">
                <TrashIcon class="w-4 h-4" />
              </button>
            </div>
          </div>

          <!-- LIGNE 1 : Marque + Référence + Puissance + Énergie + Rôle -->
          <div class="grid grid-cols-12 gap-2 items-end">
            <div class="col-span-6 md:col-span-3">
              <label class="block text-[10px] font-medium uppercase tracking-wide text-gray-400 mb-0.5">Marque</label>
              <input type="text" :value="d.brand" placeholder="Atlantic"
                     @blur="e => e.target.value !== (d.brand || '') && patchDevice(d, { brand: e.target.value || null })"
                     :class="inputCls" class="placeholder:italic placeholder:text-gray-300" />
            </div>
            <div class="col-span-6 md:col-span-3">
              <label class="block text-[10px] font-medium uppercase tracking-wide text-gray-400 mb-0.5">Référence</label>
              <input type="text" :value="d.model_reference" placeholder="Varmax 70"
                     @blur="e => e.target.value !== (d.model_reference || '') && patchDevice(d, { model_reference: e.target.value || null })"
                     :class="inputCls" class="placeholder:italic placeholder:text-gray-300" />
            </div>
            <div class="col-span-3 md:col-span-2">
              <label class="block text-[10px] font-medium uppercase tracking-wide text-gray-400 mb-0.5">Puiss.</label>
              <div class="relative">
                <input type="number" min="0" step="0.1" :value="d.power_kw" placeholder="—"
                       @blur="e => patchDevice(d, { power_kw: e.target.value === '' ? null : parseFloat(e.target.value) })"
                       :class="inputCls" class="text-right pr-7 placeholder:text-gray-300" />
                <span class="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-gray-400 pointer-events-none">kW</span>
              </div>
            </div>
            <div class="col-span-4 md:col-span-2">
              <label class="block text-[10px] font-medium uppercase tracking-wide text-gray-400 mb-0.5">Énergie</label>
              <SearchableSelect
                :model-value="d.energy_source"
                @update:model-value="v => patchDevice(d, { energy_source: v || null })"
                :options="ENERGY_OPTIONS"
                :clearable="false"
                size="sm"
                placeholder="Énergie"
              />
            </div>
            <div class="col-span-5 md:col-span-2">
              <label class="block text-[10px] font-medium uppercase tracking-wide text-gray-400 mb-0.5">Rôle</label>
              <SearchableSelect
                :model-value="d.device_role"
                @update:model-value="v => patchDevice(d, { device_role: v || null })"
                :options="ROLE_OPTIONS"
                :clearable="false"
                size="sm"
                placeholder="Rôle"
              />
            </div>
          </div>

          <!-- LIGNE 2 : Localisation (4/12) + Liaison GTB (auto) + Protocoles
               (le reste). Grid 12 colonnes cohérent avec la ligne 1, plus
               de flex-1 qui étirait Localisation sur toute la largeur. -->
          <div class="mt-2 grid grid-cols-12 gap-x-3 gap-y-2 items-start">
            <div class="col-span-12 md:col-span-4">
              <label class="block text-[10px] font-medium uppercase tracking-wide text-gray-400 mb-0.5">Localisation</label>
              <input type="text" :value="d.location" placeholder="ex : Local technique sous-sol, Toiture…"
                     @blur="e => e.target.value !== (d.location || '') && patchDevice(d, { location: e.target.value || null })"
                     :class="inputCls" class="placeholder:italic placeholder:text-gray-300" />
            </div>
            <div class="col-span-12 md:col-span-4">
              <label class="block text-[10px] font-medium uppercase tracking-wide text-gray-400 mb-0.5">Liaison GTB</label>
              <div class="flex items-center gap-1.5 h-7">
                <button type="button"
                        @click="patchDevice(d, { wired: !d.wired })"
                        :class="['flag-pill', d.wired ? 'flag-on' : 'flag-off']"
                        title="Communication câblée vers la GTB">
                  <span class="flag-ico">{{ d.wired ? '✓' : '✗' }}</span> Câblé
                </button>
                <button type="button"
                        @click="patchDevice(d, { meets_r175_3_p4: !d.meets_r175_3_p4 })"
                        :class="['flag-pill', d.meets_r175_3_p4 ? 'flag-on' : 'flag-off']"
                        title="R175-3 4° — Arrêt manuel possible">
                  <span class="flag-ico">{{ d.meets_r175_3_p4 ? '✓' : '✗' }}</span> Arrêt manuel
                </button>
                <button type="button"
                        @click="patchDevice(d, { meets_r175_3_p4_autonomous: !d.meets_r175_3_p4_autonomous })"
                        :class="['flag-pill', d.meets_r175_3_p4_autonomous ? 'flag-on' : 'flag-off']"
                        title="R175-3 4° — Reprise autonome de la GTB">
                  <span class="flag-ico">{{ d.meets_r175_3_p4_autonomous ? '✓' : '✗' }}</span> Autonome
                </button>
              </div>
            </div>
            <div class="col-span-12 md:col-span-4">
              <label class="block text-[10px] font-medium uppercase tracking-wide text-gray-400 mb-0.5">Protocole(s)</label>
              <ProtocolMultiPicker
                :model-value="d.communication_protocols || (d.communication_protocol && d.communication_protocol !== 'non_communicant' ? JSON.stringify([d.communication_protocol]) : null)"
                :options="COMM_OPTIONS"
                size="xs"
                placeholder="Aucun"
                @update:modelValue="v => patchDevice(d, { communication_protocols: v, communication_protocol: null })"
              />
            </div>
          </div>
        </div>
      </PhotoDropzone>
    </div>
  </div>
</template>
