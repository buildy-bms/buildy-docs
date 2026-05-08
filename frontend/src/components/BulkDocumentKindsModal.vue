<script setup>
/**
 * Modale d'édition en bulk des tags `document_kinds` (types de documents).
 *
 * Props :
 *  - selected : Array<{ id, title }> — sections sélectionnées dans la liste
 *  - documentKindsCatalog : Array<{ kind, label, description }> — catalogue
 *
 * Émet :
 *  - @close
 *  - @done({ affected, cascaded }) après succès
 *
 * 3 modes :
 *  - add     : ajoute les kinds choisis sans toucher aux tags existants
 *  - remove  : retire les kinds choisis
 *  - replace : remplace tous les tags par la liste choisie (destructif)
 *
 * Cascade : ON par défaut (cohérent avec le PATCH unitaire). Toggle pour
 * limiter l'opération aux sections sélectionnées sans descendre.
 */
import { ref, computed } from 'vue'
import BaseModal from './BaseModal.vue'
import { bulkUpdateSectionTemplateDocumentKinds } from '@/api'
import { useNotification } from '@/composables/useNotification'

const props = defineProps({
  selected: { type: Array, required: true },
  documentKindsCatalog: { type: Array, required: true },
})
const emit = defineEmits(['close', 'done'])
const { success, error: notifyError } = useNotification()

const action = ref('add')
const cascade = ref(true)
const selectedKinds = ref(new Set())
const submitting = ref(false)

const ACTIONS = [
  { value: 'add',     label: 'Ajouter',    icon: '+', help: 'Ajoute le(s) tag(s) choisi(s) aux sections sélectionnées sans toucher aux autres tags déjà posés.' },
  { value: 'remove',  label: 'Retirer',    icon: '−', help: 'Retire le(s) tag(s) choisi(s) des sections sélectionnées sans toucher aux autres tags.' },
  { value: 'replace', label: 'Remplacer',  icon: '↻', help: 'Remplace TOUS les tags par la liste choisie. Destructif : les anciens tags sont effacés.' },
]

function toggleKind(k) {
  if (selectedKinds.value.has(k)) selectedKinds.value.delete(k)
  else selectedKinds.value.add(k)
  selectedKinds.value = new Set(selectedKinds.value)
}
function isKindActive(k) { return selectedKinds.value.has(k) }

const canSubmit = computed(() =>
  props.selected.length > 0 && selectedKinds.value.size > 0 && !submitting.value
)

const actionMeta = computed(() => ACTIONS.find(a => a.value === action.value))

async function submit() {
  if (!canSubmit.value) return
  submitting.value = true
  try {
    const { data } = await bulkUpdateSectionTemplateDocumentKinds({
      ids: props.selected.map(s => s.id),
      action: action.value,
      kinds: Array.from(selectedKinds.value),
      cascade: cascade.value,
    })
    const { affected, cascaded } = data || { affected: 0, cascaded: 0 }
    const cascadeMsg = cascaded > 0 ? ` (dont ${cascaded} sous-section${cascaded > 1 ? 's' : ''} via cascade)` : ''
    success(`Tags mis à jour sur ${affected} section${affected > 1 ? 's' : ''}${cascadeMsg}.`)
    emit('done', data)
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Échec de la mise à jour en bulk')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <BaseModal :title="`Modifier les tags de ${selected.length} section${selected.length > 1 ? 's' : ''}`" size="md" @close="emit('close')">
    <div class="space-y-4">
      <!-- Liste compacte des sections selectionnees -->
      <div>
        <label class="block text-xs font-medium text-gray-600 mb-1.5">Sections concernées</label>
        <div class="bg-gray-50 border border-gray-200 rounded-lg p-2 max-h-32 overflow-y-auto">
          <ul class="text-sm text-gray-700 space-y-0.5">
            <li v-for="s in selected" :key="s.id" class="truncate">
              <span class="text-gray-400 text-xs mr-1">•</span>{{ s.title }}
            </li>
          </ul>
        </div>
      </div>

      <!-- Choix de l'action -->
      <div>
        <label class="block text-xs font-medium text-gray-600 mb-1.5">Action</label>
        <div class="grid grid-cols-3 gap-2">
          <button v-for="a in ACTIONS" :key="a.value" type="button"
                  @click="action = a.value"
                  :class="['px-3 py-2.5 rounded-lg border text-sm font-medium transition flex items-center justify-center gap-2',
                           action === a.value
                             ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                             : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50']">
            <span class="font-mono text-base">{{ a.icon }}</span>
            <span>{{ a.label }}</span>
          </button>
        </div>
        <p class="text-[11px] text-gray-500 mt-1.5 leading-relaxed">{{ actionMeta?.help }}</p>
      </div>

      <!-- Choix des kinds (multi-select boutons toggle) -->
      <div>
        <label class="block text-xs font-medium text-gray-600 mb-1.5">
          Type{{ selectedKinds.size > 1 ? 's' : '' }} de document
          <span class="text-gray-400 font-normal">— sélectionner un ou plusieurs</span>
        </label>
        <div class="flex flex-wrap gap-1.5">
          <button v-for="dk in documentKindsCatalog" :key="dk.kind" type="button"
                  @click="toggleKind(dk.kind)"
                  v-tooltip="dk.description"
                  :class="['inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-full border transition whitespace-nowrap',
                           isKindActive(dk.kind)
                             ? 'bg-indigo-100 text-indigo-800 border-indigo-300 shadow-sm'
                             : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50']">
            <span :class="['w-1.5 h-1.5 rounded-full shrink-0', isKindActive(dk.kind) ? 'bg-indigo-600' : 'bg-gray-300']" />
            <span class="font-medium">{{ dk.label }}</span>
          </button>
        </div>
      </div>

      <!-- Toggle cascade -->
      <label class="inline-flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
        <input v-model="cascade" type="checkbox"
               class="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500/30 shrink-0" />
        <span>Inclure aussi les sous-sections (cascade)</span>
      </label>

      <!-- Avertissement Replace -->
      <div v-if="action === 'replace'" class="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2.5 leading-relaxed">
        ⚠ Le mode <strong>Remplacer</strong> efface tous les tags actuels. Les sections sélectionnées n'auront plus que les tags choisis ci-dessus.
      </div>
    </div>

    <template #footer>
      <button @click="emit('close')"
              class="px-3 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition">
        Annuler
      </button>
      <button @click="submit" :disabled="!canSubmit"
              class="px-4 py-2 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition shadow-sm">
        {{ submitting ? 'Application…' : 'Appliquer' }}
      </button>
    </template>
  </BaseModal>
</template>
