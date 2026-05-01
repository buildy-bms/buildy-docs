<script setup>
/**
 * Wrapper render-light : transforme une zone (n'importe quel container)
 * en drop zone pour photos. Ne rend rien d'autre que le slot ; affiche
 * juste un overlay quand un drag est en cours.
 *
 * Usage :
 *   <PhotoDropzone :site-uuid="..." :attach-to="{ system_id: s.id }" @changed="...">
 *     <div>... contenu de la ligne ...</div>
 *   </PhotoDropzone>
 *
 * Le BacsPhotoButton existant reste a sa place dans le slot ; le drop
 * sur la ligne entiere upload directement, le bouton continue d'ouvrir
 * la galerie. Les deux mecanismes coexistent.
 */
import { computed } from 'vue'
import { usePhotoDropzone } from '@/composables/usePhotoDropzone'

const props = defineProps({
  siteUuid: { type: String, required: true },
  attachTo: { type: Object, required: true },
  // Si false, ne pose pas les handlers (utile pour ligne non encore prete).
  enabled: { type: Boolean, default: true },
})
const emit = defineEmits(['changed'])

const siteUuidRef = computed(() => props.siteUuid)
const attachToRef = computed(() => props.attachTo)

const { isDragOver, handlers } = usePhotoDropzone(
  siteUuidRef,
  attachToRef,
  () => emit('changed')
)
</script>

<template>
  <div
    :class="['relative transition-all', isDragOver ? 'ring-2 ring-indigo-400 ring-offset-1 rounded' : '']"
    v-on="enabled ? {
      dragenter: e => { e.preventDefault(); handlers.onDragenter(e) },
      dragover:  e => { e.preventDefault(); handlers.onDragover(e) },
      dragleave: e => { e.preventDefault(); handlers.onDragleave(e) },
      drop:      e => { e.preventDefault(); handlers.onDrop(e) },
    } : {}"
  >
    <slot />
    <div v-if="isDragOver"
         class="absolute inset-0 flex items-center justify-center bg-indigo-100/60 rounded pointer-events-none z-10">
      <span class="text-xs font-semibold text-indigo-700 bg-white px-3 py-1.5 rounded-full shadow-md">
        📷 Déposer les photos ici
      </span>
    </div>
  </div>
</template>
