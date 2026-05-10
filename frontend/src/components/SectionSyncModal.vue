<script setup>
/**
 * Modal "Mettre a jour depuis la bibliotheque" pour une section AF.
 *
 * Affiche les champs synchronisables depuis le template biblio (equipment
 * OU section_template) avec checkbox pour selectionner ceux a ecraser.
 * Compare la valeur actuelle de la section avec la valeur biblio pour
 * indiquer "Identique" / "Sera remplace" sur chaque ligne.
 *
 * Au submit : POST /sections/:id/template-update/apply { fields: [...] }
 */
import { ref, computed, onMounted } from 'vue'
import { ArrowPathIcon, XMarkIcon } from '@heroicons/vue/24/outline'
import BaseModal from './BaseModal.vue'
import { getEquipmentTemplate, getSectionTemplate, applySectionTemplateUpdate } from '@/api'
import { useNotification } from '@/composables/useNotification'

const props = defineProps({
  section: { type: Object, required: true },
})
const emit = defineEmits(['close', 'updated'])

const { error: notifyError, success } = useNotification()

const loading = ref(true)
const submitting = ref(false)
const tpl = ref(null) // template charge depuis le backend

// Champs cochables : derive du type de template rattache.
// Chaque champ : { key, label, current, target, hint }
const fields = ref([])
const selected = ref(new Set())

function stripHtml(html) {
  if (!html) return ''
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}
function previewText(text, maxLen = 120) {
  if (!text) return '—'
  return text.length > maxLen ? text.slice(0, maxLen).trimEnd() + '…' : text
}

function buildFieldsForEquipment(template) {
  const list = []
  list.push({
    key: 'title',
    label: 'Titre de la section',
    current: props.section.title || '',
    target: template.name || '',
    isHtml: false,
  })
  list.push({
    key: 'description_html',
    label: 'Description fonctionnelle',
    current: stripHtml(props.section.description_html_override),
    target: stripHtml(template.description_html),
    isHtml: true,
    hint: 'Surcharge la description par défaut héritée du modèle.',
  })
  return list
}
function buildFieldsForSectionTemplate(template) {
  const list = []
  list.push({
    key: 'title',
    label: 'Titre de la section',
    current: props.section.title || '',
    target: template.title || '',
    isHtml: false,
  })
  list.push({
    key: 'body_html',
    label: 'Contenu (description fonctionnelle)',
    current: stripHtml(props.section.body_html),
    target: stripHtml(template.body_html),
    isHtml: true,
  })
  list.push({
    key: 'service_level',
    label: 'Niveau d\'offre',
    current: props.section.service_level || '—',
    target: template.service_level || '—',
    isHtml: false,
  })
  list.push({
    key: 'bacs_articles',
    label: 'Articles BACS',
    current: props.section.bacs_articles || '—',
    target: template.bacs_articles || '—',
    isHtml: false,
  })
  return list
}

onMounted(async () => {
  try {
    if (props.section.equipment_template_id) {
      const { data } = await getEquipmentTemplate(props.section.equipment_template_id)
      tpl.value = { kind: 'equipment', ...data }
      fields.value = buildFieldsForEquipment(data)
    } else if (props.section.section_template_id) {
      const { data } = await getSectionTemplate(props.section.section_template_id)
      tpl.value = { kind: 'section_template', ...data }
      fields.value = buildFieldsForSectionTemplate(data)
    }
    // Pre-cocher les champs qui different (rapide pour l'utilisateur).
    for (const f of fields.value) {
      if ((f.current || '') !== (f.target || '')) selected.value.add(f.key)
    }
    selected.value = new Set(selected.value)
  } catch (e) {
    notifyError(e?.response?.data?.detail || 'Échec du chargement du modèle')
  } finally {
    loading.value = false
  }
})

const diffFields = computed(() => fields.value.filter(f => (f.current || '') !== (f.target || '')))
const sameFields = computed(() => fields.value.filter(f => (f.current || '') === (f.target || '')))
const canSubmit = computed(() => selected.value.size > 0 && !submitting.value && !loading.value)

function toggle(key) {
  const next = new Set(selected.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  selected.value = next
}

async function submit() {
  if (!canSubmit.value) return
  submitting.value = true
  try {
    const { data } = await applySectionTemplateUpdate(props.section.id, [...selected.value])
    success(`Section synchronisée (${selected.value.size} champ${selected.value.size > 1 ? 's' : ''})`)
    emit('updated', data)
    emit('close')
  } catch (e) {
    notifyError(e?.response?.data?.detail || 'Échec de la synchronisation')
  } finally {
    submitting.value = false
  }
}

const sourceLabel = computed(() => {
  if (!tpl.value) return ''
  if (tpl.value.kind === 'equipment') return `Modèle équipement « ${tpl.value.name} »`
  return `Section type « ${tpl.value.title} »`
})
</script>

<template>
  <BaseModal title="Mettre à jour depuis la bibliothèque" size="lg" :dismiss-on-backdrop="!submitting" @close="emit('close')">
    <div v-if="loading" class="text-center py-12 text-sm text-gray-400">Chargement du modèle…</div>

    <template v-else-if="!tpl">
      <p class="text-sm text-gray-600">Cette section n'est pas rattachée à un modèle de bibliothèque.</p>
    </template>

    <template v-else>
      <p class="text-xs text-gray-500 mb-3">
        Source : <span class="font-medium text-gray-700">{{ sourceLabel }}</span>
      </p>

      <div v-if="diffFields.length" class="mb-4">
        <h3 class="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-2">
          Champs à différencier ({{ diffFields.length }})
        </h3>
        <ul class="space-y-2">
          <li v-for="f in diffFields" :key="f.key"
              :class="['border rounded-lg p-3 cursor-pointer transition', selected.has(f.key) ? 'border-indigo-300 bg-indigo-50/30' : 'border-gray-200 hover:border-gray-300']"
              @click="toggle(f.key)">
            <label class="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" :checked="selected.has(f.key)" @click.stop @change="toggle(f.key)"
                     class="mt-0.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500/30" />
              <div class="flex-1 min-w-0">
                <div class="text-sm font-medium text-gray-800">{{ f.label }}</div>
                <p v-if="f.hint" class="text-[11px] text-gray-500 mt-0.5">{{ f.hint }}</p>
                <div class="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px]">
                  <div>
                    <span class="block text-[10px] uppercase tracking-wider text-gray-400 mb-0.5">Actuel</span>
                    <div class="px-2 py-1.5 bg-white border border-gray-200 rounded text-gray-700 break-words">
                      {{ previewText(f.current) || '(vide)' }}
                    </div>
                  </div>
                  <div>
                    <span class="block text-[10px] uppercase tracking-wider text-emerald-600 mb-0.5">Bibliothèque</span>
                    <div class="px-2 py-1.5 bg-emerald-50 border border-emerald-200 rounded text-emerald-900 break-words">
                      {{ previewText(f.target) || '(vide)' }}
                    </div>
                  </div>
                </div>
              </div>
            </label>
          </li>
        </ul>
      </div>

      <div v-if="sameFields.length" class="text-[11px] text-gray-400 italic">
        {{ sameFields.length }} champ{{ sameFields.length > 1 ? 's' : '' }} déjà identique{{ sameFields.length > 1 ? 's' : '' }} à la bibliothèque
        ({{ sameFields.map(f => f.label).join(', ') }}).
      </div>

      <div v-if="!diffFields.length" class="text-center py-6 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg">
        Tous les champs sont déjà alignés sur la bibliothèque. Aucune mise à jour nécessaire.
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
        {{ submitting ? 'Mise à jour…' : `Mettre à jour ${selected.size > 0 ? `(${selected.size})` : ''}` }}
      </button>
    </template>
  </BaseModal>
</template>
