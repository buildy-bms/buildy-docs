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

const ICON_PRESETS = [
  { fa: 'fa-fan', color: '#3b82f6', label: 'Ventilation' },
  { fa: 'fa-fire', color: '#ef4444', label: 'Chauffage' },
  { fa: 'fa-snowflake', color: '#06b6d4', label: 'Froid' },
  { fa: 'fa-droplet', color: '#0ea5e9', label: 'Eau' },
  { fa: 'fa-lightbulb', color: '#facc15', label: 'Éclairage' },
  { fa: 'fa-bolt', color: '#facc15', label: 'Électricité' },
  { fa: 'fa-temperature-half', color: '#f97316', label: 'Température' },
  { fa: 'fa-leaf', color: '#10b981', label: 'QAI / vert' },
  { fa: 'fa-blinds', color: '#64748b', label: 'Occultation' },
  { fa: 'fa-industry', color: '#475569', label: 'Process' },
  { fa: 'fa-cube', color: '#6b7280', label: 'Générique' },
  { fa: 'fa-plug', color: '#a855f7', label: 'Prise' },
  { fa: 'fa-solar-panel', color: '#eab308', label: 'Solaire' },
  { fa: 'fa-building', color: '#0ea5e9', label: 'Bâtiment' },
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
function selectIcon(preset) {
  form.value.icon_value = preset.fa
  form.value.icon_color = preset.color
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
          <label class="block text-xs font-medium text-gray-700 mb-1">Icône</label>
          <div class="flex flex-wrap gap-1">
            <button v-for="preset in ICON_PRESETS" :key="preset.fa" type="button" @click="selectIcon(preset)"
                    :class="['inline-flex items-center justify-center w-8 h-8 border rounded transition-all', form.icon_value === preset.fa ? 'border-indigo-500 ring-2 ring-indigo-200' : 'border-gray-200 hover:border-gray-400']"
                    :title="preset.label">
              <EquipmentIcon :template="{ icon_kind: 'fa', icon_value: preset.fa, icon_color: preset.color }" size="sm" />
            </button>
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
          <button type="button" @click="showClaudePrompt = true"
                  class="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] text-violet-700 hover:text-violet-900 border border-violet-300 hover:bg-violet-50 rounded">
            <SparklesIcon class="w-3 h-3" />
            Générer avec Claude Desktop
          </button>
        </div>
        <textarea v-model="form.description_html" rows="6" autocomplete="off" data-1p-ignore="true"
                  placeholder="<p>Ce que fait l'équipement…</p><p><strong>La régulation est assurée par l'équipement lui-même</strong>…</p><p>La solution Buildy supervise…</p>"
                  class="w-full px-3 py-2 border border-gray-300 text-xs font-mono leading-snug focus:outline-none focus:ring-2 focus:ring-indigo-500"></textarea>
      </div>

      <div>
        <label class="block text-xs font-medium text-gray-700 mb-1">Justification BACS (encart contextualisé)</label>
        <textarea v-model="form.bacs_justification" rows="4" autocomplete="off" data-1p-ignore="true"
                  placeholder="<p>L'article R175-X définit…</p><p>Le décret impose…</p><p>L'intégration de [équipement] dans la solution Buildy permet…</p>"
                  class="w-full px-3 py-2 border border-gray-300 text-xs font-mono leading-snug focus:outline-none focus:ring-2 focus:ring-indigo-500"></textarea>
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

  <ClaudePromptModal v-if="showClaudePrompt" :template="{ ...form, preferred_protocols: form.preferred_protocols.join(',') }" @close="showClaudePrompt = false" />
</template>
