<script setup>
import { ref, computed } from 'vue'
import { XMarkIcon, ArrowUpTrayIcon, PhotoIcon } from '@heroicons/vue/24/outline'
import { bulkUploadSitePhotos, updateSiteDocument, getSiteDocumentDownloadUrl } from '@/api'
import { useNotification } from '@/composables/useNotification'

const props = defineProps({
  open: { type: Boolean, default: false },
  siteUuid: { type: String, required: true },
  zones: { type: Array, default: () => [] },
  systems: { type: Array, default: () => [] },
  devices: { type: Array, default: () => [] },
  meters: { type: Array, default: () => [] },
})
const emit = defineEmits(['close', 'uploaded'])
const { success, error } = useNotification()

const files = ref([])
const uploading = ref(false)
const progress = ref(0)
const photos = ref([])

const fileInput = ref(null)
function pickFiles() { fileInput.value?.click() }
function onFiles(e) {
  const list = Array.from(e.target.files || [])
  files.value = list
}

async function startUpload() {
  if (!files.value.length) return
  uploading.value = true
  progress.value = 0
  try {
    const { data } = await bulkUploadSitePhotos(props.siteUuid, files.value,
      (e) => { if (e.total) progress.value = Math.round(100 * e.loaded / e.total) })
    photos.value = data.photos.map(p => ({ ...p, mapping: '' }))
    files.value = []
    if (data.errors?.length) error(`${data.errors.length} photo(s) ignorée(s)`)
    success(`${data.photos.length} photo(s) importée(s), triée(s) par horodatage`)
  } catch (e) {
    error(e.response?.data?.detail || 'Échec de l\'import en masse')
  } finally {
    uploading.value = false
  }
}

// Options de mapping : <kind>:<id>
const mappingOptions = computed(() => {
  const out = []
  for (const z of props.zones) out.push({ value: `zone:${z.zone_id}`, label: `Zone — ${z.name}` })
  for (const s of props.systems) {
    const z = props.zones.find(zz => zz.zone_id === s.zone_id)
    out.push({ value: `system:${s.id}`, label: `Système ${s.system_category}${z ? ' / ' + z.name : ''}` })
  }
  for (const d of props.devices) {
    const sys = props.systems.find(s => s.id === d.system_id)
    out.push({ value: `device:${d.id}`, label: `Équipement #${d.id}${sys ? ' (' + sys.system_category + ')' : ''}` })
  }
  for (const m of props.meters) out.push({ value: `meter:${m.id}`, label: `Compteur ${m.usage} ${m.meter_type}` })
  return out
})

async function applyMapping(photo) {
  if (!photo.mapping) return
  const [kind, idStr] = photo.mapping.split(':')
  const id = parseInt(idStr, 10)
  const patch = {}
  if (kind === 'zone') patch.bacs_audit_zone_id = id
  if (kind === 'system') patch.bacs_audit_system_id = id
  if (kind === 'device') patch.bacs_audit_device_id = id
  if (kind === 'meter') patch.bacs_audit_meter_id = id
  try {
    await updateSiteDocument(photo.id, patch)
    photo.applied = true
  } catch (e) {
    error(`Échec de l'affectation de ${photo.original_name}`)
  }
}

function close() {
  emit('close')
  if (photos.value.length) emit('uploaded')
  files.value = []
  photos.value = []
  progress.value = 0
}
</script>

<template>
  <div v-if="open" class="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
    <div class="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
      <header class="flex items-center justify-between px-5 py-3 border-b border-gray-200">
        <div class="flex items-center gap-2">
          <PhotoIcon class="w-5 h-5 text-indigo-600" />
          <h2 class="text-base font-semibold text-gray-800">Import massif de photos terrain</h2>
        </div>
        <button @click="close" class="text-gray-400 hover:text-gray-600"><XMarkIcon class="w-5 h-5" /></button>
      </header>

      <div class="flex-1 overflow-y-auto p-5 space-y-4">
        <div v-if="!photos.length" class="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
          <PhotoIcon class="w-10 h-10 mx-auto text-gray-300 mb-2" />
          <p class="text-sm text-gray-600 mb-3">
            Sélectionnez toutes les photos prises sur site. Elles seront optimisées,<br />
            l'horodatage EXIF lu et triées par ordre chronologique.
          </p>
          <input ref="fileInput" type="file" accept="image/*" multiple class="hidden" @change="onFiles" />
          <button @click="pickFiles"
            class="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
            <ArrowUpTrayIcon class="w-4 h-4" /> Choisir des photos
          </button>
          <p v-if="files.length" class="mt-3 text-xs text-gray-500">{{ files.length }} fichier(s) sélectionné(s)</p>
          <button v-if="files.length" :disabled="uploading" @click="startUpload"
            class="mt-3 inline-flex items-center gap-1.5 px-4 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-60">
            <ArrowUpTrayIcon class="w-4 h-4" /> {{ uploading ? `Import ${progress}%` : 'Lancer l\'import' }}
          </button>
        </div>

        <div v-if="photos.length" class="space-y-3">
          <p class="text-xs text-gray-600">
            {{ photos.length }} photos triées par horodatage. Affectez chacune à une zone/système/compteur,
            ou laissez vide (ce sont alors des photos de site génériques).
          </p>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div v-for="p in photos" :key="p.id" class="flex gap-3 border border-gray-200 rounded-lg p-2 items-start"
              :class="{ 'bg-emerald-50 border-emerald-200': p.applied }">
              <img :src="getSiteDocumentDownloadUrl(p.id)" :alt="p.original_name"
                class="w-20 h-20 object-cover rounded border border-gray-200 shrink-0" loading="lazy" />
              <div class="flex-1 min-w-0">
                <div class="text-xs font-mono text-gray-500 truncate">{{ p.taken_at || p.uploaded_at }}</div>
                <div class="text-xs text-gray-700 truncate">{{ p.original_name }}</div>
                <select v-model="p.mapping" @change="applyMapping(p)"
                  class="mt-1 w-full text-xs border border-gray-200 rounded px-1.5 py-1">
                  <option value="">Aucune affectation (photo générale)</option>
                  <option v-for="o in mappingOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      </div>

      <footer class="border-t border-gray-200 px-5 py-3 flex justify-end">
        <button @click="close"
          class="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200">
          {{ photos.length ? 'Terminer' : 'Annuler' }}
        </button>
      </footer>
    </div>
  </div>
</template>
