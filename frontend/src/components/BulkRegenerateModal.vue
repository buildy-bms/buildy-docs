<script setup>
/**
 * Modale de régénération en masse via Claude.
 *
 * Props :
 *  - items : Array d'entités à régénérer, chacune au format
 *      { id, title, kind, payload }
 *      où `kind` ∈ 'narrative_section' | 'functionality'
 *                | 'equipment_description' | 'equipment_bacs_justification'
 *      et `payload` est passé tel quel à claudeLibraryAssist (sans le mode/html).
 *  - getHtml(item) : fonction qui retourne le HTML actuel à reformuler.
 *  - onSaveHtml(item, newHtml) : callback async qui persiste le HTML retourné
 *      (typiquement un appel à updateSectionTemplate / updateEquipmentTemplate).
 *
 * Émet : @close, @done (count)
 */
import { ref, computed } from 'vue'
import { SparklesIcon, XMarkIcon, CheckIcon, ExclamationTriangleIcon } from '@heroicons/vue/24/outline'
import BaseModal from './BaseModal.vue'
import { claudeLibraryAssist } from '@/api'

const props = defineProps({
  items: { type: Array, required: true },
  getHtml: { type: Function, required: true },
  onSaveHtml: { type: Function, required: true },
  title: { type: String, default: 'Régénérer avec Claude' },
})
const emit = defineEmits(['close', 'done'])

// Sélection : par défaut tout coché
const selectedIds = ref(new Set(props.items.map(i => i.id)))
function toggle(id) {
  if (selectedIds.value.has(id)) selectedIds.value.delete(id)
  else selectedIds.value.add(id)
  selectedIds.value = new Set(selectedIds.value)
}
function toggleAll() {
  if (selectedIds.value.size === props.items.length) selectedIds.value = new Set()
  else selectedIds.value = new Set(props.items.map(i => i.id))
}
const selectionCount = computed(() => selectedIds.value.size)

// Options
const useCorpus = ref(false)
const corpusStrategy = ref('neighbors')

// État d'exécution
const running = ref(false)
const cancelled = ref(false)
const progress = ref({ current: 0, total: 0 })
const statuses = ref(new Map()) // id -> 'pending' | 'running' | 'ok' | 'fail'
const totalCost = ref(0)
const errors = ref([]) // { id, title, message }

function statusOf(id) { return statuses.value.get(id) || 'pending' }

async function start() {
  const queue = props.items.filter(i => selectedIds.value.has(i.id))
  if (!queue.length) return
  running.value = true
  cancelled.value = false
  progress.value = { current: 0, total: queue.length }
  statuses.value = new Map(queue.map(i => [i.id, 'pending']))
  totalCost.value = 0
  errors.value = []

  for (let i = 0; i < queue.length; i++) {
    if (cancelled.value) break
    const item = queue[i]
    progress.value.current = i + 1
    statuses.value.set(item.id, 'running')
    statuses.value = new Map(statuses.value)
    try {
      const html = props.getHtml(item)
      if (!html?.trim()) throw new Error('contenu vide')
      const { data } = await claudeLibraryAssist({
        mode: 'reformulate',
        kind: item.kind,
        title: item.title,
        html,
        ...item.payload,
        library_context: useCorpus.value ? { enabled: true, strategy: corpusStrategy.value } : undefined,
      })
      if (!data?.html?.trim()) throw new Error('réponse Claude vide')
      await props.onSaveHtml(item, data.html)
      totalCost.value += data.cost_eur || 0
      statuses.value.set(item.id, 'ok')
    } catch (e) {
      const msg = e.response?.data?.detail || e.message || 'erreur inconnue'
      statuses.value.set(item.id, 'fail')
      errors.value.push({ id: item.id, title: item.title, message: msg })
    }
    statuses.value = new Map(statuses.value)
  }

  running.value = false
  emit('done', { ok: [...statuses.value.values()].filter(v => v === 'ok').length, total: queue.length })
}

function cancel() {
  if (running.value) cancelled.value = true
  else emit('close')
}
</script>

<template>
  <BaseModal :title="title" size="lg" @close="cancel">
    <div class="space-y-4">
      <div class="bg-violet-50 border border-violet-200 rounded-lg px-4 py-3 text-xs text-violet-900 leading-relaxed">
        <p class="font-medium mb-1 inline-flex items-center gap-1.5">
          <SparklesIcon class="w-4 h-4" /> Régénération en masse
        </p>
        Chaque entrée sélectionnée sera reformulée par Claude avec le prompt en cours, et son contenu sera remplacé en base. Coût estimé ≈ 0,02 € par entrée.
      </div>

      <!-- Options corpus -->
      <div class="border border-gray-200 rounded-lg p-3 space-y-2 text-sm">
        <label class="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" v-model="useCorpus" :disabled="running"
                 class="rounded border-gray-300 text-violet-600 focus:ring-violet-500" />
          <span class="font-medium">Inclure le corpus existant</span>
          <span class="text-gray-500 text-xs">(améliore la cohérence ; coût plus élevé)</span>
        </label>
        <div v-if="useCorpus" class="pl-6 flex items-center gap-3 text-xs">
          <label class="flex items-center gap-1 cursor-pointer">
            <input type="radio" value="neighbors" v-model="corpusStrategy" :disabled="running" /> Voisins
          </label>
          <label class="flex items-center gap-1 cursor-pointer">
            <input type="radio" value="summary" v-model="corpusStrategy" :disabled="running" /> Résumé complet
          </label>
          <label class="flex items-center gap-1 cursor-pointer">
            <input type="radio" value="full" v-model="corpusStrategy" :disabled="running" /> Corpus complet
          </label>
        </div>
      </div>

      <!-- Liste des entrées -->
      <div class="border border-gray-200 rounded-lg max-h-80 overflow-y-auto">
        <div class="sticky top-0 bg-gray-50 px-3 py-2 border-b border-gray-200 flex items-center gap-2 text-xs">
          <input type="checkbox"
                 :checked="selectionCount === items.length && items.length > 0"
                 :indeterminate.prop="selectionCount > 0 && selectionCount < items.length"
                 @change="toggleAll" :disabled="running"
                 class="rounded border-gray-300 text-violet-600" />
          <span class="font-medium text-gray-700">{{ selectionCount }} / {{ items.length }} sélectionnée(s)</span>
          <span v-if="running" class="ml-auto text-violet-700">{{ progress.current }} / {{ progress.total }} en cours…</span>
          <span v-else-if="totalCost > 0" class="ml-auto font-mono text-gray-600">≈ {{ totalCost.toFixed(3) }} €</span>
        </div>
        <ul class="divide-y divide-gray-100 text-sm">
          <li v-for="it in items" :key="it.id"
              class="flex items-center gap-2 px-3 py-1.5">
            <input type="checkbox"
                   :checked="selectedIds.has(it.id)"
                   @change="toggle(it.id)"
                   :disabled="running"
                   class="rounded border-gray-300 text-violet-600" />
            <span class="flex-1 truncate">
              <span class="text-[10px] uppercase font-semibold text-gray-400 mr-1.5">{{ it.kind.replace('equipment_', 'eq.').replace('_', ' ') }}</span>
              {{ it.title }}
            </span>
            <span v-if="statusOf(it.id) === 'running'"
                  class="text-violet-600 text-xs animate-pulse">⏳</span>
            <CheckIcon v-else-if="statusOf(it.id) === 'ok'" class="w-4 h-4 text-emerald-600" />
            <ExclamationTriangleIcon v-else-if="statusOf(it.id) === 'fail'" class="w-4 h-4 text-red-600" />
          </li>
        </ul>
      </div>

      <!-- Erreurs -->
      <div v-if="errors.length" class="border border-red-200 bg-red-50 rounded-lg px-3 py-2 text-xs text-red-800">
        <p class="font-medium mb-1">{{ errors.length }} erreur(s) :</p>
        <ul class="list-disc pl-5 space-y-0.5">
          <li v-for="e in errors" :key="e.id">{{ e.title }} — {{ e.message }}</li>
        </ul>
      </div>
    </div>

    <template #footer>
      <button @click="cancel"
              class="px-3 py-1.5 text-sm text-gray-700 hover:text-gray-900">
        {{ running ? 'Annuler' : 'Fermer' }}
      </button>
      <button @click="start" :disabled="running || selectionCount === 0"
              class="px-3 py-1.5 text-sm font-medium bg-violet-600 text-white hover:bg-violet-700 rounded-lg shadow-sm inline-flex items-center gap-1.5 disabled:opacity-50">
        <SparklesIcon class="w-4 h-4" />
        <span v-if="running">Régénération…</span>
        <span v-else>Régénérer ({{ selectionCount }})</span>
      </button>
    </template>
  </BaseModal>
</template>
