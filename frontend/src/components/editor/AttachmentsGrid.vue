<script setup>
import { ref, onMounted, watch } from 'vue'
import { PhotoIcon, TrashIcon, ArrowsUpDownIcon, CloudArrowUpIcon } from '@heroicons/vue/24/outline'
import {
  listSectionAttachments, uploadSectionAttachment, updateAttachment,
  reorderAttachments, deleteAttachment,
} from '@/api'
import { useNotification } from '@/composables/useNotification'

const props = defineProps({
  sectionId: { type: Number, required: true },
  afId: { type: Number, required: true },
})

function urlFor(att) {
  return `/attachments/${props.afId}/${att.filename}`
}

const { success, error: notifyError } = useNotification()
const attachments = ref([])
const loading = ref(false)
const isDragging = ref(false)
const uploading = ref(0) // nombre d'uploads en cours
const dragOverId = ref(null)
const fileInput = ref(null)

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
  refresh()
}

function onFilePicker(e) {
  if (e.target.files?.length) uploadFiles(Array.from(e.target.files))
  e.target.value = '' // reset
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

// Drag & drop reorder simple (HTML5 native sans lib)
let draggedId = null
function onCardDragStart(att, e) {
  draggedId = att.id
  e.dataTransfer.effectAllowed = 'move'
  e.dataTransfer.setData('text/plain', String(att.id))
}
function onCardDragOver(att, e) {
  e.preventDefault()
  if (draggedId && draggedId !== att.id) dragOverId.value = att.id
}
function onCardDragLeave() {
  dragOverId.value = null
}
async function onCardDrop(targetAtt, e) {
  e.preventDefault()
  e.stopPropagation()
  dragOverId.value = null
  if (!draggedId || draggedId === targetAtt.id) { draggedId = null; return }

  const oldIdx = attachments.value.findIndex(a => a.id === draggedId)
  const newIdx = attachments.value.findIndex(a => a.id === targetAtt.id)
  if (oldIdx === -1 || newIdx === -1) { draggedId = null; return }

  const [moved] = attachments.value.splice(oldIdx, 1)
  attachments.value.splice(newIdx, 0, moved)
  draggedId = null

  try {
    await reorderAttachments(props.sectionId, attachments.value.map(a => a.id))
  } catch {
    notifyError('Échec de la réorganisation')
    refresh()
  }
}

watch(() => props.sectionId, refresh)
onMounted(refresh)
</script>

<template>
  <div
    :class="['bg-white rounded-xl border border-gray-200 transition-colors', isDragging ? 'border-indigo-500 ring-4 ring-indigo-100' : '']"
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
          Glisse-dépose des images directement ici, ou clique sur le bouton.
          Réorganise par drag & drop des miniatures.
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

    <!-- Empty state -->
    <div
      v-else-if="!attachments.length"
      class="px-5 py-10 text-center"
    >
      <PhotoIcon class="w-12 h-12 mx-auto text-gray-300" />
      <p class="text-sm text-gray-500 mt-3">
        Aucune capture pour cette section.
      </p>
      <p class="text-xs text-gray-400 mt-1">
        Glisse-dépose des images dans cette zone pour les ajouter.
      </p>
    </div>

    <!-- Grille -->
    <div v-else class="p-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
      <div
        v-for="att in attachments"
        :key="att.id"
        :class="[
          'group relative bg-gray-50 rounded-lg border border-gray-200 overflow-hidden cursor-move transition-all',
          dragOverId === att.id ? 'border-indigo-500 ring-2 ring-indigo-200 scale-[1.02]' : '',
        ]"
        draggable="true"
        @dragstart="(e) => onCardDragStart(att, e)"
        @dragover="(e) => onCardDragOver(att, e)"
        @dragleave="onCardDragLeave"
        @drop="(e) => onCardDrop(att, e)"
      >
        <a :href="urlFor(att)" target="_blank" rel="noopener">
          <img :src="urlFor(att)" :alt="att.original_name || ''" class="w-full aspect-video object-cover" />
        </a>

        <button
          @click="removeAttachment(att)"
          class="absolute top-1.5 right-1.5 p-1.5 bg-white/90 hover:bg-red-500 hover:text-white text-gray-600 rounded-md opacity-0 group-hover:opacity-100 transition"
          title="Supprimer"
        >
          <TrashIcon class="w-3.5 h-3.5" />
        </button>

        <div class="absolute top-1.5 left-1.5 p-1 bg-white/90 text-gray-400 rounded opacity-0 group-hover:opacity-100 transition" title="Glisser pour réordonner">
          <ArrowsUpDownIcon class="w-3.5 h-3.5" />
        </div>

        <input
          v-model="att.caption"
          @blur="saveCaption(att)"
          type="text"
          placeholder="Légende…"
          class="w-full px-2 py-1 text-xs bg-white border-t border-gray-200 focus:outline-none focus:bg-indigo-50"
        />
      </div>
    </div>
  </div>
</template>
