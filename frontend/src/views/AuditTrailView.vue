<script setup>
/**
 * Audit trail global — liste paginee de tous les evenements logges en DB.
 * Filtres : action (prefix), utilisateur, AF.
 */
import { ref, computed, onMounted, watch } from 'vue'
import {
  ClockIcon, MagnifyingGlassIcon, XMarkIcon, ChevronLeftIcon, ChevronRightIcon,
} from '@heroicons/vue/24/outline'
import { listAuditLog, listAuditActions } from '@/api'

const rows = ref([])
const total = ref(0)
const actions = ref([])
const filterAction = ref('')
const search = ref('')
const page = ref(0)
const pageSize = 100
const loading = ref(false)

async function refresh() {
  loading.value = true
  try {
    const { data } = await listAuditLog({
      limit: pageSize,
      offset: page.value * pageSize,
      action: filterAction.value || undefined,
    })
    rows.value = data.rows
    total.value = data.total
  } finally {
    loading.value = false
  }
}

async function loadActions() {
  const { data } = await listAuditActions()
  actions.value = data.actions || []
}

onMounted(async () => {
  await loadActions()
  await refresh()
})

watch([filterAction], () => {
  page.value = 0
  refresh()
})

// Filtrage textuel cote client (sur les rows deja chargees) pour la recherche libre
const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return rows.value
  return rows.value.filter(r =>
    (r.action || '').toLowerCase().includes(q) ||
    (r.user_display_name || '').toLowerCase().includes(q) ||
    (r.user_email || '').toLowerCase().includes(q) ||
    (r.af_client_name || '').toLowerCase().includes(q) ||
    (r.af_project_name || '').toLowerCase().includes(q) ||
    (r.payload || '').toLowerCase().includes(q)
  )
})

// Libelles humanises par prefix
const ACTION_LABELS = {
  'af.':                 { label: 'AF',                color: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  'section.':            { label: 'Section',           color: 'bg-blue-50 text-blue-700 border-blue-200' },
  'section_template.':   { label: 'Section type',      color: 'bg-blue-50 text-blue-700 border-blue-200' },
  'template.':           { label: 'Équipement',        color: 'bg-cyan-50 text-cyan-700 border-cyan-200' },
  'attachment.':         { label: 'Capture',           color: 'bg-purple-50 text-purple-700 border-purple-200' },
  'export.':             { label: 'Export PDF',        color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  'inspection.':         { label: 'Inspection BACS',   color: 'bg-amber-50 text-amber-700 border-amber-200' },
  'claude.':             { label: 'Claude (IA)',       color: 'bg-violet-50 text-violet-700 border-violet-200' },
  'zone.':               { label: 'Zone',              color: 'bg-teal-50 text-teal-700 border-teal-200' },
}
function actionBadge(code) {
  for (const k of Object.keys(ACTION_LABELS)) {
    if (code.startsWith(k)) return ACTION_LABELS[k]
  }
  return { label: 'Autre', color: 'bg-gray-100 text-gray-700 border-gray-200' }
}
function formatDate(iso) {
  if (!iso) return '—'
  return new Date(iso + 'Z').toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}
function formatPayload(json) {
  if (!json) return '—'
  try {
    const obj = typeof json === 'string' ? JSON.parse(json) : json
    return JSON.stringify(obj, null, 2)
  } catch {
    return String(json)
  }
}

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)))
function nextPage() { if (page.value < totalPages.value - 1) { page.value++; refresh() } }
function prevPage() { if (page.value > 0) { page.value--; refresh() } }

const expanded = ref(new Set())
function toggle(id) {
  if (expanded.value.has(id)) expanded.value.delete(id)
  else expanded.value.add(id)
  expanded.value = new Set(expanded.value)
}
</script>

<template>
  <div class="max-w-screen-2xl mx-auto">
    <div class="mb-5">
      <h1 class="text-2xl font-semibold text-gray-800 inline-flex items-center gap-2">
        <ClockIcon class="w-6 h-6 text-gray-500" />
        Audit trail
      </h1>
      <p class="text-sm text-gray-500 mt-1">
        Journal complet de toutes les actions tracées : créations, modifications, exports, appels à l'IA. {{ total }} événement{{ total > 1 ? 's' : '' }}.
      </p>
    </div>

    <div class="flex items-center gap-3 mb-4">
      <div class="relative flex-1 max-w-md">
        <MagnifyingGlassIcon class="w-4 h-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
        <input v-model="search" type="text" placeholder="Filtrer (utilisateur, AF, payload…)"
               autocomplete="off"
               class="w-full pl-9 pr-9 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition" />
        <button v-if="search" @click="search = ''"
                class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700">
          <XMarkIcon class="w-4 h-4" />
        </button>
      </div>
      <select v-model="filterAction"
              class="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition">
        <option value="">Toutes les actions</option>
        <option v-for="a in actions" :key="a" :value="a">{{ a }}</option>
      </select>
    </div>

    <div class="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
      <table class="w-full text-sm">
        <thead class="bg-gray-50 text-xs uppercase text-gray-500 tracking-wider">
          <tr>
            <th class="text-left px-4 py-2.5 whitespace-nowrap">Quand</th>
            <th class="text-left px-4 py-2.5 whitespace-nowrap">Type</th>
            <th class="text-left px-4 py-2.5 whitespace-nowrap">Action</th>
            <th class="text-left px-4 py-2.5 whitespace-nowrap">Utilisateur</th>
            <th class="text-left px-4 py-2.5 whitespace-nowrap">AF concernée</th>
            <th class="text-left px-4 py-2.5">Détails</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading">
            <td colspan="6" class="px-4 py-8 text-center text-sm text-gray-400">Chargement…</td>
          </tr>
          <template v-else-if="filtered.length">
            <template v-for="r in filtered" :key="r.id">
              <tr class="border-t border-gray-100 hover:bg-indigo-50/30 cursor-pointer"
                  @click="toggle(r.id)">
                <td class="px-4 py-2 text-xs text-gray-600 font-mono whitespace-nowrap">{{ formatDate(r.created_at) }}</td>
                <td class="px-4 py-2 whitespace-nowrap">
                  <span :class="['inline-flex items-center px-2 py-0.5 text-[11px] rounded-full border', actionBadge(r.action).color]">
                    {{ actionBadge(r.action).label }}
                  </span>
                </td>
                <td class="px-4 py-2 text-xs font-mono text-gray-700 whitespace-nowrap">{{ r.action }}</td>
                <td class="px-4 py-2 text-xs whitespace-nowrap">
                  <span v-if="r.user_display_name" class="text-gray-800">{{ r.user_display_name }}</span>
                  <span v-else-if="r.user_email" class="text-gray-500">{{ r.user_email }}</span>
                  <span v-else class="text-gray-300 italic">système</span>
                </td>
                <td class="px-4 py-2 text-xs whitespace-nowrap">
                  <span v-if="r.af_client_name" class="text-gray-700">
                    <span class="font-medium">{{ r.af_client_name }}</span>
                    <span class="text-gray-400"> · {{ r.af_project_name }}</span>
                  </span>
                  <span v-else class="text-gray-300 italic">—</span>
                </td>
                <td class="px-4 py-2 text-xs text-gray-500 max-w-md truncate">
                  <span v-if="r.payload">{{ r.payload }}</span>
                  <span v-else class="text-gray-300 italic">—</span>
                </td>
              </tr>
              <tr v-if="expanded.has(r.id)" class="border-t border-gray-100 bg-gray-50">
                <td colspan="6" class="px-4 py-3">
                  <pre class="text-[11px] font-mono text-gray-700 whitespace-pre-wrap break-words">{{ formatPayload(r.payload) }}</pre>
                </td>
              </tr>
            </template>
          </template>
          <tr v-else>
            <td colspan="6" class="px-4 py-8 text-center text-sm text-gray-400 italic">
              Aucun événement.
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="totalPages > 1" class="flex items-center justify-between mt-4 text-xs text-gray-600">
      <span>Page {{ page + 1 }} / {{ totalPages }}</span>
      <div class="flex items-center gap-2">
        <button @click="prevPage" :disabled="page === 0"
                class="inline-flex items-center gap-1 px-3 py-1.5 bg-white border border-gray-200 rounded-lg disabled:opacity-50 hover:bg-gray-50 transition">
          <ChevronLeftIcon class="w-4 h-4" /> Précédent
        </button>
        <button @click="nextPage" :disabled="page >= totalPages - 1"
                class="inline-flex items-center gap-1 px-3 py-1.5 bg-white border border-gray-200 rounded-lg disabled:opacity-50 hover:bg-gray-50 transition">
          Suivant <ChevronRightIcon class="w-4 h-4" />
        </button>
      </div>
    </div>
  </div>
</template>
