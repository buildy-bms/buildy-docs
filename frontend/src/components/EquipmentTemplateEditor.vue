<script setup>
/**
 * Modale création / édition d'un template équipement.
 *
 * Props :
 *   template : objet existant (= mode édition) ou null (= mode création)
 *
 * Émet :
 *   close → fermer sans rien faire
 *   saved (template) → fermer et rafraîchir le parent
 */
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { TrashIcon, ChevronDownIcon, XMarkIcon, ScaleIcon, MagnifyingGlassIcon, CheckBadgeIcon, SparklesIcon } from '@heroicons/vue/24/outline'
import BaseModal from './BaseModal.vue'
import EquipmentIcon from './EquipmentIcon.vue'
import RichTextEditor from './RichTextEditor.vue'
import EquipmentPointsEditor from './EquipmentPointsEditor.vue'
import TemplateAttachmentsGrid from './TemplateAttachmentsGrid.vue'
// Lazy-load la full lib FA Pro Solid (~1 Mo) UNIQUEMENT dans cet editeur
// admin pour eviter le bundle main.
const ALL_FA_NAMES = ref([])
import {
  createEquipmentTemplate,
  updateEquipmentTemplate,
  deleteEquipmentTemplate,
  getEquipmentTemplate,
  validateEquipmentTemplateContent,
  unvalidateEquipmentTemplateContent,
  claudeLibraryAssist,
} from '@/api'
import ContentValidationDot from './ContentValidationDot.vue'
import SearchableSelect from './SearchableSelect.vue'
import { ENERGY_OPTIONS, ROLE_OPTIONS } from '@/lib/audit-options'
import { getValidationStatus } from '@/lib/content-validation'
import { useNotification } from '@/composables/useNotification'
import { useSystemCategories } from '@/composables/useSystemCategories'
import { useConfirm } from '@/composables/useConfirm'

const props = defineProps({
  template: { type: Object, default: null },
})
const emit = defineEmits(['close', 'saved', 'saved-inline', 'deleted'])
const { success, error: notifyError } = useNotification()
const { confirm } = useConfirm()

const isEdit = computed(() => !!props.template?.id)

// Catalogue dynamique : alimenté par le composable useSystemCategories qui
// charge `system_categories_db` (table éditable via /library/equipments
// ?tab=categories). Pas de liste hardcodée — toute catégorie créée par
// l'admin apparaît automatiquement ici. `value` = `key` DB.
const { categories: dbCategories } = useSystemCategories()
const CATEGORIES = computed(() =>
  dbCategories.value.map(c => ({ value: c.key, label: c.label, icon: c.icon, color: c.color }))
)

const PROTOCOLS_PRESETS = ['Modbus TCP', 'Modbus RTU', 'BACnet/IP', 'BACnet MS/TP', 'KNX/IP', 'KNX TP', 'M-Bus IP', 'M-Bus filaire', 'MQTT', 'OPC-UA', 'LoRaWAN', 'DALI', 'Zigbee']
// Liste affichee = presets + tout protocole custom deja sur le template
// (pour qu'il reste visible et toggleable). dedupe.
const allProtocols = computed(() => {
  const set = new Set([...PROTOCOLS_PRESETS, ...(form.value.preferred_protocols || [])])
  return [...set]
})
const customProtocol = ref('')
function addCustomProtocol() {
  const v = customProtocol.value.trim()
  if (!v) return
  if (!form.value.preferred_protocols.includes(v)) {
    form.value.preferred_protocols.push(v)
  }
  customProtocol.value = ''
}

// Palette de couleurs Buildy pour le pastillage des icônes
const COLOR_PRESETS = [
  '#3b82f6', '#1e40af', '#06b6d4', '#0ea5e9', '#10b981', '#22c55e',
  '#facc15', '#eab308', '#f97316', '#ef4444', '#a855f7', '#ec4899',
  '#475569', '#64748b', '#6b7280',
]

const form = ref({
  slug: '',
  name: '',
  category: 'autres',
  bacs_articles: '',
  bacs_justification: '',
  description_html: '',
  preferred_protocols: [],
  icon_kind: 'fa',
  icon_value: 'fa-cube',
  icon_color: '#6b7280',
  default_energy_source: null,
  // Multi-rôle : array (peut être vide). Persisté en JSON array côté DB.
  default_device_role: [],
  // Item 10 — contre-indications de pilotage BACS : array de codes.
  bacs_contraindications: [],
})

// Item 10 — codes de contre-indications de pilotage par type d'équipement.
const BACS_CONTRAINDICATION_OPTIONS = [
  { value: 'do_not_cut_power_thermodynamic', label: 'Thermodynamique — ne pas couper l\'alimentation' },
  { value: 'do_not_cut_power_winter_boiler', label: 'Chaudière hivernale — ne pas couper (hors-gel)' },
  { value: 'legionella_loop_ecs', label: 'Boucle ECS — arrêt interdit (légionelle)' },
  { value: 'continuous_ventilation_required', label: 'Ventilation continue requise (EHPAD, hôpitaux…)' },
  { value: 'aci_tank_no_long_cut', label: 'Ballon ECS à anode ACI — pas de coupure prolongée' },
  { value: 'circulator_degommage', label: 'Circulateur avec dégommage — ne pas couper en été' },
  { value: 'lighting_already_optimized', label: 'Éclairage déjà optimisé — pas de gisement BACS' },
]

const selectedCategory = computed(() =>
  CATEGORIES.value.find(c => c.value === form.value.category) ||
  CATEGORIES.value[CATEGORIES.value.length - 1] ||
  { value: 'autres', label: 'Autres', icon: 'fa-cube', color: '#6b7280' }
)
const categoryOpen = ref(false)
const categoryRef = ref(null)
const categorySearch = ref('')
const categorySearchRef = ref(null)
function normalizeSearch(s) {
  return (s || '').toString().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}
const filteredCategories = computed(() => {
  const q = normalizeSearch(categorySearch.value.trim())
  if (!q) return CATEGORIES.value
  return CATEGORIES.value.filter(c => normalizeSearch(c.label).includes(q))
})
function toggleCategory() {
  categoryOpen.value = !categoryOpen.value
  if (categoryOpen.value) {
    categorySearch.value = ''
    nextTick(() => categorySearchRef.value?.focus?.())
  }
}
function pickCategory(value) { form.value.category = value; categoryOpen.value = false }
function onDocClick(e) {
  if (categoryRef.value && !categoryRef.value.contains(e.target)) categoryOpen.value = false
}
onMounted(() => document.addEventListener('mousedown', onDocClick))
onBeforeUnmount(() => document.removeEventListener('mousedown', onDocClick))

const submitting = ref(false)
const validating = ref(false)

// Suggestion de titre proposee par Claude (description ou justification BACS).
const suggestedTitle = ref(null)
const suggestingTitle = ref(false)
function onSuggestedTitle(t) {
  if (t && t.trim() && t.trim() !== (form.value.name || '').trim()) {
    suggestedTitle.value = t.trim()
  }
}
function applySuggestedTitle() {
  if (suggestedTitle.value) form.value.name = suggestedTitle.value
  suggestedTitle.value = null
}
function dismissSuggestedTitle() { suggestedTitle.value = null }

async function suggestTitleOnly() {
  if (!form.value.name.trim() || suggestingTitle.value) return
  suggestingTitle.value = true
  try {
    const { data } = await claudeLibraryAssist({
      mode: 'title',
      kind: 'equipment_description',
      title: form.value.name.trim(),
      html: form.value.description_html || undefined,
      category_label: selectedCategory.value?.label || null,
      bacs_articles: props.template?.bacs_articles || null,
      current_template_id: props.template?.id || null,
      category: form.value.category || null,
    })
    if (data?.suggested_title) {
      onSuggestedTitle(data.suggested_title)
    } else {
      success('Nom actuel jugé déjà bon par Claude')
    }
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Échec de la requête Claude')
  } finally {
    suggestingTitle.value = false
  }
}

// Etat local synchronise avec props.template + mises a jour apres save
// inline. Permet au bandeau de validation de rester a jour sans fermer.
const liveTemplate = ref(props.template || {})
watch(() => props.template, (t) => { liveTemplate.value = t || {} })

const isDirty = computed(() => {
  if (!isEdit.value) return false
  const cur = liveTemplate.value?.description_html || ''
  return (form.value.description_html || '') !== cur
})
// Cf. SectionTemplateEditor : degrade en 'draft' quand isDirty pour que
// le bouton "Valider la description" reapparaisse pendant l'edition.
const currentStatus = computed(() => {
  const persisted = getValidationStatus(liveTemplate.value || {}, 'description_html')
  if (persisted === 'validated' && isDirty.value) return 'draft'
  return persisted
})
const canValidate = computed(() => {
  if (!isEdit.value) return false
  const persistedHtml = (liveTemplate.value?.description_html || '').trim()
  const formHtml = (form.value.description_html || '').trim()
  return !!(persistedHtml || formHtml)
})

async function toggleValidation() {
  if (!canValidate.value || !liveTemplate.value?.id) return
  validating.value = true
  try {
    if (isDirty.value) {
      const saved = await save({ close: false })
      if (!saved) { validating.value = false; return }
    }
    if (currentStatus.value === 'validated') {
      const { data } = await unvalidateEquipmentTemplateContent(liveTemplate.value.id)
      liveTemplate.value = data
      success('Description repassée en brouillon')
      emit('saved-inline', data)
    } else {
      const { data } = await validateEquipmentTemplateContent(liveTemplate.value.id)
      liveTemplate.value = data
      success('Description validée')
      emit('saved-inline', data)
    }
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Échec')
  } finally {
    validating.value = false
  }
}

watch(() => props.template, (t) => {
  if (t) {
    form.value = {
      slug: t.slug || '',
      name: t.name || '',
      category: t.category || 'autres',
      bacs_articles: t.bacs_articles || '',
      bacs_justification: t.bacs_justification || '',
      description_html: t.description_html || '',
      preferred_protocols: (t.preferred_protocols || '').split(',').map(s => s.trim()).filter(Boolean),
      icon_kind: t.icon_kind || 'fa',
      icon_value: t.icon_value || 'fa-cube',
      icon_color: t.icon_color || '#6b7280',
      default_energy_source: t.default_energy_source || null,
      // Multi-rôle : backend retourne un array (mig 117). Si valeur scalaire
      // legacy ou null, normalise en array.
      default_device_role: Array.isArray(t.default_device_role)
        ? t.default_device_role
        : (t.default_device_role ? [t.default_device_role] : []),
      // Item 10 — backend retourne un array de codes (jamais null).
      bacs_contraindications: Array.isArray(t.bacs_contraindications)
        ? t.bacs_contraindications : [],
    }
  }
}, { immediate: true })

// Lot — Refactor catégories : la position d'un équipement dans l'arbre AF
// est désormais déterminée par sa `category` (= node parent automatique
// dans `system_categories_db`), plus par des "sections parentes" multiples
// stockées en `section_templates`. L'ancien selecteur multi-chips a donc
// été retire.

onMounted(async () => {
  // Lazy load FA full library (~1 Mo) seulement quand l'editeur est ouvert
  const allSolidIcons = await import('@fortawesome/pro-solid-svg-icons')
  ALL_FA_NAMES.value = [...new Set(
    Object.values(allSolidIcons)
      .filter(i => i && i.iconName && i.icon)
      .map(i => i.iconName)
  )].sort()
})

function toggleProtocol(p) {
  const idx = form.value.preferred_protocols.indexOf(p)
  if (idx >= 0) form.value.preferred_protocols.splice(idx, 1)
  else form.value.preferred_protocols.push(p)
}

// Picker icône — recherche prédictive dans toute la base FA Solid Pro.
// Match par MOT ENTIER (segment séparé par `-`) plutôt que par substring
// brute, sinon « heat » fait remonter « wheat » et « theater-masks » qui
// n'ont aucun rapport sémantique avec la chaleur. Ordre de pertinence :
// exact > segment-prefix > segment-contient.
const iconSearch = ref('')
const filteredIcons = computed(() => {
  const q = iconSearch.value.trim().toLowerCase()
  if (!q) return []
  const exact = []
  const prefix = []
  const wordMatch = []
  for (const n of ALL_FA_NAMES.value) {
    if (n === q) { exact.push(n); continue }
    const segments = n.split('-')
    if (segments[0].startsWith(q)) prefix.push(n)
    else if (segments.some(s => s === q || s.startsWith(q))) wordMatch.push(n)
    if (exact.length + prefix.length + wordMatch.length > 100) break
  }
  return [...exact, ...prefix, ...wordMatch].slice(0, 60)
})

function selectIconName(name) {
  form.value.icon_value = 'fa-' + name
}
function selectColor(color) {
  form.value.icon_color = color
}

// save({ close }) : enregistre le template. close=true => emit 'saved'
// (ferme la modale cote parent), close=false => emit 'saved-inline'
// (parent rafraichit la liste, modale reste ouverte).
async function save({ close = true } = {}) {
  if (!form.value.name.trim()) return null
  submitting.value = true
  try {
    const payload = {
      name: form.value.name.trim(),
      category: form.value.category || null,
      bacs_articles: form.value.bacs_articles.trim() || null,
      bacs_justification: form.value.bacs_justification.trim() || null,
      description_html: form.value.description_html.trim() || null,
      preferred_protocols: form.value.preferred_protocols.join(',') || null,
      icon_kind: form.value.icon_kind,
      icon_value: form.value.icon_value,
      icon_color: form.value.icon_color,
      default_energy_source: form.value.default_energy_source || null,
      // Multi-rôle : array vide → null (clear), sinon array.
      default_device_role: (Array.isArray(form.value.default_device_role) && form.value.default_device_role.length)
        ? form.value.default_device_role
        : null,
      // Item 10 — contre-indications BACS : array vide → null (clear).
      bacs_contraindications: (Array.isArray(form.value.bacs_contraindications) && form.value.bacs_contraindications.length)
        ? form.value.bacs_contraindications
        : null,
    }
    let res
    if (isEdit.value) {
      // Slug editable : on l'envoie uniquement s'il a change pour eviter
      // un round-trip d'unicite si l'utilisateur n'y touche pas.
      const slugTrim = form.value.slug.trim()
      if (slugTrim && slugTrim !== props.template.slug) {
        payload.slug = slugTrim
      }
      res = await updateEquipmentTemplate(props.template.id, payload)
      liveTemplate.value = res.data
      success('Modèle mis à jour')
      emit(close ? 'saved' : 'saved-inline', res.data)
    } else {
      payload.slug = form.value.slug.trim() || undefined
      res = await createEquipmentTemplate(payload)
      liveTemplate.value = res.data
      success('Modèle créé')
      emit('saved', res.data)
    }
    return res.data
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Échec de l\'enregistrement')
    return null
  } finally {
    submitting.value = false
  }
}
const submit = () => save({ close: true })
const submitKeepOpen = () => save({ close: false })

async function destroy() {
  if (!isEdit.value) return
  const ok = await confirm({
    title: 'Supprimer le modèle ?',
    message: `« ${props.template.name} »\n\nLes sections AF qui l'utilisent ne pourront plus en hériter.`,
    confirmLabel: 'Supprimer',
    danger: true,
  })
  if (!ok) return
  try {
    await deleteEquipmentTemplate(props.template.id)
    success('Modèle supprimé')
    emit('deleted', props.template.id)
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Échec suppression — il y a peut-être encore des sections AF qui l\'utilisent')
  }
}
</script>

<template>
  <BaseModal :title="isEdit ? `Éditer le modèle « ${template.name} »` : 'Nouveau modèle d\'équipement'" size="xl" :dismiss-on-backdrop="false" @close="emit('close')">
    <!-- Bandeau statut de validation de la description (mig 89). -->
    <div v-if="isEdit"
         :class="['flex items-center gap-2 px-2.5 py-1.5 mb-2 rounded-md border text-sm',
                  currentStatus === 'validated' ? 'bg-emerald-50 border-emerald-200' :
                  currentStatus === 'draft' ? 'bg-amber-50 border-amber-200' :
                  'bg-gray-50 border-gray-200']">
      <ContentValidationDot :status="currentStatus"
                            :validated-at="liveTemplate.content_validated_at"
                            :validated-by="liveTemplate.content_validated_by_name" />
      <div class="flex-1 text-xs">
        <template v-if="currentStatus === 'validated'">
          <span class="font-medium text-emerald-800">Description validée</span>
          <span v-if="liveTemplate.content_validated_by_name" class="text-emerald-700">
            · par {{ liveTemplate.content_validated_by_name }}
          </span>
          <span v-if="liveTemplate.content_validated_at" class="text-emerald-600">
            · le {{ new Date(liveTemplate.content_validated_at).toLocaleDateString('fr-FR') }}
          </span>
        </template>
        <span v-else-if="currentStatus === 'draft'" class="font-medium text-amber-800">
          Brouillon — description rédigée mais pas encore validée
        </span>
        <span v-else class="font-medium text-gray-600">
          Vide — aucune description rédigée pour le moment
        </span>
      </div>
    </div>
    <form @submit.prevent="submit" class="space-y-2.5">
      <!-- Sous-bloc IDENTITÉ : sections parentes, nom, categorie, slug. -->
      <fieldset class="border border-gray-200 rounded-lg px-3 pt-2 pb-2.5 space-y-2">
        <legend class="px-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
          Identité
        </legend>

      <!-- Identite -->
      <div class="grid grid-cols-3 gap-3">
        <div class="col-span-2">
          <label class="block text-[11px] font-medium text-gray-600 mb-0.5">Nom *</label>
          <div class="relative">
            <input v-model="form.name" type="text" required autocomplete="off" data-1p-ignore="true"
                   placeholder="Ex : Pompe à chaleur air/eau"
                   class="w-full pl-3 pr-9 py-1.5 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition" />
            <button type="button" @click="suggestTitleOnly" :disabled="suggestingTitle || !form.name.trim()"
                    v-tooltip="form.name.trim() ? 'Proposer un meilleur nom avec Claude' : 'Saisir d\'abord un nom'"
                    class="absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-7 h-7 text-violet-600 hover:text-violet-800 hover:bg-violet-50 disabled:opacity-30 rounded-md transition">
              <SparklesIcon class="w-4 h-4" :class="suggestingTitle ? 'animate-pulse' : ''" />
            </button>
          </div>
          <div v-if="suggestedTitle"
               class="mt-1 flex items-center gap-2 px-2 py-1 bg-violet-50 border border-violet-200 rounded-md text-[11px]">
            <SparklesIcon class="w-3.5 h-3.5 text-violet-600 shrink-0" />
            <span class="text-violet-900 truncate flex-1">
              Claude propose : <span class="font-medium">« {{ suggestedTitle }} »</span>
            </span>
            <button type="button" @click="applySuggestedTitle"
                    class="px-2 py-0.5 text-[11px] font-medium text-white bg-violet-600 hover:bg-violet-700 rounded transition shrink-0">
              Appliquer
            </button>
            <button type="button" @click="dismissSuggestedTitle"
                    class="text-violet-400 hover:text-violet-700 shrink-0" v-tooltip="'Ignorer'">
              <XMarkIcon class="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
        <div>
          <label class="block text-[11px] font-medium text-gray-600 mb-0.5">Catégorie</label>
          <div ref="categoryRef" class="relative">
            <button type="button" @click="toggleCategory"
                    class="w-full flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition">
              <EquipmentIcon :template="{ icon_kind: 'fa', icon_value: selectedCategory.icon, icon_color: selectedCategory.color }" size="sm" />
              <span class="flex-1 text-left text-gray-800 truncate">{{ selectedCategory.label }}</span>
              <ChevronDownIcon class="w-4 h-4 text-gray-400 shrink-0 transition-transform" :class="categoryOpen ? 'rotate-180' : ''" />
            </button>
            <div v-if="categoryOpen"
                 class="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
              <div class="relative border-b border-gray-100">
                <MagnifyingGlassIcon class="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input ref="categorySearchRef" v-model="categorySearch" type="text"
                       placeholder="Rechercher une catégorie…"
                       autocomplete="off" data-1p-ignore="true"
                       class="w-full pl-8 pr-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none" />
              </div>
              <div class="max-h-72 overflow-y-auto py-1">
                <button v-for="c in filteredCategories" :key="c.value" type="button" @click="pickCategory(c.value)"
                        :class="['w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left transition',
                                 form.category === c.value ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-gray-700 hover:bg-gray-50']">
                  <EquipmentIcon :template="{ icon_kind: 'fa', icon_value: c.icon, icon_color: c.color }" size="sm" />
                  <span class="truncate">{{ c.label }}</span>
                </button>
                <div v-if="!filteredCategories.length" class="px-3 py-3 text-xs text-gray-400 italic text-center">
                  Aucune catégorie
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div>
        <label class="block text-[11px] font-medium text-gray-600 mb-0.5">
          Slug
          <span v-if="!isEdit" class="text-gray-400 font-normal">— auto si vide</span>
          <span v-else class="text-gray-400 font-normal">— identifiant technique stable</span>
        </label>
        <input v-model="form.slug" type="text" autocomplete="off" data-1p-ignore="true"
               placeholder="pac-air-eau"
               class="w-full px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 font-mono placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition" />
        <p v-if="isEdit" class="mt-1 text-[10px] text-gray-500">
          Renommage géré automatiquement : pas de doublon créé.
        </p>
      </div>
      </fieldset>

      <!-- Sous-bloc PRÉ-REMPLISSAGE : valeurs par défaut servant à pré-remplir
           l'équipement créé depuis ce modèle via le bouton « Bibliothèque »
           d'un système BACS. Le rôle accepte des valeurs libres (creatable). -->
      <fieldset class="border border-gray-200 rounded-lg px-3 pt-2 pb-2.5 space-y-2">
        <legend class="px-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
          Pré-remplissage
        </legend>
        <p class="text-[11px] text-gray-500">
          Énergie et rôle pré-remplis sur l'équipement créé depuis ce modèle. Tape un nouveau rôle pour l'ajouter à la liste.
        </p>
        <div class="grid grid-cols-2 gap-2">
          <div>
            <label class="block text-[11px] font-medium text-gray-600 mb-0.5">
              Énergie par défaut <span class="text-gray-400 font-normal">(optionnel)</span>
            </label>
            <SearchableSelect
              v-model="form.default_energy_source"
              :options="ENERGY_OPTIONS"
              placeholder="—"
              :clearable="true"
            />
          </div>
          <div>
            <label class="block text-[11px] font-medium text-gray-600 mb-0.5">
              Fonctions intégrées <span class="text-gray-400 font-normal">(optionnel)</span>
            </label>
            <SearchableSelect
              v-model="form.default_device_role"
              :options="ROLE_OPTIONS"
              placeholder="Sélectionne un ou plusieurs rôles…"
              :multiple="true"
              :clearable="true"
              :creatable="true"
            />
          </div>
          <!-- Item 10 — contre-indications de pilotage BACS -->
          <div class="col-span-2">
            <label class="block text-[11px] font-medium text-gray-600 mb-0.5">
              Contre-indications de pilotage BACS <span class="text-gray-400 font-normal">(optionnel)</span>
            </label>
            <SearchableSelect
              v-model="form.bacs_contraindications"
              :options="BACS_CONTRAINDICATION_OPTIONS"
              placeholder="Aucune contre-indication…"
              :multiple="true"
              :clearable="true"
            />
            <p class="text-[10px] text-gray-400 mt-0.5 leading-snug">
              L'audit BACS ne génère pas d'action « arrêt manuel » contraire à ces contraintes.
            </p>
          </div>
        </div>
      </fieldset>

      <!-- Sous-bloc APPARENCE : icone + couleur. -->
      <fieldset class="border border-gray-200 rounded-lg px-3 pt-2 pb-2.5">
        <legend class="px-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
          Apparence
        </legend>
      <div>
        <label class="block text-[11px] font-medium text-gray-600 mb-0.5">Icône & couleur</label>
        <div class="flex items-center gap-2">
          <span class="inline-flex items-center justify-center w-9 h-9 bg-white border border-gray-200 rounded-lg shrink-0">
            <EquipmentIcon :template="{ icon_kind: 'fa', icon_value: form.icon_value, icon_color: form.icon_color }" size="md" />
          </span>
          <input v-model="iconSearch" type="text" autocomplete="off" data-1p-ignore="true"
                 placeholder="Rechercher (fire, water…)"
                 class="flex-1 px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition" />
        </div>

        <div v-if="iconSearch.trim()" class="bg-white border border-gray-200 rounded-lg p-1.5 mt-1.5 max-h-28 overflow-y-auto grid grid-cols-10 gap-0.5">
          <button v-for="name in filteredIcons" :key="name" type="button" @click="selectIconName(name)"
                  :class="['inline-flex items-center justify-center w-7 h-7 rounded-md transition', form.icon_value === 'fa-' + name ? 'bg-indigo-100 ring-1 ring-indigo-400' : 'hover:bg-gray-100']"
                  v-tooltip="name">
            <EquipmentIcon :template="{ icon_kind: 'fa', icon_value: 'fa-' + name, icon_color: form.icon_color }" size="sm" />
          </button>
          <p v-if="!filteredIcons.length" class="col-span-10 text-[11px] text-gray-400 italic text-center py-2">
            Aucune icône.
          </p>
        </div>

        <div class="flex items-center gap-1.5 mt-1.5">
          <span class="text-[11px] text-gray-500 mr-1">Couleur</span>
          <button v-for="c in COLOR_PRESETS" :key="c" type="button" @click="selectColor(c)"
                  :class="['w-4 h-4 rounded-full border-2 transition', form.icon_color === c ? 'border-gray-700 scale-110' : 'border-white ring-1 ring-gray-200']"
                  :style="{ background: c }" v-tooltip="c"></button>
          <input type="color" v-model="form.icon_color" class="w-5 h-5 rounded cursor-pointer ml-1 border border-gray-200" v-tooltip="'Couleur personnalisée'" />
        </div>
      </div>
      </fieldset>

      <!-- Sous-bloc TECHNIQUE : BACS herite + protocoles exiges. -->
      <fieldset class="border border-gray-200 rounded-lg px-3 pt-2 pb-2.5 space-y-2">
        <legend class="px-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
          Technique
        </legend>
        <div v-if="isEdit && (template.bacs_articles || template.bacs_inherited_from)">
          <label class="block text-[11px] font-medium text-gray-600 mb-0.5">Articles BACS applicables</label>
          <div class="flex items-start gap-2 px-3 py-1.5 bg-purple-50/50 border border-purple-200 rounded-lg text-xs">
            <ScaleIcon class="w-4 h-4 text-purple-600 shrink-0 mt-0.5" />
            <div class="min-w-0">
              <p class="text-gray-700">
                <span class="font-medium">{{ template.bacs_articles || '— (catégorie sans BACS)' }}</span>
              </p>
              <p v-if="template.bacs_inherited_from" class="text-[11px] text-gray-500 mt-0.5">
                Hérité de la catégorie « {{ template.bacs_inherited_from.label }} » — édité dans Catégories de systèmes.
              </p>
            </div>
          </div>
        </div>
      <div>
        <label class="block text-[11px] font-medium text-gray-600 mb-0.5">Protocoles exigés</label>
        <div class="flex flex-wrap gap-1.5 items-center">
          <button v-for="p in allProtocols" :key="p" type="button" @click="toggleProtocol(p)"
                  :class="['px-2.5 py-0.5 text-xs rounded-full border transition', form.preferred_protocols.includes(p) ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50']">
            {{ p }}
          </button>
          <!-- Ajout d'un protocole personnalise (absent de la liste predefinie) -->
          <div class="inline-flex items-center gap-1 ml-1 pl-2 border-l border-gray-200">
            <input
              v-model="customProtocol"
              @keydown.enter.prevent="addCustomProtocol"
              type="text"
              autocomplete="off"
              data-1p-ignore="true"
              placeholder="+ Ajouter un protocole…"
              class="w-44 px-2 py-1 text-xs bg-white border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-all"
            />
            <button
              type="button"
              @click="addCustomProtocol"
              :disabled="!customProtocol.trim()"
              class="px-2 py-1 text-xs bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-30 disabled:cursor-not-allowed"
              v-tooltip="'Ajouter ce protocole à la liste'"
            >Ajouter</button>
          </div>
        </div>
      </div>
      </fieldset>

      <!-- Sous-bloc CONTENU : description fonctionnelle + justification BACS. -->
      <fieldset class="border border-gray-200 rounded-lg px-3 pt-2 pb-2.5 space-y-2">
        <legend class="px-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
          Contenu
        </legend>
      <div>
        <label class="block text-[11px] font-medium text-gray-600 mb-0.5">
          Description fonctionnelle
        </label>
        <RichTextEditor
          v-model="form.description_html"
          placeholder="Ce que fait l'équipement, son rapport au décret BACS, qui assure sa régulation, et comment Buildy intervient en aval…"
          min-height="120px"
          @suggested-title="onSuggestedTitle"
          :assist-context="{
            kind: 'equipment_description',
            title: form.name || null,
            category_label: selectedCategory.label,
            bacs_articles: template?.bacs_articles || null,
            current_template_id: props.template?.id || null,
            category: form.category || template?.category || null,
          }"
        />
      </div>

      <div>
        <label class="block text-[11px] font-medium text-gray-600 mb-0.5">Justification BACS</label>
        <RichTextEditor
          v-model="form.bacs_justification"
          placeholder="L'article R175-X définit… Le décret impose… La solution Buildy permet…"
          min-height="90px"
          :assist-context="{
            kind: 'equipment_bacs_justification',
            title: form.name || null,
            category_label: selectedCategory.label,
            bacs_articles: template?.bacs_articles || null,
            current_template_id: props.template?.id || null,
            category: form.category || template?.category || null,
          }"
        />
      </div>
      </fieldset>

      <!-- Donnees lues / ecrites + Captures : repliables (gain de hauteur).
           Auto-deplies sur des modeles deja peuples. -->
      <details v-if="isEdit" class="group pt-2 border-t border-gray-100"
               :open="(template?.points_count || 0) > 0">
        <summary class="text-[11px] font-medium text-gray-700 cursor-pointer hover:text-gray-900 inline-flex items-center gap-1.5 select-none list-none">
          <span class="inline-block w-3 h-3 transition-transform group-open:rotate-90">▸</span>
          Données typiques
          <span v-if="template?.points_count" class="text-gray-400">· {{ template.points_count }}</span>
        </summary>
        <p class="text-[11px] text-gray-500 mt-1 mb-2">
          Lectures (mesures, états) et écritures (commandes, consignes). Cliquer pour éditer, glisser pour réordonner.
        </p>
        <EquipmentPointsEditor :template-id="template.id" @updated="$emit('saved', template)" />
      </details>

      <details v-if="isEdit" class="group pt-2 border-t border-gray-100"
               :open="(template?.attachments_count || 0) > 0">
        <summary class="text-[11px] font-medium text-gray-700 cursor-pointer hover:text-gray-900 inline-flex items-center gap-1.5 select-none list-none">
          <span class="inline-block w-3 h-3 transition-transform group-open:rotate-90">▸</span>
          Captures du modèle
          <span v-if="template?.attachments_count" class="text-gray-400">· {{ template.attachments_count }}</span>
        </summary>
        <div class="mt-2">
          <TemplateAttachmentsGrid template-kind="equipment" :template-id="template.id" />
        </div>
      </details>
    </form>

    <template #footer>
      <button v-if="isEdit" @click="destroy"
              class="mr-auto px-3 py-2 text-sm text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition inline-flex items-center gap-1.5">
        <TrashIcon class="w-4 h-4" /> Supprimer
      </button>
      <button v-if="isEdit && currentStatus === 'validated'"
              @click="toggleValidation" :disabled="!canValidate || validating || submitting"
              class="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 rounded-lg transition inline-flex items-center gap-1.5 disabled:opacity-50 whitespace-nowrap">
        Repasser en brouillon
      </button>
      <button v-else-if="isEdit"
              @click="toggleValidation" :disabled="!canValidate || validating || submitting"
              v-tooltip="canValidate ? '' : 'Aucune description à valider'"
              class="px-3 py-1.5 text-sm font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded-lg transition inline-flex items-center gap-1.5 disabled:opacity-50 whitespace-nowrap">
        <CheckBadgeIcon class="w-4 h-4 shrink-0" /> {{ validating ? '…' : 'Valider la description' }}
      </button>
      <button @click="emit('close')"
              class="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition">
        Annuler
      </button>
      <button v-if="isEdit"
              @click="submitKeepOpen" :disabled="submitting || !form.name.trim()"
              v-tooltip="'Enregistrer sans fermer'"
              class="px-3 py-1.5 text-sm font-medium text-indigo-700 bg-white border border-indigo-300 hover:bg-indigo-50 rounded-lg transition disabled:opacity-50">
        {{ submitting ? 'Enregistrement…' : 'Enregistrer' }}
      </button>
      <button @click="submit" :disabled="submitting || !form.name.trim()"
              class="px-4 py-1.5 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition shadow-sm">
        {{ submitting ? 'Enregistrement…' : (isEdit ? 'Enregistrer et fermer' : 'Créer le modèle') }}
      </button>
    </template>
  </BaseModal>
</template>
