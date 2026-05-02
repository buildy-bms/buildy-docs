<script setup>
import { ref, onMounted, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  DocumentPlusIcon,
  DocumentDuplicateIcon,
  TrashIcon,
  MapPinIcon,
  DocumentTextIcon,
  MagnifyingGlassIcon,
  XMarkIcon,
  BookmarkIcon,
  ClockIcon,
} from '@heroicons/vue/24/outline'
import { listAfs, getAfsStats, createAf, cloneAf, deleteAf, seedBacsFixture, searchAfs } from '@/api'
import { useNotification } from '@/composables/useNotification'
import { useConfirm } from '@/composables/useConfirm'
import BaseModal from '@/components/BaseModal.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import ServiceLevelBadge from '@/components/ServiceLevelBadge.vue'
import AddressAutocomplete from '@/components/AddressAutocomplete.vue'
import SitePicker from '@/components/SitePicker.vue'

const router = useRouter()
const { success, error } = useNotification()
const { confirm } = useConfirm()

const afs = ref([])
const stats = ref({ redaction: 0, validee: 0, commissioning: 0, commissioned: 0, livree: 0, total: 0 })
const loading = ref(false)

const showCreate = ref(false)
const seedingFixture = ref(false)

async function createBacsFixture() {
  if (seedingFixture.value) return
  seedingFixture.value = true
  try {
    const { data } = await seedBacsFixture()
    success(`Audit BACS de test créé`)
    router.push(data.detail_url)
  } catch (e) {
    error(e.response?.data?.detail || 'Création de l\'audit fictif impossible')
  } finally {
    seedingFixture.value = false
  }
}
const showClone = ref(false)
const cloneSource = ref(null)

// Tableau unique avec recherche + tri colonne + groupement optionnel.
// (Avant : un toggle table/grille avec une grille qui regroupait par statut
// — friction sans valeur ajoutée. Le groupement est désormais une option du
// tableau, persistée comme le tri.)
const searchQuery = ref('')
const kindFilter = ref(localStorage.getItem('afs-kind-filter') || 'all') // 'all' | 'af' | 'bacs_audit'
watch(kindFilter, () => localStorage.setItem('afs-kind-filter', kindFilter.value))
const sortBy = ref(localStorage.getItem('afs-sort-by') || 'updated_at')
const sortDir = ref(localStorage.getItem('afs-sort-dir') || 'desc') // 'asc' | 'desc'
const groupBy = ref(localStorage.getItem('afs-group-by') || 'none') // 'none' | 'client' | 'status'
watch([sortBy, sortDir, groupBy], () => {
  localStorage.setItem('afs-sort-by', sortBy.value)
  localStorage.setItem('afs-sort-dir', sortDir.value)
  localStorage.setItem('afs-group-by', groupBy.value)
})
// Progression du stepper BACS (9 etapes a valider) pour la liste
function bacsProgress(af) {
  let progress = {}
  try { progress = JSON.parse(af.audit_progress || '{}') } catch { progress = {} }
  const STEPS = ['identification','zones','systems','meters','thermal','bms','documents','credentials','review']
  const count = STEPS.filter(s => progress[s]?.validated).length
  return { count, percent: Math.round((count / STEPS.length) * 100) }
}

function toggleSort(col) {
  if (sortBy.value === col) sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  else { sortBy.value = col; sortDir.value = 'asc' }
}
function normalize(s) {
  return (s || '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

const STATUS_ORDER = { redaction: 0, validee: 1, commissioning: 2, commissioned: 3, livree: 4 }

// Recherche etendue (cross-tables) : quand l'utilisateur tape un terme,
// on appelle /api/afs/search qui renvoie les af_ids matches dans les
// titres, sites, contenu BACS (notes, action items, devices, GTB...) +
// les hits library + sites independants. La recherche locale (client/
// project/address) reste un fallback rapide.
const extendedSearchAfIds = ref(null) // null = pas de recherche en cours
const libraryHits = ref([])
const siteOnlyHits = ref([])
let searchTimer = null
watch(searchQuery, (q) => {
  clearTimeout(searchTimer)
  if (!q || q.length < 2) {
    extendedSearchAfIds.value = null
    libraryHits.value = []
    siteOnlyHits.value = []
    return
  }
  searchTimer = setTimeout(async () => {
    try {
      const { data } = await searchAfs(q)
      extendedSearchAfIds.value = new Set(data.af_ids || [])
      libraryHits.value = data.library_hits || []
      siteOnlyHits.value = data.site_hits || []
    } catch { /* silencieux */ }
  }, 250)
})

const filteredSorted = computed(() => {
  const q = normalize(searchQuery.value)
  let list = afs.value
  if (kindFilter.value !== 'all') {
    list = list.filter(a => (a.kind || 'af') === kindFilter.value)
  }
  if (q.length >= 2) {
    // Union : matches locaux (instantanes) + matches backend etendus.
    const localMatch = (a) =>
      normalize(a.client_name).includes(q) ||
      normalize(a.project_name).includes(q) ||
      normalize(a.site_address).includes(q)
    const ids = extendedSearchAfIds.value
    list = list.filter(a => localMatch(a) || (ids && ids.has(a.id)))
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

// Pagination cote client : on rend les premiers N items, l'utilisateur peut
// charger la suite en cliquant. Filtrage/tri continue d'operer sur la liste
// complete (les recherches restent globales). Reset auto quand le filtre
// ou le tri change (sinon "page 5" sur 1000 elements = panier vide apres
// filtrage). Suffisant pour quelques centaines d'AFs ; on basculera sur
// pagination serveur si on depasse 1000.
const PAGE_SIZE = 50
const displayedCount = ref(PAGE_SIZE)
watch([searchQuery, sortBy, sortDir], () => { displayedCount.value = PAGE_SIZE })
const visibleAfs = computed(() => filteredSorted.value.slice(0, displayedCount.value))
const hasMore = computed(() => filteredSorted.value.length > displayedCount.value)
function loadMore() { displayedCount.value += PAGE_SIZE }

const newAf = ref({
  kind: 'af',
  site_id: null,
  client_name: '',
  project_name: '',
  site_address: '',
  service_level: null,
})
// Selectionne reactivement (charge depuis SitePicker via @change)
const selectedSite = ref(null)
function onSiteChange(site) {
  selectedSite.value = site
  if (!site) return
  // Pre-remplit client + adresse + project depuis le site choisi (editable apres)
  if (!newAf.value.client_name && site.customer_name) newAf.value.client_name = site.customer_name
  if (!newAf.value.site_address && site.address) newAf.value.site_address = site.address
  if (newAf.value.kind === 'bacs_audit' && !newAf.value.project_name) {
    newAf.value.project_name = `Audit BACS — ${site.name}`
  }
}
function onKindChange() {
  // Reset le project_name en cas de switch vers bacs_audit pour appliquer le pattern
  if (newAf.value.kind === 'bacs_audit' && selectedSite.value) {
    newAf.value.project_name = `Audit BACS — ${selectedSite.value.name}`
  }
}
const cloneTarget = ref({ client_name: '', project_name: '', site_address: '' })
const submitting = ref(false)

// Lignes du tableau, groupées si l'utilisateur l'a choisi. Format :
//   [{ kind: 'header', label, count }, { kind: 'row', af }, ...]
// Le groupement préserve l'ordre de tri choisi : on collecte les groupes
// dans l'ordre où ils apparaissent dans `visibleAfs`, ce qui permet par
// exemple de "trier par dernière modif, grouper par client" sans perdre
// le tri intra-groupe.
const STATUS_LABEL = {
  redaction: 'En rédaction',
  validee: 'Validées',
  commissioning: 'En commissionnement',
  commissioned: 'Commissionnées',
  livree: 'Livrées',
}
const tableRows = computed(() => {
  if (groupBy.value === 'none') {
    return visibleAfs.value.map(af => ({ kind: 'row', af }))
  }
  const keyFn = groupBy.value === 'client'
    ? (af) => af.client_name || '—'
    : (af) => STATUS_LABEL[af.status] || af.status
  const order = []
  const buckets = new Map()
  for (const af of visibleAfs.value) {
    const k = keyFn(af)
    if (!buckets.has(k)) { buckets.set(k, []); order.push(k) }
    buckets.get(k).push(af)
  }
  const rows = []
  for (const k of order) {
    const list = buckets.get(k)
    rows.push({ kind: 'header', label: k, count: list.length })
    for (const af of list) rows.push({ kind: 'row', af })
  }
  return rows
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
  if ((newAf.value.kind === 'bacs_audit' || newAf.value.kind === 'site_audit') && !newAf.value.site_id) {
    const label = newAf.value.kind === 'bacs_audit' ? 'audit BACS' : 'audit GTB'
    error(`Un ${label} doit être rattaché à un site`)
    return
  }
  submitting.value = true
  try {
    const { data } = await createAf(newAf.value)
    const kindLabel = data.kind === 'bacs_audit' ? 'Audit BACS'
      : data.kind === 'site_audit' ? 'Audit GTB'
      : data.kind === 'brochure' ? 'Brochure' : 'AF'
    success(`${kindLabel} créé : ${data.client_name} — ${data.project_name}${data.sections_count ? ` (${data.sections_count} sections seedées)` : ''}`)
    showCreate.value = false
    newAf.value = { kind: 'af', site_id: null, client_name: '', project_name: '', site_address: '', service_level: null }
    selectedSite.value = null
    refresh()
    router.push(routeForDoc(data))
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
  const ok = await confirm({
    title: 'Supprimer l\'AF ?',
    message: `« ${af.client_name} — ${af.project_name} »\n\nL'AF est archivée (récupérable côté DB).`,
    confirmLabel: 'Supprimer',
    danger: true,
  })
  if (!ok) return
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

// Dispatcher vers la bonne vue selon le kind du document
function routeForDoc(doc) {
  if (doc.kind === 'bacs_audit') return `/bacs-audit/${doc.id}`
  if (doc.kind === 'site_audit') return `/site-audit/${doc.id}`
  if (doc.kind === 'brochure') return `/brochures/${doc.id}`
  return `/afs/${doc.id}`
}

onMounted(refresh)
</script>

<template>
  <div class="max-w-6xl mx-auto">
    <!-- Header -->
    <div class="flex items-start justify-between mb-6">
      <div>
        <h1 class="text-2xl font-semibold text-gray-800">Mes documents</h1>
        <p class="text-sm text-gray-500 mt-1">
          {{ stats.total }} AF{{ stats.total > 1 ? 's' : '' }} —
          <span class="text-gray-700">{{ stats.redaction }} en rédaction</span>,
          <span class="text-amber-700">{{ stats.commissioning + stats.commissioned }} en commissionnement</span>,
          <span class="text-emerald-700">{{ stats.livree }} livrée{{ stats.livree > 1 ? 's' : '' }}</span>
        </p>
      </div>
      <div class="flex items-center gap-2">
        <button
          @click="createBacsFixture"
          :disabled="seedingFixture"
          class="inline-flex items-center gap-2 px-3 py-2 bg-violet-50 text-violet-700 text-sm font-medium rounded-lg hover:bg-violet-100 border border-violet-200 disabled:opacity-50"
          title="Crée un site + audit BACS de démonstration entièrement rempli pour tester l'outil"
        >
          ✨ {{ seedingFixture ? 'Création…' : 'Audit BACS de test' }}
        </button>
        <button
          @click="showCreate = true"
          class="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 shadow-sm"
        >
          <DocumentPlusIcon class="w-4 h-4" />
          Nouveau document
        </button>
      </div>
    </div>

    <!-- Toolbar : recherche + toggle vue (Lot 27) -->
    <div v-if="afs.length" class="flex items-center justify-between gap-3 mb-4">
      <div class="relative flex-1 max-w-md">
        <MagnifyingGlassIcon class="w-4 h-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
        <input
          v-model="searchQuery"
          type="text"
          placeholder="Rechercher : client, projet, adresse, contenu audit BACS, bibliothèque…"
          autocomplete="off"
          data-1p-ignore="true"
          data-bwignore="true"
          data-lpignore="true"
          class="w-full pl-9 pr-9 py-2 border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <button v-if="searchQuery" @click="searchQuery = ''" class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700">
          <XMarkIcon class="w-4 h-4" />
        </button>
      </div>
      <span v-if="searchQuery && searchQuery.length >= 2" class="text-xs text-gray-500 whitespace-nowrap">
        {{ filteredSorted.length }} doc{{ filteredSorted.length > 1 ? 's' : '' }}
        <span v-if="libraryHits.length || siteOnlyHits.length" class="text-gray-400">
          · {{ libraryHits.length }} biblio · {{ siteOnlyHits.length }} site{{ siteOnlyHits.length > 1 ? 's' : '' }}
        </span>
      </span>
      <div class="inline-flex items-center gap-1 bg-white border border-gray-200 rounded-lg p-0.5 text-xs">
        <button
          v-for="opt in [{v:'all',l:'Tous'}, {v:'af',l:'AF'}, {v:'bacs_audit',l:'Audit BACS'}, {v:'site_audit',l:'Audit GTB'}]"
          :key="opt.v"
          @click="kindFilter = opt.v"
          :class="[
            'px-2.5 py-1 rounded transition',
            kindFilter === opt.v ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-100'
          ]"
        >{{ opt.l }}</button>
      </div>
      <div class="inline-flex items-center gap-2 text-xs">
        <label class="text-gray-500">Grouper par</label>
        <select
          v-model="groupBy"
          class="px-2 py-1.5 bg-white border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition"
        >
          <option value="none">Aucun</option>
          <option value="client">Client</option>
          <option value="status">Statut</option>
        </select>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="text-center py-12 text-gray-400 text-sm">Chargement...</div>

    <!-- Empty state -->
    <div
      v-else-if="!afs.length"
      class="bg-white rounded-lg border border-gray-200 p-12 text-center"
    >
      <div class="w-16 h-16 rounded-full bg-indigo-50 flex items-center justify-center mx-auto">
        <DocumentTextIcon class="w-9 h-9 text-indigo-500" />
      </div>
      <h2 class="mt-4 text-base font-semibold text-gray-800">Aucune AF pour l'instant</h2>
      <p class="mt-2 text-sm text-gray-500 max-w-md mx-auto leading-relaxed">
        Démarre ton premier projet en cliquant sur « Nouvelle AF ». Le plan complet
        de 12 chapitres et la bibliothèque d'équipements seront automatiquement appliqués.
      </p>
      <button
        @click="showCreate = true"
        class="mt-5 inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700"
      >
        <DocumentPlusIcon class="w-4 h-4" /> Nouvelle AF
      </button>
    </div>

    <!-- Tableau unique (avec tri colonne + groupement optionnel) -->
    <div v-else class="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
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
          <template v-for="(row, idx) in tableRows" :key="idx">
            <tr v-if="row.kind === 'header'" class="bg-gray-50/60 border-t border-gray-200">
              <td colspan="6" class="px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                {{ row.label }} <span class="text-gray-400 font-normal">· {{ row.count }}</span>
              </td>
            </tr>
            <tr
              v-else
              class="border-t border-gray-100 hover:bg-indigo-50/40 cursor-pointer group"
              @click="router.push(routeForDoc(row.af))"
            >
              <td class="px-4 py-2.5 font-semibold text-gray-800">{{ row.af.client_name }}</td>
              <td class="px-4 py-2.5 text-gray-700">
                <div class="flex items-center gap-2">
                  <span
                    v-if="(row.af.kind || 'af') === 'bacs_audit'"
                    class="inline-block px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider rounded bg-orange-100 text-orange-700"
                    title="Audit BACS — décret R175"
                  >BACS</span>
                  <span
                    v-else-if="row.af.kind === 'site_audit'"
                    class="inline-block px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider rounded bg-emerald-100 text-emerald-700"
                    title="Audit GTB (Classique) — préparation devis Buildy"
                  >GTB</span>
                  <span
                    v-else-if="row.af.kind === 'brochure'"
                    class="inline-block px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider rounded bg-purple-100 text-purple-700"
                  >Brochure</span>
                  {{ row.af.project_name }}
                </div>
                <p v-if="row.af.site_address" class="text-[11px] text-gray-400 truncate flex items-center gap-1 mt-0.5">
                  <MapPinIcon class="w-3 h-3 shrink-0" />{{ row.af.site_address }}
                </p>
                <!-- Barre de progression stepper pour les audits BACS -->
                <div v-if="(row.af.kind || 'af') === 'bacs_audit'" class="mt-1.5 flex items-center gap-2">
                  <div class="flex-1 max-w-45 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div class="h-full bg-emerald-500 transition-all"
                         :style="{ width: bacsProgress(row.af).percent + '%' }"></div>
                  </div>
                  <span class="text-[10px] font-medium text-gray-600 whitespace-nowrap">
                    {{ bacsProgress(row.af).count }} / 9 étapes
                  </span>
                </div>
              </td>
              <td class="px-4 py-2.5"><StatusBadge :status="row.af.status" /></td>
              <td class="px-4 py-2.5">
                <ServiceLevelBadge v-if="row.af.service_level" :level="row.af.service_level" />
                <span v-else class="text-[11px] text-gray-400 italic">—</span>
              </td>
              <td class="px-4 py-2.5 text-xs text-gray-500">
                {{ formatDate(row.af.updated_at) }}
                <p v-if="row.af.updated_by_name" class="text-[10px] text-gray-400 truncate">par {{ row.af.updated_by_name }}</p>
              </td>
              <td class="px-4 py-2.5 text-right">
                <div class="inline-flex items-center gap-1 opacity-0 group-hover:opacity-100">
                  <button v-if="(row.af.kind || 'af') === 'af'" @click.stop="router.push(`/afs/${row.af.id}/versions`)" class="text-gray-400 hover:text-indigo-600 p-1" title="Versions">
                    <BookmarkIcon class="w-4 h-4" />
                  </button>
                  <button v-if="row.af.kind === 'bacs_audit' || row.af.kind === 'site_audit'"
                          @click.stop="router.push(`${row.af.kind === 'site_audit' ? '/site-audit' : '/bacs-audit'}/${row.af.id}/audit-trail`)"
                          class="text-gray-400 hover:text-indigo-600 p-1" title="Historique">
                    <ClockIcon class="w-4 h-4" />
                  </button>
                  <button v-if="(row.af.kind || 'af') === 'af'" @click.stop="openClone(row.af)" class="text-gray-400 hover:text-indigo-600 p-1" title="Cloner">
                    <DocumentDuplicateIcon class="w-4 h-4" />
                  </button>
                  <button @click.stop="confirmDelete(row.af)" class="text-gray-400 hover:text-red-600 p-1" title="Supprimer">
                    <TrashIcon class="w-4 h-4" />
                  </button>
                </div>
              </td>
            </tr>
          </template>
          <tr v-if="!filteredSorted.length">
            <td colspan="6" class="px-4 py-10 text-center">
              <p class="text-sm text-gray-500">
                <template v-if="searchQuery">
                  Aucune AF ne correspond à « <strong>{{ searchQuery }}</strong> ».
                </template>
                <template v-else>Aucune AF dans ce filtre.</template>
              </p>
              <button
                v-if="searchQuery"
                @click="searchQuery = ''"
                class="mt-2 text-xs text-indigo-600 hover:underline"
              >Effacer la recherche</button>
            </td>
          </tr>
          <tr v-if="hasMore">
            <td colspan="6" class="px-4 py-3 text-center bg-gray-50 border-t border-gray-200">
              <button
                @click="loadMore"
                class="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
              >
                Charger {{ Math.min(50, filteredSorted.length - visibleAfs.length) }} de plus
                <span class="text-gray-400 font-normal ml-1">({{ visibleAfs.length }} / {{ filteredSorted.length }})</span>
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Hits transverses (bibliothèque + sites) -->
    <div v-if="searchQuery && (libraryHits.length || siteOnlyHits.length)" class="mt-6 grid grid-cols-2 gap-4">
      <div v-if="libraryHits.length" class="bg-white border border-gray-200 rounded-lg shadow-sm">
        <header class="px-4 py-2.5 border-b border-gray-100 flex items-center gap-2 text-sm font-semibold text-gray-800">
          📚 Bibliothèque
          <span class="text-xs font-normal text-gray-500">{{ libraryHits.length }} résultat{{ libraryHits.length > 1 ? 's' : '' }}</span>
        </header>
        <ul class="divide-y divide-gray-100">
          <li v-for="h in libraryHits" :key="h.id" class="px-4 py-2 text-sm hover:bg-indigo-50/40 cursor-pointer"
              @click="router.push(h.is_functionality ? '/library/functionalities' : '/library/sections')">
            <div class="flex items-center gap-2">
              <span v-if="h.number" class="text-[10px] font-mono text-gray-400">{{ h.number }}</span>
              <span :class="h.is_functionality ? 'inline-block px-1.5 py-0.5 text-[9px] font-semibold uppercase rounded bg-violet-100 text-violet-700' : 'inline-block px-1.5 py-0.5 text-[9px] font-semibold uppercase rounded bg-gray-100 text-gray-700'">
                {{ h.is_functionality ? 'Fonctionnalité' : h.kind }}
              </span>
              <span class="text-gray-800">{{ h.title }}</span>
            </div>
          </li>
        </ul>
      </div>
      <div v-if="siteOnlyHits.length" class="bg-white border border-gray-200 rounded-lg shadow-sm">
        <header class="px-4 py-2.5 border-b border-gray-100 flex items-center gap-2 text-sm font-semibold text-gray-800">
          📍 Sites
          <span class="text-xs font-normal text-gray-500">{{ siteOnlyHits.length }} résultat{{ siteOnlyHits.length > 1 ? 's' : '' }}</span>
        </header>
        <ul class="divide-y divide-gray-100">
          <li v-for="s in siteOnlyHits" :key="s.site_id" class="px-4 py-2 text-sm">
            <div class="font-medium text-gray-800">{{ s.name }}</div>
            <div class="text-[11px] text-gray-500">{{ s.customer_name }}{{ s.address ? ' · ' + s.address : '' }}</div>
          </li>
        </ul>
      </div>
    </div>

    <!-- Modal nouveau document -->
    <BaseModal v-if="showCreate" title="Nouveau document" size="md" @close="showCreate = false">
      <form @submit.prevent="submitCreate" class="space-y-4">
        <!-- Selecteur de kind -->
        <div>
          <label class="block text-xs font-medium text-gray-700 mb-1">Type de document *</label>
          <div class="grid grid-cols-2 lg:grid-cols-4 gap-2">
            <label
              v-for="opt in [
                { value: 'af', label: 'Analyse Fonctionnelle', desc: 'Plan AF GTB pour DOE' },
                { value: 'bacs_audit', label: 'Audit BACS', desc: 'Conformité décret R175' },
                { value: 'site_audit', label: 'Audit GTB (Classique)', desc: 'Préparation devis Buildy (hors décret)' },
                { value: 'brochure', label: 'Brochure', desc: 'Document commercial composé' },
              ]"
              :key="opt.value"
              :class="[
                'cursor-pointer text-center py-3 px-2 rounded-lg border text-xs font-semibold transition',
                opt.disabled ? 'opacity-40 cursor-not-allowed' : '',
                newAf.kind === opt.value
                  ? 'bg-indigo-50 border-indigo-500 text-indigo-700'
                  : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
              ]"
            >
              <input
                v-model="newAf.kind"
                :value="opt.value"
                :disabled="opt.disabled"
                @change="onKindChange"
                type="radio"
                class="sr-only"
              />
              <div>{{ opt.label }}</div>
              <div class="text-[10px] font-normal text-gray-500 mt-0.5">{{ opt.desc }}</div>
            </label>
          </div>
        </div>

        <!-- Site (obligatoire pour bacs_audit, optionnel pour af) -->
        <div v-if="newAf.kind !== 'af'">
          <label class="block text-xs font-medium text-gray-700 mb-1">
            Site *
            <span class="text-gray-400 font-normal">— les zones et équipements seront partagés avec les autres documents du site</span>
          </label>
          <SitePicker
            v-model="newAf.site_id"
            :required="newAf.kind === 'bacs_audit' || newAf.kind === 'site_audit'"
            @change="onSiteChange"
          />
        </div>
        <div v-else>
          <label class="block text-xs font-medium text-gray-700 mb-1">
            Site
            <span class="text-gray-400 font-normal">— optionnel, sinon adresse libre ci-dessous</span>
          </label>
          <SitePicker v-model="newAf.site_id" @change="onSiteChange" />
        </div>

        <div>
          <label class="block text-xs font-medium text-gray-700 mb-1">Client *</label>
          <input
            v-model="newAf.client_name"
            type="text"
            required
            placeholder="ex : Acme SAS"
            class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-700 mb-1">Projet *</label>
          <input
            v-model="newAf.project_name"
            type="text"
            required
            placeholder="ex : Lyon Part-Dieu — Bâtiment B"
            class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-700 mb-1">Adresse du site</label>
          <AddressAutocomplete
            v-model="newAf.site_address"
            placeholder="ex : 42 rue de la Tête d'Or, 69006 Lyon"
          />
        </div>
        <div v-if="newAf.kind === 'af'">
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
                  : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
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
        <p v-if="newAf.kind === 'af'" class="text-xs text-gray-500 leading-relaxed">
          La création va seeder automatiquement les 12 chapitres du plan AF type
          (~93 sections) avec la bibliothèque d'équipements (CTA, chaudière, compteurs…)
          et les pages réelles d'Hyperveez. Tu pourras ensuite éditer chaque section.
        </p>
        <p v-else-if="newAf.kind === 'bacs_audit'" class="text-xs text-gray-500 leading-relaxed">
          L'audit BACS sera rattaché au site choisi. Le plan canonique pré-rempli
          (zones fonctionnelles, systèmes techniques, compteurs, GTB, régulation thermique)
          sera disponible en Phase 2.
        </p>
      </form>
      <template #footer>
        <button @click="showCreate = false" class="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Annuler</button>
        <button
          @click="submitCreate"
          :disabled="submitting || !newAf.client_name.trim() || !newAf.project_name.trim() || ((newAf.kind === 'bacs_audit' || newAf.kind === 'site_audit') && !newAf.site_id)"
          class="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50"
        >
          {{
            submitting ? 'Création…'
            : newAf.kind === 'bacs_audit' ? 'Créer l\'audit BACS'
            : newAf.kind === 'site_audit' ? 'Créer l\'audit GTB'
            : newAf.kind === 'brochure' ? 'Créer la brochure'
            : 'Créer l\'AF'
          }}
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
          <input v-model="cloneTarget.client_name" type="text" required class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" autocomplete="off" data-1p-ignore="true" data-bwignore="true" data-lpignore="true" />
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-700 mb-1">Projet *</label>
          <input v-model="cloneTarget.project_name" type="text" required class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" autocomplete="off" data-1p-ignore="true" data-bwignore="true" data-lpignore="true" />
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-700 mb-1">Adresse du site</label>
          <AddressAutocomplete v-model="cloneTarget.site_address" />
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
