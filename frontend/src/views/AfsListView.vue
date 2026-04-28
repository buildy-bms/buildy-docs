<script setup>
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import {
  DocumentPlusIcon,
  DocumentDuplicateIcon,
  TrashIcon,
  MapPinIcon,
  UserCircleIcon,
  ClockIcon,
  DocumentTextIcon,
  TableCellsIcon,
  Squares2X2Icon,
  MagnifyingGlassIcon,
  XMarkIcon,
} from '@heroicons/vue/24/outline'
import { listAfs, getAfsStats, createAf, cloneAf, deleteAf } from '@/api'
import { useNotification } from '@/composables/useNotification'
import BaseModal from '@/components/BaseModal.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import ServiceLevelBadge from '@/components/ServiceLevelBadge.vue'

const router = useRouter()
const { success, error } = useNotification()

const afs = ref([])
const stats = ref({ redaction: 0, validee: 0, commissioning: 0, commissioned: 0, livree: 0, total: 0 })
const loading = ref(false)

const showCreate = ref(false)
const showClone = ref(false)
const cloneSource = ref(null)

// Lot 27 — vue tableau (par défaut) + recherche client/projet
const viewMode = ref(localStorage.getItem('afs-view-mode') || 'table') // 'table' | 'grid'
const searchQuery = ref('')
const sortBy = ref('updated_at')
const sortDir = ref('desc') // 'asc' | 'desc'
function setViewMode(mode) {
  viewMode.value = mode
  localStorage.setItem('afs-view-mode', mode)
}
function toggleSort(col) {
  if (sortBy.value === col) sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  else { sortBy.value = col; sortDir.value = 'asc' }
}
function normalize(s) {
  return (s || '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

const STATUS_ORDER = { redaction: 0, validee: 1, commissioning: 2, commissioned: 3, livree: 4 }

const filteredSorted = computed(() => {
  const q = normalize(searchQuery.value)
  let list = afs.value
  if (q.length >= 2) {
    list = list.filter(a =>
      normalize(a.client_name).includes(q) ||
      normalize(a.project_name).includes(q) ||
      normalize(a.site_address).includes(q)
    )
  }
  list = [...list].sort((a, b) => {
    let av, bv
    if (sortBy.value === 'status') { av = STATUS_ORDER[a.status] ?? 99; bv = STATUS_ORDER[b.status] ?? 99 }
    else if (sortBy.value === 'updated_at') { av = a.updated_at || ''; bv = b.updated_at || '' }
    else { av = (a[sortBy.value] || '').toString().toLowerCase(); bv = (b[sortBy.value] || '').toString().toLowerCase() }
    if (av < bv) return sortDir.value === 'asc' ? -1 : 1
    if (av > bv) return sortDir.value === 'asc' ? 1 : -1
    return 0
  })
  return list
})

const newAf = ref({ client_name: '', project_name: '', site_address: '', service_level: null })
const cloneTarget = ref({ client_name: '', project_name: '', site_address: '' })
const submitting = ref(false)

// Groupement par statut pour affichage
const grouped = computed(() => {
  const groups = {
    'En rédaction': afs.value.filter((a) => a.status === 'redaction'),
    'Validées': afs.value.filter((a) => a.status === 'validee'),
    'En commissionnement': afs.value.filter((a) => ['commissioning', 'commissioned'].includes(a.status)),
    'Livrées': afs.value.filter((a) => a.status === 'livree'),
  }
  // Ne renvoie que les groupes non vides
  return Object.fromEntries(Object.entries(groups).filter(([_, list]) => list.length > 0))
})

async function refresh() {
  loading.value = true
  try {
    const [a, s] = await Promise.all([listAfs(), getAfsStats()])
    afs.value = a.data
    stats.value = s.data
  } catch (e) {
    error('Échec du chargement des AFs')
  } finally {
    loading.value = false
  }
}

async function submitCreate() {
  if (!newAf.value.client_name.trim() || !newAf.value.project_name.trim()) return
  submitting.value = true
  try {
    const { data } = await createAf(newAf.value)
    success(`AF créée : ${data.client_name} — ${data.project_name} (${data.sections_count} sections seedées)`)
    showCreate.value = false
    newAf.value = { client_name: '', project_name: '', site_address: '', service_level: null }
    refresh()
    router.push(`/afs/${data.id}`)
  } catch (e) {
    error(e.response?.data?.detail || 'Erreur lors de la création')
  } finally {
    submitting.value = false
  }
}

function openClone(af) {
  cloneSource.value = af
  cloneTarget.value = {
    client_name: af.client_name,
    project_name: `${af.project_name} (copie)`,
    site_address: af.site_address || '',
  }
  showClone.value = true
}

async function submitClone() {
  if (!cloneTarget.value.client_name.trim() || !cloneTarget.value.project_name.trim()) return
  submitting.value = true
  try {
    const { data } = await cloneAf(cloneSource.value.id, cloneTarget.value)
    success(`AF clonée : ${data.client_name} — ${data.project_name}`)
    showClone.value = false
    refresh()
  } catch (e) {
    error(e.response?.data?.detail || 'Erreur lors du clonage')
  } finally {
    submitting.value = false
  }
}

async function confirmDelete(af) {
  if (!confirm(`Supprimer l'AF "${af.client_name} — ${af.project_name}" ?\n(Soft delete : récupérable côté DB)`)) return
  try {
    await deleteAf(af.id)
    success('AF supprimée')
    refresh()
  } catch (e) {
    error('Échec de la suppression')
  }
}

function formatDate(s) {
  if (!s) return '—'
  return new Date(s.replace(' ', 'T')).toLocaleDateString('fr-FR', {
    day: '2-digit', month: 'short', year: 'numeric'
  })
}

onMounted(refresh)
</script>

<template>
  <div class="max-w-6xl mx-auto">
    <!-- Header -->
    <div class="flex items-start justify-between mb-6">
      <div>
        <h1 class="text-2xl font-semibold text-gray-800">Mes Analyses Fonctionnelles</h1>
        <p class="text-sm text-gray-500 mt-1">
          {{ stats.total }} AF{{ stats.total > 1 ? 's' : '' }} —
          <span class="text-gray-700">{{ stats.redaction }} en rédaction</span>,
          <span class="text-amber-700">{{ stats.commissioning + stats.commissioned }} en commissionnement</span>,
          <span class="text-emerald-700">{{ stats.livree }} livrée{{ stats.livree > 1 ? 's' : '' }}</span>
        </p>
      </div>
      <button
        @click="showCreate = true"
        class="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 shadow-sm"
      >
        <DocumentPlusIcon class="w-4 h-4" />
        Nouvelle AF
      </button>
    </div>

    <!-- Toolbar : recherche + toggle vue (Lot 27) -->
    <div v-if="afs.length" class="flex items-center justify-between gap-3 mb-4">
      <div class="relative flex-1 max-w-md">
        <MagnifyingGlassIcon class="w-4 h-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
        <input
          v-model="searchQuery"
          type="text"
          placeholder="Rechercher par client, projet ou adresse…"
          autocomplete="off"
          data-1p-ignore="true"
          data-bwignore="true"
          data-lpignore="true"
          class="w-full pl-9 pr-9 py-2 border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <button v-if="searchQuery" @click="searchQuery = ''" class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700">
          <XMarkIcon class="w-4 h-4" />
        </button>
      </div>
      <div class="inline-flex items-center border border-gray-300 rounded overflow-hidden text-xs">
        <button @click="setViewMode('table')" :class="['px-3 py-1.5 inline-flex items-center gap-1', viewMode === 'table' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50']">
          <TableCellsIcon class="w-3.5 h-3.5" /> Tableau
        </button>
        <button @click="setViewMode('grid')" :class="['px-3 py-1.5 inline-flex items-center gap-1', viewMode === 'grid' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50']">
          <Squares2X2Icon class="w-3.5 h-3.5" /> Grille
        </button>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="text-center py-12 text-gray-400 text-sm">Chargement...</div>

    <!-- Empty state -->
    <div
      v-else-if="!afs.length"
      class="bg-white rounded-none border border-gray-200 p-12 text-center"
    >
      <DocumentTextIcon class="w-16 h-16 mx-auto text-gray-300" />
      <h2 class="mt-4 text-base font-medium text-gray-800">Aucune AF pour l'instant</h2>
      <p class="mt-2 text-sm text-gray-500 max-w-md mx-auto">
        Démarrez votre premier projet en cliquant sur « Nouvelle AF ». Le plan complet
        de 12 chapitres et la bibliothèque d'équipements seront automatiquement appliqués.
      </p>
    </div>

    <!-- Vue tableau (par défaut, Lot 27) -->
    <template v-else-if="viewMode === 'table'">
      <div class="bg-white border border-gray-200 rounded-none overflow-hidden">
        <table class="w-full text-sm">
          <thead class="bg-gray-50 text-xs uppercase text-gray-500 tracking-wider">
            <tr>
              <th class="text-left px-4 py-2.5 cursor-pointer hover:text-gray-700" @click="toggleSort('client_name')">
                Client {{ sortBy === 'client_name' ? (sortDir === 'asc' ? '↑' : '↓') : '' }}
              </th>
              <th class="text-left px-4 py-2.5 cursor-pointer hover:text-gray-700" @click="toggleSort('project_name')">
                Projet {{ sortBy === 'project_name' ? (sortDir === 'asc' ? '↑' : '↓') : '' }}
              </th>
              <th class="text-left px-4 py-2.5 cursor-pointer hover:text-gray-700 w-44" @click="toggleSort('status')">
                Statut {{ sortBy === 'status' ? (sortDir === 'asc' ? '↑' : '↓') : '' }}
              </th>
              <th class="text-left px-4 py-2.5 w-24">Contrat</th>
              <th class="text-left px-4 py-2.5 cursor-pointer hover:text-gray-700 w-40" @click="toggleSort('updated_at')">
                Dernière modif {{ sortBy === 'updated_at' ? (sortDir === 'asc' ? '↑' : '↓') : '' }}
              </th>
              <th class="text-right px-4 py-2.5 w-24">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="af in filteredSorted"
              :key="af.id"
              class="border-t border-gray-100 hover:bg-indigo-50/40 cursor-pointer group"
              @click="router.push(`/afs/${af.id}`)"
            >
              <td class="px-4 py-2.5 font-semibold text-gray-800">{{ af.client_name }}</td>
              <td class="px-4 py-2.5 text-gray-700">
                {{ af.project_name }}
                <p v-if="af.site_address" class="text-[11px] text-gray-400 truncate flex items-center gap-1 mt-0.5">
                  <MapPinIcon class="w-3 h-3 shrink-0" />{{ af.site_address }}
                </p>
              </td>
              <td class="px-4 py-2.5"><StatusBadge :status="af.status" /></td>
              <td class="px-4 py-2.5">
                <ServiceLevelBadge v-if="af.service_level" :level="af.service_level" />
                <span v-else class="text-[11px] text-gray-400 italic">—</span>
              </td>
              <td class="px-4 py-2.5 text-xs text-gray-500">
                {{ formatDate(af.updated_at) }}
                <p v-if="af.updated_by_name" class="text-[10px] text-gray-400 truncate">par {{ af.updated_by_name }}</p>
              </td>
              <td class="px-4 py-2.5 text-right">
                <div class="inline-flex items-center gap-1 opacity-0 group-hover:opacity-100">
                  <button @click.stop="openClone(af)" class="text-gray-400 hover:text-indigo-600 p-1" title="Cloner">
                    <DocumentDuplicateIcon class="w-4 h-4" />
                  </button>
                  <button @click.stop="confirmDelete(af)" class="text-gray-400 hover:text-red-600 p-1" title="Supprimer">
                    <TrashIcon class="w-4 h-4" />
                  </button>
                </div>
              </td>
            </tr>
            <tr v-if="!filteredSorted.length">
              <td colspan="6" class="px-4 py-8 text-center text-sm text-gray-400 italic">
                {{ searchQuery ? `Aucune AF ne correspond à « ${searchQuery} ».` : 'Aucune AF.' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <!-- Vue grille groupée (legacy) -->
    <template v-else>
      <div v-for="(items, group) in grouped" :key="group" class="mb-8">
        <h3 class="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">
          {{ group }} <span class="text-gray-400">· {{ items.length }}</span>
        </h3>
        <div v-if="!items.length" class="text-sm text-gray-400 italic">Aucune dans ce groupe.</div>
        <div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <div
            v-for="af in items"
            :key="af.id"
            class="bg-white rounded-none border border-gray-200 p-4 hover:shadow-md transition-shadow group cursor-pointer"
            @click="router.push(`/afs/${af.id}`)"
          >
            <div class="flex items-start justify-between mb-2">
              <h4 class="font-semibold text-sm text-gray-900 truncate flex-1 min-w-0 pr-2">
                {{ af.client_name }}
              </h4>
              <div class="flex items-center gap-1">
                <ServiceLevelBadge :level="af.service_level" />
                <StatusBadge :status="af.status" />
              </div>
            </div>
            <p class="text-sm text-gray-700 mb-2 truncate">{{ af.project_name }}</p>
            <div v-if="af.site_address" class="flex items-center gap-1.5 text-xs text-gray-500 mb-2 truncate">
              <MapPinIcon class="w-3.5 h-3.5 shrink-0" />
              <span class="truncate">{{ af.site_address }}</span>
            </div>
            <div class="flex items-center gap-1.5 text-xs text-gray-400 mb-3">
              <UserCircleIcon class="w-3.5 h-3.5" />
              {{ af.updated_by_name || af.created_by_name || 'Inconnu' }}
              <ClockIcon class="w-3.5 h-3.5 ml-2" />
              {{ formatDate(af.updated_at) }}
            </div>
            <div class="flex items-center gap-2 pt-3 border-t border-gray-100 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                @click.stop="openClone(af)"
                class="text-xs text-gray-500 hover:text-indigo-600 inline-flex items-center gap-1"
              >
                <DocumentDuplicateIcon class="w-3.5 h-3.5" /> Cloner
              </button>
              <button
                @click.stop="confirmDelete(af)"
                class="text-xs text-gray-500 hover:text-red-600 inline-flex items-center gap-1 ml-auto"
              >
                <TrashIcon class="w-3.5 h-3.5" /> Supprimer
              </button>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- Modal nouvelle AF -->
    <BaseModal v-if="showCreate" title="Nouvelle Analyse Fonctionnelle" size="md" @close="showCreate = false">
      <form @submit.prevent="submitCreate" class="space-y-4">
        <div>
          <label class="block text-xs font-medium text-gray-700 mb-1">Client *</label>
          <input
            v-model="newAf.client_name"
            type="text"
            required
            placeholder="ex : Acme SAS"
            class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-700 mb-1">Projet *</label>
          <input
            v-model="newAf.project_name"
            type="text"
            required
            placeholder="ex : Lyon Part-Dieu — Bâtiment B"
            class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-700 mb-1">Adresse du site</label>
          <input
            v-model="newAf.site_address"
            type="text"
            placeholder="ex : 42 rue de la Tête d'Or, 69006 Lyon"
            class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-700 mb-1">
            Niveau de contrat Buildy
            <span class="text-gray-400 font-normal">— optionnel, à définir plus tard si besoin</span>
          </label>
          <div class="grid grid-cols-4 gap-2">
            <label
              v-for="opt in [
                { value: null, label: 'À déterminer' },
                { value: 'E', label: 'Essentials' },
                { value: 'S', label: 'Smart' },
                { value: 'P', label: 'Premium' },
              ]"
              :key="opt.value || 'none'"
              :class="[
                'cursor-pointer text-center py-2 rounded-lg border text-sm font-semibold',
                newAf.service_level === opt.value
                  ? 'bg-indigo-50 border-indigo-500 text-indigo-700'
                  : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
              ]"
            >
              <input v-model="newAf.service_level" :value="opt.value" type="radio" class="sr-only" />
              {{ opt.label }}
            </label>
          </div>
          <p class="text-[11px] text-gray-500 mt-1.5">
            Le niveau requis par l'AF sera calculé automatiquement à partir des sections que vous incluez.
          </p>
        </div>
        <p class="text-xs text-gray-500 leading-relaxed">
          La création va seeder automatiquement les 12 chapitres du plan AF type
          (~93 sections) avec la bibliothèque d'équipements (CTA, chaudière, compteurs…)
          et les pages réelles d'Hyperveez. Tu pourras ensuite éditer chaque section.
        </p>
      </form>
      <template #footer>
        <button @click="showCreate = false" class="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Annuler</button>
        <button
          @click="submitCreate"
          :disabled="submitting || !newAf.client_name.trim() || !newAf.project_name.trim()"
          class="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50"
        >
          {{ submitting ? 'Création…' : 'Créer l\'AF' }}
        </button>
      </template>
    </BaseModal>

    <!-- Modal clone -->
    <BaseModal v-if="showClone" :title="`Cloner « ${cloneSource?.client_name} — ${cloneSource?.project_name} »`" size="md" @close="showClone = false">
      <form @submit.prevent="submitClone" class="space-y-4">
        <p class="text-xs text-gray-500">
          Toutes les sections, points overrides et instances d'équipement seront copiés.
          Les captures et l'historique des exports ne le sont pas (l'AF clonée démarre vierge).
        </p>
        <div>
          <label class="block text-xs font-medium text-gray-700 mb-1">Client *</label>
          <input v-model="cloneTarget.client_name" type="text" required class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" autocomplete="off" data-1p-ignore="true" data-bwignore="true" data-lpignore="true" />
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-700 mb-1">Projet *</label>
          <input v-model="cloneTarget.project_name" type="text" required class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" autocomplete="off" data-1p-ignore="true" data-bwignore="true" data-lpignore="true" />
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-700 mb-1">Adresse du site</label>
          <input v-model="cloneTarget.site_address" type="text" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" autocomplete="off" data-1p-ignore="true" data-bwignore="true" data-lpignore="true" />
        </div>
      </form>
      <template #footer>
        <button @click="showClone = false" class="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Annuler</button>
        <button
          @click="submitClone"
          :disabled="submitting || !cloneTarget.client_name.trim() || !cloneTarget.project_name.trim()"
          class="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50"
        >
          {{ submitting ? 'Clonage…' : 'Cloner' }}
        </button>
      </template>
    </BaseModal>
  </div>
</template>
