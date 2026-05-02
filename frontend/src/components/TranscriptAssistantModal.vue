<script setup>
import { ref, computed, watch } from 'vue'
import { XMarkIcon, ArrowUpTrayIcon, SparklesIcon, CheckIcon, NoSymbolIcon } from '@heroicons/vue/24/outline'
import {
  listBacsTranscripts, uploadBacsTranscript, generateBacsSuggestions,
  listBacsSuggestions, applyBacsSuggestion, rejectBacsSuggestion,
} from '@/api'
import { useNotification } from '@/composables/useNotification'

const props = defineProps({
  open: { type: Boolean, default: false },
  documentId: { type: Number, required: true },
})
const emit = defineEmits(['close', 'applied'])
const { success, error } = useNotification()

const transcripts = ref([])
const suggestions = ref([])
const generating = ref(false)
const uploading = ref(false)
const fileInput = ref(null)

async function refresh() {
  if (!props.documentId) return
  const [t, s] = await Promise.all([
    listBacsTranscripts(props.documentId),
    listBacsSuggestions(props.documentId),
  ])
  transcripts.value = t.data
  suggestions.value = s.data
}
watch(() => props.open, (v) => { if (v) refresh() })

function pickFile() { fileInput.value?.click() }
async function onFile(e) {
  const f = (e.target.files || [])[0]
  if (!f) return
  uploading.value = true
  try {
    const { data } = await uploadBacsTranscript(props.documentId, f)
    success('Transcript importé')
    e.target.value = ''
    await refresh()
    await runSuggestions(data.id)
  } catch (err) {
    error(err.response?.data?.detail || 'Échec de l\'import')
  } finally {
    uploading.value = false
  }
}

async function runSuggestions(transcriptId) {
  generating.value = true
  try {
    const { data } = await generateBacsSuggestions(transcriptId)
    success(`${data.count} suggestion(s) générée(s) par Claude`)
    await refresh()
  } catch (err) {
    error(err.response?.data?.detail || 'Échec de la génération')
  } finally {
    generating.value = false
  }
}

async function apply(id) {
  try {
    await applyBacsSuggestion(id)
    await refresh()
    emit('applied')
  } catch (err) {
    error(err.response?.data?.detail || 'Échec de l\'application')
  }
}
async function reject(id) {
  try {
    await rejectBacsSuggestion(id)
    await refresh()
  } catch (err) {
    error('Échec du rejet')
  }
}

const pendingSuggestions = computed(() => suggestions.value.filter(s => s.status === 'pending'))
const resolvedSuggestions = computed(() => suggestions.value.filter(s => s.status !== 'pending'))

function close() { emit('close') }
</script>

<template>
  <div v-if="open" class="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
    <div class="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
      <header class="flex items-center justify-between px-5 py-3 border-b border-gray-200">
        <div class="flex items-center gap-2">
          <SparklesIcon class="w-5 h-5 text-indigo-600" />
          <h2 class="text-base font-semibold text-gray-800">Assistant de restitution — transcript Plaud Pro</h2>
        </div>
        <button @click="close" class="text-gray-400 hover:text-gray-600"><XMarkIcon class="w-5 h-5" /></button>
      </header>

      <div class="flex-1 overflow-y-auto p-5 space-y-4 text-sm">
        <section class="bg-gray-50 border border-gray-200 rounded-lg p-3">
          <div class="flex items-center justify-between gap-3">
            <div class="text-xs text-gray-600">
              Importez le <code>.txt</code> de Plaud Pro. Claude propose des pré-remplissages champ par champ
              (vous validez ou rejetez).
            </div>
            <input ref="fileInput" type="file" accept=".txt,.md" class="hidden" @change="onFile" />
            <button @click="pickFile" :disabled="uploading"
              class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-60">
              <ArrowUpTrayIcon class="w-4 h-4" /> {{ uploading ? 'Import…' : 'Importer un transcript' }}
            </button>
          </div>
          <ul v-if="transcripts.length" class="mt-3 text-xs text-gray-600 space-y-1">
            <li v-for="t in transcripts" :key="t.id" class="flex items-center justify-between">
              <span>📝 {{ t.original_name || t.id }} — {{ new Date(t.uploaded_at).toLocaleString('fr-FR') }}</span>
              <button @click="runSuggestions(t.id)" :disabled="generating"
                class="text-indigo-600 hover:underline disabled:opacity-60">
                Régénérer suggestions
              </button>
            </li>
          </ul>
        </section>

        <section v-if="pendingSuggestions.length">
          <h3 class="font-semibold text-gray-800 mb-2">Suggestions à valider ({{ pendingSuggestions.length }})</h3>
          <div class="space-y-2">
            <div v-for="s in pendingSuggestions" :key="s.id"
              class="border border-gray-200 rounded-lg p-3 bg-white">
              <div class="flex items-center gap-2 text-xs text-gray-500 mb-1">
                <span v-if="s.target_ref" class="font-mono px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-100">{{ s.target_ref }}</span>
                <span class="font-mono">{{ s.target_kind }}</span>
                <span class="ml-auto" v-if="s.confidence != null">conf. {{ (s.confidence * 100).toFixed(0) }}%</span>
              </div>
              <div class="text-sm">
                <strong class="text-gray-800">{{ s.field_name }}</strong>
                <span class="text-gray-500"> = </span>
                <span class="text-emerald-700">{{ s.suggested_value }}</span>
              </div>
              <blockquote v-if="s.source_quote" class="mt-1 text-xs italic text-gray-500 border-l-2 border-gray-200 pl-2">
                « {{ s.source_quote }} »
              </blockquote>
              <div class="mt-2 flex gap-2">
                <button @click="apply(s.id)"
                  class="inline-flex items-center gap-1 px-2.5 py-1 text-xs bg-emerald-600 text-white rounded hover:bg-emerald-700">
                  <CheckIcon class="w-3.5 h-3.5" /> Appliquer
                </button>
                <button @click="reject(s.id)"
                  class="inline-flex items-center gap-1 px-2.5 py-1 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200">
                  <NoSymbolIcon class="w-3.5 h-3.5" /> Rejeter
                </button>
              </div>
            </div>
          </div>
        </section>

        <section v-else-if="!generating && !transcripts.length" class="text-center text-xs text-gray-500 py-8">
          Aucun transcript importé pour cet audit.
        </section>

        <section v-if="resolvedSuggestions.length" class="opacity-70">
          <h3 class="font-semibold text-gray-700 mb-2 text-xs uppercase">Historique ({{ resolvedSuggestions.length }})</h3>
          <ul class="text-xs text-gray-500 space-y-1">
            <li v-for="s in resolvedSuggestions" :key="s.id" class="flex items-center gap-2">
              <span :class="s.status === 'applied' ? 'text-emerald-600' : 'text-gray-400 line-through'">
                {{ s.status === 'applied' ? '✓' : '✗' }} {{ s.target_ref }} {{ s.field_name }} = {{ s.suggested_value }}
              </span>
            </li>
          </ul>
        </section>
      </div>

      <footer class="border-t border-gray-200 px-5 py-3 flex justify-end">
        <button @click="close"
          class="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200">Fermer</button>
      </footer>
    </div>
  </div>
</template>
