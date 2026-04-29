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
import { SparklesIcon, TrashIcon, ChevronDownIcon } from '@heroicons/vue/24/outline'
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

// === Section parente dans l'arbre canonique ==========================
// Une seule liste deroulante. La section_template kind=equipment qui pointe
// vers ce modele est creee/deplacee/supprimee automatiquement selon la valeur.
const linkedSections = ref([])
const allSectionTemplates = ref([])
const parentSectionId = ref(null) // valeur du select (null = pas liee)
const savingParent = ref(false)

async function reloadLinks() {
  if (!isEdit.value) { linkedSections.value = []; parentSectionId.value = null; return }
  try {
    const { data } = await getEquipmentTemplate(props.template.id)
    linkedSections.value = data.linked_sections || []
    // Si une seule liaison existe, on prend son parent comme valeur initiale.
    parentSectionId.value = linkedSections.value[0]?.parent_template_id ?? null
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

// Options du select : "non liée" (null) + tous les section_templates non-equipment.
const parentOptions = computed(() => {
  const opts = [{ id: null, label: '— Non liée' }]
  const byParent = new Map()
  for (const t of allSectionTemplates.value) {
    const k = t.parent_template_id || 0
    if (!byParent.has(k)) byParent.set(k, [])
    byParent.get(k).push(t)
  }
  for (const arr of byParent.values()) {
    arr.sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
  }
  function visit(parentId, depth) {
    for (const t of (byParent.get(parentId) || [])) {
      if (t.kind === 'equipment') continue
      opts.push({ id: t.id, label: '— '.repeat(depth) + t.title })
      visit(t.id, depth + 1)
    }
  }
  visit(0, 1)
  return opts
})

// Auto-save : create / move / delete selon la valeur choisie et l'etat actuel.
async function saveParentSection() {
  if (!isEdit.value) return
  savingParent.value = true
  try {
    const existing = linkedSections.value[0] || null
    const target = parentSectionId.value
    if (!existing && target) {
      // Pas de lien existant + parent choisi → creer la section
      await createSectionTemplate({
        title: form.value.name.trim() || `Équipement #${props.template.id}`,
        kind: 'equipment',
        parent_template_id: target,
        equipment_template_id: props.template.id,
      })
      success('Section parente définie')
    } else if (existing && target && target !== existing.parent_template_id) {
      // Lien existant + nouveau parent → re-parenter
      await updateSectionTemplate(existing.id, { parent_template_id: target })
      success('Section déplacée')
    } else if (existing && !target) {
      // Lien existant + "non liée" → supprimer la section
      await deleteSectionTemplate(existing.id)
      success('Section déliée')
    }
    await reloadLinks()
    await loadAllSectionTemplates()
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Échec — la section est peut-être utilisée par des AFs')
    await reloadLinks() // remet l'UI a l'etat serveur si l'op a echoue
  } finally {
    savingParent.value = false
  }
}

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

      <!-- Section parente : juste une liste deroulante -->
      <div v-if="isEdit" class="grid grid-cols-3 gap-3 items-end">
        <div class="col-span-3">
          <label class="block text-xs font-medium text-gray-600 mb-1">
            Section parente dans l'arbre AF
            <span class="text-gray-400 font-normal">— sauvegarde automatique</span>
          </label>
          <select v-model="parentSectionId" @change="saveParentSection" :disabled="savingParent"
                  class="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition">
            <option v-for="o in parentOptions" :key="o.id ?? 'none'" :value="o.id">{{ o.label }}</option>
          </select>
          <p v-if="linkedSections.length > 1" class="text-[11px] text-amber-600 mt-1">
            ⚠ Ce modèle est lié à {{ linkedSections.length }} sections — éditer les autres dans Sections types.
          </p>
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

      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="block text-xs font-medium text-gray-600 mb-1">Articles BACS applicables</label>
          <input v-model="form.bacs_articles" type="text" autocomplete="off" data-1p-ignore="true"
                 placeholder="Ex : R175-1 §1, §2, §3"
                 class="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition" />
          <p class="text-[11px] text-gray-400 mt-1">Format : <code class="bg-gray-100 px-1 rounded">R175-1 §1, §2</code>. Vide si non visé.</p>
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
