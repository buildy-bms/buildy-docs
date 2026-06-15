<script setup>
/**
 * Aperçu PDF d'un livre blanc en modale plein écran.
 * Fetch /api/whitepapers/:id/preview/pdf, crée un blob URL et l'affiche
 * dans un <iframe> (viewer PDF natif Chromium/Firefox/Safari). Bouton
 * « Régénérer » pour relancer le rendu Puppeteer après édition.
 *
 * Cookie OIDC inclus automatiquement (same-origin fetch). Blob URL
 * libéré au close pour ne pas leaker de mémoire.
 */
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { ArrowPathIcon, ArrowDownTrayIcon } from '@heroicons/vue/24/outline'
import BaseModal from '@/components/BaseModal.vue'
import { useNotification } from '@/composables/useNotification'

const props = defineProps({
  id: { type: [Number, String], required: true },
  title: { type: String, default: 'Aperçu PDF' },
})
const emit = defineEmits(['close'])

const { error: notifyError } = useNotification()
const loading = ref(false)
const blobUrl = ref(null)

async function fetchPdf() {
  loading.value = true
  if (blobUrl.value) {
    URL.revokeObjectURL(blobUrl.value)
    blobUrl.value = null
  }
  try {
    const res = await fetch(`/api/whitepapers/${props.id}/preview/pdf`, {
      credentials: 'same-origin',
      headers: { Accept: 'application/pdf' },
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(text || `HTTP ${res.status}`)
    }
    const blob = await res.blob()
    blobUrl.value = URL.createObjectURL(blob)
  } catch (e) {
    notifyError(`Échec de l'aperçu PDF : ${e.message || e}`)
    emit('close')
  } finally {
    loading.value = false
  }
}

function download() {
  // Force le téléchargement (Content-Disposition: attachment) via la
  // route d'export classique.
  window.location.href = `/api/whitepapers/${props.id}/export/pdf`
}

onMounted(fetchPdf)
onBeforeUnmount(() => {
  if (blobUrl.value) URL.revokeObjectURL(blobUrl.value)
})
</script>

<template>
  <BaseModal :title="title" size="full" @close="emit('close')">
    <!-- Iframe qui occupe toute la modale (92vh - header BaseModal ~50px).
         Le viewer PDF natif du navigateur s'affiche dedans. -->
    <div class="relative -mx-5 -my-3 bg-gray-100" style="height: calc(92vh - 110px); min-height: 500px;">
      <div v-if="loading" class="absolute inset-0 flex items-center justify-center text-gray-500 text-sm">
        <ArrowPathIcon class="w-5 h-5 mr-2 animate-spin" />
        Génération du PDF…
      </div>
      <iframe
        v-if="blobUrl"
        :src="blobUrl"
        class="w-full h-full border-0"
        title="Aperçu PDF du livre blanc"
      />
    </div>

    <template #footer>
      <button
        @click="fetchPdf"
        :disabled="loading"
        class="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50"
        v-tooltip="'Relance le rendu Puppeteer (après édition du contenu)'"
      >
        <ArrowPathIcon class="w-4 h-4" :class="loading ? 'animate-spin' : ''" />
        Régénérer
      </button>
      <button
        @click="download"
        class="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50"
      >
        <ArrowDownTrayIcon class="w-4 h-4" />
        Télécharger
      </button>
      <button
        @click="emit('close')"
        class="inline-flex items-center px-3 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg"
      >
        Fermer
      </button>
    </template>
  </BaseModal>
</template>
