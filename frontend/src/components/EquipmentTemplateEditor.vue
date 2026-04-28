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
import { ref, computed, watch } from 'vue'
import { SparklesIcon, TrashIcon } from '@heroicons/vue/24/outline'
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
import { createEquipmentTemplate, updateEquipmentTemplate, deleteEquipmentTemplate } from '@/api'
import { useNotification } from '@/composables/useNotification'

const props = defineProps({
  template: { type: Object, default: null },
})
const emit = defineEmits(['close', 'saved', 'deleted'])
const { success, error: notifyError } = useNotification()

const isEdit = computed(() => !!props.template?.id)

const CATEGORIES = [
  { value: 'ventilation', label: 'Ventilation' },
  { value: 'chauffage', label: 'Chauffage' },
  { value: 'climatisation', label: 'Climatisation' },
  { value: 'ecs', label: 'Eau chaude sanitaire' },
  { value: 'eclairage', label: 'Éclairage' },
  { value: 'electricite', label: 'Électricité' },
  { value: 'comptage', label: 'Comptage énergétique' },
  { value: 'qai', label: 'Qualité de l\'air' },
  { value: 'occultation', label: 'Occultation' },
  { value: 'process', label: 'Process industriel' },
  { value: 'autres', label: 'Autres équipements' },
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

function toggleProtocol(p) {
  const idx = form.value.preferred_protocols.indexOf(p)
  if (idx >= 0) form.value.preferred_protocols.splice(idx, 1)
  else form.value.preferred_protocols.push(p)
}

// Picker icône — recherche prédictive dans toute la base FA Solid Free
const iconSearch = ref('')
const filteredIcons = computed(() => {
  const q = iconSearch.value.trim().toLowerCase()
  if (!q) {
    // Si pas de recherche, montrer un assortiment varié + l'icône courante
    const defaults = ['fan', 'fire', 'snowflake', 'droplet', 'lightbulb', 'bolt', 'temperature-half', 'leaf', 'plug', 'solar-panel', 'industry', 'cube', 'building', 'gauge', 'water', 'fire-flame-simple', 'wind', 'gear', 'server', 'tower-broadcast']
    return defaults.filter(n => ALL_FA_NAMES.includes(n))
  }
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
    <form @submit.prevent="submit" class="space-y-4">
      <div class="grid grid-cols-3 gap-3">
        <div class="col-span-2">
          <label class="block text-xs font-medium text-gray-700 mb-1">Nom *</label>
          <input v-model="form.name" type="text" required autocomplete="off" data-1p-ignore="true"
                 placeholder="Ex : Pompe à chaleur air/eau"
                 class="w-full px-3 py-2 border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-700 mb-1">Catégorie</label>
          <select v-model="form.category" class="w-full px-3 py-2 border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
            <option v-for="c in CATEGORIES" :key="c.value" :value="c.value">{{ c.label }}</option>
          </select>
        </div>
      </div>

      <div v-if="!isEdit">
        <label class="block text-xs font-medium text-gray-700 mb-1">Slug (auto si vide)</label>
        <input v-model="form.slug" type="text" autocomplete="off" data-1p-ignore="true"
               placeholder="pac-air-eau"
               class="w-full px-3 py-2 border border-gray-300 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500" />
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="block text-xs font-medium text-gray-700 mb-1">Articles BACS applicables</label>
          <input v-model="form.bacs_articles" type="text" autocomplete="off" data-1p-ignore="true"
                 placeholder="Ex : R175-1 §1, §2, §3"
                 class="w-full px-3 py-2 border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          <p class="text-[10px] text-gray-400 mt-1">Format : <code>R175-1 §1, §2 ; R175-3 §4</code>. Laisser vide si non visé.</p>
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-700 mb-1">Icône & couleur</label>
          <div class="flex items-center gap-2 mb-1.5">
            <span class="inline-flex items-center justify-center w-9 h-9 border-2 border-gray-300 rounded">
              <EquipmentIcon :template="{ icon_kind: 'fa', icon_value: form.icon_value, icon_color: form.icon_color }" size="md" />
            </span>
            <input v-model="iconSearch" type="text" autocomplete="off" data-1p-ignore="true"
                   placeholder="Rechercher (ex: fire, water, gauge…)"
                   class="flex-1 px-2 py-1.5 border border-gray-300 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>

          <div class="border border-gray-200 rounded p-1 max-h-32 overflow-y-auto grid grid-cols-10 gap-0.5">
            <button v-for="name in filteredIcons" :key="name" type="button" @click="selectIconName(name)"
                    :class="['inline-flex items-center justify-center w-7 h-7 rounded transition-all', form.icon_value === 'fa-' + name ? 'bg-indigo-100 ring-1 ring-indigo-400' : 'hover:bg-gray-100']"
                    :title="name">
              <EquipmentIcon :template="{ icon_kind: 'fa', icon_value: 'fa-' + name, icon_color: form.icon_color }" size="sm" />
            </button>
            <p v-if="!filteredIcons.length" class="col-span-10 text-[10px] text-gray-400 italic text-center py-2">
              Aucune icône ne correspond.
            </p>
          </div>

          <div class="flex items-center gap-1 mt-1.5">
            <span class="text-[10px] text-gray-500 mr-1">Couleur :</span>
            <button v-for="c in COLOR_PRESETS" :key="c" type="button" @click="selectColor(c)"
                    :class="['w-4 h-4 rounded-full border transition-all', form.icon_color === c ? 'border-gray-700 scale-125' : 'border-gray-200']"
                    :style="{ background: c }" :title="c"></button>
            <input type="color" v-model="form.icon_color" class="w-5 h-5 rounded cursor-pointer ml-1" title="Couleur personnalisée" />
          </div>
        </div>
      </div>

      <div>
        <label class="block text-xs font-medium text-gray-700 mb-1.5">Protocoles exigés</label>
        <div class="flex flex-wrap gap-1.5">
          <button v-for="p in PROTOCOLS" :key="p" type="button" @click="toggleProtocol(p)"
                  :class="['px-2 py-0.5 text-[11px] rounded-full border', form.preferred_protocols.includes(p) ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50']">
            {{ p }}
          </button>
        </div>
      </div>

      <div>
        <div class="flex items-center justify-between mb-1">
          <label class="block text-xs font-medium text-gray-700">
            Description fonctionnelle
            <span class="text-gray-400 font-normal">— HTML, paragraphes courts</span>
          </label>
          <button type="button" @click="openClaudeFor('description')"
                  class="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] text-violet-700 hover:text-violet-900 border border-violet-300 hover:bg-violet-50 rounded">
            <SparklesIcon class="w-3 h-3" />
            Générer avec Claude Desktop
          </button>
        </div>
        <RichTextEditor
          v-model="form.description_html"
          placeholder="Ce que fait l'équipement, à quel titre il est concerné par le décret BACS, par qui sa régulation est assurée, et comment la solution Buildy intervient en aval…"
          min-height="180px"
        />
      </div>

      <div>
        <div class="flex items-center justify-between mb-1">
          <label class="block text-xs font-medium text-gray-700">Justification BACS <span class="text-gray-400 font-normal">— encart contextualisé</span></label>
          <button type="button" @click="openClaudeFor('justification')"
                  class="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] text-violet-700 hover:text-violet-900 border border-violet-300 hover:bg-violet-50 rounded">
            <SparklesIcon class="w-3 h-3" />
            Générer avec Claude Desktop
          </button>
        </div>
        <RichTextEditor
          v-model="form.bacs_justification"
          placeholder="L'article R175-X définit… Le décret impose… La solution Buildy permet de répondre à ces obligations en…"
          min-height="120px"
        />
        <p class="text-[10px] text-gray-400 mt-1">Affiché dans l'encart « Pourquoi le décret BACS s'applique ici » au-dessus du badge.</p>
      </div>
    </form>

    <template #footer>
      <button v-if="isEdit" @click="destroy" class="mr-auto px-3 py-1.5 text-xs text-red-600 hover:text-red-800 inline-flex items-center gap-1">
        <TrashIcon class="w-3.5 h-3.5" /> Supprimer
      </button>
      <button @click="emit('close')" class="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-800">Annuler</button>
      <button @click="submit" :disabled="submitting || !form.name.trim()"
              class="px-3 py-1.5 text-xs bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">
        {{ submitting ? 'Enregistrement…' : (isEdit ? 'Enregistrer' : 'Créer le modèle') }}
      </button>
    </template>
  </BaseModal>

  <ClaudePromptModal v-if="showClaudePrompt" :template="{ ...form, preferred_protocols: form.preferred_protocols.join(',') }" :mode="claudeMode" @close="showClaudePrompt = false" />
</template>
