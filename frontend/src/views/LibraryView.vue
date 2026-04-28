<script setup>
import { ref, onMounted, computed } from 'vue'
import { ChevronLeftIcon, BookmarkIcon, TableCellsIcon, Squares2X2Icon, MagnifyingGlassIcon, XMarkIcon } from '@heroicons/vue/24/outline'
import { listEquipmentTemplates, getEquipmentTemplate, getTemplateVersions, getTemplateAffectedAfs } from '@/api'
import EquipmentIcon from '@/components/EquipmentIcon.vue'
import ProtocolPills from '@/components/ProtocolPills.vue'
import BacsContextBox from '@/components/BacsContextBox.vue'
import { useRouter, useRoute } from 'vue-router'

const router = useRouter()
const route = useRoute()
const versions = ref([])
const affectedAfs = ref([])

const templates = ref([])
const selected = ref(null)

// Lot 23 — toggle vue tableau / grille + recherche
const viewMode = ref(localStorage.getItem('library-view-mode') || 'table')
const searchQuery = ref('')
const sortBy = ref('name')
const sortDir = ref('asc')
function setViewMode(m) { viewMode.value = m; localStorage.setItem('library-view-mode', m) }
function toggleSort(c) {
  if (sortBy.value === c) sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  else { sortBy.value = c; sortDir.value = 'asc' }
}
function normalize(s) { return (s || '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '') }

const filteredSorted = computed(() => {
  const q = normalize(searchQuery.value)
  let list = templates.value
  if (q.length >= 2) {
    list = list.filter(t =>
      normalize(t.name).includes(q) ||
      normalize(t.slug).includes(q) ||
      normalize(t.category).includes(q) ||
      normalize(t.preferred_protocols).includes(q)
    )
  }
  list = [...list].sort((a, b) => {
    let av, bv
    if (sortBy.value === 'points_count' || sortBy.value === 'sections_using_count' || sortBy.value === 'current_version') {
      av = a[sortBy.value] || 0; bv = b[sortBy.value] || 0
    } else {
      av = (a[sortBy.value] || '').toString().toLowerCase()
      bv = (b[sortBy.value] || '').toString().toLowerCase()
    }
    if (av < bv) return sortDir.value === 'asc' ? -1 : 1
    if (av > bv) return sortDir.value === 'asc' ? 1 : -1
    return 0
  })
  return list
})
const loading = ref(false)

const TYPE_COLORS = {
  Mesure:   { bg: 'bg-blue-50',     text: 'text-blue-700' },
  'État':   { bg: 'bg-gray-100',    text: 'text-gray-700' },
  Alarme:   { bg: 'bg-red-50',      text: 'text-red-700' },
  Commande: { bg: 'bg-emerald-50',  text: 'text-emerald-700' },
  Consigne: { bg: 'bg-amber-50',    text: 'text-amber-700' },
}

const grouped = computed(() => {
  const groups = {}
  for (const t of templates.value) {
    const cat = t.category || 'autres'
    if (!groups[cat]) groups[cat] = []
    groups[cat].push(t)
  }
  return groups
})

const CATEGORY_LABELS = {
  ventilation: 'Ventilation',
  chauffage: 'Chauffage',
  climatisation: 'Climatisation',
  ecs: 'Eau chaude sanitaire',
  eclairage: 'Éclairage',
  electricite: 'Électricité',
  comptage: 'Comptage énergétique',
  qai: 'Qualité de l\'air',
  occultation: 'Occultation',
  process: 'Process industriel',
  autres: 'Autres équipements',
}

async function refresh() {
  loading.value = true
  try {
    const { data } = await listEquipmentTemplates()
    templates.value = data
  } finally {
    loading.value = false
  }
}

async function openTemplate(t) {
  const [tplRes, verRes, afsRes] = await Promise.all([
    getEquipmentTemplate(t.id),
    getTemplateVersions(t.id).catch(() => ({ data: { versions: [] } })),
    getTemplateAffectedAfs(t.id).catch(() => ({ data: { afs: [] } })),
  ])
  selected.value = tplRes.data
  versions.value = verRes.data.versions || []
  affectedAfs.value = afsRes.data.afs || []
}

onMounted(async () => {
  await refresh()
  // Ouverture directe via ?open=<slug> (utilisée par EquipmentDescriptionPanel)
  if (route.query.open) {
    const t = templates.value.find(x => x.slug === route.query.open)
    if (t) await openTemplate(t)
  }
})
</script>

<template>
  <div class="max-w-6xl mx-auto">
    <!-- Vue liste -->
    <template v-if="!selected">
      <div class="mb-6 flex items-end justify-between gap-3">
        <div>
          <h1 class="text-2xl font-semibold text-gray-800">Bibliothèque d'équipements</h1>
          <p class="text-sm text-gray-500 mt-1">
            {{ templates.length }} template{{ templates.length > 1 ? 's' : '' }} partagé{{ templates.length > 1 ? 's' : '' }}
            entre toutes les AFs. Édite un template pour propager les changements.
          </p>
        </div>
      </div>

      <!-- Toolbar : recherche + toggle (Lot 23) -->
      <div v-if="templates.length" class="flex items-center justify-between gap-3 mb-4">
        <div class="relative flex-1 max-w-md">
          <MagnifyingGlassIcon class="w-4 h-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            v-model="searchQuery"
            type="text"
            placeholder="Rechercher (nom, slug, catégorie, protocole)…"
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

      <div v-if="loading" class="text-center py-12 text-gray-400 text-sm">Chargement...</div>

      <!-- Vue tableau (par défaut) -->
      <div v-else-if="viewMode === 'table'" class="bg-white border border-gray-200 rounded-none overflow-hidden">
        <table class="w-full text-sm">
          <thead class="bg-gray-50 text-xs uppercase text-gray-500 tracking-wider">
            <tr>
              <th class="text-center px-4 py-2.5 w-12"></th>
              <th class="text-center px-4 py-2.5 cursor-pointer hover:text-gray-700" @click="toggleSort('category')">
                Catégorie {{ sortBy === 'category' ? (sortDir === 'asc' ? '↑' : '↓') : '' }}
              </th>
              <th class="text-center px-4 py-2.5 cursor-pointer hover:text-gray-700" @click="toggleSort('name')">
                Nom {{ sortBy === 'name' ? (sortDir === 'asc' ? '↑' : '↓') : '' }}
              </th>
              <th class="text-center px-4 py-2.5 w-32">Slug</th>
              <th class="text-center px-4 py-2.5 w-24 cursor-pointer hover:text-gray-700" @click="toggleSort('points_count')">
                Points {{ sortBy === 'points_count' ? (sortDir === 'asc' ? '↑' : '↓') : '' }}
              </th>
              <th class="text-center px-4 py-2.5 w-20 cursor-pointer hover:text-gray-700" @click="toggleSort('sections_using_count')">
                AFs {{ sortBy === 'sections_using_count' ? (sortDir === 'asc' ? '↑' : '↓') : '' }}
              </th>
              <th class="text-center px-4 py-2.5 w-44">Protocoles exigés</th>
              <th class="text-center px-4 py-2.5 w-16 cursor-pointer hover:text-gray-700" @click="toggleSort('current_version')">
                Version {{ sortBy === 'current_version' ? (sortDir === 'asc' ? '↑' : '↓') : '' }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="t in filteredSorted"
              :key="t.id"
              class="border-t border-gray-100 hover:bg-indigo-50/40 cursor-pointer"
              @click="openTemplate(t)"
            >
              <td class="px-4 py-2 text-center"><EquipmentIcon :template="t" size="sm" /></td>
              <td class="px-4 py-2 text-center text-gray-600 text-xs uppercase tracking-wider">{{ CATEGORY_LABELS[t.category] || t.category || '—' }}</td>
              <td class="px-4 py-2 font-semibold text-gray-800">{{ t.name }}</td>
              <td class="px-4 py-2 text-center"><code class="text-[11px] bg-gray-100 px-1.5 py-0.5 rounded">{{ t.slug }}</code></td>
              <td class="px-4 py-2 text-center">
                <span class="inline-flex items-center justify-center w-7 h-7 rounded-full bg-[#1b2842] text-white text-xs font-bold tabular-nums">{{ t.points_count }}</span>
              </td>
              <td class="px-4 py-2 text-center">
                <span class="inline-flex items-center gap-1 text-xs text-gray-500">
                  <BookmarkIcon class="w-3 h-3" /> {{ t.sections_using_count }}
                </span>
              </td>
              <td class="px-4 py-2">
                <ProtocolPills v-if="t.preferred_protocols" :protocols="t.preferred_protocols" />
                <span v-else class="text-[11px] text-gray-300 italic block text-center">—</span>
              </td>
              <td class="px-4 py-2 text-center text-[11px] text-gray-400 font-mono">v{{ t.current_version }}</td>
            </tr>
            <tr v-if="!filteredSorted.length">
              <td colspan="8" class="px-4 py-8 text-center text-sm text-gray-400 italic">
                {{ searchQuery ? `Aucun template ne correspond à « ${searchQuery} ».` : 'Aucun template.' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Vue grille (legacy) -->
      <div v-else v-for="(items, cat) in grouped" :key="cat" class="mb-8">
        <h3 class="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">
          {{ CATEGORY_LABELS[cat] || cat }} <span class="text-gray-400">· {{ items.length }}</span>
        </h3>
        <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          <button
            v-for="t in items"
            :key="t.id"
            @click="openTemplate(t)"
            class="text-left bg-white rounded-none border border-gray-200 p-4 hover:shadow-md hover:border-indigo-300 transition group"
          >
            <div class="flex items-center justify-between mb-2">
              <EquipmentIcon :template="t" size="lg" />
              <span class="text-[10px] text-gray-400">v{{ t.current_version }}</span>
            </div>
            <p class="text-sm font-semibold text-gray-800 leading-tight mb-1">{{ t.name }}</p>
            <div class="flex items-center justify-between text-[11px] text-gray-500 mt-2 pt-2 border-t border-gray-100">
              <span>{{ t.points_count }} point{{ t.points_count > 1 ? 's' : '' }}</span>
              <span class="inline-flex items-center gap-0.5">
                <BookmarkIcon class="w-3 h-3" /> {{ t.sections_using_count }}
              </span>
            </div>
          </button>
        </div>
      </div>
    </template>

    <!-- Vue détail -->
    <template v-else>
      <button @click="selected = null" class="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-4">
        <ChevronLeftIcon class="w-4 h-4" /> Retour à la bibliothèque
      </button>

      <div class="flex items-start gap-4 mb-6">
        <EquipmentIcon :template="selected" size="lg" />
        <div class="min-w-0 flex-1">
          <h1 class="text-2xl font-semibold text-gray-800">{{ selected.name }}</h1>
          <p class="text-sm text-gray-500 mt-1">
            <span class="capitalize">{{ CATEGORY_LABELS[selected.category] || selected.category }}</span>
            · v{{ selected.current_version }} · slug <code class="bg-gray-100 px-1.5 py-0.5 rounded">{{ selected.slug }}</code>
          </p>
          <div v-if="selected.preferred_protocols" class="mt-3">
            <ProtocolPills :protocols="selected.preferred_protocols" />
          </div>
        </div>
      </div>

      <!-- Encart contextualisé "lien avec le décret BACS" -->
      <div v-if="selected.bacs_articles" class="mb-6">
        <BacsContextBox
          :reference="selected.bacs_articles"
          :justification="selected.bacs_justification"
          :template-id="selected.id"
          context="equipment"
          editable
          @updated="selected = { ...selected, ...$event }"
        />
      </div>

      <!-- Description -->
      <div class="mb-6">
        <h3 class="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">Description fonctionnelle</h3>
        <div v-if="selected.description_html" v-html="selected.description_html" class="prose prose-sm max-w-none text-gray-700 bg-white border border-gray-200 rounded-none p-5"></div>
        <div v-else class="bg-white border border-dashed border-gray-300 rounded-none p-5 text-sm text-gray-400 italic">
          Pas encore de description rédigée pour ce template. Édite-le depuis une AF puis promeus tes modifications dans la bibliothèque.
        </div>
      </div>

      <!-- Points lus -->
      <div class="mb-6">
        <h3 class="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
          Données typiquement lues ({{ selected.points.filter(p => p.direction === 'read').length }})
        </h3>
        <div v-if="selected.points.filter(p => p.direction === 'read').length" class="bg-white border border-gray-200 rounded-none overflow-hidden">
          <table class="w-full text-sm">
            <thead class="bg-gray-50 text-xs text-gray-500 uppercase">
              <tr>
                <th class="text-left px-4 py-2 font-medium">Donnée</th>
                <th class="text-left px-4 py-2 font-medium w-44">Nom technique</th>
                <th class="text-left px-4 py-2 font-medium w-28">Type</th>
                <th class="text-left px-4 py-2 font-medium w-24">Nature</th>
                <th class="text-left px-4 py-2 font-medium w-20">Unité</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in selected.points.filter(p => p.direction === 'read')" :key="p.id" class="border-t border-gray-100">
                <td class="px-4 py-2 text-gray-800">{{ p.label }}</td>
                <td class="px-4 py-2 text-xs">
                  <code v-if="p.tech_name" class="bg-gray-100 px-1.5 py-0.5 rounded font-mono text-[11px] text-gray-700">{{ p.tech_name }}</code>
                  <span v-else class="text-gray-300 italic">—</span>
                </td>
                <td class="px-4 py-2">
                  <span :class="['inline-block px-1.5 py-0.5 text-[10px] font-semibold rounded', TYPE_COLORS[p.data_type]?.bg, TYPE_COLORS[p.data_type]?.text]">{{ p.data_type }}</span>
                </td>
                <td class="px-4 py-2 text-gray-500 text-xs italic">{{ p.nature || '—' }}</td>
                <td class="px-4 py-2 text-gray-500 text-center font-variant-numeric tabular-nums">{{ p.unit || '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="text-sm text-gray-400 italic">Aucun point de lecture défini.</div>
      </div>

      <!-- Points écrits -->
      <div>
        <h3 class="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
          Données typiquement écrites ({{ selected.points.filter(p => p.direction === 'write').length }})
        </h3>
        <div v-if="selected.points.filter(p => p.direction === 'write').length" class="bg-white border border-gray-200 rounded-none overflow-hidden">
          <table class="w-full text-sm">
            <thead class="bg-gray-50 text-xs text-gray-500 uppercase">
              <tr>
                <th class="text-left px-4 py-2 font-medium">Donnée</th>
                <th class="text-left px-4 py-2 font-medium w-44">Nom technique</th>
                <th class="text-left px-4 py-2 font-medium w-28">Type</th>
                <th class="text-left px-4 py-2 font-medium w-24">Nature</th>
                <th class="text-left px-4 py-2 font-medium w-20">Unité</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in selected.points.filter(p => p.direction === 'write')" :key="p.id" class="border-t border-gray-100">
                <td class="px-4 py-2 text-gray-800">{{ p.label }}</td>
                <td class="px-4 py-2 text-xs">
                  <code v-if="p.tech_name" class="bg-gray-100 px-1.5 py-0.5 rounded font-mono text-[11px] text-gray-700">{{ p.tech_name }}</code>
                  <span v-else class="text-gray-300 italic">—</span>
                </td>
                <td class="px-4 py-2">
                  <span :class="['inline-block px-1.5 py-0.5 text-[10px] font-semibold rounded', TYPE_COLORS[p.data_type]?.bg, TYPE_COLORS[p.data_type]?.text]">{{ p.data_type }}</span>
                </td>
                <td class="px-4 py-2 text-gray-500 text-xs italic">{{ p.nature || '—' }}</td>
                <td class="px-4 py-2 text-gray-500 text-center font-variant-numeric tabular-nums">{{ p.unit || '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="text-sm text-gray-400 italic">Aucun point d'écriture défini.</div>
      </div>

      <!-- Historique des versions -->
      <div class="mt-8" v-if="versions.length">
        <h3 class="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
          Historique des versions ({{ versions.length }})
        </h3>
        <div class="bg-white border border-gray-200 rounded-none overflow-hidden">
          <table class="w-full text-sm">
            <thead class="bg-gray-50 text-xs text-gray-500 uppercase">
              <tr>
                <th class="text-left px-4 py-2 font-medium w-20">Version</th>
                <th class="text-left px-4 py-2 font-medium">Changelog</th>
                <th class="text-left px-4 py-2 font-medium w-40">Auteur</th>
                <th class="text-left px-4 py-2 font-medium w-44">Date</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="v in versions" :key="v.id" class="border-t border-gray-100">
                <td class="px-4 py-2">
                  <span class="font-mono text-xs">v{{ v.version }}</span>
                  <span v-if="v.version === selected.current_version" class="ml-1 inline-block px-1.5 py-0.5 text-[10px] font-semibold bg-emerald-100 text-emerald-800">actuelle</span>
                </td>
                <td class="px-4 py-2 text-gray-700">{{ v.changelog || '—' }}</td>
                <td class="px-4 py-2 text-gray-500 text-xs">{{ v.author_name || '—' }}</td>
                <td class="px-4 py-2 text-gray-500 text-xs">{{ new Date(v.created_at + 'Z').toLocaleString('fr-FR') }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- AFs qui utilisent ce template -->
      <div class="mt-8" v-if="affectedAfs.length">
        <h3 class="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
          AFs qui utilisent ce template ({{ affectedAfs.length }})
        </h3>
        <div class="bg-white border border-gray-200 rounded-none overflow-hidden">
          <table class="w-full text-sm">
            <thead class="bg-gray-50 text-xs text-gray-500 uppercase">
              <tr>
                <th class="text-left px-4 py-2 font-medium">Projet</th>
                <th class="text-left px-4 py-2 font-medium w-28">Statut</th>
                <th class="text-left px-4 py-2 font-medium w-44">Sections</th>
                <th class="text-left px-4 py-2 font-medium w-32">Synchro</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="af in affectedAfs" :key="af.af_id" class="border-t border-gray-100">
                <td class="px-4 py-2">
                  <button @click="router.push(`/afs/${af.af_id}`)" class="text-left hover:text-indigo-700">
                    <p class="font-semibold text-gray-800">{{ af.client_name }}</p>
                    <p class="text-xs text-gray-500">{{ af.project_name }}</p>
                  </button>
                </td>
                <td class="px-4 py-2 text-xs text-gray-600 capitalize">{{ af.status }}</td>
                <td class="px-4 py-2 text-xs text-gray-600">
                  <span v-for="(s, i) in af.sections" :key="s.section_id">
                    <span :class="s.is_outdated ? 'text-amber-700' : 'text-gray-500'">
                      § {{ s.number || '?' }} (v{{ s.equipment_template_version || 0 }})
                    </span><span v-if="i < af.sections.length - 1">, </span>
                  </span>
                </td>
                <td class="px-4 py-2">
                  <span v-if="af.outdated_count === 0" class="inline-block px-1.5 py-0.5 text-[10px] font-semibold bg-emerald-100 text-emerald-800">à jour</span>
                  <span v-else class="inline-block px-1.5 py-0.5 text-[10px] font-semibold bg-amber-100 text-amber-800">{{ af.outdated_count }} en retard</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </div>
</template>
