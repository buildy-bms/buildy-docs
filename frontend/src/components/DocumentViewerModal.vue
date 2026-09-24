<script setup>
// Aperçu d'un document joint dans l'appli (PDF ou image), sans le
// télécharger : le PDF est servi inline (?inline=1) et affiché par la
// visionneuse du navigateur. Fermeture par Échap, par la croix ou par un
// clic en dehors de la fenêtre.
import { computed, watch, onBeforeUnmount } from 'vue'
import {
  XMarkIcon, ArrowDownTrayIcon, ArrowTopRightOnSquareIcon, DocumentIcon,
} from '@heroicons/vue/24/outline'
import { getSiteDocumentDownloadUrl, getSiteDocumentViewUrl } from '@/api'

const props = defineProps({
  // { id, title, original_name, mime_type, size_bytes } ou null (fermé)
  doc: { type: Object, default: null },
})
const emit = defineEmits(['close'])

const isPdf = computed(() => {
  const d = props.doc
  if (!d) return false
  return d.mime_type === 'application/pdf' || /\.pdf$/i.test(d.original_name || d.title || '')
})
const isImage = computed(() => String(props.doc?.mime_type || '').startsWith('image/'))
const title = computed(() => props.doc?.title || props.doc?.original_name || 'Document')
const viewUrl = computed(() => (props.doc ? getSiteDocumentViewUrl(props.doc.id) : ''))
const downloadUrl = computed(() => (props.doc ? getSiteDocumentDownloadUrl(props.doc.id) : ''))

function fmtSize(b) {
  if (!b) return ''
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} Ko`
  return `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} Mo`
}

function onKey(e) {
  if (e.key === 'Escape') emit('close')
}
watch(() => props.doc, (d) => {
  if (d) window.addEventListener('keydown', onKey)
  else window.removeEventListener('keydown', onKey)
}, { immediate: true })
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <div v-if="doc"
         class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
         @click.self="emit('close')">
      <div class="flex h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
           role="dialog" aria-modal="true" :aria-label="`Aperçu : ${title}`">
        <header class="flex items-center gap-3 border-b border-gray-200 px-4 py-2.5">
          <DocumentIcon class="h-5 w-5 shrink-0 text-gray-400" />
          <div class="min-w-0 flex-1">
            <h3 class="truncate text-sm font-semibold text-gray-800">{{ title }}</h3>
            <p class="truncate text-xs text-gray-500">
              {{ doc.original_name }}<template v-if="doc.size_bytes"> · {{ fmtSize(doc.size_bytes) }}</template>
            </p>
          </div>
          <a :href="isPdf ? viewUrl : downloadUrl" target="_blank" rel="noopener"
             class="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
             v-tooltip="'Ouvrir dans un nouvel onglet'">
            <ArrowTopRightOnSquareIcon class="h-4 w-4" /> Nouvel onglet
          </a>
          <a :href="downloadUrl"
             class="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">
            <ArrowDownTrayIcon class="h-4 w-4" /> Télécharger
          </a>
          <button type="button" @click="emit('close')"
                  class="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                  v-tooltip="'Fermer (Échap)'">
            <XMarkIcon class="h-5 w-5" />
          </button>
        </header>
        <div class="min-h-0 flex-1 bg-gray-100">
          <iframe v-if="isPdf" :src="viewUrl" :title="title" class="h-full w-full border-0" />
          <div v-else-if="isImage" class="flex h-full items-center justify-center p-4">
            <img :src="downloadUrl" :alt="title" decoding="async"
                 class="max-h-full max-w-full rounded object-contain shadow" />
          </div>
          <div v-else class="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            <p class="text-sm text-gray-600">Aperçu indisponible pour ce type de fichier.</p>
            <a :href="downloadUrl"
               class="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
              <ArrowDownTrayIcon class="h-4 w-4" /> Télécharger le fichier
            </a>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
