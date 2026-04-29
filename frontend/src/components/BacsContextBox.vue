<script setup>
/**
 * Encart contextualisé "lien avec le décret BACS" — version visible
 * (vs le simple BacsBadge qui ne montre qu'une référence).
 *
 * - Badge cliquable → modale avec extrait
 * - Phrase explicative au-dessous : justification rédigée par l'utilisateur
 *   OU fallback auto basé sur le résumé de(s) article(s) référencé(s)
 *
 * Props :
 *   reference  : "R175-1 §1, §2 ; R175-3"
 *   justification : texte libre (optionnel, prioritaire sur le fallback)
 *   context : 'section' | 'equipment'
 *   editable : boolean — affiche un mini-input pour rédiger/éditer la justification
 *   sectionId / templateId : pour l'édition (passe une mutation à l'appel)
 */
import { ref, onMounted, computed, watch } from 'vue'
import { ScaleIcon, PencilSquareIcon, CheckIcon, XMarkIcon } from '@heroicons/vue/24/outline'
import { getBacsArticles, updateSection, updateEquipmentTemplate } from '@/api'
import BacsBadge from './BacsBadge.vue'

const props = defineProps({
  reference: { type: String, required: true },
  justification: { type: String, default: null },
  context: { type: String, default: 'section' }, // 'section' | 'equipment'
  editable: { type: Boolean, default: false },
  sectionId: { type: Number, default: null },
  templateId: { type: Number, default: null },
})
const emit = defineEmits(['updated'])

const bacsData = ref(null)
const editing = ref(false)
const draft = ref('')
const saving = ref(false)

onMounted(() => {
  getBacsArticles().then(d => { bacsData.value = d }).catch(() => {})
})

// Parse référence en codes (R175-1, R175-3…)
const referencedCodes = computed(() => {
  if (!props.reference) return []
  const matches = [...props.reference.matchAll(/R175-\d+/g)]
  return [...new Set(matches.map(m => m[0]))]
})

// Fallback automatique : concatène les `summary` des articles référencés
const fallbackText = computed(() => {
  if (!bacsData.value) return null
  const summaries = referencedCodes.value
    .map(code => bacsData.value.articles.find(a => a.code === code))
    .filter(Boolean)
    .map(a => a.summary)
  if (!summaries.length) return null
  return summaries.join(' ')
})

const displayedText = computed(() => props.justification?.trim() || fallbackText.value)

function startEdit() {
  draft.value = props.justification || ''
  editing.value = true
}
function cancelEdit() { editing.value = false }

async function save() {
  saving.value = true
  try {
    const payload = { bacs_justification: draft.value.trim() || null }
    let res
    if (props.sectionId) res = await updateSection(props.sectionId, payload)
    else if (props.templateId) res = await updateEquipmentTemplate(props.templateId, payload)
    editing.value = false
    emit('updated', res?.data)
  } finally {
    saving.value = false
  }
}

watch(() => props.justification, () => { editing.value = false })
</script>

<template>
  <div class="border-l-4 border-purple-300 bg-purple-50/60 px-4 py-3 rounded-r-md">
    <div class="flex items-start gap-2 flex-wrap">
      <ScaleIcon class="w-4 h-4 text-purple-700 mt-0.5 shrink-0" />
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 flex-wrap">
          <BacsBadge :reference="reference" :context="context" :context-explanation="displayedText" />
          <button v-if="editable && !editing" @click="startEdit" class="text-[11px] text-purple-700 hover:text-purple-900 inline-flex items-center gap-0.5">
            <PencilSquareIcon class="w-3 h-3" />
            {{ justification ? 'Éditer' : 'Préciser le lien' }}
          </button>
        </div>

        <div v-if="editing" class="mt-2 space-y-2">
          <textarea v-model="draft" rows="3" autocomplete="off" data-1p-ignore="true"
                    :placeholder="context === 'equipment'
                      ? 'Ex : Cet équipement combine ventilation (§3) et chauffage (§1) — le décret impose pour ces systèmes l\'automatisation, la supervision continue et la capacité de pilotage.'
                      : 'Ex : Cette section répond à l\'exigence du décret BACS en encadrant la liste des points exposés et leurs natures techniques.'"
                    class="w-full px-2 py-1.5 text-xs border border-gray-200 focus:outline-none focus:ring-1 focus:ring-purple-500"></textarea>
          <div class="flex items-center gap-2">
            <button @click="save" :disabled="saving" class="inline-flex items-center gap-1 px-2 py-1 text-[11px] bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50">
              <CheckIcon class="w-3 h-3" /> Enregistrer
            </button>
            <button @click="cancelEdit" class="inline-flex items-center gap-1 px-2 py-1 text-[11px] text-gray-500 hover:text-gray-800">
              <XMarkIcon class="w-3 h-3" /> Annuler
            </button>
          </div>
        </div>

        <div v-else-if="displayedText" class="mt-1.5 text-xs text-gray-700 leading-relaxed bacs-context-prose" v-html="displayedText"></div>
        <p v-if="!editing && displayedText && !justification && fallbackText" class="text-[10px] text-gray-400 italic mt-0.5">
          (résumé automatique de l'article — précisez le lien si besoin)
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Rendu HTML de la justification BACS (paragraphes + strong) */
.bacs-context-prose :deep(p) { margin: 0 0 0.5rem; line-height: 1.55; }
.bacs-context-prose :deep(p:last-child) { margin-bottom: 0; }
.bacs-context-prose :deep(strong) { color: #1f2937; font-weight: 500; }
.bacs-context-prose :deep(ul), .bacs-context-prose :deep(ol) { margin: 0.4rem 0; padding-left: 1.2rem; }
.bacs-context-prose :deep(li) { margin: 0.2rem 0; }
</style>
