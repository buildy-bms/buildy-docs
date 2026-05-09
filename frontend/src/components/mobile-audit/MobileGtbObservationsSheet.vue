<script setup>
/**
 * Constats GTB hors-décret + opportunités Buildy — sheet mobile (mig 108).
 * Liste les sujets GTB ; chaque tap ouvre un sub-sheet avec les deux champs
 * (observation + opportunité) et un bouton « Suggérer avec Claude ».
 *
 * Pour rester tactile-friendly, on utilise des <textarea> simples, pas un
 * RichTextEditor : le texte saisi sur PWA est encadré <p>...</p> au save
 * (le PDF accepte les deux). L'édition fine en richtext reste desktop.
 */
import { ref, computed, watch } from 'vue'
import { SparklesIcon, ChatBubbleLeftRightIcon, ChevronRightIcon } from '@heroicons/vue/24/outline'
import { useAuditStore } from '@/stores/audit'
import { useNotification } from '@/composables/useNotification'
import {
  getBacsGtbObservations, updateBacsGtbObservation, suggestBacsGtbObservation,
} from '@/api'
import MobileSheet from './MobileSheet.vue'

const props = defineProps({
  open: { type: Boolean, default: false },
})
defineEmits(['close'])

const audit = useAuditStore()
const { error, success } = useNotification()

const items = ref([])
const loading = ref(false)
const editingKey = ref(null)
const suggesting = ref(false)
const localObs = ref('')
const localOpp = ref('')

watch(() => props.open, async (v) => {
  if (!v) return
  loading.value = true
  try {
    const r = await getBacsGtbObservations(audit.docId)
    items.value = r.data
  } catch (e) {
    error(e.response?.data?.detail || 'Chargement impossible')
  } finally {
    loading.value = false
  }
})

const editingTopic = computed(() => items.value.find(i => i.topic_key === editingKey.value) || null)

function htmlToText(html) {
  if (!html) return ''
  return html.replace(/<\/?p[^>]*>/gi, '\n').replace(/<[^>]*>/g, '').trim()
}

function textToHtml(text) {
  if (!text || !text.trim()) return ''
  return text.split(/\n+/).filter(Boolean).map(p => `<p>${p.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>`).join('')
}

function openItem(it) {
  editingKey.value = it.topic_key
  localObs.value = htmlToText(it.observation_html)
  localOpp.value = htmlToText(it.opportunity_html)
}

async function saveItem() {
  if (!editingTopic.value) return
  const patch = {
    observation_html: textToHtml(localObs.value),
    opportunity_html: textToHtml(localOpp.value),
  }
  try {
    await updateBacsGtbObservation(audit.docId, editingKey.value, patch)
    Object.assign(editingTopic.value, patch)
    editingKey.value = null
    success('Constat enregistré')
  } catch (e) {
    error(e.response?.data?.detail || 'Sauvegarde impossible')
  }
}

async function suggestNow() {
  if (suggesting.value || !editingKey.value) return
  suggesting.value = true
  try {
    const r = await suggestBacsGtbObservation(audit.docId, editingKey.value)
    localObs.value = htmlToText(r.data.observation_html || '')
    localOpp.value = htmlToText(r.data.opportunity_html || '')
    success('Suggestion appliquée — édite avant d\'enregistrer.')
  } catch (e) {
    error(e.response?.data?.detail || 'Suggestion impossible')
  } finally {
    suggesting.value = false
  }
}

function isFilled(it) {
  return (it.observation_html?.replace(/<[^>]*>/g, '').trim().length || 0) > 0
      || (it.opportunity_html?.replace(/<[^>]*>/g, '').trim().length || 0) > 0
}
</script>

<template>
  <MobileSheet :open="open" title="Constats GTB" hide-save @close="$emit('close')">
    <div class="p-4 space-y-3">
      <div class="bg-violet-50 border border-violet-200 rounded-xl p-3 flex items-start gap-3">
        <ChatBubbleLeftRightIcon class="w-5 h-5 text-violet-600 shrink-0 mt-0.5" />
        <div class="flex-1 text-xs text-violet-900 leading-relaxed">
          Pour chaque sujet GTB, note ce que tu observes et l'opportunité Buildy.
          <strong>Tout est intégré au PDF rapport</strong>, même hors décret BACS.
        </div>
      </div>

      <div v-if="loading" class="text-sm text-gray-400 text-center py-6">Chargement…</div>
      <button
        v-for="it in items"
        :key="it.topic_key"
        type="button"
        @click="openItem(it)"
        class="w-full text-left bg-white border border-gray-200 rounded-xl px-4 py-3 flex items-center justify-between gap-3 active:bg-gray-50"
      >
        <div class="min-w-0 flex-1">
          <div class="text-sm font-semibold text-gray-800 flex items-center gap-2">
            {{ it.label }}
            <span v-if="isFilled(it)" class="inline-block w-2 h-2 rounded-full bg-emerald-500"></span>
          </div>
          <div v-if="it.description" class="text-[11px] text-gray-500 mt-0.5">{{ it.description }}</div>
        </div>
        <ChevronRightIcon class="w-5 h-5 text-gray-400 shrink-0" />
      </button>
    </div>

    <!-- Sub-sheet d'édition d'un sujet -->
    <MobileSheet
      :open="editingKey !== null"
      :title="editingTopic?.label || 'Constat'"
      save-label="Enregistrer"
      @close="editingKey = null"
      @save="saveItem"
    >
      <div class="p-4 space-y-4">
        <button
          type="button"
          @click="suggestNow"
          :disabled="suggesting"
          class="w-full inline-flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium text-violet-700 bg-violet-50 border border-violet-200 active:bg-violet-100 rounded-xl disabled:opacity-50"
        >
          <SparklesIcon :class="['w-4 h-4', suggesting ? 'animate-pulse' : '']" />
          {{ suggesting ? 'Génération…' : 'Suggérer avec Claude' }}
        </button>

        <div class="space-y-1.5">
          <label class="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
            Observation (état actuel)
          </label>
          <textarea
            v-model="localObs"
            rows="5"
            placeholder="Ce que tu constates sur site — factuel, neutre."
            class="w-full text-sm rounded-lg border border-gray-200 p-3 focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400"
          ></textarea>
        </div>

        <div class="space-y-1.5">
          <label class="block text-[11px] font-semibold text-violet-700 uppercase tracking-wider">
            Opportunité Buildy
          </label>
          <textarea
            v-model="localOpp"
            rows="5"
            placeholder="Ce que Buildy peut apporter ici."
            class="w-full text-sm rounded-lg border border-gray-200 p-3 focus:outline-none focus:ring-2 focus:ring-violet-200 focus:border-violet-400"
          ></textarea>
        </div>

        <p class="text-[11px] text-gray-500 italic">
          Sur mobile, on saisit du texte simple — l'édition richtext (gras, listes…) reste sur desktop.
        </p>
      </div>
    </MobileSheet>
  </MobileSheet>
</template>
