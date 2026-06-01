<script setup>
/**
 * Variante de PhotoDropzone dont la racine est un <tr>, pour usage
 * direct dans un tbody. Sinon meme contrat (siteUuid + attachTo).
 *
 * Accepte images ET PDFs : images upload direct, PDFs ouvrent la modale
 * DocumentUploadModal (titre + categorie obligatoires) — la modale est
 * Teleport-ee dans le body pour ne pas violer la structure <tr>.
 *
 * inheritAttrs: false + v-bind="$attrs" sur le <tr> : le composant a 2
 * roots (tr + Teleport) donc Vue ne sait pas où attacher automatiquement
 * les data-* (data-zone-id, data-device-id, etc. utilisés pour le scroll
 * depuis les pilules d'actions). On les binde explicitement sur le tr.
 */
import { computed } from 'vue'
import { usePhotoDropzone } from '@/composables/usePhotoDropzone'
import DocumentUploadModal from './DocumentUploadModal.vue'

defineOptions({ inheritAttrs: false })

const props = defineProps({
  siteUuid: { type: String, required: true },
  attachTo: { type: Object, required: true },
  enabled: { type: Boolean, default: true },
  rowClass: { type: String, default: '' },
})
const emit = defineEmits(['changed'])

const siteUuidRef = computed(() => props.siteUuid)
const attachToRef = computed(() => props.attachTo)

const {
  isDragOver,
  uploading,
  handlers,
  pendingDocs,
  uploadDocsWithMeta,
  cancelPendingDocs,
} = usePhotoDropzone(siteUuidRef, attachToRef, () => emit('changed'))
</script>

<template>
  <tr
    v-bind="$attrs"
    :class="[rowClass, isDragOver ? 'bg-indigo-50 outline outline-2 outline-indigo-400' : '']"
    v-on="enabled ? {
      dragenter: e => { e.preventDefault(); e.stopPropagation(); handlers.onDragenter(e) },
      dragover:  e => { e.preventDefault(); e.stopPropagation(); handlers.onDragover(e) },
      dragleave: e => { e.preventDefault(); e.stopPropagation(); handlers.onDragleave(e) },
      drop:      e => { e.preventDefault(); e.stopPropagation(); handlers.onDrop(e) },
    } : {}"
  >
    <slot />
  </tr>
  <Teleport to="body">
    <DocumentUploadModal
      v-if="pendingDocs.length > 0"
      :files="pendingDocs"
      :uploading="uploading"
      @confirm="uploadDocsWithMeta"
      @cancel="cancelPendingDocs"
    />
  </Teleport>
</template>
