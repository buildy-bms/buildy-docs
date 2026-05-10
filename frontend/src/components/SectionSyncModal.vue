<script setup>
/**
 * Modal "Mettre a jour depuis la bibliotheque" pour une section AF.
 *
 * 3 parts independantes a cocher :
 *   - Texte decret BACS (bacs_articles + bacs_justification du template)
 *   - Descriptif fonctionnel (description_html OU body_html selon type)
 *   - Table de points (reset des overrides locaux, applicable equipment)
 *
 * Au submit : POST /sections/:id/template-update/apply { parts: [...] }
 */
import { ref, computed, onMounted } from 'vue'
import { ArrowPathIcon, BookOpenIcon, DocumentTextIcon, TableCellsIcon } from '@heroicons/vue/24/outline'
import BaseModal from './BaseModal.vue'
import { getEquipmentTemplate, getSectionTemplate, applySectionTemplateUpdate } from '@/api'
import { useNotification } from '@/composables/useNotification'
import { useAfStore } from '@/stores/af'

const props = defineProps({
  section: { type: Object, required: true },
})
const emit = defineEmits(['close', 'updated'])

const { error: notifyError, success } = useNotification()
const afStore = useAfStore()

const loading = ref(true)
const submitting = ref(false)
const tpl = ref(null)
const overridesCount = ref(0) // pour afficher "X overrides locaux"

// 3 cases independantes
const wantBacs = ref(false)
const wantFonctionnel = ref(false)
const wantPoints = ref(false)

const isEquipment = computed(() => !!props.section.equipment_template_id)

const sourceLabel = computed(() => {
  if (!tpl.value) return ''
  if (tpl.value._kind === 'equipment') return `Modèle d'équipement « ${tpl.value.name} »`
  return `Section type « ${tpl.value.title} »`
})

onMounted(async () => {
  try {
    if (props.section.equipment_template_id) {
      const { data } = await getEquipmentTemplate(props.section.equipment_template_id)
      tpl.value = { _kind: 'equipment', ...data }
    } else if (props.section.section_template_id) {
      const { data } = await getSectionTemplate(props.section.section_template_id)
      tpl.value = { _kind: 'section_template', ...data }
    }
  } catch (e) {
    notifyError(e?.response?.data?.detail || 'Échec du chargement du modèle')
  } finally {
    loading.value = false
  }
})

const canSubmit = computed(() =>
  !submitting.value && !loading.value && (wantBacs.value || wantFonctionnel.value || wantPoints.value)
)

async function submit() {
  if (!canSubmit.value) return
  const parts = []
  if (wantBacs.value) parts.push('bacs')
  if (wantFonctionnel.value) parts.push('fonctionnel')
  if (wantPoints.value) parts.push('points')
  submitting.value = true
  try {
    const { data } = await applySectionTemplateUpdate(props.section.id, parts)
    const labels = parts.map(p =>
      p === 'bacs' ? 'décret BACS' : p === 'fonctionnel' ? 'descriptif fonctionnel' : 'table de points'
    ).join(', ')
    success(`Section synchronisée : ${labels}`)
    // Force un re-fetch complet de la section depuis le serveur pour
    // que tous les composants enfants (Description / BACS / Points)
    // re-rendent avec les nouvelles valeurs. Sans ca, certaines vues
    // restent sur leur cache local et imposent un refresh manuel.
    await afStore.selectSection(props.section.id)
    emit('updated', data)
    emit('close')
  } catch (e) {
    notifyError(e?.response?.data?.detail || 'Échec de la synchronisation')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <BaseModal title="Mettre à jour depuis la bibliothèque" size="md" :dismiss-on-backdrop="!submitting" @close="emit('close')">
    <div v-if="loading" class="text-center py-12 text-sm text-gray-400">Chargement du modèle…</div>

    <template v-else-if="!tpl">
      <p class="text-sm text-gray-600">Cette section n'est pas rattachée à un modèle de bibliothèque.</p>
    </template>

    <template v-else>
      <p class="text-xs text-gray-500 mb-4">
        Source : <span class="font-medium text-gray-700">{{ sourceLabel }}</span>
      </p>

      <p class="text-sm text-gray-700 mb-3">Coche les éléments à récupérer depuis la bibliothèque :</p>

      <div class="space-y-2">
        <!-- Texte decret BACS -->
        <label :class="['flex items-start gap-3 border rounded-lg p-3 cursor-pointer transition',
                        wantBacs ? 'border-indigo-300 bg-indigo-50/40' : 'border-gray-200 hover:border-gray-300']">
          <input v-model="wantBacs" type="checkbox" class="mt-0.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500/30" />
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <BookOpenIcon class="w-4 h-4 text-amber-600 shrink-0" />
              <span class="text-sm font-medium text-gray-800">Texte décret BACS</span>
            </div>
            <p class="text-[11px] text-gray-500 mt-0.5">
              Articles BACS référencés et leur justification, repris du modèle.
            </p>
          </div>
        </label>

        <!-- Descriptif fonctionnel -->
        <label :class="['flex items-start gap-3 border rounded-lg p-3 cursor-pointer transition',
                        wantFonctionnel ? 'border-indigo-300 bg-indigo-50/40' : 'border-gray-200 hover:border-gray-300']">
          <input v-model="wantFonctionnel" type="checkbox" class="mt-0.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500/30" />
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <DocumentTextIcon class="w-4 h-4 text-indigo-600 shrink-0" />
              <span class="text-sm font-medium text-gray-800">Descriptif fonctionnel</span>
            </div>
            <p class="text-[11px] text-gray-500 mt-0.5">
              {{ isEquipment
                ? 'Description fonctionnelle de l\'équipement (override local remplacé).'
                : 'Contenu de la section (le texte actuel sera remplacé).' }}
            </p>
          </div>
        </label>

        <!-- Table de points (equipment uniquement) -->
        <label v-if="isEquipment" :class="['flex items-start gap-3 border rounded-lg p-3 cursor-pointer transition',
                                            wantPoints ? 'border-indigo-300 bg-indigo-50/40' : 'border-gray-200 hover:border-gray-300']">
          <input v-model="wantPoints" type="checkbox" class="mt-0.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500/30" />
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <TableCellsIcon class="w-4 h-4 text-emerald-600 shrink-0" />
              <span class="text-sm font-medium text-gray-800">Table de points</span>
            </div>
            <p class="text-[11px] text-gray-500 mt-0.5">
              Réinitialise la table de points de la section : les modifications locales (ajouts, retraits, éditions de points) sont supprimées et la table revient à celle du modèle.
            </p>
          </div>
        </label>
      </div>
    </template>

    <template #footer>
      <button @click="emit('close')" :disabled="submitting"
              class="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800 disabled:opacity-50">
        Annuler
      </button>
      <button @click="submit" :disabled="!canSubmit"
              class="inline-flex items-center gap-1.5 px-4 py-1.5 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed">
        <ArrowPathIcon :class="['w-4 h-4', submitting ? 'animate-spin' : '']" />
        {{ submitting ? 'Mise à jour…' : 'Mettre à jour' }}
      </button>
    </template>
  </BaseModal>
</template>
