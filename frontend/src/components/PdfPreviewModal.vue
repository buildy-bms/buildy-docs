<script setup>
/**
 * Modal d'aperçu HTML d'un PDF avant export.
 *
 * Charge le rendu HTML du document (via une URL backend qui retourne
 * le HTML autonome avec CSS embed et fonts data URL) dans une iframe
 * sandboxée plein écran. Permet à l'auditeur de valider visuellement
 * le contenu avant de déclencher la génération PDF Puppeteer (qui prend
 * 3-5s par export).
 *
 * Usage :
 *   <PdfPreviewModal
 *     v-if="previewOpen"
 *     title="Aperçu rapport audit BACS"
 *     :preview-url="`/api/bacs-audit/${docId}/preview`"
 *     :downloading="exporting"
 *     @download="exportPdf"
 *     @close="previewOpen = false"
 *   />
 */
import { onMounted, onUnmounted } from 'vue'
import { XMarkIcon, DocumentArrowDownIcon } from '@heroicons/vue/24/outline'

const props = defineProps({
  title: { type: String, required: true },
  previewUrl: { type: String, required: true },
  downloading: { type: Boolean, default: false },
  downloadLabel: { type: String, default: 'Télécharger le PDF' },
})
const emit = defineEmits(['close', 'download'])

function onEsc(e) { if (e.key === 'Escape') emit('close') }
onMounted(() => document.addEventListener('keydown', onEsc))
onUnmounted(() => document.removeEventListener('keydown', onEsc))
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-50 bg-black/60 flex items-stretch justify-center" @click.self="emit('close')">
      <div class="bg-white shadow-2xl flex flex-col w-full max-w-[1100px] m-4 rounded-xl overflow-hidden">
        <header class="flex items-center justify-between px-5 py-3 border-b border-gray-200 bg-gray-50 shrink-0">
          <div class="flex items-center gap-2">
            <h2 class="text-sm font-semibold text-gray-800">{{ title }}</h2>
            <span class="text-[11px] text-gray-500 italic">Aperçu indicatif (pagination simulée par le navigateur)</span>
          </div>
          <div class="flex items-center gap-2">
            <button @click="emit('download')" :disabled="downloading"
                    class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-60">
              <DocumentArrowDownIcon class="w-4 h-4" />
              {{ downloading ? 'Génération…' : downloadLabel }}
            </button>
            <button @click="emit('close')" aria-label="Fermer l'aperçu"
                    class="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded">
              <XMarkIcon class="w-5 h-5" />
            </button>
          </div>
        </header>
        <iframe :src="previewUrl"
                title="Aperçu PDF"
                class="flex-1 w-full bg-white border-0"
                sandbox="allow-same-origin" />
      </div>
    </div>
  </Teleport>
</template>
