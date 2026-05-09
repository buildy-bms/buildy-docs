<script setup>
/**
 * Bouton « + Note » à côté de chaque sous-titre (h3) de la carte GTB.
 * Mig 109 : permet de saisir une note libre par sujet, intégrée au PDF
 * sous la sous-section correspondante du chapitre 6 GTB. Visible
 * MÊME quand la GTB est marquée Hors-Service (l'auditeur doit pouvoir
 * tout renseigner pour la traçabilité).
 *
 * Réutilise le NotesEditorModal global du parent BacsAuditDetailView
 * via l'event `open-notes` (entityType: 'bms_topic').
 */
import { computed } from 'vue'
import { PencilSquareIcon } from '@heroicons/vue/24/outline'
import { storeToRefs } from 'pinia'
import { useAuditStore } from '@/stores/audit'

const props = defineProps({
  topicKey: { type: String, required: true },
  topicLabel: { type: String, required: true },
})
const emit = defineEmits(['open-notes'])

const audit = useAuditStore()
const { gtbTopicNotes } = storeToRefs(audit)

const note = computed(() => gtbTopicNotes.value.find(n => n.topic_key === props.topicKey))
const hasNote = computed(() => {
  const html = note.value?.observation_html || ''
  return !!html.replace(/<[^>]*>/g, '').trim()
})

function open() {
  emit('open-notes', {
    title: 'Note — ' + props.topicLabel,
    contextLabel: 'Carte GTB · ' + props.topicLabel,
    entityType: 'bms_topic',
    entityRef: { topic_key: props.topicKey, topic_label: props.topicLabel },
    currentHtml: note.value?.observation_html || '',
  })
}
</script>

<template>
  <button
    type="button"
    @click.stop="open"
    :class="['inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded-md border transition whitespace-nowrap',
      hasNote
        ? 'border-indigo-300 text-indigo-700 bg-indigo-50 hover:bg-indigo-100'
        : 'border-gray-300 text-gray-600 hover:bg-gray-50']"
    :title="hasNote ? 'Voir / éditer la note' : 'Ajouter une note libre'"
  >
    <PencilSquareIcon class="w-3 h-3" />
    {{ hasNote ? 'Note' : '+ Note' }}
  </button>
</template>
