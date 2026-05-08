<script setup>
/**
 * Modale de régénération partielle (Partie 1.E) — déclenchée depuis le
 * BubbleMenu Tiptap quand l'utilisateur a une sélection dans l'éditeur.
 *
 * Affiche le passage sélectionné (lecture seule), un champ instruction
 * libre, et appelle `/api/faq/ai/rewrite-selection`. Émet `rewritten`
 * avec le HTML retourné, l'éditeur s'occupe de la substitution.
 */
import { ref } from 'vue'
import { SparklesIcon, ArrowPathIcon } from '@heroicons/vue/24/outline'
import BaseModal from './BaseModal.vue'
import SafeHtml from './SafeHtml.vue'
import { useFaqStore } from '@/stores/faq'
import { useNotification } from '@/composables/useNotification'

const props = defineProps({
  articleId: { type: [Number, String], required: true },
  selectionHtml: { type: String, required: true },
})
const emit = defineEmits(['close', 'rewritten'])

const store = useFaqStore()
const { success, error: notifyError } = useNotification()

const instruction = ref('')
const running = ref(false)

const SUGGESTIONS = [
  'Raccourcir',
  'Rendre plus pédagogue (vulgariser)',
  'Ajouter un exemple concret',
  'Reformuler avec un encart info',
  'Préciser et étoffer',
]

async function rewrite() {
  running.value = true
  try {
    const data = await store.aiRewriteSelection({
      article_id: parseInt(props.articleId, 10),
      selection_html: props.selectionHtml,
      instruction: instruction.value.trim(),
    })
    success('Passage réécrit')
    emit('rewritten', data)
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Échec')
  } finally {
    running.value = false
  }
}
</script>

<template>
  <BaseModal size="lg" :dismiss-on-backdrop="false" title="Réécrire ce passage avec l'IA" @close="emit('close')">
    <div>
      <p class="text-sm text-gray-500 -mt-1 mb-3">
        L'IA réécrit uniquement la sélection en gardant son sens et sa structure HTML. L'historique de l'article est snapshoté avant pour permettre un retour arrière.
      </p>

      <label class="block text-sm font-medium text-gray-700 mb-1.5">Passage sélectionné</label>
      <div class="border border-gray-200 rounded-lg p-3 max-h-40 overflow-y-auto bg-gray-50/50 prose prose-sm max-w-none mb-4">
        <SafeHtml :html="selectionHtml" />
      </div>

      <label class="block text-sm font-medium text-gray-700 mb-1.5">
        Instruction <span class="text-gray-400 font-normal">(optionnel)</span>
      </label>
      <textarea v-model="instruction" rows="2"
                placeholder="Ex : raccourcir, rendre plus pédagogue, ajouter un exemple…"
                class="w-full px-3.5 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition resize-y mb-2" />
      <div class="flex flex-wrap gap-1.5 mb-5">
        <button v-for="s in SUGGESTIONS" :key="s" type="button" @click="instruction = s"
                class="px-2.5 py-0.5 text-xs rounded-full border border-gray-200 hover:border-violet-300 hover:bg-violet-50 text-gray-600 transition whitespace-nowrap">
          {{ s }}
        </button>
      </div>

      <div class="flex items-center justify-end gap-2 pt-3 border-t border-gray-100">
        <button type="button" @click="emit('close')"
                class="px-4 py-2 text-sm font-medium text-gray-700 rounded-lg hover:bg-gray-100 transition whitespace-nowrap">
          Annuler
        </button>
        <button type="button" @click="rewrite" :disabled="running"
                class="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-violet-600 text-white hover:bg-violet-700 transition whitespace-nowrap disabled:opacity-50 shadow-sm">
          <ArrowPathIcon v-if="running" class="w-4 h-4 shrink-0 animate-spin" />
          <SparklesIcon v-else class="w-4 h-4 shrink-0" />
          {{ running ? 'Réécriture…' : 'Réécrire' }}
        </button>
      </div>
    </div>
  </BaseModal>
</template>
