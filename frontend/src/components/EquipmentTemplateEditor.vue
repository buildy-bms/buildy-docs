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
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { SparklesIcon, TrashIcon, ChevronDownIcon, XMarkIcon, PlusIcon, ScaleIcon } from '@heroicons/vue/24/outline'
import BaseModal from './BaseModal.vue'
import ClaudePromptModal from './ClaudePromptModal.vue'
import EquipmentIcon from './EquipmentIcon.vue'
import RichTextEditor from './RichTextEditor.vue'
import * as allSolidIcons from '@fortawesome/pro-solid-svg-icons'

// Liste exhaustive des noms d'icones FA Solid Pro, déduplique les alias.
const ALL_FA_NAMES = [...new Set(
  Object.values(allSolidIcons)
    .filter(i => i && i.iconName && i.icon)
    .map(i => i.iconName)
)].sort()
import {
  createEquipmentTemplate,
  updateEquipmentTemplate,
  deleteEquipmentTemplate,
  getEquipmentTemplate,
  listSectionTemplates,
  createSectionTemplate,
  updateSectionTemplate,
  deleteSectionTemplate,
} from '@/api'
import { useNotification } from '@/composables/useNotification'

const props = defineProps({
  template: { type: Object, default: null },
})
const emit = defineEmits(['close', 'saved', 'deleted'])
const { success, error: notifyError } = useNotification()

const isEdit = computed(() => !!props.template?.id)

const CATEGORIES = [
  { value: 'ventilation',   label: 'Ventilation',          icon: 'fa-fan',             color: '#3b82f6' },
  { value: 'chauffage',     label: 'Chauffage',            icon: 'fa-fire',            color: '#dc2626' },
  { value: 'climatisation', label: 'Climatisation',        icon: 'fa-snowflake',       color: '#0ea5e9' },
  { value: 'ecs',           label: 'Eau chaude sanitaire', icon: 'fa-faucet-drip',     color: '#0284c7' },
  { value: 'eclairage',     label: 'Éclairage',            icon: 'fa-lightbulb',       color: '#eab308' },
  { value: 'electricite',   label: 'Électricité',          icon: 'fa-bolt',            color: '#a855f7' },
  { value: 'comptage',      label: 'Comptage énergétique', icon: 'fa-gauge',           color: '#22c55e' },
  { value: 'qai',           label: 'Qualité de l\'air',    icon: 'fa-leaf',            color: '#16a34a' },
  { value: 'occultation',   label: 'Occultation',          icon: 'fa-window-maximize', color: '#64748b' },
  { value: 'process',       label: 'Process industriel',   icon: 'fa-industry',        color: '#475569' },
  { value: 'autres',        label: 'Autres équipements',   icon: 'fa-cube',            color: '#6b7280' },
]

const PROTOCOLS = ['Modbus TCP', 'Modbus RTU', 'BACnet/IP', 'BACnet MS/TP', 'KNX/IP', 'KNX TP', 'M-Bus IP', 'M-Bus filaire', 'MQTT', 'OPC-UA', 'LoRaWAN', 'DALI', 'Zigbee']

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
})

const selectedCategory = computed(() => CATEGORIES.find(c => c.value === form.value.category) || CATEGORIES[CATEGORIES.length - 1])
const categoryOpen = ref(false)
const categoryRef = ref(null)
function toggleCategory() { categoryOpen.value = !categoryOpen.value }
function pickCategory(value) { form.value.category = value; categoryOpen.value = false }
function onDocClick(e) {
  if (categoryRef.value && !categoryRef.value.contains(e.target)) categoryOpen.value = false
}
onMounted(() => document.addEventListener('mousedown', onDocClick))
onBeforeUnmount(() => document.removeEventListener('mousedown', onDocClick))

const submitting = ref(false)
const showClaudePrompt = ref(false)
const claudeMode = ref('description') // 'description' | 'justification'

function openClaudeFor(mode) {
  claudeMode.value = mode
  showClaudePrompt.value = true
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
    }
  }
}, { immediate: true })

// === Sections parentes dans l'arbre canonique ========================
// Multi-select : un equipement peut etre liee a N sections (chacune = un
// section_template kind=equipment avec equipment_template_id = ce modele).
const linkedSections = ref([])
const allSectionTemplates = ref([])
const savingLink = ref(false)
const addOpen = ref(false)
const addSearch = ref('')
const addRef = ref(null)

async function reloadLinks() {
  if (!isEdit.value) { linkedSections.value = []; return }
  try {
    const { data } = await getEquipmentTemplate(props.template.id)
    linkedSections.value = data.linked_sections || []
  } catch { /* silencieux */ }
}
async function loadAllSectionTemplates() {
  try {
    const { data } = await listSectionTemplates({})
    allSectionTemplates.value = data || []
  } catch { allSectionTemplates.value = [] }
}
onMounted(() => {
  reloadLinks()
  loadAllSectionTemplates()
})

// Tous les parents possibles (section_templates non-equipment) — avec chemin
// hierarchique pour l'autocomplete et indentation visuelle.
const parentOptions = computed(() => {
  const opts = []
  const byParent = new Map()
  const byId = new Map()
  for (const t of allSectionTemplates.value) {
    const k = t.parent_template_id || 0
    if (!byParent.has(k)) byParent.set(k, [])
    byParent.get(k).push(t)
    byId.set(t.id, t)
  }
  for (const arr of byParent.values()) {
    arr.sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
  }
  function pathOf(t) {
    const parts = []
    let cur = t
    while (cur) {
      parts.unshift(cur.title)
      cur = cur.parent_template_id ? byId.get(cur.parent_template_id) : null
    }
    return parts.join(' › ')
  }
  function visit(parentId, depth) {
    for (const t of (byParent.get(parentId) || [])) {
      if (t.kind === 'equipment') continue
      opts.push({ id: t.id, depth, title: t.title, path: pathOf(t) })
      visit(t.id, depth + 1)
    }
  }
  visit(0, 0)
  return opts
})

// Filtre options : exclut les parents deja utilises + filtre par recherche.
const usedParentIds = computed(() => new Set(linkedSections.value.map(s => s.parent_template_id)))
const filteredAddOptions = computed(() => {
  const q = addSearch.value.trim().toLowerCase()
  return parentOptions.value.filter(o => {
    if (usedParentIds.value.has(o.id)) return false
    if (!q) return true
    return o.path.toLowerCase().includes(q) || o.title.toLowerCase().includes(q)
  })
})

async function addParent(parentId) {
  if (!isEdit.value) return
  savingLink.value = true
  try {
    await createSectionTemplate({
      title: form.value.name.trim() || `Équipement #${props.template.id}`,
      kind: 'equipment',
      parent_template_id: parentId,
      equipment_template_id: props.template.id,
    })
    addOpen.value = false
    addSearch.value = ''
    await reloadLinks()
    await loadAllSectionTemplates()
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Échec de la liaison')
  } finally {
    savingLink.value = false
  }
}

async function removeParent(section) {
  savingLink.value = true
  try {
    await deleteSectionTemplate(section.id)
    await reloadLinks()
    await loadAllSectionTemplates()
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Suppression refusée — des AFs utilisent peut-être encore cette section')
  } finally {
    savingLink.value = false
  }
}

function onAddDocClick(e) {
  if (addRef.value && !addRef.value.contains(e.target)) {
    addOpen.value = false
    addSearch.value = ''
  }
}
onMounted(() => document.addEventListener('mousedown', onAddDocClick))
onBeforeUnmount(() => document.removeEventListener('mousedown', onAddDocClick))

function toggleProtocol(p) {
  const idx = form.value.preferred_protocols.indexOf(p)
  if (idx >= 0) form.value.preferred_protocols.splice(idx, 1)
  else form.value.preferred_protocols.push(p)
}

// Picker icône — recherche prédictive dans toute la base FA Solid Pro
const iconSearch = ref('')
const filteredIcons = computed(() => {
  const q = iconSearch.value.trim().toLowerCase()
  if (!q) return [] // pas d'affichage par defaut : la grille n'apparait qu'a la recherche
  return ALL_FA_NAMES.filter(n => n.includes(q)).slice(0, 60)
})

function selectIconName(name) {
  form.value.icon_value = 'fa-' + name
}
function selectColor(color) {
  form.value.icon_color = color
}

async function submit() {
  if (!form.value.name.trim()) return
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
    }
    let res
    if (isEdit.value) {
      res = await updateEquipmentTemplate(props.template.id, payload)
      success('Modèle mis à jour')
    } else {
      payload.slug = form.value.slug.trim() || undefined
      res = await createEquipmentTemplate(payload)
      success('Modèle créé')
    }
    emit('saved', res.data)
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Échec de l\'enregistrement')
  } finally {
    submitting.value = false
  }
}

async function destroy() {
  if (!isEdit.value) return
  if (!confirm(`Supprimer le modèle « ${props.template.name} » ?\nLes sections AF qui l'utilisent ne pourront plus en hériter.`)) return
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
  <BaseModal :title="isEdit ? `Éditer le modèle « ${template.name} »` : 'Nouveau modèle d\'équipement'" size="lg" @close="emit('close')">
    <form @submit.prevent="submit" class="space-y-3">

      <!-- Sections parentes : multi-select chips + popover de recherche -->
      <div v-if="isEdit">
        <label class="block text-xs font-medium text-gray-600 mb-1">
          Sections parentes dans l'arbre AF
          <span class="text-gray-400 font-normal">— où ce modèle apparaît dans les AFs</span>
        </label>
        <div class="flex flex-wrap items-center gap-1.5 px-2 py-1.5 min-h-10 bg-white border border-gray-200 rounded-lg focus-within:ring-2 focus-within:ring-indigo-500/30 focus-within:border-indigo-500 transition">
          <span v-for="s in linkedSections" :key="s.id"
                class="inline-flex items-center gap-1.5 pl-2.5 pr-1 py-1 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-full text-xs">
            <span class="truncate max-w-[24rem]" :title="s.path">{{ s.path }}</span>
            <button type="button" @click="removeParent(s)" :disabled="savingLink"
                    class="inline-flex items-center justify-center w-4 h-4 text-indigo-400 hover:text-white hover:bg-indigo-500 rounded-full transition disabled:opacity-50"
                    title="Délier">
              <XMarkIcon class="w-3 h-3" />
            </button>
          </span>

          <div ref="addRef" class="relative">
            <button type="button" @click="addOpen = !addOpen"
                    class="inline-flex items-center gap-1 px-2 py-1 text-xs text-gray-500 hover:text-indigo-700 hover:bg-indigo-50 rounded-full transition">
              <PlusIcon class="w-3.5 h-3.5" />
              {{ linkedSections.length ? 'Ajouter' : 'Choisir une section parente' }}
            </button>
            <div v-if="addOpen" class="absolute z-30 left-0 mt-1 w-96 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden">
              <div class="px-3 py-2 border-b border-gray-100">
                <input v-model="addSearch" type="text" autocomplete="off" data-1p-ignore="true"
                       placeholder="Rechercher une section…"
                       class="w-full px-2 py-1.5 text-sm bg-gray-50 border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:bg-white transition"
                       @click.stop />
              </div>
              <div class="max-h-72 overflow-y-auto py-1">
                <button v-for="o in filteredAddOptions" :key="o.id" type="button"
                        @click="addParent(o.id)"
                        class="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-indigo-50 transition flex items-baseline gap-2">
                  <span class="text-gray-300 text-xs tabular-nums shrink-0" v-if="o.depth > 0">{{ '·'.repeat(o.depth) }}</span>
                  <span class="truncate">{{ o.path }}</span>
                </button>
                <p v-if="!filteredAddOptions.length" class="px-3 py-3 text-xs text-gray-400 italic text-center">
                  {{ addSearch ? 'Aucune section ne correspond.' : 'Toutes les sections sont déjà liées.' }}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Identite -->
      <div class="grid grid-cols-3 gap-3">
        <div class="col-span-2">
          <label class="block text-xs font-medium text-gray-600 mb-1">Nom *</label>
          <input v-model="form.name" type="text" required autocomplete="off" data-1p-ignore="true"
                 placeholder="Ex : Pompe à chaleur air/eau"
                 class="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition" />
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-600 mb-1">Catégorie</label>
          <div ref="categoryRef" class="relative">
            <button type="button" @click="toggleCategory"
                    class="w-full flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition">
              <EquipmentIcon :template="{ icon_kind: 'fa', icon_value: selectedCategory.icon, icon_color: selectedCategory.color }" size="sm" />
              <span class="flex-1 text-left text-gray-800 truncate">{{ selectedCategory.label }}</span>
              <ChevronDownIcon class="w-4 h-4 text-gray-400 shrink-0 transition-transform" :class="categoryOpen ? 'rotate-180' : ''" />
            </button>
            <div v-if="categoryOpen"
                 class="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-72 overflow-y-auto py-1">
              <button v-for="c in CATEGORIES" :key="c.value" type="button" @click="pickCategory(c.value)"
                      :class="['w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left transition',
                               form.category === c.value ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-gray-700 hover:bg-gray-50']">
                <EquipmentIcon :template="{ icon_kind: 'fa', icon_value: c.icon, icon_color: c.color }" size="sm" />
                <span class="truncate">{{ c.label }}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div v-if="!isEdit">
        <label class="block text-xs font-medium text-gray-600 mb-1">Slug <span class="text-gray-400 font-normal">— auto si vide</span></label>
        <input v-model="form.slug" type="text" autocomplete="off" data-1p-ignore="true"
               placeholder="pac-air-eau"
               class="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 font-mono placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition" />
      </div>

      <!-- BACS herite de la categorie : lecture seule, edite via la page Categories -->
      <div v-if="isEdit && (template.bacs_articles || template.bacs_inherited_from)">
        <label class="block text-xs font-medium text-gray-600 mb-1.5">Articles BACS applicables</label>
        <div class="flex items-start gap-2 px-3 py-2 bg-purple-50/50 border border-purple-200 rounded-lg text-xs">
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
        <label class="block text-xs font-medium text-gray-600 mb-1">Icône & couleur</label>
        <div class="flex items-center gap-2">
          <span class="inline-flex items-center justify-center w-9 h-9 bg-white border border-gray-200 rounded-lg shrink-0">
            <EquipmentIcon :template="{ icon_kind: 'fa', icon_value: form.icon_value, icon_color: form.icon_color }" size="md" />
          </span>
          <input v-model="iconSearch" type="text" autocomplete="off" data-1p-ignore="true"
                 placeholder="Rechercher (fire, water…)"
                 class="flex-1 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition" />
        </div>

        <div v-if="iconSearch.trim()" class="bg-white border border-gray-200 rounded-lg p-1.5 mt-1.5 max-h-28 overflow-y-auto grid grid-cols-10 gap-0.5">
          <button v-for="name in filteredIcons" :key="name" type="button" @click="selectIconName(name)"
                  :class="['inline-flex items-center justify-center w-7 h-7 rounded-md transition', form.icon_value === 'fa-' + name ? 'bg-indigo-100 ring-1 ring-indigo-400' : 'hover:bg-gray-100']"
                  :title="name">
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
                  :style="{ background: c }" :title="c"></button>
          <input type="color" v-model="form.icon_color" class="w-5 h-5 rounded cursor-pointer ml-1 border border-gray-200" title="Couleur personnalisée" />
        </div>
      </div>

      <div>
        <label class="block text-xs font-medium text-gray-600 mb-1.5">Protocoles exigés</label>
        <div class="flex flex-wrap gap-1.5">
          <button v-for="p in PROTOCOLS" :key="p" type="button" @click="toggleProtocol(p)"
                  :class="['px-2.5 py-0.5 text-xs rounded-full border transition', form.preferred_protocols.includes(p) ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50']">
            {{ p }}
          </button>
        </div>
      </div>

      <div>
        <div class="flex items-center justify-between mb-1">
          <label class="block text-xs font-medium text-gray-600">
            Description fonctionnelle
          </label>
          <button type="button" @click="openClaudeFor('description')"
                  class="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] text-violet-700 hover:text-violet-900 border border-violet-200 hover:bg-violet-50 rounded-lg transition">
            <SparklesIcon class="w-3 h-3" />
            Générer avec Claude
          </button>
        </div>
        <RichTextEditor
          v-model="form.description_html"
          placeholder="Ce que fait l'équipement, son rapport au décret BACS, qui assure sa régulation, et comment Buildy intervient en aval…"
          min-height="120px"
          enable-reformulate
          :reformulate-context="`Modèle d'équipement — ${form.name || 'sans nom'} (description fonctionnelle)`"
        />
      </div>

      <div>
        <div class="flex items-center justify-between mb-1">
          <label class="block text-xs font-medium text-gray-600">Justification BACS</label>
          <button type="button" @click="openClaudeFor('justification')"
                  class="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] text-violet-700 hover:text-violet-900 border border-violet-200 hover:bg-violet-50 rounded-lg transition">
            <SparklesIcon class="w-3 h-3" />
            Générer avec Claude
          </button>
        </div>
        <RichTextEditor
          v-model="form.bacs_justification"
          placeholder="L'article R175-X définit… Le décret impose… La solution Buildy permet…"
          min-height="90px"
          enable-reformulate
          :reformulate-context="`Modèle d'équipement — ${form.name || 'sans nom'} (justification BACS)`"
        />
      </div>
    </form>

    <template #footer>
      <button v-if="isEdit" @click="destroy"
              class="mr-auto px-3 py-2 text-sm text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition inline-flex items-center gap-1.5">
        <TrashIcon class="w-4 h-4" /> Supprimer
      </button>
      <button @click="emit('close')"
              class="px-3 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition">
        Annuler
      </button>
      <button @click="submit" :disabled="submitting || !form.name.trim()"
              class="px-4 py-2 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition shadow-sm">
        {{ submitting ? 'Enregistrement…' : (isEdit ? 'Enregistrer' : 'Créer le modèle') }}
      </button>
    </template>
  </BaseModal>

  <ClaudePromptModal v-if="showClaudePrompt" :template="{ ...form, preferred_protocols: form.preferred_protocols.join(',') }" :mode="claudeMode" @close="showClaudePrompt = false" />
</template>
