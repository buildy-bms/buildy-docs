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
import { TrashIcon, ClockIcon, ArrowUturnLeftIcon } from '@heroicons/vue/24/outline'
import BaseModal from './BaseModal.vue'
import TemplateAttachmentsGrid from './TemplateAttachmentsGrid.vue'
import RichTextEditor from './RichTextEditor.vue'
import SearchableSelect from './SearchableSelect.vue'
import EquipmentTemplatePicker from './EquipmentTemplatePicker.vue'
import BacsArticlesPicker from './BacsArticlesPicker.vue'
import FaIconPicker from './FaIconPicker.vue'
import {
  createSectionTemplate,
  updateSectionTemplate,
  deleteSectionTemplate,
  listSectionTemplates,
  listEquipmentTemplates,
  listSectionTemplateVersions,
  getSectionTemplateVersion,
} from '@/api'
import { useNotification } from '@/composables/useNotification'
import { useConfirm } from '@/composables/useConfirm'

const props = defineProps({
  template: { type: Object, default: () => ({}) },
  // 'standard' | 'functionality' — utilise pour le titre + le flag a la creation
  mode: { type: String, default: 'standard' },
})
const emit = defineEmits(['close', 'saved', 'deleted'])
const { success, error: notifyError } = useNotification()
const { confirm } = useConfirm()

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
  icon_name: null,
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

const submitting = ref(false)
const deleting = ref(false)
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

// Options pour SearchableSelect : on remappe id->value et on enleve le
// prefixe '— ' du label (l'indentation visuelle est rendue via 'indent').
const parentSelectOptions = computed(() =>
  parentOptions.value.map(o => ({
    value: o.id,
    label: o.id === null ? o.label : o.label.replace(/^(— )+/, ''),
    indent: o.depth || 0,
  }))
)

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
    icon_name: (t && t.icon_name) || null,
    avail_e: (t && t.avail_e) || null,
    avail_s: (t && t.avail_s) || null,
    avail_p: (t && t.avail_p) || null,
  }
}, { immediate: true })

// Historique des versions du body_html. Charge a la demande quand l'user
// clique sur "Historique". La restauration recopie le snapshot dans le
// champ body_html (sans sauvegarder) — l'user revoit/edite puis Enregistre,
// ce qui re-snapshote le texte courant avant ecrasement.
const showHistory = ref(false)
const historyVersions = ref([])
const historyLoading = ref(false)
async function openHistory() {
  if (!props.template?.id) return
  showHistory.value = true
  historyLoading.value = true
  try {
    const { data } = await listSectionTemplateVersions(props.template.id)
    historyVersions.value = data
  } catch {
    notifyError('Impossible de charger l\'historique')
  } finally {
    historyLoading.value = false
  }
}
async function restoreVersion(v) {
  const ok = await confirm({
    title: `Restaurer cette version ?`,
    message: `Le texte actuel sera remplacé par celui du ${formatDate(v.created_at)}.\n\nLa version remplacée sera elle-même versionnée à l'enregistrement, donc rien ne sera perdu.`,
    confirmLabel: 'Restaurer ce texte',
  })
  if (!ok) return
  try {
    const { data } = await getSectionTemplateVersion(props.template.id, v.id)
    form.value.body_html = data.body_html || ''
    showHistory.value = false
    success(`Texte du ${formatDate(v.created_at)} restauré — pense à enregistrer.`)
  } catch {
    notifyError('Échec de la restauration')
  }
}
function formatDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso.replace(' ', 'T') + (iso.includes('Z') || iso.includes('+') ? '' : 'Z'))
  return d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
}

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
      icon_name: form.value.icon_name || null,
    }
    // Pour les fonctionnalites : on envoie la matrice de disponibilite,
    // le backend en derive automatiquement le service_level.
    if (props.mode === 'functionality') {
      payload.avail_e = form.value.avail_e || null
      payload.avail_s = form.value.avail_s || null
      payload.avail_p = form.value.avail_p || null
    }
    if (isEdit.value) {
      const { data } = await updateSectionTemplate(props.template.id, payload)
      success(`${labelEntity.value[0].toUpperCase()}${labelEntity.value.slice(1)} enregistrée`)
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
  const ok = await confirm({ title: 'Supprimer ?', message: `« ${props.template.title} »`, confirmLabel: 'Supprimer', danger: true })
  if (!ok) return
  deleting.value = true
  try {
    await deleteSectionTemplate(props.template.id)
    success(`${labelEntity.value[0].toUpperCase()}${labelEntity.value.slice(1)} supprimée`)
    emit('deleted', props.template.id)
  } catch (e) {
    // 409 : des AFs utilisent encore la section. On propose le cascade.
    if (e.response?.status === 409) {
      const n = e.response.data?.affected_count || 0
      const ok2 = await confirm({
        title: `Forcer la suppression ?`,
        message: `${n} AF${n > 1 ? 's' : ''} utilise${n > 1 ? 'nt' : ''} encore cette ${labelEntity.value}.\n\nLes sections correspondantes seront retirées de ces AFs et le contenu personnalisé sera perdu.`,
        confirmLabel: 'Forcer',
        danger: true,
      })
      if (ok2) {
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

      <!-- Icone FontAwesome (uniquement pour les fonctionnalites — pas pour
           les sections types narratives). Visible dans la liste de la
           bibliotheque et dans la brochure PDF. -->
      <div v-if="mode === 'functionality'">
        <label class="block text-xs font-medium text-gray-600 mb-1">
          Icône
          <span class="text-gray-400 font-normal">— affichée dans la liste, la brochure et le tableau des offres</span>
        </label>
        <FaIconPicker v-model="form.icon_name" />
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
          <SearchableSelect
            v-model="form.parent_template_id"
            :options="parentSelectOptions"
            placeholder="— (top-level)"
            search-placeholder="Rechercher une section parente…"
          />
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
          <button v-if="isEdit" type="button" @click="openHistory"
                  class="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-indigo-700 hover:bg-indigo-50 px-2 py-1 rounded transition whitespace-nowrap"
                  title="Voir l'historique des modifications du texte et restaurer une version antérieure">
            <ClockIcon class="w-3.5 h-3.5" /> Historique
          </button>
        </div>
        <RichTextEditor
          v-model="form.body_html"
          placeholder="Ce que dit cette section dans le style Buildy : 2-4 paragraphes courts, ton sobre et technique, vocabulaire métier GTB précis…"
          min-height="180px"
          :assist-context="{
            kind: mode === 'functionality' ? 'functionality' : 'narrative_section',
            title: form.title || null,
            bacs_articles: form.bacs_articles || null,
            avail_e: form.avail_e,
            avail_s: form.avail_s,
            avail_p: form.avail_p,
            current_template_id: props.template?.id || null,
            parent_template_id: form.parent_template_id || null,
          }"
        />
      </div>

      <p v-if="isEdit && form.kind === 'standard'"
         class="text-xs text-gray-500 leading-relaxed bg-gray-50 border border-gray-200 rounded-lg p-3">
        Les AFs existantes restent figées sur la version actuellement liée. Pour qu'une AF
        prenne en compte cette modification, ouvre la section concernée — un bandeau
        « nouvelle version » te proposera de la mettre à jour.
      </p>

      <!-- Captures du modele : automatiquement heritees par les AFs -->
      <div v-if="isEdit">
        <TemplateAttachmentsGrid template-kind="section" :template-id="props.template.id" />
      </div>
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

  <BaseModal v-if="showEquipmentPicker" title="Choisir un modèle d'équipement" size="lg" @close="showEquipmentPicker = false">
    <EquipmentTemplatePicker
      :model-value="form.equipment_template_id"
      :templates="equipmentTemplates"
      @update:model-value="(v) => { form.equipment_template_id = v; showEquipmentPicker = false }"
    />
  </BaseModal>

  <!-- Modale "Historique" : liste des versions anterieures du body_html.
       Affiche un apercu texte + bouton restaurer. La restauration ne
       sauvegarde pas : le snapshot atterit dans la form, l'user clique
       Enregistrer pour confirmer (ce qui versionne le texte actuel). -->
  <BaseModal v-if="showHistory" title="Historique du texte" size="lg" @close="showHistory = false">
    <div v-if="historyLoading" class="py-12 text-center text-sm text-gray-400">
      Chargement…
    </div>
    <div v-else-if="!historyVersions.length" class="py-12 text-center">
      <ClockIcon class="w-10 h-10 text-gray-200 mx-auto mb-3" />
      <p class="text-sm text-gray-500">Aucune version antérieure enregistrée pour ce texte.</p>
      <p class="text-xs text-gray-400 mt-2">Une version sera figée à chaque modification du contenu.</p>
    </div>
    <ul v-else class="divide-y divide-gray-100 max-h-[60vh] overflow-y-auto -mx-1">
      <li v-for="v in historyVersions" :key="v.id" class="py-3 px-1 flex items-start gap-3">
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 text-xs text-gray-500 mb-1">
            <span class="font-medium text-gray-700">{{ formatDate(v.created_at) }}</span>
            <span v-if="v.author_name">· par {{ v.author_name }}</span>
            <span class="text-gray-300">·</span>
            <span>{{ v.body_length }} caractères</span>
          </div>
          <p class="text-sm text-gray-600 line-clamp-3 leading-relaxed">
            {{ v.preview || '(texte vide)' }}
          </p>
        </div>
        <button type="button" @click="restoreVersion(v)"
                class="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 hover:bg-indigo-100 rounded-lg whitespace-nowrap transition">
          <ArrowUturnLeftIcon class="w-3.5 h-3.5" /> Restaurer ce texte
        </button>
      </li>
    </ul>
    <template #footer>
      <button @click="showHistory = false"
              class="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 rounded-lg transition">
        Fermer
      </button>
    </template>
  </BaseModal>
</template>
