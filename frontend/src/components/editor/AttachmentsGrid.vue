<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import Sortable from 'sortablejs'
import {
  PhotoIcon, TrashIcon, CloudArrowUpIcon, ExclamationCircleIcon,
} from '@heroicons/vue/24/outline'
import ImageLightbox from '@/components/ImageLightbox.vue'

const failedIds = ref(new Set())
const retryCount = new Map()
import {
  listSectionAttachments, uploadSectionAttachment, updateAttachment,
  reorderAttachments, deleteAttachment,
} from '@/api'
import { useNotification } from '@/composables/useNotification'
import { useConfirm } from '@/composables/useConfirm'

const props = defineProps({
  sectionId: { type: Number, required: true },
  afId: { type: Number, required: true },
})

const { error: notifyError } = useNotification()
const { confirm } = useConfirm()
const attachments = ref([])
const loading = ref(false)
const isDragging = ref(false)
const uploading = ref(0)
const fileInput = ref(null)
const viewerIndex = ref(null)
const viewableImages = computed(() => attachments.value
  .filter(att => !failedIds.value.has(att.id))
  .map(att => ({ url: urlFor(att), name: att.original_name || att.filename }))
)
const gridRef = ref(null)
let sortable = null

// Cache-buster basé sur l'id + un nonce de retry pour bypass un échec antérieur.
// L'API renvoie url_path déjà calculé qui tient compte de la source
// (section / section_template / equipment_template).
function urlFor(att) {
  const retry = retryCount.get(att.id) || 0
  const base = att.url_path || `/attachments/${props.afId}/${att.filename}`
  return `${base}?v=${att.id}${retry ? `&r=${retry}` : ''}`
}
function isInherited(att) {
  return att.source === 'section_template' || att.source === 'equipment_template'
}
// Drag d'une card vers l'arbre des sections (= deplacement vers une autre
// section). On utilise un MIME type custom pour que SectionTreeNode puisse
// distinguer ce drag des autres (fichiers OS, etc.). Sortable.js intercepte
// son propre dragstart pour le reorder interne ; ce handler s'execute en
// parallele et ajoute une donnee custom au DataTransfer.
function onCardDragStart(e, att) {
  if (isInherited(att)) return
  e.dataTransfer?.setData('application/x-buildy-attachment', String(att.id))
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
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
  const ok = await confirm({ title: 'Supprimer la capture ?', message: `« ${att.original_name} »`, confirmLabel: 'Supprimer', danger: true })
  if (!ok) return
  try {
    await deleteAttachment(att.id)
    refresh()
  } catch {
    notifyError('Échec de la suppression')
  }
}

function openViewer(att) {
  const idx = viewableImages.value.findIndex(img => img.url === urlFor(att))
  if (idx >= 0) viewerIndex.value = idx
}

// SortableJS pour réorganiser : drop entre items (intuitif)
function setupSortable() {
  if (sortable) { sortable.destroy(); sortable = null }
  if (!gridRef.value || attachments.value.length < 2) return
  sortable = Sortable.create(gridRef.value, {
    animation: 150,
    ghostClass: 'sortable-ghost',
    chosenClass: 'sortable-chosen',
    dragClass: 'sortable-drag',
    // Les captures heritees du modele ne sont pas re-ordonnables au niveau
    // de la section AF — elles ont leur ordre defini au niveau du template.
    filter: '[data-inherited="true"]',
    preventOnFilter: false,
    onEnd: async (evt) => {
      if (evt.oldIndex === evt.newIndex) return
      // Reordre LOCAL (Sortable a deja deplace le DOM). Pour la persistance,
      // on n'envoie au backend QUE les captures specifiques (source='section'),
      // dans leur nouvel ordre relatif.
      const [moved] = attachments.value.splice(evt.oldIndex, 1)
      attachments.value.splice(evt.newIndex, 0, moved)
      try {
        const ownIds = attachments.value
          .filter(a => a.source === 'section' || !a.source)
          .map(a => a.id)
        await reorderAttachments(props.sectionId, ownIds)
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
  refresh()
})
onBeforeUnmount(() => {
  if (sortable) sortable.destroy()
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
        :class="[
          'att-card group relative bg-gray-50 border overflow-hidden',
          isInherited(att) ? 'border-indigo-200 cursor-default' : 'border-gray-200 cursor-move',
        ]"
        :data-inherited="isInherited(att) ? 'true' : null"
        :draggable="!isInherited(att)"
        @dragstart="(e) => onCardDragStart(e, att)"
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

        <!-- Badge "héritée du modèle" pour les captures heritees -->
        <span
          v-if="isInherited(att)"
          class="absolute top-1.5 left-1.5 px-1.5 py-0.5 bg-indigo-600 text-white text-[10px] font-semibold rounded-md inline-flex items-center gap-1 z-10"
          :title="att.source === 'section_template' ? 'Capture héritée du modèle de fonctionnalité' : 'Capture héritée du modèle d\'équipement'"
        >
          📎 Modèle
        </span>

        <button
          v-if="!isInherited(att)"
          @click.stop="removeAttachment(att)"
          class="absolute top-1.5 right-1.5 p-1.5 bg-white/90 hover:bg-red-500 hover:text-white text-gray-600 rounded-md opacity-0 group-hover:opacity-100 transition z-10"
          title="Supprimer"
        >
          <TrashIcon class="w-3.5 h-3.5" />
        </button>

        <input
          v-if="!isInherited(att)"
          v-model="att.caption"
          @blur="saveCaption(att)"
          @click.stop
          type="text"
          placeholder="Légende…"
          class="relative z-10 w-full px-2 py-1 text-xs bg-white border-t border-gray-200 focus:outline-none focus:bg-indigo-50 cursor-text"
        />
        <div
          v-else
          class="relative z-10 w-full px-2 py-1 text-xs bg-indigo-50/40 border-t border-indigo-200 text-indigo-900 truncate"
          :title="att.caption || 'Légende héritée du modèle'"
        >
          {{ att.caption || 'Légende héritée du modèle' }}
        </div>
      </div>
    </div>

    <!-- Lightbox partagée -->
    <ImageLightbox v-model:index="viewerIndex" :images="viewableImages" />
  </div>
</template>

<style>
/* SortableJS classes */
.att-card.sortable-ghost { opacity: 0.4; background: #eef2ff; }
.att-card.sortable-chosen { cursor: grabbing; }
.att-card.sortable-drag { opacity: 0.9; transform: rotate(1deg); box-shadow: 0 10px 25px rgba(0,0,0,0.15); }
</style>
