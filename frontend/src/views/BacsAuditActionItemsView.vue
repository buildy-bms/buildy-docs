<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import {
  ArrowLeftIcon, MagnifyingGlassIcon, XMarkIcon, ArrowPathIcon,
  DocumentArrowDownIcon, PlusIcon, TrashIcon, FireIcon,
} from '@heroicons/vue/24/outline'
import {
  getAf, getBacsActionItems, regenerateBacsActionItems,
  updateBacsActionItem, createBacsActionItem, deleteBacsActionItem,
  getBacsActionItemsCsvUrl,
} from '@/api'
import { useNotification } from '@/composables/useNotification'
import { useConfirm } from '@/composables/useConfirm'
import BaseModal from '@/components/BaseModal.vue'

const route = useRoute()
const router = useRouter()
const { success, error } = useNotification()
const { confirm } = useConfirm()

const docId = parseInt(route.params.id, 10)
const document = ref(null)
const items = ref([])
const loading = ref(true)

const SEVERITY_LABEL = {
  blocking: { label: 'Bloquante', cls: 'bg-red-100 text-red-700 border-red-300' },
  major: { label: 'Majeure', cls: 'bg-orange-100 text-orange-700 border-orange-300' },
  minor: { label: 'Mineure', cls: 'bg-yellow-100 text-yellow-700 border-yellow-300' },
}
const STATUS_OPTS = [
  { value: 'open', label: 'Ouverte' },
  { value: 'quoted', label: 'Chiffrée' },
  { value: 'in_progress', label: 'En cours' },
  { value: 'done', label: 'Terminée' },
  { value: 'declined', label: 'Refusée' },
]
const EFFORT_OPTS = [
  { value: null, label: '—' },
  { value: 'low', label: 'Faible' },
  { value: 'medium', label: 'Moyen' },
  { value: 'high', label: 'Élevé' },
]
const CATEGORY_OPTS = [
  { value: 'meter_addition', label: 'Ajout compteur' },
  { value: 'meter_replacement', label: 'Remplacement compteur' },
  { value: 'meter_connection', label: 'Raccord compteur' },
  { value: 'system_addition', label: 'Ajout système' },
  { value: 'system_replacement', label: 'Remplacement système' },
  { value: 'communication_upgrade', label: 'Upgrade communication' },
  { value: 'bms_upgrade', label: 'Upgrade GTB' },
  { value: 'bms_replacement', label: 'Remplacement GTB' },
  { value: 'bms_addition', label: 'Ajout GTB' },
  { value: 'data_retention_upgrade', label: 'Rétention données' },
  { value: 'training', label: 'Formation' },
  { value: 'documentation', label: 'Documentation' },
  { value: 'thermal_regulation', label: 'Régulation thermique' },
  { value: 'thermal_regulation_upgrade', label: 'Upgrade régulation' },
  { value: 'other', label: 'Autre' },
]

// Filtres
const severityFilter = ref('all')
const statusFilter = ref('open_active') // 'all' / 'open_active' (open|quoted|in_progress) / chaque statut individuel
const categoryFilter = ref('all')
const searchQuery = ref('')

const filtered = computed(() => {
  const q = searchQuery.value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  return items.value.filter(it => {
    if (severityFilter.value !== 'all' && it.severity !== severityFilter.value) return false
    if (statusFilter.value === 'open_active') {
      if (!['open', 'quoted', 'in_progress'].includes(it.status)) return false
    } else if (statusFilter.value !== 'all' && it.status !== statusFilter.value) return false
    if (categoryFilter.value !== 'all' && it.category !== categoryFilter.value) return false
    if (q && q.length >= 2) {
      const hay = `${it.title} ${it.description || ''} ${it.zone_name || ''} ${it.equipment_name || ''} ${it.commercial_notes || ''}`
        .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      if (!hay.includes(q)) return false
    }
    return true
  })
})

const stats = computed(() => {
  const out = { blocking: 0, major: 0, minor: 0, total: 0, open: 0, quoted: 0, done: 0 }
  for (const it of items.value) {
    out.total++
    out[it.severity] = (out[it.severity] || 0) + 1
    if (it.status === 'open') out.open++
    if (it.status === 'quoted') out.quoted++
    if (it.status === 'done') out.done++
  }
  return out
})

async function refresh() {
  loading.value = true
  try {
    const [d, a] = await Promise.all([getAf(docId), getBacsActionItems(docId)])
    document.value = d.data
    items.value = a.data
  } catch {
    error('Échec du chargement')
  } finally {
    loading.value = false
  }
}

async function patchItem(it, patch) {
  try {
    const { data } = await updateBacsActionItem(it.id, patch)
    Object.assign(it, data)
  } catch {
    error('Sauvegarde impossible')
  }
}

async function regenerate() {
  try {
    const { data } = await regenerateBacsActionItems(docId)
    success(`+${data.added} nouvelles, ${data.updated} synchronisées, ${data.resolved} résolues`)
    await refresh()
  } catch {
    error('Régénération impossible')
  }
}

function downloadCsv() {
  window.location.href = getBacsActionItemsCsvUrl(docId)
}

// Ajout manuel
const showAdd = ref(false)
const newItem = ref({ category: 'other', severity: 'major', r175_article: '', title: '', description: '' })
async function submitNew() {
  if (!newItem.value.title.trim()) return
  try {
    await createBacsActionItem(docId, newItem.value)
    success('Action ajoutée')
    showAdd.value = false
    newItem.value = { category: 'other', severity: 'major', r175_article: '', title: '', description: '' }
    await refresh()
  } catch (e) {
    error(e.response?.data?.detail || 'Création impossible')
  }
}

async function removeItem(it) {
  if (it.auto_generated) {
    error('Items auto-générés ne peuvent pas être supprimés. Utilise "Refusée" comme statut.')
    return
  }
  const ok = await confirm({
    title: 'Supprimer cet item ?',
    message: `« ${it.title} »`,
    confirmLabel: 'Supprimer', danger: true,
  })
  if (!ok) return
  try {
    await deleteBacsActionItem(it.id)
    items.value = items.value.filter(x => x.id !== it.id)
    success('Item supprimé')
  } catch {
    error('Suppression impossible')
  }
}

onMounted(refresh)
</script>

<template>
  <div class="max-w-[1500px] mx-auto pb-12">
    <!-- Header -->
    <div class="flex items-start justify-between mb-4">
      <div>
        <button @click="router.push(`/bacs-audit/${docId}`)" class="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-2">
          <ArrowLeftIcon class="w-4 h-4" /> Retour à l'audit
        </button>
        <h1 class="text-2xl font-semibold text-gray-800 flex items-center gap-2">
          <FireIcon class="w-6 h-6 text-orange-500" />
          Plan de mise en conformité
        </h1>
        <p class="text-sm text-gray-500 mt-1">
          {{ document?.client_name }} — {{ document?.project_name }}
        </p>
      </div>
      <div class="flex items-center gap-2">
        <button @click="showAdd = true" class="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50">
          <PlusIcon class="w-4 h-4" /> Ajouter manuellement
        </button>
        <button @click="regenerate" class="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50">
          <ArrowPathIcon class="w-4 h-4" /> Régénérer depuis l'audit
        </button>
        <button @click="downloadCsv" class="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-white bg-indigo-600 rounded-lg hover:bg-indigo-700">
          <DocumentArrowDownIcon class="w-4 h-4" /> Export CSV
        </button>
      </div>
    </div>

    <!-- Synthèse -->
    <div class="grid grid-cols-6 gap-3 mb-4">
      <div class="rounded-lg border bg-red-50 border-red-200 p-3">
        <div class="text-[10px] font-medium uppercase tracking-wider text-red-700 opacity-70">Bloquantes</div>
        <div class="text-2xl font-semibold text-red-700">{{ stats.blocking }}</div>
      </div>
      <div class="rounded-lg border bg-orange-50 border-orange-200 p-3">
        <div class="text-[10px] font-medium uppercase tracking-wider text-orange-700 opacity-70">Majeures</div>
        <div class="text-2xl font-semibold text-orange-700">{{ stats.major }}</div>
      </div>
      <div class="rounded-lg border bg-yellow-50 border-yellow-200 p-3">
        <div class="text-[10px] font-medium uppercase tracking-wider text-yellow-700 opacity-70">Mineures</div>
        <div class="text-2xl font-semibold text-yellow-700">{{ stats.minor }}</div>
      </div>
      <div class="rounded-lg border bg-gray-50 border-gray-200 p-3">
        <div class="text-[10px] font-medium uppercase tracking-wider text-gray-600 opacity-70">Ouvertes</div>
        <div class="text-2xl font-semibold text-gray-700">{{ stats.open }}</div>
      </div>
      <div class="rounded-lg border bg-blue-50 border-blue-200 p-3">
        <div class="text-[10px] font-medium uppercase tracking-wider text-blue-700 opacity-70">Chiffrées</div>
        <div class="text-2xl font-semibold text-blue-700">{{ stats.quoted }}</div>
      </div>
      <div class="rounded-lg border bg-emerald-50 border-emerald-200 p-3">
        <div class="text-[10px] font-medium uppercase tracking-wider text-emerald-700 opacity-70">Terminées</div>
        <div class="text-2xl font-semibold text-emerald-700">{{ stats.done }}</div>
      </div>
    </div>

    <!-- Toolbar filtres -->
    <div class="bg-white border border-gray-200 rounded-lg p-3 mb-4 flex items-center gap-3 flex-wrap">
      <div class="relative flex-1 max-w-sm">
        <MagnifyingGlassIcon class="w-4 h-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
        <input v-model="searchQuery" type="text" placeholder="Rechercher dans titre, description, notes…"
               class="w-full pl-9 pr-9 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/30" />
        <button v-if="searchQuery" @click="searchQuery = ''" class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400">
          <XMarkIcon class="w-4 h-4" />
        </button>
      </div>
      <div class="inline-flex items-center gap-1 bg-gray-50 border border-gray-200 rounded-lg p-0.5 text-xs">
        <button v-for="opt in [
            { v: 'all', l: 'Toutes' },
            { v: 'blocking', l: 'Bloquantes' },
            { v: 'major', l: 'Majeures' },
            { v: 'minor', l: 'Mineures' },
          ]" :key="opt.v"
          @click="severityFilter = opt.v"
          :class="['px-2.5 py-1 rounded transition', severityFilter === opt.v ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-100']"
        >{{ opt.l }}</button>
      </div>
      <select v-model="statusFilter" class="text-xs px-2 py-1.5 border border-gray-200 rounded-lg">
        <option value="open_active">Ouvertes / Chiffrées / En cours</option>
        <option value="all">Tous statuts</option>
        <option v-for="s in STATUS_OPTS" :key="s.value" :value="s.value">{{ s.label }}</option>
      </select>
      <select v-model="categoryFilter" class="text-xs px-2 py-1.5 border border-gray-200 rounded-lg">
        <option value="all">Toutes catégories</option>
        <option v-for="c in CATEGORY_OPTS" :key="c.value" :value="c.value">{{ c.label }}</option>
      </select>
      <span class="text-xs text-gray-500 ml-auto">{{ filtered.length }} action{{ filtered.length > 1 ? 's' : '' }} affichée{{ filtered.length > 1 ? 's' : '' }}</span>
    </div>

    <!-- Loading / Empty -->
    <div v-if="loading" class="text-center py-12 text-gray-400 text-sm">Chargement…</div>

    <!-- Table -->
    <div v-else class="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
      <table class="w-full text-sm">
        <thead class="text-xs uppercase text-gray-500 tracking-wider bg-gray-50">
          <tr>
            <th class="text-left px-3 py-2 w-24">Sévérité</th>
            <th class="text-left py-2 w-24">Article</th>
            <th class="text-left py-2">Action</th>
            <th class="text-left py-2 w-28">Zone</th>
            <th class="text-left py-2 w-24">Effort</th>
            <th class="text-left py-2 w-28">Statut</th>
            <th class="text-left px-3 py-2 w-72">Notes commerciales (devis)</th>
            <th class="text-right px-3 py-2 w-12"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          <tr v-for="it in filtered" :key="it.id"
              :class="[(it.status === 'done' || it.status === 'declined') ? 'opacity-50' : '', 'group']">
            <td class="px-3 py-2">
              <span :class="['inline-block px-2 py-0.5 text-[10px] font-medium rounded border', SEVERITY_LABEL[it.severity].cls]">
                {{ SEVERITY_LABEL[it.severity].label }}
              </span>
              <span v-if="!it.auto_generated" class="ml-1 text-[9px] text-purple-600 font-semibold uppercase">Manuel</span>
            </td>
            <td class="py-2 text-[11px] text-gray-500 font-mono">{{ it.r175_article || '—' }}</td>
            <td class="py-2">
              <div class="text-gray-800 font-medium">{{ it.title }}</div>
              <div v-if="it.description" class="text-[11px] text-gray-500 mt-0.5 line-clamp-2">{{ it.description }}</div>
            </td>
            <td class="py-2 text-xs text-gray-600">{{ it.zone_name || '—' }}</td>
            <td class="py-2">
              <select :value="it.estimated_effort"
                      @change="e => patchItem(it, { estimated_effort: e.target.value || null })"
                      class="text-xs px-2 py-1 border border-gray-200 rounded">
                <option v-for="e in EFFORT_OPTS" :key="e.value || 'null'" :value="e.value">{{ e.label }}</option>
              </select>
            </td>
            <td class="py-2">
              <select :value="it.status"
                      @change="e => patchItem(it, { status: e.target.value })"
                      class="text-xs px-2 py-1 border border-gray-200 rounded">
                <option v-for="s in STATUS_OPTS" :key="s.value" :value="s.value">{{ s.label }}</option>
              </select>
            </td>
            <td class="px-3 py-2">
              <textarea :value="it.commercial_notes" placeholder="Référence produit, prix HT estimé, fournisseur, délai…"
                        @blur="e => e.target.value !== (it.commercial_notes || '') && patchItem(it, { commercial_notes: e.target.value || null })"
                        rows="2"
                        class="w-full text-xs px-2 py-1 border border-gray-200 rounded resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500/30" />
            </td>
            <td class="px-3 py-2 text-right">
              <button v-if="!it.auto_generated"
                      @click="removeItem(it)"
                      class="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-600 p-1 transition" title="Supprimer">
                <TrashIcon class="w-4 h-4" />
              </button>
            </td>
          </tr>
          <tr v-if="!filtered.length">
            <td colspan="8" class="px-5 py-12 text-center text-sm text-gray-500">
              Aucune action ne correspond aux filtres actuels.
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Modal ajout manuel -->
    <BaseModal v-if="showAdd" title="Ajouter une action manuelle" size="md" @close="showAdd = false">
      <form @submit.prevent="submitNew" class="space-y-3">
        <div>
          <label class="block text-xs font-medium text-gray-700 mb-1">Titre *</label>
          <input v-model="newItem.title" type="text" required placeholder="ex : Remplacer la pompe à chaleur en zone Atelier"
                 class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-xs font-medium text-gray-700 mb-1">Sévérité *</label>
            <select v-model="newItem.severity" class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm">
              <option value="blocking">Bloquante</option>
              <option value="major">Majeure</option>
              <option value="minor">Mineure</option>
            </select>
          </div>
          <div>
            <label class="block text-xs font-medium text-gray-700 mb-1">Catégorie *</label>
            <select v-model="newItem.category" class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm">
              <option v-for="c in CATEGORY_OPTS" :key="c.value" :value="c.value">{{ c.label }}</option>
            </select>
          </div>
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-700 mb-1">Article R175 (optionnel)</label>
          <input v-model="newItem.r175_article" type="text" placeholder="ex : R175-3 §3"
                 class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-700 mb-1">Description</label>
          <textarea v-model="newItem.description" rows="3" placeholder="Précisions techniques, contexte…"
                    class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
        </div>
        <div class="flex justify-end gap-2 pt-2">
          <button type="button" @click="showAdd = false" class="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg">Annuler</button>
          <button type="submit" :disabled="!newItem.title.trim()" class="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50">
            Créer
          </button>
        </div>
      </form>
    </BaseModal>
  </div>
</template>
