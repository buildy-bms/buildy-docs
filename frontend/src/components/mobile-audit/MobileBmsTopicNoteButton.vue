<script setup>
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import '@/lib/equipment-icons'
/**
 * Bouton « + Note » à côté de chaque sous-titre de la carte GTB sur
 * mobile (mig 109). Self-contained : gère son propre sheet d'édition
 * (textarea simple) et sauvegarde via le store audit.
 *
 * Pourquoi pas le NotesEditorModal global ? Il est défini sur la vue
 * desktop ; sur mobile on évite la complexité d'un store de modale
 * partagé : un sheet simple suffit.
 */
import { ref, computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useAuditStore } from '@/stores/audit'
import { useNotification } from '@/composables/useNotification'
import MobileSheet from './MobileSheet.vue'

const props = defineProps({
  topicKey: { type: String, required: true },
  topicLabel: { type: String, required: true },
})

const audit = useAuditStore()
const { gtbTopicNotes } = storeToRefs(audit)
const { error, success } = useNotification()

const open = ref(false)
const localText = ref('')

const note = computed(() => gtbTopicNotes.value.find(n => n.topic_key === props.topicKey))
const hasNote = computed(() => {
  const html = note.value?.observation_html || ''
  return !!html.replace(/<[^>]*>/g, '').trim()
})

function htmlToText(html) {
  if (!html) return ''
  return html.replace(/<\/?p[^>]*>/gi, '\n').replace(/<[^>]*>/g, '').trim()
}

function textToHtml(text) {
  if (!text || !text.trim()) return ''
  return text.split(/\n+/).filter(Boolean)
    .map(p => `<p>${p.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>`).join('')
}

function openSheet() {
  localText.value = htmlToText(note.value?.observation_html || '')
  open.value = true
}

async function save() {
  try {
    await audit.saveGtbTopicNote(props.topicKey, textToHtml(localText.value))
    success('Note enregistrée')
    open.value = false
  } catch (e) {
    error(e.response?.data?.detail || 'Sauvegarde impossible')
  }
}
</script>

<template>
  <button
    type="button"
    @click.stop="openSheet"
    :class="['pwa-button border whitespace-nowrap',
      hasNote
        ? 'border-indigo-300 text-indigo-700 bg-indigo-50'
        : 'border-gray-300 text-gray-600 bg-white']"
  >
    <FontAwesomeIcon :icon="['fas', 'pen-to-square']" class="w-5 h-5" />
    {{ hasNote ? 'Note' : '+ Note' }}
  </button>

  <MobileSheet :open="open" :title="'Note — ' + topicLabel" save-label="Enregistrer"
               @close="open = false" @save="save">
    <div class="p-4 space-y-3">
      <p class="text-xs text-gray-500 leading-relaxed">
        Saisis ici tout ce que tu observes sur ce sujet (état actuel, défauts, contournements).
        Cette note apparaîtra dans le PDF rapport sous cette sous-section.
      </p>
      <textarea
        v-model="localText"
        rows="8"
        placeholder="Ce que tu observes…"
        class="pwa-input resize-y"
      ></textarea>
    </div>
  </MobileSheet>
</template>
