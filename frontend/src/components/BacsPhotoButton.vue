<script setup>
import { ref, onMounted, onBeforeUnmount, watch, computed } from 'vue'
import { CameraIcon, TrashIcon, XMarkIcon, ArrowDownTrayIcon } from '@heroicons/vue/24/outline'
import {
  listSiteDocuments,
  uploadSiteDocument,
  deleteSiteDocument,
  updateSiteDocument,
  getSiteDocumentDownloadUrl,
} from '@/api'
import { useNotification } from '@/composables/useNotification'

/**
 * Bouton compact (icone camera + compteur) qui sert aussi de zone de drop
 * pour les photos. Au drop / au clic + selection : upload immediat, puis
 * une modal demande titre/description par photo et affiche la miniature.
 *
 * Toutes les photos passent par site_documents (categorie 'photo') avec
 * le site_uuid + une FK selon attachTo. Le backend resize a 1600px max
 * et convertit en JPEG q=82 (sharp).
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
const isDragOver = ref(false)
const dragDepth = ref(0) // counter pour eviter le flicker dragenter/dragleave sur enfants
const captionModal = ref({ open: false, photos: [] }) // photos = [{ id, dataUrl, title, notes }]
const previewPhoto = ref(null)
const rootEl = ref(null)

function onDocClick(e) {
  if (!showGallery.value) return
  if (rootEl.value && !rootEl.value.contains(e.target)) {
    showGallery.value = false
  }
}

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
  } catch {
    notifyError('Erreur chargement photos')
  } finally {
    loading.value = false
  }
}

function onDocsChanged() { refresh() }
onMounted(() => {
  refresh()
  window.addEventListener('site-documents:changed', onDocsChanged)
  document.addEventListener('mousedown', onDocClick)
})
onBeforeUnmount(() => {
  window.removeEventListener('site-documents:changed', onDocsChanged)
  document.removeEventListener('mousedown', onDocClick)
})
watch(() => filterParams.value, refresh, { deep: true })

function pickFile() {
  fileInput.value?.click()
}

async function uploadFiles(files) {
  if (!files.length) return
  uploading.value = true
  const uploaded = []
  try {
    for (const f of files) {
      const fd = new FormData()
      fd.append('file', f)
      const defaultTitle = f.name.replace(/\.[^.]+$/, '')
      const { data } = await uploadSiteDocument(props.siteUuid, fd, {
        title: defaultTitle,
        category: 'photo',
        ...filterParams.value,
      })
      uploaded.push({
        id: data.id,
        dataUrl: getSiteDocumentDownloadUrl(data.id),
        title: defaultTitle,
        notes: '',
      })
    }
    success(files.length > 1 ? `${files.length} photos televersees` : 'Photo televersee')
    window.dispatchEvent(new CustomEvent('site-documents:changed'))
    await refresh()
    emit('changed')
    // On ouvre la modal pour ajouter titre + notes par photo
    captionModal.value = { open: true, photos: uploaded }
  } catch (err) {
    notifyError(err.response?.data?.detail || 'Echec upload photo')
  } finally {
    uploading.value = false
    if (fileInput.value) fileInput.value.value = ''
  }
}

async function onFileChosen(e) {
  const files = Array.from(e.target.files || [])
  await uploadFiles(files)
}

// Expose pour que la ligne parent puisse forwarder un drop sans
// devoir recreer le composant. Permet de transformer une ligne complete
// (zone, systeme, compteur, device, GTB) en zone de drop.
defineExpose({ uploadFiles, refresh })

async function onDrop(e) {
  isDragOver.value = false
  dragDepth.value = 0
  const files = Array.from(e.dataTransfer?.files || []).filter(f => f.type.startsWith('image/'))
  if (!files.length) {
    notifyError('Glisse uniquement des fichiers image')
    return
  }
  await uploadFiles(files)
}

function onDragEnter(e) {
  // Counter approach : empeche le flicker quand le drag passe d'un enfant
  // a l'autre (chaque transition genere un dragleave + dragenter alterne).
  if (!e.dataTransfer?.types?.includes('Files')) return
  dragDepth.value++
  isDragOver.value = true
}
function onDragLeave() {
  dragDepth.value = Math.max(0, dragDepth.value - 1)
  if (dragDepth.value === 0) isDragOver.value = false
}
function onDragOver(e) { /* no-op : juste pour autoriser le drop */ }

async function removePhoto(p) {
  if (!confirm('Supprimer cette photo ?')) return
  try {
    await deleteSiteDocument(p.id)
    await refresh()
    emit('changed')
  } catch {
    notifyError('Echec suppression')
  }
}

function thumbUrl(p) {
  return getSiteDocumentDownloadUrl(p.id)
}

async function saveCaptions() {
  // Sauvegarde uniquement les photos dont le titre a change ou qui ont des notes
  try {
    for (const p of captionModal.value.photos) {
      const updates = {}
      if (p.title) updates.title = p.title
      // Pas de champ 'notes' sur site_documents — on ne propage que le titre.
      // (les notes du contexte parent sont sur la zone/systeme/etc)
      if (Object.keys(updates).length) {
        await updateSiteDocument(p.id, updates)
      }
    }
    captionModal.value.open = false
    await refresh()
    success('Photos enregistrees')
  } catch (err) {
    notifyError('Sauvegarde des libelles impossible')
  }
}

const btnCls = computed(() => {
  const base = 'inline-flex items-center gap-1 rounded-md border transition-all'
  const size = props.size === 'md'
    ? 'px-2.5 py-1 text-xs'
    : 'px-2 py-0.5 text-[11px]'
  if (isDragOver.value) return `${base} ${size} border-indigo-500 bg-indigo-100 text-indigo-700 ring-2 ring-indigo-300 scale-105`
  const tone = photos.value.length
    ? 'border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100'
    : 'border-gray-300 text-gray-600 hover:bg-gray-50'
  return `${base} ${size} ${tone}`
})
</script>

<template>
  <div class="relative inline-block" ref="rootEl">
    <button
      type="button"
      :class="btnCls"
      :title="label ? `Photos - ${label} (clic pour ouvrir / glisse-depose pour ajouter)` : 'Photos'"
      @click="showGallery = !showGallery"
      @dragover.prevent="onDragOver"
      @dragenter.prevent="onDragEnter"
      @dragleave.prevent="onDragLeave"
      @drop.prevent="onDrop"
    >
      <CameraIcon :class="['transition-all', isDragOver ? 'w-5 h-5' : 'w-4 h-4']" />
      <span v-if="photos.length && !isDragOver" class="font-medium">{{ photos.length }}</span>
      <span v-if="isDragOver" class="font-semibold text-[11px] whitespace-nowrap">Deposer ici</span>
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
        Aucune photo. Glisse des images sur l'icone ou clique sur <strong>+ Ajouter</strong>.
      </div>
      <div v-else class="grid grid-cols-3 gap-1.5">
        <div v-for="p in photos" :key="p.id" class="relative group">
          <button type="button" @click="previewPhoto = p" class="block w-full">
            <img :src="thumbUrl(p)" :alt="p.title || p.original_name || 'Photo'"
                 loading="lazy" decoding="async"
                 class="w-full h-16 object-cover rounded border border-gray-200 hover:border-indigo-400 transition cursor-zoom-in" />
          </button>
          <button
            @click="removePhoto(p)"
            class="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-600 text-white opacity-0 group-hover:opacity-100 hover:bg-red-700 transition flex items-center justify-center"
            title="Supprimer"
          >
            <TrashIcon class="w-3 h-3" />
          </button>
          <p v-if="p.title" class="text-[9px] text-gray-500 truncate mt-0.5" :title="p.title">{{ p.title }}</p>
        </div>
      </div>

      <button
        @click="showGallery = false"
        class="mt-2 w-full text-[11px] text-gray-500 hover:text-gray-700"
      >Fermer</button>
    </div>

    <!-- Modal captions apres upload -->
    <div
      v-if="captionModal.open"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      @click.self="captionModal.open = false"
    >
      <div class="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        <header class="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h3 class="text-base font-semibold text-gray-900">
              {{ captionModal.photos.length }} photo{{ captionModal.photos.length > 1 ? 's' : '' }} televersee{{ captionModal.photos.length > 1 ? 's' : '' }}
            </h3>
            <p class="text-xs text-gray-500 mt-0.5">
              Ajoute un titre court a chaque photo (visible dans le PDF d'audit).
              {{ label ? `Contexte : ${label}.` : '' }}
            </p>
          </div>
          <button @click="captionModal.open = false" class="p-1 rounded hover:bg-gray-100 text-gray-500">
            <XMarkIcon class="w-5 h-5" />
          </button>
        </header>

        <div class="flex-1 overflow-y-auto p-5 space-y-4">
          <div
            v-for="(p, idx) in captionModal.photos"
            :key="p.id"
            class="flex items-start gap-4 p-3 border border-gray-200 rounded-lg"
          >
            <img :src="p.dataUrl" :alt="p.title || 'Photo'"
                 loading="lazy" decoding="async"
                 class="w-32 h-24 object-cover rounded border border-gray-200 shrink-0" />
            <div class="flex-1 min-w-0">
              <label class="block text-xs font-medium text-gray-700 mb-1">
                Titre <span class="text-gray-400">({{ idx + 1 }} / {{ captionModal.photos.length }})</span>
              </label>
              <input
                v-model="p.title"
                type="text"
                placeholder="ex : Vue d'ensemble armoire electrique"
                class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500"
              />
            </div>
          </div>
        </div>

        <footer class="px-5 py-3 border-t border-gray-200 flex items-center justify-end gap-2 bg-gray-50">
          <button
            @click="captionModal.open = false"
            class="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition"
          >
            Plus tard
          </button>
          <button
            @click="saveCaptions"
            class="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition shadow-sm"
          >
            Enregistrer
          </button>
        </footer>
      </div>
    </div>

    <!-- Lightbox preview -->
    <div v-if="previewPhoto"
         class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
         @click.self="previewPhoto = null">
      <div class="relative max-w-6xl max-h-[90vh] w-full flex flex-col">
        <header class="flex items-center justify-between text-white mb-3">
          <div class="min-w-0 flex-1">
            <h3 class="text-base font-semibold truncate">{{ previewPhoto.title || previewPhoto.original_name }}</h3>
            <p v-if="label" class="text-xs opacity-70 truncate">{{ label }}</p>
          </div>
          <a :href="getSiteDocumentDownloadUrl(previewPhoto.id)" :download="previewPhoto.original_name || previewPhoto.title"
             class="ml-4 px-3 py-1.5 text-xs font-medium text-white border border-white/40 rounded hover:bg-white/10 inline-flex items-center gap-1">
            <ArrowDownTrayIcon class="w-4 h-4" /> Télécharger
          </a>
          <button @click="previewPhoto = null" class="ml-2 p-2 text-white hover:bg-white/10 rounded">
            <XMarkIcon class="w-5 h-5" />
          </button>
        </header>
        <img :src="getSiteDocumentDownloadUrl(previewPhoto.id)" :alt="previewPhoto.title || 'Photo'"
             decoding="async"
             class="max-h-[80vh] mx-auto object-contain rounded shadow-2xl" />
      </div>
    </div>
  </div>
</template>
