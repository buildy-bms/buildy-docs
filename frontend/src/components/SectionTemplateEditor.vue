<script setup>
/**
 * Modale d'édition / création d'une section type (ou fonctionnalité).
 *
 * Mode création détecté par l'absence de `template.id`. La numérotation
 * n'est plus exposée : elle se calcule automatiquement dans les AFs en
 * fonction de la position des sections dans l'arbre `section_templates`.
 *
 * Champs structurels (parent, kind, equipment) édités ici ; le drag-drop
 * de la vue arbre permet aussi de re-parenter visuellement.
 */
import { ref, computed, watch, onMounted } from 'vue'
import { SparklesIcon, TrashIcon } from '@heroicons/vue/24/outline'
import BaseModal from './BaseModal.vue'
import ClaudePromptModal from './ClaudePromptModal.vue'
import RichTextEditor from './RichTextEditor.vue'
import EquipmentTemplatePicker from './EquipmentTemplatePicker.vue'
import {
  createSectionTemplate,
  updateSectionTemplate,
  deleteSectionTemplate,
  listSectionTemplates,
} from '@/api'
import { useNotification } from '@/composables/useNotification'

const props = defineProps({
  template: { type: Object, default: () => ({}) },
  // 'standard' | 'functionality' — utilise pour le titre + le flag a la creation
  mode: { type: String, default: 'standard' },
})
const emit = defineEmits(['close', 'saved', 'deleted'])
const { success, error: notifyError } = useNotification()

const isEdit = computed(() => !!props.template?.id)
const labelEntity = computed(() => props.mode === 'functionality' ? 'fonctionnalité' : 'section type')

const KIND_OPTIONS = [
  { value: 'standard',   label: 'Texte (chapitre / paragraphe rédigé)' },
  { value: 'equipment',  label: 'Équipement (lié à un modèle de la bibliothèque)' },
  { value: 'zones',      label: 'Zones fonctionnelles (matrice de zones)' },
  { value: 'synthesis',  label: 'Tableau de synthèse (auto-généré)' },
]

const SERVICE_LEVEL_OPTIONS = [
  { value: '',       label: '— (non précisé)' },
  { value: 'E',      label: 'Essentials' },
  { value: 'S',      label: 'Smart' },
  { value: 'P',      label: 'Premium' },
  { value: 'S/P',    label: 'Smart et Premium' },
  { value: 'E/S/P',  label: 'Tous niveaux' },
]

const form = ref({
  title: '',
  bacs_articles: '',
  body_html: '',
  service_level: '',
  kind: 'standard',
  parent_template_id: null,
  equipment_template_id: null,
})

const propagate = ref(true)
const submitting = ref(false)
const deleting = ref(false)
const showClaudePrompt = ref(false)
const showEquipmentPicker = ref(false)

// Liste des parents possibles (toutes les sections types non-feuilles + le
// niveau racine "—"). Pour eviter les cycles, on exclut l'item courant et ses
// descendants (le backend a le garde-fou definitif mais on filtre cote UI).
const allTemplates = ref([])
async function loadTemplates() {
  const { data } = await listSectionTemplates({})
  allTemplates.value = data
}
onMounted(loadTemplates)

const parentOptions = computed(() => {
  const opts = [{ id: null, label: '— (top-level)', depth: 0 }]
  // Build map and tree for indented labels
  const byParent = new Map()
  for (const t of allTemplates.value) {
    const k = t.parent_template_id || 0
    if (!byParent.has(k)) byParent.set(k, [])
    byParent.get(k).push(t)
  }
  for (const arr of byParent.values()) {
    arr.sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
  }
  // Calcul des descendants de l'item courant pour les exclure
  const excluded = new Set()
  if (isEdit.value) {
    excluded.add(props.template.id)
    function walk(id) {
      for (const c of (byParent.get(id) || [])) {
        excluded.add(c.id)
        walk(c.id)
      }
    }
    walk(props.template.id)
  }
  function visit(parentId, depth) {
    for (const t of (byParent.get(parentId) || [])) {
      if (excluded.has(t.id)) continue
      // Equipment leaves : ne peuvent pas avoir d'enfants (UX)
      if (t.kind === 'equipment') continue
      opts.push({ id: t.id, label: '— '.repeat(depth) + t.title, depth })
      visit(t.id, depth + 1)
    }
  }
  visit(0, 1)
  return opts
})

const equipmentTemplate = computed(() => {
  // Affichage du nom de l'equipment template lie
  if (!form.value.equipment_template_id) return null
  // Le template peut etre injecte via props.template.equipment_template_id puis
  // recharge en arriere-plan. Pour le label on utilise EquipmentTemplatePicker
  // qui gere la liste lui-meme.
  return form.value.equipment_template_id
})

watch(() => props.template, (t) => {
  form.value = {
    title: (t && t.title) || '',
    bacs_articles: (t && t.bacs_articles) || '',
    body_html: (t && t.body_html) || '',
    service_level: (t && t.service_level) || '',
    kind: (t && t.kind) || 'standard',
    parent_template_id: (t && t.parent_template_id) || null,
    equipment_template_id: (t && t.equipment_template_id) || null,
  }
}, { immediate: true })

const modalTitle = computed(() => {
  if (!isEdit.value) {
    return props.mode === 'functionality' ? 'Nouvelle fonctionnalité' : 'Nouvelle section type'
  }
  return `Éditer « ${props.template.title} »`
})

async function submit() {
  if (!form.value.title.trim()) return
  submitting.value = true
  try {
    const payload = {
      title: form.value.title.trim(),
      bacs_articles: form.value.bacs_articles.trim() || null,
      body_html: form.value.body_html || null,
      service_level: form.value.service_level || null,
      kind: form.value.kind || 'standard',
      parent_template_id: form.value.parent_template_id ?? null,
      equipment_template_id: form.value.kind === 'equipment'
        ? (form.value.equipment_template_id || null)
        : null,
    }
    if (isEdit.value) {
      const { data } = await updateSectionTemplate(props.template.id, payload, { propagateUnchanged: propagate.value })
      if (data.propagated_count > 0) {
        success(`Enregistrée — propagée à ${data.propagated_count} AF${data.propagated_count > 1 ? 's' : ''}`)
      } else {
        success(`${labelEntity.value[0].toUpperCase()}${labelEntity.value.slice(1)} enregistrée`)
      }
      emit('saved', data)
    } else {
      const { data } = await createSectionTemplate({
        ...payload,
        is_functionality: props.mode === 'functionality',
      })
      success(`${labelEntity.value[0].toUpperCase()}${labelEntity.value.slice(1)} créée`)
      emit('saved', data)
    }
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Échec de l\'enregistrement')
  } finally {
    submitting.value = false
  }
}

async function destroy() {
  if (!isEdit.value) return
  if (!confirm(`Supprimer « ${props.template.title} » ?\nLa suppression sera refusée si des AFs utilisent encore cette ${labelEntity.value}.`)) return
  deleting.value = true
  try {
    await deleteSectionTemplate(props.template.id)
    success(`${labelEntity.value[0].toUpperCase()}${labelEntity.value.slice(1)} supprimée`)
    emit('deleted', props.template.id)
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Échec de la suppression')
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <BaseModal :title="modalTitle" size="lg" @close="emit('close')">
    <form @submit.prevent="submit" class="space-y-4">
      <div>
        <label class="block text-xs font-medium text-gray-700 mb-1">Titre *</label>
        <input v-model="form.title" type="text" required autocomplete="off" data-1p-ignore="true"
               :placeholder="mode === 'functionality' ? 'Ex : Pilotage à distance des consignes' : 'Ex : Connectivité du site'"
               class="w-full px-3 py-2 border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="block text-xs font-medium text-gray-700 mb-1">Type de section</label>
          <select v-model="form.kind"
                  class="w-full px-3 py-2 border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
            <option v-for="o in KIND_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-700 mb-1">Section parente</label>
          <select v-model="form.parent_template_id"
                  class="w-full px-3 py-2 border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
            <option v-for="o in parentOptions" :key="o.id ?? 'root'" :value="o.id">{{ o.label }}</option>
          </select>
          <p class="text-[10px] text-gray-400 mt-1">Drag-drop dans l'arbre permet aussi de déplacer.</p>
        </div>
      </div>

      <!-- Equipment template picker, visible uniquement quand kind=equipment -->
      <div v-if="form.kind === 'equipment'">
        <label class="block text-xs font-medium text-gray-700 mb-1">Modèle d'équipement</label>
        <button type="button" @click="showEquipmentPicker = true"
                class="w-full text-left px-3 py-2 border border-gray-300 text-sm hover:bg-gray-50">
          <span v-if="form.equipment_template_id" class="text-gray-800">
            Équipement #{{ form.equipment_template_id }} — cliquer pour changer
          </span>
          <span v-else class="text-gray-400 italic">Aucun équipement choisi — cliquer pour sélectionner</span>
        </button>
        <p class="text-[10px] text-gray-400 mt-1">
          Lien vers la bibliothèque d'équipements. Toute instance ajoutée à cette section dans une AF utilisera ce modèle.
        </p>
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="block text-xs font-medium text-gray-700 mb-1">Articles BACS applicables</label>
          <input v-model="form.bacs_articles" type="text" autocomplete="off" data-1p-ignore="true"
                 placeholder="Ex : R175-3 §1, §2 ; R175-5-1"
                 class="w-full px-3 py-2 border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          <p class="text-[10px] text-gray-400 mt-1">Format : <code>R175-1 §1, §2 ; R175-3 §4</code>.</p>
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-700 mb-1">Niveau de contrat requis</label>
          <select v-model="form.service_level"
                  class="w-full px-3 py-2 border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
            <option v-for="o in SERVICE_LEVEL_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
        </div>
      </div>

      <div v-if="form.kind !== 'equipment' && form.kind !== 'synthesis'">
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

      <label v-if="isEdit && form.kind !== 'equipment' && form.kind !== 'synthesis'"
             class="flex items-start gap-2 text-xs text-gray-700 bg-amber-50 border border-amber-200 p-3 rounded">
        <input v-model="propagate" type="checkbox" class="mt-0.5" />
        <span>
          <strong class="font-medium">Appliquer aussi aux AFs existantes</strong> où le contenu n'a pas été modifié.
          Les AFs où la section a été personnalisée ne seront pas écrasées (un bandeau "nouvelle version" s'affichera dans l'éditeur).
        </span>
      </label>
    </form>

    <template #footer>
      <button v-if="isEdit" @click="destroy" :disabled="deleting"
              class="mr-auto px-3 py-1.5 text-xs text-red-600 hover:text-red-800 inline-flex items-center gap-1 disabled:opacity-50">
        <TrashIcon class="w-3.5 h-3.5" /> {{ deleting ? 'Suppression…' : 'Supprimer' }}
      </button>
      <button @click="emit('close')" class="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-800">Annuler</button>
      <button @click="submit" :disabled="submitting || !form.title.trim()"
              class="px-3 py-1.5 text-xs bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">
        {{ submitting ? 'Enregistrement…' : (isEdit ? 'Enregistrer' : 'Créer') }}
      </button>
    </template>
  </BaseModal>

  <ClaudePromptModal v-if="showClaudePrompt" :template="{ ...form }" mode="standard-section" @close="showClaudePrompt = false" />

  <BaseModal v-if="showEquipmentPicker" title="Choisir un modèle d'équipement" size="lg" @close="showEquipmentPicker = false">
    <EquipmentTemplatePicker
      :model-value="form.equipment_template_id"
      @update:model-value="(v) => { form.equipment_template_id = v; showEquipmentPicker = false }"
    />
  </BaseModal>
</template>
