<script setup>
/**
 * Variante de PhotoDropzone dont la racine est un <tr>, pour usage
 * direct dans un tbody. Sinon meme contrat (siteUuid + attachTo).
 */
import { computed } from 'vue'
import { usePhotoDropzone } from '@/composables/usePhotoDropzone'

const props = defineProps({
  siteUuid: { type: String, required: true },
  attachTo: { type: Object, required: true },
  enabled: { type: Boolean, default: true },
  rowClass: { type: String, default: '' },
})
const emit = defineEmits(['changed'])

const siteUuidRef = computed(() => props.siteUuid)
const attachToRef = computed(() => props.attachTo)

const { isDragOver, handlers } = usePhotoDropzone(
  siteUuidRef, attachToRef, () => emit('changed'),
)
</script>

<template>
  <tr
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
</template>
