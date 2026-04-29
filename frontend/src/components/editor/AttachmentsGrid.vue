<script setup>
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import Sortable from 'sortablejs'
import {
  PhotoIcon, TrashIcon, CloudArrowUpIcon, XMarkIcon, ExclamationCircleIcon,
} from '@heroicons/vue/24/outline'

const failedIds = ref(new Set())
const retryCount = new Map()
import {
  listSectionAttachments, uploadSectionAttachment, updateAttachment,
  reorderAttachments, deleteAttachment,
} from '@/api'
import { useNotification } from '@/composables/useNotification'

const props = defineProps({
  sectionId: { type: Number, required: true },
  afId: { type: Number, required: true },
})

const { error: notifyError } = useNotification()
const attachments = ref([])
const loading = ref(false)
const isDragging = ref(false)
const uploading = ref(0)
const fileInput = ref(null)
const viewerUrl = ref(null)
const viewerName = ref('')
const gridRef = ref(null)
let sortable = null

// Cache-buster basé sur l'id + un nonce de retry pour bypass un échec antérieur.
function urlFor(att) {
  const retry = retryCount.get(att.id) || 0
  return `/attachments/${props.afId}/${att.filename}?v=${att.id}${retry ? `&r=${retry}` : ''}`
}

function onImgError(att, e) {
  const tries = (retryCount.get(att.id) || 0) + 1
  if (tries <= 2) {
    // Retry une fois après 600ms (ex : fichier pas encore flush sur disque)
    retryCount.set(att.id, tries)
    setTimeout(() => {
      // Force re-render en touchant l'objet
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

async function refresh() {
  loading.value = true
  try {
    const { data } = await listSectionAttachments(props.sectionId)
    attachments.value = data
  } catch (e) {
    notifyError('Échec du chargement des captures')
  } finally {
    loading.value = false
  }
}

async function uploadFiles(files) {
  for (const file of files) {
    if (!file.type.startsWith('image/')) {
      notifyError(`"${file.name}" : seules les images sont supportées`)
      continue
    }
    uploading.value++
    try {
      await uploadSectionAttachment(props.sectionId, file)
    } catch (e) {
      notifyError(e.response?.data?.detail || `Échec de l'upload de "${file.name}"`)
    } finally {
      uploading.value--
    }
  }
  // Petite latence pour laisser le navigateur invalider tout cache d'echec
  // antérieur sur des URLs proches (ex. retry échoué en boucle juste avant).
  await new Promise(r => setTimeout(r, 200))
  refresh()
}

function onFilePicker(e) {
  if (e.target.files?.length) uploadFiles(Array.from(e.target.files))
  e.target.value = ''
}

function onDrop(e) {
  isDragging.value = false
  if (e.dataTransfer?.files?.length) {
    uploadFiles(Array.from(e.dataTransfer.files))
  }
}

async function saveCaption(att) {
  try {
    await updateAttachment(att.id, { caption: att.caption || '' })
  } catch {
    notifyError('Échec de la légende')
  }
}

async function removeAttachment(att) {
  if (!confirm(`Supprimer la capture "${att.original_name}" ?`)) return
  try {
    await deleteAttachment(att.id)
    refresh()
  } catch {
    notifyError('Échec de la suppression')
  }
}

function openViewer(att) {
  viewerUrl.value = urlFor(att)
  viewerName.value = att.original_name || att.filename
}
function closeViewer() {
  viewerUrl.value = null
  viewerName.value = ''
}
function onEsc(e) { if (e.key === 'Escape' && viewerUrl.value) closeViewer() }

// SortableJS pour réorganiser : drop entre items (intuitif)
function setupSortable() {
  if (sortable) { sortable.destroy(); sortable = null }
  if (!gridRef.value || attachments.value.length < 2) return
  sortable = Sortable.create(gridRef.value, {
    animation: 150,
    ghostClass: 'sortable-ghost',
    chosenClass: 'sortable-chosen',
    dragClass: 'sortable-drag',
    onEnd: async (evt) => {
      if (evt.oldIndex === evt.newIndex) return
      // Réordonne le tableau local (Sortable a déjà déplacé le DOM)
      const [moved] = attachments.value.splice(evt.oldIndex, 1)
      attachments.value.splice(evt.newIndex, 0, moved)
      try {
        await reorderAttachments(props.sectionId, attachments.value.map(a => a.id))
      } catch {
        notifyError('Échec de la réorganisation')
        refresh()
      }
    },
  })
}

watch(attachments, async () => {
  await nextTick()
  setupSortable()
}, { deep: false })

watch(() => props.sectionId, refresh)

onMounted(() => {
  document.addEventListener('keydown', onEsc)
  refresh()
})
onBeforeUnmount(() => {
  if (sortable) sortable.destroy()
  document.removeEventListener('keydown', onEsc)
})
</script>

<template>
  <div
    :class="['bg-white rounded-lg border border-gray-200 transition-colors', isDragging ? 'border-indigo-500 ring-4 ring-indigo-100' : '']"
    @dragover.prevent="isDragging = true"
    @dragleave.prevent="(e) => { if (!e.currentTarget.contains(e.relatedTarget)) isDragging = false }"
    @drop.prevent="onDrop"
  >
    <div class="flex items-center justify-between px-5 py-3 border-b border-gray-100">
      <div>
        <h3 class="text-sm font-semibold text-gray-700">
          Captures
          <span class="ml-2 text-xs font-normal text-gray-500">
            ({{ attachments.length }}{{ uploading > 0 ? `, ${uploading} en cours…` : '' }})
          </span>
        </h3>
        <p class="text-xs text-gray-500 mt-0.5">
          Glisse-dépose des images dans cette zone, ou clique sur le bouton.
          Glisse une miniature pour la déplacer entre les autres.
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

    <div v-else-if="!attachments.length" class="px-5 py-10 text-center">
      <PhotoIcon class="w-12 h-12 mx-auto text-gray-300" />
      <p class="text-sm text-gray-500 mt-3">Aucune capture pour cette section.</p>
      <p class="text-xs text-gray-400 mt-1">Glisse-dépose des images dans cette zone pour les ajouter.</p>
    </div>

    <div v-else ref="gridRef" class="p-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
      <div
        v-for="att in attachments"
        :key="att.id"
        class="att-card group relative bg-gray-50 border border-gray-200 overflow-hidden cursor-move"
      >
        <!-- Image OK -->
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
        <!-- Placeholder si image cassee (apres 3 essais) -->
        <div
          v-else
          class="w-full aspect-video bg-gray-100 flex flex-col items-center justify-center gap-2 text-center px-3 cursor-pointer hover:bg-gray-200"
          @click="retryCount.delete(att.id); failedIds.delete(att.id); failedIds = new Set(failedIds)"
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
          title="Supprimer"
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

    <!-- Lightbox -->
    <Teleport to="body">
      <div
        v-if="viewerUrl"
        class="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4"
        @click.self="closeViewer"
      >
        <button
          @click="closeViewer"
          class="absolute top-4 right-4 p-2 text-white/80 hover:text-white bg-white/10 hover:bg-white/20 rounded-lg"
          title="Fermer (Esc)"
        >
          <XMarkIcon class="w-6 h-6" />
        </button>
        <div class="max-w-full max-h-full flex flex-col items-center gap-3">
          <img :src="viewerUrl" :alt="viewerName" class="max-w-full max-h-[85vh] object-contain shadow-2xl" />
          <p v-if="viewerName" class="text-sm text-white/70 text-center">{{ viewerName }}</p>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style>
/* SortableJS classes */
.att-card.sortable-ghost { opacity: 0.4; background: #eef2ff; }
.att-card.sortable-chosen { cursor: grabbing; }
.att-card.sortable-drag { opacity: 0.9; transform: rotate(1deg); box-shadow: 0 10px 25px rgba(0,0,0,0.15); }
</style>
