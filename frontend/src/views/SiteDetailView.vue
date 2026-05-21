<script setup>
/**
 * Page détail / tableau de bord d'un site — hub regroupant ses documents
 * (AF, audits), zones, et compteurs. Point d'entrée : la liste des sites.
 */
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import {
  ArrowLeftIcon, PencilSquareIcon, MapPinIcon, BuildingOffice2Icon,
  DocumentTextIcon, ClipboardDocumentCheckIcon, Squares2X2Icon, CpuChipIcon,
  CameraIcon, MicrophoneIcon, KeyIcon, ArrowPathIcon,
} from '@heroicons/vue/24/outline'
import { getSiteOverview } from '@/api'
import { useNotification } from '@/composables/useNotification'
import { ZONE_NATURES } from '@/lib/audit-options'
import EditSiteModal from '@/components/EditSiteModal.vue'
import ZoneMapPicker from '@/components/ZoneMapPicker.vue'

const props = defineProps({ uuid: { type: String, required: true } })
const router = useRouter()
const { error: notifyError } = useNotification()

const overview = ref(null)
const loading = ref(true)
const showEditSite = ref(false)

async function load() {
  loading.value = true
  try {
    const { data } = await getSiteOverview(props.uuid)
    overview.value = data
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Site introuvable')
  } finally {
    loading.value = false
  }
}
onMounted(load)

const site = computed(() => overview.value?.site || null)
const counts = computed(() => overview.value?.counts || {})
const zones = computed(() => overview.value?.zones || [])
const documents = computed(() => overview.value?.documents || [])

const coordsLabel = computed(() => {
  const s = site.value
  if (!s || s.latitude == null || s.longitude == null) return null
  return `${Number(s.latitude).toFixed(5)}, ${Number(s.longitude).toFixed(5)}`
})
const hasMapData = computed(() =>
  (site.value && site.value.latitude != null) ||
  zones.value.some(z => z.latitude != null && z.longitude != null),
)

const tiles = computed(() => [
  { key: 'af', label: 'AF', icon: DocumentTextIcon },
  { key: 'audit', label: 'Audits', icon: ClipboardDocumentCheckIcon },
  { key: 'zones', label: 'Zones', icon: Squares2X2Icon },
  { key: 'equipments', label: 'Équipements', icon: CpuChipIcon },
  { key: 'photos', label: 'Photos', icon: CameraIcon },
  { key: 'voiceNotes', label: 'Notes vocales', icon: MicrophoneIcon },
  { key: 'credentials', label: 'Identifiants', icon: KeyIcon },
])

const KIND_LABEL = { af: 'AF', bacs_audit: 'Audit BACS', site_audit: 'Audit GTB' }
const KIND_CLASS = {
  af: 'bg-indigo-100 text-indigo-700',
  bacs_audit: 'bg-emerald-100 text-emerald-700',
  site_audit: 'bg-amber-100 text-amber-700',
}
function natureLabel(v) {
  return ZONE_NATURES.find(n => n.value === v)?.label || v || '—'
}
function fmtDate(s) {
  if (!s) return '—'
  return new Date(s.replace(' ', 'T')).toLocaleDateString('fr-FR', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}
function openDocument(doc) {
  if (doc.kind === 'af') router.push({ name: 'af-detail', params: { id: doc.id } })
  else router.push({ name: 'bacs-audit-detail', params: { id: doc.id } })
}
function onSiteSaved() {
  showEditSite.value = false
  load()
}
</script>

<template>
  <div class="max-w-6xl mx-auto">
    <router-link to="/sites" class="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-3">
      <ArrowLeftIcon class="w-4 h-4" /> Mes Sites
    </router-link>

    <div v-if="loading" class="text-center py-16 text-gray-400 text-sm">Chargement…</div>

    <template v-else-if="site">
      <!-- En-tête -->
      <div class="flex items-start justify-between gap-4 mb-5">
        <div class="min-w-0">
          <div class="flex items-center gap-2.5">
            <div class="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 inline-flex items-center justify-center shrink-0">
              <BuildingOffice2Icon class="w-6 h-6" />
            </div>
            <div class="min-w-0">
              <h1 class="text-2xl font-semibold text-gray-800 truncate">{{ site.name }}</h1>
              <p v-if="site.customer_name" class="text-sm text-gray-500">{{ site.customer_name }}</p>
            </div>
          </div>
          <div class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
            <span v-if="site.address" class="inline-flex items-center gap-1">
              <MapPinIcon class="w-3.5 h-3.5 shrink-0" /> {{ site.address }}
            </span>
            <span v-if="coordsLabel" class="font-mono">{{ coordsLabel }}</span>
          </div>
        </div>
        <button @click="showEditSite = true"
                class="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 whitespace-nowrap">
          <PencilSquareIcon class="w-4 h-4" /> Modifier le site
        </button>
      </div>

      <!-- Compteurs -->
      <div class="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-7 gap-2 mb-5">
        <div v-for="t in tiles" :key="t.key"
             class="bg-white border border-gray-200 rounded-xl p-3 flex flex-col items-center text-center">
          <component :is="t.icon" class="w-5 h-5 text-gray-400" />
          <span class="mt-1 text-xl font-semibold text-gray-800 tabular-nums">{{ counts[t.key] || 0 }}</span>
          <span class="text-[11px] text-gray-500 leading-tight">{{ t.label }}</span>
        </div>
      </div>

      <!-- Carte des zones -->
      <div v-if="hasMapData" class="bg-white border border-gray-200 rounded-lg p-3 mb-5">
        <p class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Carte du site</p>
        <ZoneMapPicker readonly :zones="zones" :site="site" />
      </div>

      <!-- Documents -->
      <div class="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden mb-5">
        <div class="px-4 py-2.5 border-b border-gray-100">
          <h2 class="text-sm font-semibold text-gray-700">Documents du site</h2>
        </div>
        <table v-if="documents.length" class="w-full text-sm">
          <thead class="bg-gray-50 text-xs uppercase text-gray-500 tracking-wider">
            <tr>
              <th class="text-left px-4 py-2">Type</th>
              <th class="text-left px-4 py-2">Projet</th>
              <th class="text-left px-4 py-2">Client</th>
              <th class="text-left px-4 py-2 w-28">Statut</th>
              <th class="text-left px-4 py-2 w-28">Modifié</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="d in documents" :key="d.id"
                @click="openDocument(d)"
                class="border-t border-gray-100 hover:bg-indigo-50/40 cursor-pointer">
              <td class="px-4 py-2.5">
                <span :class="['inline-block px-2 py-0.5 text-[10px] font-medium rounded', KIND_CLASS[d.kind] || 'bg-gray-100 text-gray-600']">
                  {{ KIND_LABEL[d.kind] || d.kind }}
                </span>
              </td>
              <td class="px-4 py-2.5 font-medium text-gray-800">{{ d.project_name }}</td>
              <td class="px-4 py-2.5 text-gray-600">{{ d.client_name || '—' }}</td>
              <td class="px-4 py-2.5 text-xs text-gray-500">
                {{ d.delivered_at ? 'Livré' : (d.status || '—') }}
              </td>
              <td class="px-4 py-2.5 text-xs text-gray-500 whitespace-nowrap">{{ fmtDate(d.updated_at) }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else class="px-4 py-6 text-sm text-gray-500 italic">Aucun document rattaché à ce site.</p>
      </div>

      <!-- Zones -->
      <div class="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
        <div class="px-4 py-2.5 border-b border-gray-100">
          <h2 class="text-sm font-semibold text-gray-700">Zones ({{ zones.length }})</h2>
        </div>
        <table v-if="zones.length" class="w-full text-sm">
          <thead class="bg-gray-50 text-xs uppercase text-gray-500 tracking-wider">
            <tr>
              <th class="text-left px-4 py-2">Nom</th>
              <th class="text-left px-4 py-2">Nature</th>
              <th class="text-left px-4 py-2 w-32">Type</th>
              <th class="text-left px-4 py-2 w-28">Surface (m²)</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="z in zones" :key="z.id" class="border-t border-gray-100">
              <td class="px-4 py-2.5 font-medium text-gray-800">{{ z.name }}</td>
              <td class="px-4 py-2.5 text-gray-600">{{ natureLabel(z.nature) }}</td>
              <td class="px-4 py-2.5">
                <span :class="['inline-block px-2 py-0.5 text-[10px] font-medium rounded',
                               (z.kind || 'functional') === 'technical' ? 'bg-slate-100 text-slate-700' : 'bg-indigo-100 text-indigo-700']">
                  {{ (z.kind || 'functional') === 'technical' ? 'Technique' : 'Fonctionnelle' }}
                </span>
              </td>
              <td class="px-4 py-2.5 text-gray-600">{{ z.surface_m2 || '—' }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else class="px-4 py-6 text-sm text-gray-500 italic">Aucune zone définie.</p>
      </div>
    </template>

    <div v-else class="text-center py-16">
      <p class="text-sm text-gray-500">Site introuvable.</p>
      <router-link to="/sites" class="mt-2 inline-block text-xs text-indigo-600 hover:underline">
        Retour à la liste des sites
      </router-link>
    </div>

    <EditSiteModal
      v-if="showEditSite && site"
      :site="site"
      @close="showEditSite = false"
      @saved="onSiteSaved"
    />
  </div>
</template>
