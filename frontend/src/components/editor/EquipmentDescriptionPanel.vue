<script setup>
/**
 * Affiche la description fonctionnelle d'un equipement dans une AF.
 *
 * Source par defaut : equipment_templates.description_html (biblio).
 * Override AF : sections.description_html_override — quand non-NULL, c'est cette
 * valeur qui est rendue/exportee dans l'AF, sans toucher au template biblio.
 *
 * Bouton « Recuperer depuis le modele » remet l'override a NULL (le texte
 * biblio reapparait). Indicateur de drift : equipment_template_version <
 * template.current_version → badge ambre + bouton « Mettre a jour depuis le
 * modele » (acquitte la version, ne touche pas a l'override).
 */
import { ref, computed, watch } from 'vue'
import { PencilSquareIcon, ArrowTopRightOnSquareIcon, ArrowPathIcon, CheckIcon, XMarkIcon, ExclamationTriangleIcon } from '@heroicons/vue/24/outline'
import { useRouter } from 'vue-router'
import { getEquipmentTemplate, updateSection } from '@/api'
import RichTextEditor from '@/components/RichTextEditor.vue'

const props = defineProps({
  section: { type: Object, required: true },
})
const emit = defineEmits(['updated'])

const router = useRouter()
const template = ref(null)
const editing = ref(false)
const draft = ref('')
const saving = ref(false)
const error = ref('')

const overrideValue = computed(() => props.section.description_html_override)
const hasOverride = computed(() => overrideValue.value !== null && overrideValue.value !== undefined)
const renderedHtml = computed(() => hasOverride.value ? overrideValue.value : (template.value?.description_html || ''))
const drift = computed(() => {
  if (!template.value) return false
  const localV = props.section.equipment_template_version
  const currentV = template.value.current_version
  if (localV == null || currentV == null) return false
  return localV < currentV
})

async function refresh() {
  if (!props.section.equipment_template_id) { template.value = null; return }
  try {
    const { data } = await getEquipmentTemplate(props.section.equipment_template_id)
    template.value = data
  } catch { template.value = null }
}
watch(() => props.section.equipment_template_id, refresh, { immediate: true })

function startEdit() {
  draft.value = renderedHtml.value
  error.value = ''
  editing.value = true
}
function cancelEdit() {
  editing.value = false
  draft.value = ''
}

async function saveOverride() {
  saving.value = true
  error.value = ''
  try {
    const { data } = await updateSection(props.section.id, { description_html_override: draft.value })
    emit('updated', data)
    editing.value = false
  } catch (e) {
    error.value = e?.response?.data?.detail || 'Échec de l\'enregistrement'
  } finally {
    saving.value = false
  }
}

async function resetToTemplate() {
  if (!confirm('Récupérer la description depuis le modèle ? Vos modifications locales seront effacées.')) return
  saving.value = true
  error.value = ''
  try {
    const { data } = await updateSection(props.section.id, { description_html_override: null })
    emit('updated', data)
    editing.value = false
  } catch (e) {
    error.value = e?.response?.data?.detail || 'Échec de la réinitialisation'
  } finally {
    saving.value = false
  }
}

async function ackTemplateVersion() {
  if (!template.value) return
  saving.value = true
  try {
    const { data } = await updateSection(props.section.id, { equipment_template_version: template.value.current_version })
    emit('updated', data)
  } catch (e) {
    error.value = e?.response?.data?.detail || 'Échec de la mise à jour'
  } finally {
    saving.value = false
  }
}

function openInLibrary() {
  router.push({ path: '/library/equipments', query: { open: template.value.slug } })
}
</script>

<template>
  <div v-if="template" class="bg-white border border-gray-200 rounded-lg">
    <div class="flex items-center justify-between gap-3 px-5 py-2 border-b border-gray-100 bg-gray-50 flex-wrap">
      <div class="flex items-center gap-2 flex-wrap">
        <p class="text-[10px] uppercase tracking-wider text-gray-500 font-semibold whitespace-nowrap">
          Description fonctionnelle de l'équipement
        </p>
        <span v-if="hasOverride" class="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 font-semibold whitespace-nowrap">
          Personnalisée pour cette AF
        </span>
        <span v-else class="text-[10px] text-gray-400 normal-case">(héritée de la bibliothèque)</span>
        <span v-if="drift" class="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 font-semibold whitespace-nowrap">
          <ExclamationTriangleIcon class="w-3 h-3 shrink-0" /> Modèle mis à jour
        </span>
      </div>
      <div class="flex items-center gap-1 flex-wrap">
        <button v-if="!editing" @click="startEdit"
          class="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md text-indigo-700 hover:bg-indigo-50 whitespace-nowrap">
          <PencilSquareIcon class="w-3.5 h-3.5 shrink-0" /> Modifier dans cette AF
        </button>
        <button v-if="hasOverride && !editing" @click="resetToTemplate" :disabled="saving"
          class="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md text-gray-700 hover:bg-gray-100 disabled:opacity-50 whitespace-nowrap">
          <ArrowPathIcon class="w-3.5 h-3.5 shrink-0" /> Récupérer depuis le modèle
        </button>
        <button v-if="drift && !editing" @click="ackTemplateVersion" :disabled="saving"
          class="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md text-amber-800 hover:bg-amber-100 disabled:opacity-50 whitespace-nowrap">
          <CheckIcon class="w-3.5 h-3.5 shrink-0" /> Acquitter la version
        </button>
        <button @click="openInLibrary"
          class="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md text-gray-600 hover:bg-gray-100 whitespace-nowrap">
          <ArrowTopRightOnSquareIcon class="w-3.5 h-3.5 shrink-0" /> Éditer le modèle
        </button>
      </div>
    </div>

    <div v-if="!editing">
      <div v-if="renderedHtml" v-html="renderedHtml" class="prose prose-sm max-w-none p-5 text-gray-700 equipment-desc"></div>
      <div v-else class="p-5 text-sm text-gray-400 italic">
        Pas encore de description rédigée. Cliquez « Modifier dans cette AF » pour ajouter du contenu, ou « Éditer le modèle » pour rédiger la description biblio partagée.
      </div>
    </div>

    <div v-else class="p-3">
      <RichTextEditor :model-value="draft" @update:model-value="(html) => draft = html" />
      <div v-if="error" class="mt-2 text-xs text-rose-600">{{ error }}</div>
      <div class="mt-3 flex items-center gap-2">
        <button @click="saveOverride" :disabled="saving"
          class="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 whitespace-nowrap">
          <CheckIcon class="w-4 h-4 shrink-0" /> {{ saving ? 'Enregistrement…' : 'Enregistrer dans cette AF' }}
        </button>
        <button @click="cancelEdit" :disabled="saving"
          class="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-md text-gray-600 hover:bg-gray-100 disabled:opacity-50 whitespace-nowrap">
          <XMarkIcon class="w-4 h-4 shrink-0" /> Annuler
        </button>
        <p class="text-[11px] text-gray-500">L'édition ne touche pas au modèle de la bibliothèque.</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.equipment-desc :deep(p) { margin: 0 0 1rem; line-height: 1.65; }
.equipment-desc :deep(p:last-child) { margin-bottom: 0; }
.equipment-desc :deep(ul), .equipment-desc :deep(ol) { padding-left: 1.4rem; margin: 0.75rem 0 1rem; list-style-position: outside; }
.equipment-desc :deep(ul) { list-style-type: disc; }
.equipment-desc :deep(ol) { list-style-type: decimal; }
.equipment-desc :deep(li) { margin: 0.4rem 0; line-height: 1.55; }
.equipment-desc :deep(strong) { color: #1f2937; font-weight: 500; }
</style>
