<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import {
  ArrowLeftIcon, TrashIcon, ArrowDownTrayIcon, ArrowUpTrayIcon,
  ClipboardDocumentIcon, ChartBarIcon, ArrowPathIcon,
} from '@heroicons/vue/24/outline'
import { useWhitepaperStore } from '@/stores/whitepaper'
import { exportWhitepaperPdf } from '@/api'
import { useNotification } from '@/composables/useNotification'
import { useConfirm } from '@/composables/useConfirm'

const route = useRoute()
const router = useRouter()
const store = useWhitepaperStore()
const { whitepaper, loading, publishing, clicks, clicksLoading } = storeToRefs(store)
const { success, error } = useNotification()
const { confirm } = useConfirm()

const exporting = ref(false)
// Cache-buster du <iframe> : incrémenté à chaque clic « Régénérer »
// (et automatiquement après une publication réussie) pour forcer le
// navigateur à recharger un PDF fraîchement généré côté serveur.
const pdfReloadKey = ref(Date.now())
const pdfUrl = computed(() =>
  whitepaper.value ? `/api/whitepapers/${whitepaper.value.id}/preview/pdf?v=${pdfReloadKey.value}` : ''
)
function refreshPdf() { pdfReloadKey.value = Date.now() }

function formatDateTime(s) {
  if (!s) return '—'
  return new Date(s).toLocaleString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}
function formatDay(d) {
  if (!d) return '—'
  return new Date(d + 'T00:00:00').toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })
}

// ── Publication / mise à jour du PDF sur le FTP OVH buildy.fr ───────
const publishedInfo = computed(() => whitepaper.value?.meta?.published || null)

async function publishOnline() {
  const wasPublished = !!publishedInfo.value
  const ok = await confirm({
    title: wasPublished ? 'Mettre à jour la publication ?' : 'Publier ce document en ligne ?',
    message: wasPublished
      ? 'Le PDF en ligne sera remplacé par la version actuelle du document.'
      : 'Le PDF va être généré et mis en ligne sur buildy.fr — il sera accessible publiquement à tous.',
    confirmLabel: wasPublished ? 'Mettre à jour' : 'Publier',
  })
  if (!ok) return
  try {
    await store.publish()
    success(wasPublished ? 'Publication mise à jour' : 'Document publié en ligne')
    refreshPdf()
  } catch (e) {
    error(e.response?.data?.detail || 'Échec de la publication')
  }
}
function copyPublishedUrl() {
  if (!publishedInfo.value?.url) return
  navigator.clipboard?.writeText(publishedInfo.value.url)
  success('Lien copié')
}

// ── Statistiques du lien traçable ───────────────────────────────────
function copyTrackerUrl() {
  if (!whitepaper.value?.tracker_url) return
  navigator.clipboard?.writeText(whitepaper.value.tracker_url)
  success('Lien copié')
}
const maxDayCount = computed(
  () => Math.max(1, ...(clicks.value?.by_day || []).map(d => d.count))
)
function barWidth(count) { return `${Math.round((count / maxDayCount.value) * 100)}%` }
async function refreshClicks() {
  try { await store.refreshClicks(); success('Statistiques à jour') }
  catch (e) { error(e.response?.data?.detail || 'Échec du rafraîchissement') }
}

async function exportPdf() {
  exporting.value = true
  try {
    const { data } = await exportWhitepaperPdf(whitepaper.value.id)
    const url = URL.createObjectURL(data)
    const a = document.createElement('a')
    a.href = url
    a.download = `${whitepaper.value.slug || 'livre-blanc'}.pdf`
    a.click()
    URL.revokeObjectURL(url)
  } catch (e) {
    error(e.response?.data?.detail || 'Échec de l\'export PDF')
  } finally {
    exporting.value = false
  }
}

async function removeWhitepaper() {
  const ok = await confirm({
    title: 'Supprimer ce livre blanc ?',
    message: `« ${whitepaper.value.title} » sera supprimé.`,
    confirmLabel: 'Supprimer', danger: true,
  })
  if (!ok) return
  try {
    await store.remove()
    success('Livre blanc supprimé')
    router.push({ name: 'whitepapers' })
  } catch { error('Échec de la suppression') }
}

onMounted(async () => {
  try { await store.load(parseInt(route.params.id, 10)) }
  catch { error('Livre blanc introuvable'); router.push({ name: 'whitepapers' }) }
})
onBeforeUnmount(() => { store.reset() })

watch(() => route.params.id, async (id) => {
  if (id) {
    try { await store.load(parseInt(id, 10)); refreshPdf() } catch { /* */ }
  }
})
</script>

<template>
  <div v-if="loading && !whitepaper" class="text-center py-16 text-gray-400 text-sm">Chargement…</div>

  <div v-else-if="whitepaper" class="max-w-7xl mx-auto">
    <!-- Toolbar -->
    <div class="flex items-center justify-between gap-4 mb-5">
      <div class="flex items-center gap-3 min-w-0">
        <button @click="router.push({ name: 'whitepapers' })" class="p-1.5 text-gray-400 hover:text-gray-700 shrink-0">
          <ArrowLeftIcon class="w-5 h-5" />
        </button>
        <h1 class="text-xl font-semibold text-gray-800 truncate">{{ whitepaper.title }}</h1>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <button
          @click="refreshPdf"
          class="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 whitespace-nowrap"
          v-tooltip="'Régénérer l\'aperçu PDF'"
        >
          <ArrowPathIcon class="w-4 h-4 shrink-0" />
          Régénérer
        </button>
        <button
          @click="exportPdf"
          :disabled="exporting"
          class="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 whitespace-nowrap"
        >
          <ArrowDownTrayIcon class="w-4 h-4 shrink-0" />
          {{ exporting ? 'Export…' : 'Télécharger' }}
        </button>
        <button
          @click="publishOnline"
          :disabled="publishing"
          class="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg whitespace-nowrap disabled:opacity-50"
          :class="publishedInfo ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-indigo-600 text-white hover:bg-indigo-700'"
        >
          <ArrowUpTrayIcon class="w-4 h-4 shrink-0" />
          {{ publishing ? 'Publication…' : (publishedInfo ? 'Mettre à jour' : 'Publier en ligne') }}
        </button>
        <button @click="removeWhitepaper" class="p-2 text-gray-400 hover:text-red-600" v-tooltip="'Supprimer'">
          <TrashIcon class="w-4 h-4" />
        </button>
      </div>
    </div>

    <!-- Bandeau « en ligne » : URL publique du PDF publié -->
    <div v-if="publishedInfo" class="flex items-center gap-2 mb-5 text-sm min-w-0">
      <span class="inline-flex items-center gap-1.5 font-medium text-emerald-700 shrink-0">
        <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> En ligne
      </span>
      <a :href="publishedInfo.url" target="_blank" rel="noopener"
         class="text-indigo-600 hover:underline truncate">{{ publishedInfo.url }}</a>
      <button @click="copyPublishedUrl" class="text-gray-400 hover:text-gray-700 shrink-0" v-tooltip="'Copier le lien'">
        <ClipboardDocumentIcon class="w-4 h-4" />
      </button>
      <span class="text-gray-400 shrink-0 whitespace-nowrap">· publié le {{ formatDateTime(publishedInfo.at) }}</span>
    </div>

    <!-- Stats de clics (uniquement si publié) -->
    <div v-if="publishedInfo" class="bg-white rounded-lg border border-gray-200 p-5 mb-5">
      <div class="flex items-center justify-between gap-4 mb-4">
        <h2 class="text-base font-semibold text-gray-800 flex items-center gap-2">
          <ChartBarIcon class="w-5 h-5 text-indigo-500 shrink-0" /> Lien traçable &amp; statistiques
        </h2>
        <button
          @click="refreshClicks"
          :disabled="clicksLoading"
          class="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 whitespace-nowrap"
        >
          <ArrowPathIcon class="w-3.5 h-3.5 shrink-0" :class="{ 'animate-spin': clicksLoading }" />
          {{ clicksLoading ? 'Mise à jour…' : 'Rafraîchir' }}
        </button>
      </div>

      <div class="flex items-center gap-2 mb-4 p-3 bg-indigo-50 rounded-lg text-sm min-w-0">
        <span class="font-medium text-indigo-900 shrink-0">À partager :</span>
        <a :href="whitepaper.tracker_url" target="_blank" rel="noopener"
           class="text-indigo-600 hover:underline truncate">{{ whitepaper.tracker_url }}</a>
        <button @click="copyTrackerUrl" class="text-indigo-400 hover:text-indigo-700 shrink-0" v-tooltip="'Copier le lien'">
          <ClipboardDocumentIcon class="w-4 h-4" />
        </button>
      </div>

      <div class="grid grid-cols-3 gap-3 mb-4">
        <div class="rounded-lg bg-gray-50 p-3">
          <div class="text-2xl font-semibold text-gray-800">{{ clicks?.total ?? 0 }}</div>
          <div class="text-xs text-gray-500 mt-0.5">clic{{ (clicks?.total ?? 0) > 1 ? 's' : '' }} au total</div>
        </div>
        <div class="rounded-lg bg-gray-50 p-3">
          <div class="text-2xl font-semibold text-gray-800">{{ clicks?.uniques ?? 0 }}</div>
          <div class="text-xs text-gray-500 mt-0.5">visiteurs uniques</div>
        </div>
        <div class="rounded-lg bg-gray-50 p-3">
          <div class="text-sm font-semibold text-gray-800 leading-tight">{{ clicks?.last_hit_at ? formatDateTime(clicks.last_hit_at) : '—' }}</div>
          <div class="text-xs text-gray-500 mt-0.5">dernière visite</div>
        </div>
      </div>

      <p v-if="!clicks?.total" class="text-sm text-gray-400">
        Aucun clic enregistré pour l'instant. Les statistiques sont actualisées automatiquement chaque jour ; « Rafraîchir » force une mise à jour immédiate.
      </p>
      <div v-else class="grid grid-cols-2 gap-6">
        <div>
          <h3 class="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Activité récente</h3>
          <div class="space-y-1">
            <div v-for="d in clicks.by_day" :key="d.day" class="flex items-center gap-2 text-sm">
              <span class="text-gray-500 w-16 shrink-0">{{ formatDay(d.day) }}</span>
              <div class="flex-1 bg-gray-100 rounded h-2 overflow-hidden">
                <div class="bg-indigo-400 h-full rounded" :style="{ width: barWidth(d.count) }"></div>
              </div>
              <span class="text-gray-700 font-medium w-7 text-right shrink-0">{{ d.count }}</span>
            </div>
          </div>
        </div>
        <div>
          <h3 class="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Provenances</h3>
          <div class="space-y-1.5">
            <div v-for="r in clicks.by_referer" :key="r.source" class="flex items-center justify-between gap-3 text-sm">
              <span class="text-gray-600 truncate">{{ r.source }}</span>
              <span class="text-gray-700 font-medium shrink-0">{{ r.count }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- PDF embarqué (viewer natif du navigateur) -->
    <div class="bg-gray-100 rounded-lg border border-gray-200 overflow-hidden">
      <iframe
        :src="pdfUrl"
        :key="pdfReloadKey"
        class="w-full block"
        style="height: calc(100vh - 220px); min-height: 600px; border: 0;"
        title="Aperçu PDF"
      />
    </div>
  </div>
</template>
