<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import {
  SparklesIcon, ArrowPathIcon, CheckIcon, ClockIcon,
  ArrowUturnLeftIcon, DocumentTextIcon,
} from '@heroicons/vue/24/outline'
import { listAiPrompts, getAiPrompt, updateAiPrompt, resetAiPrompt, restoreAiPromptVersion } from '@/api'
import { useNotification } from '@/composables/useNotification'
import { useConfirm } from '@/composables/useConfirm'

const { success, error: notifyError } = useNotification()
const { confirm } = useConfirm()

const prompts = ref([])
const selectedKey = ref(null)
const detail = ref(null)
const draft = ref('')
const saving = ref(false)
const showHistory = ref(false)

const dirty = computed(() =>
  detail.value && draft.value !== detail.value.body
)

async function refreshList() {
  const { data } = await listAiPrompts()
  prompts.value = data
  if (!selectedKey.value && data.length) selectedKey.value = data[0].key
}
async function loadDetail() {
  if (!selectedKey.value) return
  const { data } = await getAiPrompt(selectedKey.value)
  detail.value = data
  draft.value = data.body || ''
}
watch(selectedKey, loadDetail)
onMounted(async () => { await refreshList(); await loadDetail() })

async function save() {
  if (!dirty.value) return
  saving.value = true
  try {
    const { data } = await updateAiPrompt(selectedKey.value, draft.value)
    detail.value = { ...detail.value, ...data }
    draft.value = data.body
    await loadDetail() // recharge l'historique
    success('Prompt enregistré')
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Échec de l\'enregistrement')
  } finally {
    saving.value = false
  }
}

async function resetToDefault() {
  const ok = await confirm({
    title: 'Restaurer le prompt par défaut ?',
    message: 'Ton prompt actuel sera archivé dans l\'historique. Le prompt par défaut intégré au code sera restauré.',
    confirmLabel: 'Restaurer',
  })
  if (!ok) return
  try {
    const { data } = await resetAiPrompt(selectedKey.value)
    detail.value = data
    draft.value = data.body
    await loadDetail()
    success('Prompt par défaut restauré')
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Échec de la restauration')
  }
}

async function restoreVersion(v) {
  const ok = await confirm({
    title: 'Restaurer cette version ?',
    message: `Ton prompt actuel sera archivé. La version du ${formatDate(v.created_at)} deviendra le prompt courant.`,
    confirmLabel: 'Restaurer',
  })
  if (!ok) return
  try {
    const { data } = await restoreAiPromptVersion(selectedKey.value, v.id)
    detail.value = { ...detail.value, ...data }
    draft.value = data.body
    await loadDetail()
    showHistory.value = false
    success('Version restaurée')
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Échec')
  }
}

function discardChanges() { draft.value = detail.value?.body || '' }

function formatDate(s) {
  if (!s) return ''
  return new Date(s).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })
}
</script>

<template>
  <div class="max-w-screen-xl mx-auto">
    <div class="mb-6">
      <h1 class="text-2xl font-semibold text-gray-800 inline-flex items-center gap-2">
        <SparklesIcon class="w-6 h-6 text-violet-600" /> Prompts IA
      </h1>
      <p class="text-sm text-gray-500 mt-1">
        Édite les instructions envoyées à Claude. Chaque modification est versionnée — tu peux toujours revenir en arrière.
      </p>
    </div>

    <div v-if="!prompts.length" class="text-sm text-gray-500 italic">Chargement…</div>

    <div v-else class="grid grid-cols-12 gap-6">
      <!-- Sidebar liste -->
      <aside class="col-span-3">
        <ul class="space-y-1 sticky top-4">
          <li v-for="p in prompts" :key="p.key">
            <button @click="selectedKey = p.key"
                    :class="['w-full text-left px-3 py-2 rounded-lg text-sm transition border',
                             selectedKey === p.key
                               ? 'bg-violet-50 text-violet-900 border-violet-200 font-medium'
                               : 'border-transparent hover:bg-gray-50 text-gray-700']">
              <div class="flex items-center gap-1.5">
                <DocumentTextIcon class="w-4 h-4 shrink-0" />
                <span class="truncate">{{ p.label }}</span>
              </div>
              <div class="text-[11px] text-gray-500 mt-0.5">
                <span v-if="p.is_overridden">Modifié — {{ formatDate(p.updated_at) }}</span>
                <span v-else>Par défaut</span>
              </div>
            </button>
          </li>
        </ul>
      </aside>

      <!-- Contenu -->
      <section class="col-span-9 space-y-3">
        <div v-if="detail">
          <div class="bg-violet-50 border border-violet-200 rounded-lg p-4 text-sm text-violet-900 leading-relaxed">
            {{ detail.description }}
          </div>

          <div class="flex items-center justify-between gap-2 mt-4 mb-2">
            <div class="text-xs text-gray-500">
              <span v-if="detail.is_overridden">
                <ClockIcon class="w-3.5 h-3.5 inline-block -mt-0.5" />
                Dernière modification : <strong>{{ formatDate(detail.updated_at) }}</strong>
              </span>
              <span v-else class="italic">Aucune modification — prompt par défaut actif.</span>
              <span class="ml-3">{{ draft.length }} caractères</span>
            </div>
            <div class="flex items-center gap-2">
              <button @click="showHistory = !showHistory" :disabled="!detail.versions?.length"
                      class="inline-flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900 disabled:opacity-50">
                <ClockIcon class="w-4 h-4" /> Historique ({{ detail.versions?.length || 0 }})
              </button>
              <button @click="resetToDefault" :disabled="!detail.is_overridden"
                      class="inline-flex items-center gap-1 text-xs text-gray-600 hover:text-amber-700 disabled:opacity-50">
                <ArrowPathIcon class="w-4 h-4" /> Restaurer défaut
              </button>
            </div>
          </div>

          <textarea v-model="draft" rows="24"
                    autocomplete="off" data-1p-ignore="true"
                    class="w-full px-4 py-3 bg-white border border-gray-200 rounded-lg text-[13px] font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500 resize-y"></textarea>

          <div v-if="dirty"
               class="mt-2 flex items-center justify-between gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900">
            <span>Modifications non enregistrées.</span>
            <div class="flex items-center gap-2">
              <button @click="discardChanges"
                      class="px-2 py-1 text-amber-800 hover:bg-amber-100 rounded">
                <ArrowUturnLeftIcon class="w-3.5 h-3.5 inline-block -mt-0.5" /> Annuler
              </button>
              <button @click="save" :disabled="saving"
                      class="inline-flex items-center gap-1 px-3 py-1 bg-violet-600 text-white hover:bg-violet-700 rounded shadow-sm font-medium disabled:opacity-50">
                <CheckIcon class="w-3.5 h-3.5" />
                {{ saving ? 'Enregistrement…' : 'Enregistrer' }}
              </button>
            </div>
          </div>

          <!-- Historique -->
          <div v-if="showHistory && detail.versions?.length"
               class="mt-3 border border-gray-200 rounded-lg overflow-hidden">
            <table class="w-full text-sm">
              <thead class="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider">
                <tr>
                  <th class="text-left px-4 py-2">Date</th>
                  <th class="text-left px-4 py-2">Auteur</th>
                  <th class="text-left px-4 py-2">Étiquette</th>
                  <th class="text-right px-4 py-2">Action</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-100">
                <tr v-for="v in detail.versions" :key="v.id">
                  <td class="px-4 py-2">{{ formatDate(v.created_at) }}</td>
                  <td class="px-4 py-2 text-gray-600">{{ v.created_by_name || '—' }}</td>
                  <td class="px-4 py-2 text-gray-600">{{ v.label || 'modification manuelle' }}</td>
                  <td class="px-4 py-2 text-right">
                    <button @click="restoreVersion(v)"
                            class="text-xs text-violet-700 hover:text-violet-900 font-medium">
                      Restaurer
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>
