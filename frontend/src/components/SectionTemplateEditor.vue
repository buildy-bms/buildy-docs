<script setup>
/**
 * Modale d'édition d'une "section type" (Lot 30).
 *
 * Mirroir light de EquipmentTemplateEditor (sans points, protocoles, icone, categorie).
 * Édite le contenu canonique d'une section standard du plan AF Buildy
 * (titre, articles BACS, body_html). Bouton "Générer avec Claude Desktop" et
 * checkbox "Appliquer aussi aux AFs où le contenu n'a pas été modifié".
 */
import { ref, computed, watch } from 'vue'
import { SparklesIcon } from '@heroicons/vue/24/outline'
import BaseModal from './BaseModal.vue'
import ClaudePromptModal from './ClaudePromptModal.vue'
import RichTextEditor from './RichTextEditor.vue'
import { updateSectionTemplate } from '@/api'
import { useNotification } from '@/composables/useNotification'

const props = defineProps({
  template: { type: Object, required: true },
})
const emit = defineEmits(['close', 'saved'])
const { success, error: notifyError } = useNotification()

const form = ref({
  title: '',
  bacs_articles: '',
  body_html: '',
})
const propagate = ref(true)
const submitting = ref(false)
const showClaudePrompt = ref(false)

watch(() => props.template, (t) => {
  form.value = {
    title: t.title || '',
    bacs_articles: t.bacs_articles || '',
    body_html: t.body_html || '',
  }
}, { immediate: true })

async function submit() {
  if (!form.value.title.trim()) return
  submitting.value = true
  try {
    const payload = {
      title: form.value.title.trim(),
      bacs_articles: form.value.bacs_articles.trim() || null,
      body_html: form.value.body_html || null,
    }
    const { data } = await updateSectionTemplate(props.template.id, payload, { propagateUnchanged: propagate.value })
    if (data.propagated_count > 0) {
      success(`Section type enregistrée — propagée à ${data.propagated_count} AF${data.propagated_count > 1 ? 's' : ''}`)
    } else {
      success('Section type enregistrée')
    }
    emit('saved', data)
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Échec de l\'enregistrement')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <BaseModal :title="`Éditer la section type « ${template.number || ''} ${template.title} »`" size="lg" @close="emit('close')">
    <form @submit.prevent="submit" class="space-y-4">
      <div class="grid grid-cols-3 gap-3">
        <div class="col-span-2">
          <label class="block text-xs font-medium text-gray-700 mb-1">Titre *</label>
          <input v-model="form.title" type="text" required autocomplete="off" data-1p-ignore="true"
                 class="w-full px-3 py-2 border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-700 mb-1">Numéro</label>
          <input :value="template.number || '—'" disabled
                 class="w-full px-3 py-2 border border-gray-200 bg-gray-50 text-sm text-gray-500 font-mono" />
        </div>
      </div>

      <div>
        <label class="block text-xs font-medium text-gray-700 mb-1">Articles BACS applicables</label>
        <input v-model="form.bacs_articles" type="text" autocomplete="off" data-1p-ignore="true"
               placeholder="Ex : R175-3 §1, §2 ; R175-5-1"
               class="w-full px-3 py-2 border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        <p class="text-[10px] text-gray-400 mt-1">Format : <code>R175-1 §1, §2 ; R175-3 §4</code>. Laisser vide si non visé.</p>
      </div>

      <div>
        <div class="flex items-center justify-between mb-1">
          <label class="block text-xs font-medium text-gray-700">
            Contenu canonique
            <span class="text-gray-400 font-normal">— HTML, paragraphes courts</span>
          </label>
          <button type="button" @click="showClaudePrompt = true"
                  class="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] text-violet-700 hover:text-violet-900 border border-violet-300 hover:bg-violet-50 rounded">
            <SparklesIcon class="w-3 h-3" />
            Générer avec Claude Desktop
          </button>
        </div>
        <RichTextEditor
          v-model="form.body_html"
          placeholder="Ce que dit cette section dans le style Buildy : 2-4 paragraphes courts, ton sobre et technique, vocabulaire métier GTB précis…"
          min-height="280px"
        />
      </div>

      <label class="flex items-start gap-2 text-xs text-gray-700 bg-amber-50 border border-amber-200 p-3 rounded">
        <input v-model="propagate" type="checkbox" class="mt-0.5" />
        <span>
          <strong class="font-medium">Appliquer aussi aux AFs existantes</strong> où le contenu n'a pas été modifié.
          Les AFs où la section a été personnalisée ne seront pas écrasées (un bandeau "nouvelle version" s'affichera dans l'éditeur).
        </span>
      </label>
    </form>

    <template #footer>
      <button @click="emit('close')" class="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-800">Annuler</button>
      <button @click="submit" :disabled="submitting || !form.title.trim()"
              class="px-3 py-1.5 text-xs bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">
        {{ submitting ? 'Enregistrement…' : 'Enregistrer' }}
      </button>
    </template>
  </BaseModal>

  <ClaudePromptModal v-if="showClaudePrompt" :template="{ ...form, number: template.number }" mode="standard-section" @close="showClaudePrompt = false" />
</template>
