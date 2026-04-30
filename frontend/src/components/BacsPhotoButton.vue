<script setup>
import { ref, onMounted, watch, computed } from 'vue'
import { CameraIcon, TrashIcon } from '@heroicons/vue/24/outline'
import {
  listSiteDocuments,
  uploadSiteDocument,
  deleteSiteDocument,
  getSiteDocumentDownloadUrl,
} from '@/api'
import { useNotification } from '@/composables/useNotification'

/**
 * Bouton compact (icone camera + compteur) qui ouvre une mini-galerie
 * inline pour ajouter / supprimer / agrandir des photos rattachees a une
 * zone, un compteur, une GTB, un systeme ou un device d'audit BACS.
 *
 * Toutes les photos passent par site_documents (categorie 'photo') avec le
 * site_uuid + une FK selon attachTo. Le backend resize a 1600px max et
 * convertit en JPEG q=82 (sharp).
 */
const props = defineProps({
  siteUuid: { type: String, required: true },
  attachTo: { type: Object, required: true },
  // Suffixe pour le titre par defaut ("Photo - <label>") + tooltip
  label: { type: String, default: '' },
  size: { type: String, default: 'sm' }, // 'sm' | 'md'
})

const emit = defineEmits(['changed'])

const { success, error: notifyError } = useNotification()
const photos = ref([])
const loading = ref(false)
const showGallery = ref(false)
const fileInput = ref(null)
const uploading = ref(false)

const filterParams = computed(() => {
  const p = {}
  if (props.attachTo.zone_id != null)         p.bacs_audit_zone_id = props.attachTo.zone_id
  if (props.attachTo.meter_id != null)        p.bacs_audit_meter_id = props.attachTo.meter_id
  if (props.attachTo.system_id != null)       p.bacs_audit_system_id = props.attachTo.system_id
  if (props.attachTo.device_id != null)       p.bacs_audit_device_id = props.attachTo.device_id
  if (props.attachTo.bms_document_id != null) p.bacs_audit_bms_document_id = props.attachTo.bms_document_id
  return p
})

async function refresh() {
  if (!props.siteUuid) return
  loading.value = true
  try {
    const { data } = await listSiteDocuments(props.siteUuid, filterParams.value)
    photos.value = (data || []).filter(d => d.category === 'photo')
  } catch (err) {
    notifyError('Erreur chargement photos')
  } finally {
    loading.value = false
  }
}

onMounted(refresh)
watch(() => filterParams.value, refresh, { deep: true })

function pickFile() {
  fileInput.value?.click()
}

async function onFileChosen(e) {
  const files = Array.from(e.target.files || [])
  if (!files.length) return
  uploading.value = true
  try {
    for (const f of files) {
      const fd = new FormData()
      fd.append('file', f)
      await uploadSiteDocument(props.siteUuid, fd, {
        title: f.name.replace(/\.[^.]+$/, ''),
        category: 'photo',
        ...filterParams.value,
      })
    }
    success(files.length > 1 ? `${files.length} photos ajoutees` : 'Photo ajoutee')
    await refresh()
    emit('changed')
  } catch (err) {
    notifyError(err.response?.data?.detail || 'Echec upload photo')
  } finally {
    uploading.value = false
    if (fileInput.value) fileInput.value.value = ''
  }
}

async function removePhoto(p) {
  if (!confirm('Supprimer cette photo ?')) return
  try {
    await deleteSiteDocument(p.id)
    await refresh()
    emit('changed')
  } catch (err) {
    notifyError('Echec suppression')
  }
}

function thumbUrl(p) {
  return getSiteDocumentDownloadUrl(p.id)
}

const btnCls = computed(() => {
  const base = 'inline-flex items-center gap-1 rounded-md border transition'
  const size = props.size === 'md'
    ? 'px-2.5 py-1 text-xs'
    : 'px-2 py-0.5 text-[11px]'
  const tone = photos.value.length
    ? 'border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100'
    : 'border-gray-300 text-gray-600 hover:bg-gray-50'
  return `${base} ${size} ${tone}`
})
</script>

<template>
  <div class="relative inline-block">
    <button
      type="button"
      :class="btnCls"
      :title="label ? `Photos - ${label}` : 'Photos'"
      @click="showGallery = !showGallery"
    >
      <CameraIcon class="w-4 h-4" />
      <span v-if="photos.length" class="font-medium">{{ photos.length }}</span>
    </button>

    <input
      ref="fileInput"
      type="file"
      accept="image/*"
      multiple
      class="hidden"
      @change="onFileChosen"
    />

    <!-- Galerie inline (popover) -->
    <div
      v-if="showGallery"
      class="absolute right-0 top-full mt-1 z-30 w-72 bg-white border border-gray-200 rounded-lg shadow-xl p-3"
      @click.stop
    >
      <div class="flex items-center justify-between mb-2">
        <span class="text-xs font-medium text-gray-700">
          Photos {{ label ? `- ${label}` : '' }}
        </span>
        <button
          @click="pickFile"
          :disabled="uploading"
          class="px-2 py-0.5 text-[11px] font-medium rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {{ uploading ? 'Envoi…' : '+ Ajouter' }}
        </button>
      </div>

      <div v-if="loading" class="text-center text-xs text-gray-500 py-3">Chargement…</div>
      <div v-else-if="!photos.length" class="text-center text-xs text-gray-500 py-3 italic">
        Aucune photo. Clique sur <strong>+ Ajouter</strong> pour en prendre / televerser.
      </div>
      <div v-else class="grid grid-cols-3 gap-1.5">
        <div v-for="p in photos" :key="p.id" class="relative group">
          <a :href="thumbUrl(p)" target="_blank" class="block">
            <img :src="thumbUrl(p)" :alt="p.original_name"
                 class="w-full h-16 object-cover rounded border border-gray-200" />
          </a>
          <button
            @click="removePhoto(p)"
            class="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-600 text-white opacity-0 group-hover:opacity-100 hover:bg-red-700 transition flex items-center justify-center"
            title="Supprimer"
          >
            <TrashIcon class="w-3 h-3" />
          </button>
        </div>
      </div>

      <button
        @click="showGallery = false"
        class="mt-2 w-full text-[11px] text-gray-500 hover:text-gray-700"
      >Fermer</button>
    </div>
  </div>
</template>
