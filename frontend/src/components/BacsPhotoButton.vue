<script setup>
import { ref, onMounted, onBeforeUnmount, watch, computed } from 'vue'
import { CameraIcon, TrashIcon, XMarkIcon, ArrowDownTrayIcon, MapPinIcon, ClockIcon } from '@heroicons/vue/24/outline'
import {
  listSiteDocuments,
  uploadSiteDocument,
  deleteSiteDocument,
  updateSiteDocument,
  getSiteDocumentDownloadUrl,
} from '@/api'
import { useNotification } from '@/composables/useNotification'
import { compressBeforeUpload, extractExifMeta, getDeviceGeolocation } from '@/composables/usePhotoCompression'
import { useViewport } from '@/composables/useViewport'

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
const { isMobile } = useViewport()
const photos = ref([])
const loading = ref(false)
const showGallery = ref(false)
const fileInput = ref(null)
const cameraInput = ref(null)
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
  if (props.attachTo.action_item_id != null)  p.bacs_audit_action_item_id = props.attachTo.action_item_id
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
// On watch la sérialisation des params plutôt que l'objet pour éviter
// les refetches en boucle quand le parent recrée l'objet attachTo à
// chaque render (cas typique : `:attach-to="{ system_id: s.id }"` dans
// un v-for, qui produit un nouveau littéral à chaque cycle réactif —
// mais avec les mêmes valeurs). Avant : 50+ GET en cascade par clic.
watch(() => JSON.stringify(filterParams.value), refresh)

function pickFile() {
  fileInput.value?.click()
}

function takePhoto() {
  cameraInput.value?.click()
}

async function uploadFiles(files) {
  if (!files.length) return
  uploading.value = true
  const uploaded = []
  try {
    for (const rawFile of files) {
      // Extraire l'EXIF AVANT compression (la passe canvas re-encode et
      // strip l'EXIF, on perdrait GPS / date / appareil sinon).
      let exifMeta = await extractExifMeta(rawFile) || {}
      // Fallback date : iOS Safari strip souvent les EXIF lors d'un upload
      // file. file.lastModified reste disponible (= date de création du
      // fichier sur le filesystem du navigateur, proche de la prise).
      if (!exifMeta.taken_at && rawFile.lastModified) {
        const d = new Date(rawFile.lastModified)
        if (!isNaN(d.getTime()) && d.getTime() > 946684800000 /* 2000-01-01 */) {
          exifMeta.taken_at = d.toISOString()
        }
      }
      // Fallback GPS : si l'EXIF n'a pas la position (typique iOS Safari)
      // mais que le navigateur l'a déjà accordée, on prend la position du
      // device au moment du upload. Approximation acceptable sur un audit
      // de site puisque l'auditeur est physiquement sur place.
      if (exifMeta.gps_latitude == null) {
        const geo = await getDeviceGeolocation()
        if (geo) Object.assign(exifMeta, geo)
      }
      // Compression côté client : économie réseau 4G en gardant l'orig
      // si la compression échoue ou n'apporte rien (cf. composable).
      const f = await compressBeforeUpload(rawFile)
      const fd = new FormData()
      fd.append('file', f)
      const defaultTitle = (rawFile.name || 'photo').replace(/\.[^.]+$/, '')
      const { data } = await uploadSiteDocument(props.siteUuid, fd, {
        title: defaultTitle,
        category: 'photo',
        ...filterParams.value,
        ...exifMeta,
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
  // Aligné sur le style des autres boutons d'action (Notes, HS, Câblé,
  // Arrêt manuel) : rounded-md, px-2 py-1, text-[11px], icône w-3.5 h-3.5,
  // tons border-200/text-700/bg-50 cohérents.
  const base = 'inline-flex items-center justify-center gap-1 rounded-md border transition font-medium whitespace-nowrap'
  if (isMobile.value) {
    return `${base} px-4 py-3.5 text-base w-full bg-indigo-600 border-indigo-600 text-white active:bg-indigo-700`
  }
  const size = props.size === 'md'
    ? 'px-2.5 py-1 text-xs'
    : 'px-2 py-1 text-[11px]'
  if (isDragOver.value) return `${base} ${size} border-indigo-500 bg-indigo-100 text-indigo-700 ring-2 ring-indigo-300/50`
  const tone = photos.value.length
    ? 'border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100'
    : 'border-gray-200 text-gray-500 bg-white hover:border-gray-300 hover:text-gray-700'
  return `${base} ${size} ${tone}`
})

// Affichage des EXIF (date capture, GPS, appareil) sous chaque tile et
// dans la modal preview. Pin = lien Google Maps.
function fmtTakenAt(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
}
function fmtTakenAtShort(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
}
function gpsMapUrl(p) {
  if (p?.gps_latitude == null || p?.gps_longitude == null) return null
  return `https://www.google.com/maps/search/?api=1&query=${p.gps_latitude},${p.gps_longitude}`
}
function exifTooltip(p) {
  if (!p) return ''
  const parts = []
  if (p.taken_at) parts.push('Pris le ' + fmtTakenAt(p.taken_at))
  if (p.camera_make || p.camera_model) {
    parts.push([p.camera_make, p.camera_model].filter(Boolean).join(' '))
  }
  if (p.gps_latitude != null && p.gps_longitude != null) {
    parts.push(`GPS ${p.gps_latitude.toFixed(5)}, ${p.gps_longitude.toFixed(5)}`)
  }
  return parts.join(' · ')
}
</script>

<template>
  <div :class="['relative', isMobile ? 'block w-full' : 'inline-block']" ref="rootEl">
    <button
      type="button"
      :class="btnCls"
      v-tooltip="label ? `Photos - ${label} (clic pour ouvrir / glisse-depose pour ajouter)` : 'Photos'"
      @click="showGallery = !showGallery"
      @dragover.prevent="onDragOver"
      @dragenter.prevent="onDragEnter"
      @dragleave.prevent="onDragLeave"
      @drop.prevent="onDrop"
    >
      <CameraIcon :class="['shrink-0', isMobile ? 'w-5 h-5' : 'w-3.5 h-3.5']" />
      <template v-if="isMobile">
        <span class="font-medium">Photos<span v-if="photos.length"> ({{ photos.length }})</span></span>
      </template>
      <template v-else>
        <span v-if="isDragOver">Déposer ici</span>
        <span v-else-if="photos.length">{{ photos.length }} photo<span v-if="photos.length > 1">s</span></span>
        <span v-else>+ Photo</span>
      </template>
    </button>

    <input
      ref="fileInput"
      type="file"
      accept="image/*"
      multiple
      class="hidden"
      @change="onFileChosen"
    />
    <!-- Caméra native iOS : capture="environment" déclenche directement
         l'appareil photo arrière (pas de choix Pellicule). Pas de multiple,
         on prend une photo à la fois. -->
    <input
      ref="cameraInput"
      type="file"
      accept="image/*"
      capture="environment"
      class="hidden"
      @change="onFileChosen"
    />

    <!-- Desktop : Galerie inline (popover absolute) -->
    <div
      v-if="showGallery && !isMobile"
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
          class="px-2 py-1 text-[11px] font-medium rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {{ uploading ? 'Envoi…' : '+ Ajouter' }}
        </button>
      </div>

      <div v-if="loading" class="text-center text-xs text-gray-500 py-3">Chargement…</div>
      <div v-else-if="!photos.length" class="text-center text-xs text-gray-500 py-3 italic">
        Aucune photo. Glisse des images sur l'icone ou clique sur <strong>+ Ajouter</strong>.
      </div>
      <div v-else class="grid grid-cols-3 gap-1.5">
        <div v-for="p in photos" :key="p.id" class="relative group" v-tooltip="exifTooltip(p)">
          <button type="button" @click="previewPhoto = p" class="block w-full">
            <img :src="thumbUrl(p)" :alt="p.title || p.original_name || 'Photo'"
                 loading="lazy" decoding="async"
                 class="w-full h-16 object-cover rounded border border-gray-200 hover:border-indigo-400 transition cursor-zoom-in" />
          </button>
          <a v-if="gpsMapUrl(p)" :href="gpsMapUrl(p)" target="_blank" rel="noopener" @click.stop
             class="absolute top-1 left-1 w-5 h-5 rounded-full bg-black/55 hover:bg-indigo-600 text-white flex items-center justify-center transition"
             v-tooltip="`Voir sur Google Maps — ${exifTooltip(p)}`">
            <MapPinIcon class="w-3 h-3" />
          </a>
          <button
            @click="removePhoto(p)"
            class="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-600 text-white opacity-0 group-hover:opacity-100 hover:bg-red-700 transition flex items-center justify-center"
            v-tooltip="'Supprimer'"
          >
            <TrashIcon class="w-3 h-3" />
          </button>
          <span v-if="p.taken_at"
                class="absolute bottom-1 left-1 inline-flex items-center gap-0.5 px-1 py-px rounded bg-black/55 text-white text-[9px] font-medium">
            <ClockIcon class="w-2.5 h-2.5" />
            {{ fmtTakenAtShort(p.taken_at) }}
          </span>
          <p v-if="p.title" class="text-[9px] text-gray-500 truncate mt-0.5" v-tooltip="p.title">{{ p.title }}</p>
        </div>
      </div>

      <button
        @click="showGallery = false"
        class="mt-2 w-full text-[11px] text-gray-500 hover:text-gray-700"
      >Fermer</button>
    </div>

    <!-- Mobile : Galerie en sheet plein-écran (Teleport pour éviter overflow parent) -->
    <Teleport to="body">
      <transition name="slide-up">
        <div
          v-if="showGallery && isMobile"
          class="fixed inset-0 z-60 flex flex-col bg-gray-50"
        >
          <header
            class="shrink-0 bg-white border-b border-gray-200"
            :style="{ paddingTop: 'env(safe-area-inset-top)' }"
          >
            <div class="flex items-center gap-2 h-12 px-3">
              <button
                @click="showGallery = false"
                class="tap-target inline-flex items-center justify-center text-gray-600"
                aria-label="Fermer"
              >
                <XMarkIcon class="w-6 h-6" />
              </button>
              <h2 class="flex-1 min-w-0 text-base font-medium truncate text-gray-900">
                Photos<span v-if="label"> · {{ label }}</span>
              </h2>
              <span class="text-xs text-gray-500">{{ photos.length }}</span>
            </div>
          </header>

          <div
            class="flex-1 overflow-y-auto p-3 space-y-3"
            :style="{ paddingBottom: 'calc(96px + env(safe-area-inset-bottom))' }"
          >
            <!-- Boutons capture / pellicule -->
            <div class="grid grid-cols-2 gap-2">
              <button
                @click="takePhoto"
                :disabled="uploading"
                class="inline-flex items-center justify-center gap-2 px-4 py-4 text-white bg-emerald-600 rounded-xl font-medium disabled:opacity-50"
              >
                <CameraIcon class="w-5 h-5" /> {{ uploading ? '…' : 'Prendre une photo' }}
              </button>
              <button
                @click="pickFile"
                :disabled="uploading"
                class="inline-flex items-center justify-center gap-2 px-4 py-4 text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-xl font-medium disabled:opacity-50"
              >
                Pellicule
              </button>
            </div>

            <!-- Grille photos -->
            <div v-if="loading" class="text-center text-sm text-gray-500 py-12">Chargement…</div>
            <div v-else-if="!photos.length" class="text-center py-12">
              <CameraIcon class="w-12 h-12 text-gray-300 mx-auto" />
              <p class="text-sm text-gray-500 mt-3">Aucune photo</p>
              <p class="text-xs text-gray-400 mt-1">Tape un bouton ci-dessus pour ajouter</p>
            </div>
            <div v-else class="grid grid-cols-2 gap-2">
              <div v-for="p in photos" :key="p.id" class="relative">
                <button type="button" @click="previewPhoto = p" class="block w-full">
                  <img :src="thumbUrl(p)" :alt="p.title || 'Photo'"
                       loading="lazy" decoding="async"
                       class="w-full aspect-square object-cover rounded-xl border border-gray-200" />
                </button>
                <button
                  @click="removePhoto(p)"
                  class="absolute top-1.5 right-1.5 w-8 h-8 rounded-full bg-red-600/90 text-white flex items-center justify-center shadow"
                  v-tooltip="'Supprimer'"
                >
                  <TrashIcon class="w-4 h-4" />
                </button>
                <p v-if="p.title" class="text-[11px] text-gray-600 truncate mt-1 px-1">{{ p.title }}</p>
              </div>
            </div>
          </div>
        </div>
      </transition>
    </Teleport>

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
            <div v-if="previewPhoto.taken_at || gpsMapUrl(previewPhoto) || previewPhoto.camera_make || previewPhoto.camera_model"
                 class="mt-1 flex items-center gap-3 flex-wrap text-[11px] opacity-80">
              <span v-if="previewPhoto.taken_at" class="inline-flex items-center gap-1">
                <ClockIcon class="w-3 h-3" />
                {{ fmtTakenAt(previewPhoto.taken_at) }}
              </span>
              <a v-if="gpsMapUrl(previewPhoto)" :href="gpsMapUrl(previewPhoto)" target="_blank" rel="noopener"
                 class="inline-flex items-center gap-1 text-indigo-200 hover:text-white">
                <MapPinIcon class="w-3 h-3" />
                {{ previewPhoto.gps_latitude.toFixed(5) }}, {{ previewPhoto.gps_longitude.toFixed(5) }}
              </a>
              <span v-if="previewPhoto.camera_make || previewPhoto.camera_model" class="text-white/60">
                {{ [previewPhoto.camera_make, previewPhoto.camera_model].filter(Boolean).join(' ') }}
              </span>
            </div>
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

<style scoped>
.slide-up-enter-active,
.slide-up-leave-active {
  transition: transform 220ms ease-out;
}
.slide-up-enter-from,
.slide-up-leave-to {
  transform: translateY(100%);
}
</style>
