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
import BacsArticlesPicker from './BacsArticlesPicker.vue'
import {
  createSectionTemplate,
  updateSectionTemplate,
  deleteSectionTemplate,
  listSectionTemplates,
  listEquipmentTemplates,
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

// kind=equipment retire de l'editeur : les equipements se gerent depuis la
// page Bibliotheque > Equipements (multi-select des sections parentes).
const KIND_OPTIONS = [
  { value: 'standard',   label: 'Texte (chapitre / paragraphe rédigé)' },
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
  // Disponibilite par niveau de contrat (Lot 36) : null = pas dispo,
  // 'included' = inclus dans le contrat, 'paid_option' = option payante
  avail_e: null,
  avail_s: null,
  avail_p: null,
})

// Niveaux de contrat avec leurs labels affiches
const CONTRACT_LEVELS = [
  { code: 'E', label: 'Essentials', field: 'avail_e' },
  { code: 'S', label: 'Smart',      field: 'avail_s' },
  { code: 'P', label: 'Premium',    field: 'avail_p' },
]

// 3 statuts possibles par cellule
const AVAIL_OPTIONS = [
  { value: null,           label: 'Non disponible',    icon: '❌', color: 'bg-gray-100 text-gray-500 border-gray-200' },
  { value: 'included',     label: 'Inclus',            icon: '✓',  color: 'bg-emerald-100 text-emerald-700 border-emerald-300' },
  { value: 'paid_option',  label: 'Option payante',    icon: '€',  color: 'bg-amber-100 text-amber-800 border-amber-300' },
]

const propagate = ref(true)
const submitting = ref(false)
const deleting = ref(false)
const showClaudePrompt = ref(false)
const showEquipmentPicker = ref(false)

// Liste des parents possibles (toutes les sections types non-feuilles + le
// niveau racine "—"). Pour eviter les cycles, on exclut l'item courant et ses
// descendants (le backend a le garde-fou definitif mais on filtre cote UI).
const allTemplates = ref([])
const equipmentTemplates = ref([])
async function loadTemplates() {
  const { data } = await listSectionTemplates({})
  allTemplates.value = data
}
async function loadEquipmentTemplates() {
  const { data } = await listEquipmentTemplates()
  equipmentTemplates.value = data || []
}
onMounted(() => {
  loadTemplates()
  loadEquipmentTemplates()
})

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

const selectedEquipmentName = computed(() => {
  const id = form.value.equipment_template_id
  if (!id) return null
  const t = equipmentTemplates.value.find(x => x.id === id)
  return t ? t.name : null
})

// Champs conditionnels :
// - BACS pour les fonctionnalites uniquement (pour les equipements c'est
//   herite de la categorie ; pour les sections narratives c'est sans objet)
// - Matrice de disponibilite par niveau (Lot 36) pour les fonctionnalites
const showBacs = computed(() => props.mode === 'functionality')
const showAvailability = computed(() => props.mode === 'functionality')

watch(() => props.template, (t) => {
  form.value = {
    title: (t && t.title) || '',
    bacs_articles: (t && t.bacs_articles) || '',
    body_html: (t && t.body_html) || '',
    service_level: (t && t.service_level) || '',
    kind: (t && t.kind) || 'standard',
    parent_template_id: (t && t.parent_template_id) || null,
    equipment_template_id: (t && t.equipment_template_id) || null,
    avail_e: (t && t.avail_e) || null,
    avail_s: (t && t.avail_s) || null,
    avail_p: (t && t.avail_p) || null,
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
      kind: form.value.kind || 'standard',
      parent_template_id: form.value.parent_template_id ?? null,
      equipment_template_id: form.value.kind === 'equipment'
        ? (form.value.equipment_template_id || null)
        : null,
    }
    // Pour les fonctionnalites : on envoie la matrice de disponibilite,
    // le backend en derive automatiquement le service_level.
    if (props.mode === 'functionality') {
      payload.avail_e = form.value.avail_e || null
      payload.avail_s = form.value.avail_s || null
      payload.avail_p = form.value.avail_p || null
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
  if (!confirm(`Supprimer « ${props.template.title} » ?`)) return
  deleting.value = true
  try {
    await deleteSectionTemplate(props.template.id)
    success(`${labelEntity.value[0].toUpperCase()}${labelEntity.value.slice(1)} supprimée`)
    emit('deleted', props.template.id)
  } catch (e) {
    // 409 : des AFs utilisent encore la section. On propose le cascade.
    if (e.response?.status === 409) {
      const n = e.response.data?.affected_count || 0
      const ok = confirm(
        `${n} AF${n > 1 ? 's' : ''} utilise${n > 1 ? 'nt' : ''} encore cette ${labelEntity.value}.\n\n` +
        `Supprimer quand même ? Les sections correspondantes seront retirées de ces AFs (le contenu personnalisé sera perdu).`
      )
      if (ok) {
        try {
          const { data } = await deleteSectionTemplate(props.template.id, { force: true })
          success(`Supprimée — retirée de ${data?.cascade_count || 0} AF${(data?.cascade_count || 0) > 1 ? 's' : ''}`)
          emit('deleted', props.template.id)
          return
        } catch (e2) {
          notifyError(e2.response?.data?.detail || 'Échec de la suppression')
        }
      }
    } else {
      notifyError(e.response?.data?.detail || 'Échec de la suppression')
    }
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <BaseModal :title="modalTitle" size="lg" @close="emit('close')">
    <form @submit.prevent="submit" class="space-y-3">
      <div>
        <label class="block text-xs font-medium text-gray-600 mb-1">Titre *</label>
        <input v-model="form.title" type="text" required autocomplete="off" data-1p-ignore="true"
               :placeholder="mode === 'functionality' ? 'Ex : Pilotage à distance des consignes' : 'Ex : Connectivité du site'"
               class="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition" />
      </div>

      <!-- Pour les fonctionnalites, kind est toujours 'standard' (texte) : on cache le picker -->
      <div :class="['grid gap-3', mode === 'functionality' ? 'grid-cols-1' : 'grid-cols-2']">
        <div v-if="mode !== 'functionality'">
          <label class="block text-xs font-medium text-gray-600 mb-1">Type de section</label>
          <select v-model="form.kind"
                  class="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition">
            <option v-for="o in KIND_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-600 mb-1">Section parente</label>
          <select v-model="form.parent_template_id"
                  class="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition">
            <option v-for="o in parentOptions" :key="o.id ?? 'root'" :value="o.id">{{ o.label }}</option>
          </select>
        </div>
      </div>

      <!-- Picker du modele d'equipement : uniquement pour kind=equipment -->
      <div v-if="form.kind === 'equipment'">
        <label class="block text-xs font-medium text-gray-600 mb-1">Modèle d'équipement</label>
        <button type="button" @click="showEquipmentPicker = true"
                class="w-full text-left px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition">
          <span v-if="form.equipment_template_id" class="text-gray-800">
            {{ selectedEquipmentName || `Équipement #${form.equipment_template_id}` }}
            <span class="text-gray-400 text-xs">— cliquer pour changer</span>
          </span>
          <span v-else class="text-gray-400 italic">Aucun équipement choisi — cliquer pour sélectionner</span>
        </button>
      </div>

      <!-- BACS (multi-select) : uniquement pour les fonctionnalites -->
      <div v-if="showBacs">
        <label class="block text-xs font-medium text-gray-600 mb-1.5">Articles BACS applicables</label>
        <BacsArticlesPicker v-model="form.bacs_articles" />
      </div>

      <!-- Matrice de disponibilite par niveau de contrat (Lot 36) -->
      <div v-if="showAvailability">
        <label class="block text-xs font-medium text-gray-600 mb-1.5">
          Disponibilité par niveau de contrat
          <span class="text-gray-400 font-normal">— pour chaque niveau, choisir le statut</span>
        </label>
        <div class="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100 overflow-hidden">
          <div v-for="lvl in CONTRACT_LEVELS" :key="lvl.code" class="flex items-center gap-3 px-3 py-2">
            <span class="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-indigo-50 text-indigo-700 font-mono text-sm shrink-0">
              {{ lvl.code }}
            </span>
            <span class="text-sm text-gray-700 w-24 shrink-0">{{ lvl.label }}</span>
            <div class="flex flex-wrap gap-1.5 ml-auto">
              <button v-for="o in AVAIL_OPTIONS" :key="String(o.value)" type="button"
                      @click="form[lvl.field] = o.value"
                      :class="['inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full border transition',
                               form[lvl.field] === o.value
                                 ? o.color + ' shadow-sm'
                                 : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50']">
                <span class="font-medium">{{ o.icon }}</span> {{ o.label }}
              </button>
            </div>
          </div>
        </div>
        <p class="text-[11px] text-gray-400 mt-1.5">
          ✓ inclus = couvert par le contrat · € option payante = facturé en sus · ❌ non disponible
        </p>
      </div>

      <!-- Contenu canonique : kind=standard uniquement (zones/synth/hyperveez/equipment l'ignorent) -->
      <div v-if="form.kind === 'standard'">
        <div class="flex items-center justify-between mb-1">
          <label class="block text-xs font-medium text-gray-600">
            Contenu canonique
            <span class="text-gray-400 font-normal">— HTML, paragraphes courts</span>
          </label>
          <button type="button" @click="showClaudePrompt = true"
                  class="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] text-violet-700 hover:text-violet-900 border border-violet-200 hover:bg-violet-50 rounded-lg transition">
            <SparklesIcon class="w-3 h-3" />
            Générer avec Claude
          </button>
        </div>
        <RichTextEditor
          v-model="form.body_html"
          placeholder="Ce que dit cette section dans le style Buildy : 2-4 paragraphes courts, ton sobre et technique, vocabulaire métier GTB précis…"
          min-height="180px"
        />
      </div>

      <label v-if="isEdit && form.kind === 'standard'"
             class="flex items-start gap-2.5 text-xs text-gray-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
        <input v-model="propagate" type="checkbox" class="mt-0.5 rounded text-indigo-600 focus:ring-indigo-500/30" />
        <span>
          <strong class="font-medium">Appliquer aussi aux AFs existantes</strong> où le contenu n'a pas été modifié.
          Les AFs où la section a été personnalisée ne seront pas écrasées (un bandeau "nouvelle version" s'affichera dans l'éditeur).
        </span>
      </label>
    </form>

    <template #footer>
      <button v-if="isEdit" @click="destroy" :disabled="deleting"
              class="mr-auto px-3 py-2 text-sm text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition inline-flex items-center gap-1.5 disabled:opacity-50">
        <TrashIcon class="w-4 h-4" /> {{ deleting ? 'Suppression…' : 'Supprimer' }}
      </button>
      <button @click="emit('close')"
              class="px-3 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition">
        Annuler
      </button>
      <button @click="submit" :disabled="submitting || !form.title.trim()"
              class="px-4 py-2 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition shadow-sm">
        {{ submitting ? 'Enregistrement…' : (isEdit ? 'Enregistrer' : 'Créer') }}
      </button>
    </template>
  </BaseModal>

  <ClaudePromptModal v-if="showClaudePrompt" :template="{ ...form }" mode="standard-section" @close="showClaudePrompt = false" />

  <BaseModal v-if="showEquipmentPicker" title="Choisir un modèle d'équipement" size="lg" @close="showEquipmentPicker = false">
    <EquipmentTemplatePicker
      :model-value="form.equipment_template_id"
      :templates="equipmentTemplates"
      @update:model-value="(v) => { form.equipment_template_id = v; showEquipmentPicker = false }"
    />
  </BaseModal>
</template>
