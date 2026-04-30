<script setup>
/**
 * Lightbox image partagée — utilisée par AttachmentsGrid (sections AF) et
 * TemplateAttachmentsGrid (templates de bibliothèque).
 *
 * Usage :
 *   <ImageLightbox
 *     :images="[{ url, name }, ...]"
 *     v-model:index="lightboxIndex"
 *   />
 *
 * - `images` : tableau d'objets { url, name } (name affiché en légende)
 * - `index` (v-model) : index courant ; null pour fermer
 * - Raccourcis : Esc ferme, ← / → naviguent
 * - Click sur l'arrière-plan ferme aussi
 */
import { computed, watch, onUnmounted } from 'vue'
import { XMarkIcon, ChevronLeftIcon, ChevronRightIcon } from '@heroicons/vue/24/outline'

const props = defineProps({
  images: { type: Array, required: true }, // [{ url: string, name?: string }]
  index: { type: Number, default: null },
})
const emit = defineEmits(['update:index'])

const open = computed(() => props.index !== null && props.index >= 0 && props.index < props.images.length)
const current = computed(() => open.value ? props.images[props.index] : null)
const hasPrev = computed(() => open.value && props.index > 0)
const hasNext = computed(() => open.value && props.index < props.images.length - 1)

function close() { emit('update:index', null) }
function prev() { if (hasPrev.value) emit('update:index', props.index - 1) }
function next() { if (hasNext.value) emit('update:index', props.index + 1) }

function onKey(e) {
  if (!open.value) return
  if (e.key === 'Escape') { e.preventDefault(); close() }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); prev() }
  else if (e.key === 'ArrowRight') { e.preventDefault(); next() }
}

watch(open, (isOpen) => {
  if (isOpen) window.addEventListener('keydown', onKey)
  else window.removeEventListener('keydown', onKey)
}, { immediate: true })

onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4"
      @click.self="close"
      role="dialog"
      aria-modal="true"
    >
      <!-- Fermer -->
      <button
        @click="close"
        class="absolute top-4 right-4 p-2 text-white/80 hover:text-white bg-white/10 hover:bg-white/20 rounded-lg"
        :title="`Fermer (Esc)`"
        aria-label="Fermer la visionneuse"
      >
        <XMarkIcon class="w-6 h-6" />
      </button>

      <!-- Précédent -->
      <button
        v-if="hasPrev"
        @click.stop="prev"
        class="absolute left-4 p-2 text-white/80 hover:text-white bg-white/10 hover:bg-white/20 rounded-full"
        title="Précédent (←)"
        aria-label="Image précédente"
      >
        <ChevronLeftIcon class="w-7 h-7" />
      </button>

      <!-- Suivant -->
      <button
        v-if="hasNext"
        @click.stop="next"
        class="absolute right-4 p-2 text-white/80 hover:text-white bg-white/10 hover:bg-white/20 rounded-full"
        title="Suivant (→)"
        aria-label="Image suivante"
      >
        <ChevronRightIcon class="w-7 h-7" />
      </button>

      <!-- Image + légende -->
      <div class="max-w-full max-h-full flex flex-col items-center gap-3" @click.stop>
        <img
          :src="current.url"
          :alt="current.name || ''"
          class="max-w-full max-h-[85vh] object-contain shadow-2xl"
        />
        <p v-if="current.name" class="text-sm text-white/70 text-center">{{ current.name }}</p>
        <p v-if="images.length > 1" class="text-xs text-white/50">
          {{ index + 1 }} / {{ images.length }}
        </p>
      </div>
    </div>
  </Teleport>
</template>
