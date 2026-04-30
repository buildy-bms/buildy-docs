<script setup>
/**
 * Galerie de captures rattachees a un template (section_template ou
 * equipment_template). Plus simple que AttachmentsGrid (pas de notion
 * d'heritage, pas de section AF), mais memes fonctionnalites :
 * upload drag-drop, reorder, suppression, lightbox, captions.
 *
 * Les captures uploadees ici se retrouvent automatiquement dans toutes
 * les AFs qui referencent ce template (heritage en lecture seule).
 */
import { ref, computed, onMounted, watch, nextTick, onBeforeUnmount } from 'vue'
import Sortable from 'sortablejs'
import {
  PhotoIcon, TrashIcon, CloudArrowUpIcon, ExclamationCircleIcon,
} from '@heroicons/vue/24/outline'
import ImageLightbox from '@/components/ImageLightbox.vue'
import {
  listSectionTemplateAttachments, uploadSectionTemplateAttachment, reorderSectionTemplateAttachments,
  listEquipmentTemplateAttachments, uploadEquipmentTemplateAttachment, reorderEquipmentTemplateAttachments,
  updateAttachment, deleteAttachment,
} from '@/api'
import { useNotification } from '@/composables/useNotification'
import { useConfirm } from '@/composables/useConfirm'

const props = defineProps({
  // 'section' (section_templates) ou 'equipment' (equipment_templates)
  templateKind: { type: String, required: true, validator: v => ['section', 'equipment'].includes(v) },
  templateId: { type: Number, required: true },
})

const { error: notifyError, success: notifySuccess } = useNotification()
const { confirm } = useConfirm()
const attachments = ref([])
const loading = ref(false)
const isDragging = ref(false)
const uploading = ref(0)
const fileInput = ref(null)
const viewerIndex = ref(null)
const gridRef = ref(null)
let sortable = null

// Retry sur erreur d'image (race fsync / cache navigateur) — meme logique
// que AttachmentsGrid pour les captures d'AF, sinon les miniatures peuvent
// rester cassees apres un upload sans qu'on retente le GET.
const failedIds = ref(new Set())
const retryCount = new Map()

const apis = {
  section: {
    list: listSectionTemplateAttachments,
    upload: uploadSectionTemplateAttachment,
    reorder: reorderSectionTemplateAttachments,
    urlBase: '/attachments/_tpl/section/',
  },
  equipment: {
    list: listEquipmentTemplateAttachments,
    upload: uploadEquipmentTemplateAttachment,
    reorder: reorderEquipmentTemplateAttachments,
    urlBase: '/attachments/_tpl/equipment/',
  },
}
const api = apis[props.templateKind]

function urlFor(att) {
  const retry = retryCount.get(att.id) || 0
  return `${api.urlBase}${att.filename}?v=${att.id}${retry ? `&r=${retry}` : ''}`
}

function onImgError(att, e) {
  // Retry une fois apres 600ms : si l'upload vient de finir, le fichier
  // peut ne pas etre encore servable malgre le fsync (cache OS / FS lazy).
  const tries = (retryCount.get(att.id) || 0) + 1
  if (tries <= 2) {
    retryCount.set(att.id, tries)
    setTimeout(() => {
      const src = e.target
      if (src) src.src = urlFor(att)
    }, 600)
  } else {
    failedIds.value.add(att.id)
    failedIds.value = new Set(failedIds.value)
  }
}
function onImgLoad(att) {
  if (failedIds.value.has(att.id)) {
    failedIds.value.delete(att.id)
    failedIds.value = new Set(failedIds.value)
  }
}
function retryImage(att) {
  retryCount.delete(att.id)
  failedIds.value.delete(att.id)
  failedIds.value = new Set(failedIds.value)
}

async function refresh() {
  loading.value = true
  try {
    const { data } = await api.list(props.templateId)
    attachments.value = data
  } catch (e) {
    notifyError('Échec du chargement des captures')
  } finally {
    loading.value = false
  }
}

async function uploadFiles(files) {
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue
    uploading.value++
    try {
      await api.upload(props.templateId, file)
    } catch (e) {
      notifyError(`Échec upload ${file.name} — ${e.response?.data?.detail || e.message}`)
    } finally {
      uploading.value--
    }
  }
  await refresh()
}

function onFilePicker(e) {
  const files = Array.from(e.target.files || [])
  if (files.length) uploadFiles(files)
  e.target.value = ''
}

function onDrop(e) {
  isDragging.value = false
  const files = Array.from(e.dataTransfer?.files || [])
  if (files.length) uploadFiles(files)
}

async function saveCaption(att) {
  try { await updateAttachment(att.id, { caption: att.caption }) }
  catch { notifyError('Échec sauvegarde légende') }
}

async function removeAttachment(att) {
  const ok = await confirm({ title: 'Supprimer la capture ?', message: `« ${att.original_name || att.filename} »\n\nCette suppression s'applique au modèle et sera reflétée dans toutes les AFs.`, confirmLabel: 'Supprimer', danger: true })
  if (!ok) return
  try {
    await deleteAttachment(att.id)
    refresh()
    notifySuccess('Capture supprimée du modèle')
  } catch { notifyError('Échec de la suppression') }
}

const viewableImages = computed(() => attachments.value
  .filter(att => !failedIds.value.has(att.id))
  .map(att => ({ url: urlFor(att), name: att.original_name || '' }))
)
function openViewer(att) {
  const idx = viewableImages.value.findIndex(img => img.url === urlFor(att))
  if (idx >= 0) viewerIndex.value = idx
}

function setupSortable() {
  if (sortable) { sortable.destroy(); sortable = null }
  if (!gridRef.value || attachments.value.length < 2) return
  sortable = Sortable.create(gridRef.value, {
    animation: 150,
    onEnd: async (evt) => {
      if (evt.oldIndex === evt.newIndex) return
      const [moved] = attachments.value.splice(evt.oldIndex, 1)
      attachments.value.splice(evt.newIndex, 0, moved)
      try { await api.reorder(props.templateId, attachments.value.map(a => a.id)) }
      catch {
        notifyError('Échec de la réorganisation')
        refresh()
      }
    },
  })
}

watch(attachments, async () => { await nextTick(); setupSortable() }, { deep: false })
watch(() => props.templateId, refresh)
onMounted(refresh)
onBeforeUnmount(() => { if (sortable) sortable.destroy() })
</script>

<template>
  <div
    :class="['bg-white rounded-lg border transition-colors', isDragging ? 'border-indigo-500 ring-4 ring-indigo-100' : 'border-gray-200']"
    @dragover.prevent="isDragging = true"
    @dragleave.prevent="(e) => { if (!e.currentTarget.contains(e.relatedTarget)) isDragging = false }"
    @drop.prevent="onDrop"
  >
    <div class="flex items-center justify-between px-5 py-3 border-b border-gray-100">
      <div>
        <h3 class="text-sm font-semibold text-gray-700">
          Captures du modèle
          <span class="ml-2 text-xs font-normal text-gray-500">
            ({{ attachments.length }}{{ uploading > 0 ? `, ${uploading} en cours…` : '' }})
          </span>
        </h3>
        <p class="text-xs text-gray-500 mt-0.5">
          Ces captures seront <strong>automatiquement reprises</strong> dans toutes les AFs utilisant ce modèle.
        </p>
      </div>
      <button
        @click="fileInput.click()"
        class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-indigo-600 hover:text-indigo-800 font-medium border border-indigo-200 rounded-lg hover:bg-indigo-50"
      >
        <CloudArrowUpIcon class="w-4 h-4" />
        Ajouter des images
      </button>
      <input ref="fileInput" type="file" multiple accept="image/*" class="hidden" @change="onFilePicker" />
    </div>

    <div v-if="loading" class="text-center py-6 text-sm text-gray-400">Chargement…</div>

    <div v-else-if="!attachments.length" class="px-5 py-8 text-center">
      <PhotoIcon class="w-10 h-10 mx-auto text-gray-300" />
      <p class="text-sm text-gray-500 mt-2">Aucune capture sur ce modèle.</p>
      <p class="text-xs text-gray-400 mt-1">Glisse-dépose des images ici ou clique sur le bouton.</p>
    </div>

    <div v-else ref="gridRef" class="p-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
      <div
        v-for="att in attachments"
        :key="att.id"
        class="group relative bg-gray-50 border border-gray-200 overflow-hidden cursor-move"
      >
        <img
          v-if="!failedIds.has(att.id)"
          :src="urlFor(att)"
          :alt="att.original_name || ''"
          loading="lazy"
          class="w-full aspect-video object-cover bg-gray-100 cursor-zoom-in"
          @click="openViewer(att)"
          @error="(e) => onImgError(att, e)"
          @load="onImgLoad(att)"
        />
        <div
          v-else
          class="w-full aspect-video bg-gray-100 flex flex-col items-center justify-center gap-2 text-center px-3 cursor-pointer hover:bg-gray-200"
          @click="retryImage(att)"
          title="Cliquer pour réessayer"
        >
          <ExclamationCircleIcon class="w-8 h-8 text-amber-500" />
          <p class="text-[11px] text-gray-600 leading-tight">
            Image non disponible<br>
            <span class="text-gray-400">{{ att.original_name }}</span>
          </p>
          <p class="text-[10px] text-indigo-600">Cliquer pour réessayer</p>
        </div>
        <button
          @click.stop="removeAttachment(att)"
          class="absolute top-1.5 right-1.5 p-1.5 bg-white/90 hover:bg-red-500 hover:text-white text-gray-600 rounded-md opacity-0 group-hover:opacity-100 transition z-10"
          title="Supprimer (impacte toutes les AFs)"
        >
          <TrashIcon class="w-3.5 h-3.5" />
        </button>
        <input
          v-model="att.caption"
          @blur="saveCaption(att)"
          @click.stop
          type="text"
          placeholder="Légende…"
          class="relative z-10 w-full px-2 py-1 text-xs bg-white border-t border-gray-200 focus:outline-none focus:bg-indigo-50 cursor-text"
        />
      </div>
    </div>

    <ImageLightbox v-model:index="viewerIndex" :images="viewableImages" />
  </div>
</template>
