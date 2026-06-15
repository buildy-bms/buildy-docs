<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import {
  ArrowLeftIcon, PlusIcon, TrashIcon, ChevronUpIcon, ChevronDownIcon,
  ArrowDownTrayIcon, ArrowUpTrayIcon, ClipboardDocumentIcon, DocumentTextIcon, BookOpenIcon,
  ChartBarIcon, ArrowPathIcon, EyeIcon,
} from '@heroicons/vue/24/outline'
import { useWhitepaperStore } from '@/stores/whitepaper'
import { exportWhitepaperPdf } from '@/api'
import { useNotification } from '@/composables/useNotification'
import { useConfirm } from '@/composables/useConfirm'
import WhitepaperRichTextEditor from '@/components/WhitepaperRichTextEditor.vue'
import WhitepaperPreviewModal from '@/components/WhitepaperPreviewModal.vue'

const showPreview = ref(false)

const route = useRoute()
const router = useRouter()
const store = useWhitepaperStore()
const { whitepaper, chapters, companions, currentChapter, loading, saving, publishing, clicks, clicksLoading, isCompanion, isHtmlMode, sourceInfo } = storeToRefs(store)

function formatBytes(n) {
  if (!n) return '—'
  return n > 1024 * 1024 ? `${(n / 1048576).toFixed(1)} Mo` : `${Math.round(n / 1024)} Ko`
}
function formatDateTime(s) {
  if (!s) return '—'
  return new Date(s).toLocaleString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}
async function onReplaceHtml(ev) {
  const file = ev.target.files?.[0]
  ev.target.value = ''
  if (!file) return
  try { await store.replaceSourceHtml(file); success('HTML source remplacé') }
  catch (e) { error(e.response?.data?.detail || 'Échec du remplacement') }
}
const { success, error } = useNotification()
const { confirm } = useConfirm()

const exporting = ref(false)
const newChapterTitle = ref('')
const addingChapter = ref(false)

const AUDIENCE_LABELS = {
  property_manager: 'Property manager',
  asset_manager: 'Asset manager',
  moa_moe: 'MOA / MOE / BE',
  exploitant: 'Exploitant',
}

// ── Sauvegarde auto du chapitre (debounce 800ms) ────────────────────
let saveTimer = null
function scheduleSave() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => store.saveCurrentChapter().catch(() => error('Échec de la sauvegarde')), 800)
}
watch(() => currentChapter.value?.body_html, (v, old) => { if (old !== undefined) scheduleSave() })

function onTitleInput() { scheduleSave() }

async function selectChapter(id) {
  clearTimeout(saveTimer)
  await store.saveCurrentChapter().catch(() => {})
  await store.selectChapter(id)
}

async function addChapter() {
  const title = newChapterTitle.value.trim() || `Chapitre ${chapters.value.length + 1}`
  addingChapter.value = true
  try {
    await store.addChapter(title)
    newChapterTitle.value = ''
  } catch {
    error('Échec de l\'ajout du chapitre')
  } finally {
    addingChapter.value = false
  }
}

async function removeChapter(ch) {
  const ok = await confirm({
    title: 'Supprimer ce chapitre ?',
    message: `« ${ch.title} » sera définitivement supprimé.`,
    confirmLabel: 'Supprimer', danger: true,
  })
  if (!ok) return
  try { await store.removeChapter(ch.id); success('Chapitre supprimé') }
  catch { error('Échec de la suppression') }
}

async function move(ch, direction) {
  try { await store.moveChapter(ch.id, direction) }
  catch { error('Échec du déplacement') }
}

async function saveMetaField(field, value) {
  try { await store.saveMeta({ [field]: value }) }
  catch { error('Échec de la mise à jour') }
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
function formatDay(d) {
  if (!d) return '—'
  return new Date(d + 'T00:00:00').toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })
}
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
    message: `« ${whitepaper.value.title} » et ses documents compagnons seront supprimés.`,
    confirmLabel: 'Supprimer', danger: true,
  })
  if (!ok) return
  try {
    await store.remove()
    success('Livre blanc supprimé')
    router.push({ name: 'whitepapers' })
  } catch { error('Échec de la suppression') }
}

function openCompanion(c) {
  router.push({ name: 'whitepaper-detail', params: { id: c.id } })
}

onMounted(async () => {
  try { await store.load(parseInt(route.params.id, 10)) }
  catch { error('Livre blanc introuvable'); router.push({ name: 'whitepapers' }) }
})
onBeforeUnmount(() => { clearTimeout(saveTimer); store.reset() })

// Recharge si on navigue vers un autre livre blanc (compagnon)
watch(() => route.params.id, async (id) => {
  if (id) { try { await store.load(parseInt(id, 10)) } catch { /* */ } }
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
        <input
          :value="whitepaper.title"
          @input="store.whitepaper.title = $event.target.value"
          @change="saveMetaField('title', whitepaper.title)"
          class="text-xl font-semibold text-gray-800 bg-transparent border-0 focus:outline-none focus:ring-0 min-w-0 truncate"
        />
        <span v-if="isCompanion" class="px-2 py-0.5 rounded text-xs font-semibold bg-amber-100 text-amber-700 shrink-0">
          Compagnon
        </span>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <span class="text-xs text-gray-400">{{ saving ? 'Enregistrement…' : 'Tout enregistré' }}</span>
        <button
          @click="showPreview = true"
          class="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 whitespace-nowrap"
          v-tooltip="'Aperçu du PDF dans une modale (Cmd+R pour régénérer après édition)'"
        >
          <EyeIcon class="w-4 h-4 shrink-0" />
          Aperçu PDF
        </button>
        <button
          @click="exportPdf"
          :disabled="exporting"
          class="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 whitespace-nowrap"
        >
          <ArrowDownTrayIcon class="w-4 h-4 shrink-0" />
          {{ exporting ? 'Export…' : 'Export PDF' }}
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
    <div v-if="publishedInfo" class="flex items-center gap-2 -mt-2 mb-5 text-sm min-w-0">
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

    <!-- Lien traçable & statistiques de clics -->
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

      <!-- Lien à partager sur LinkedIn -->
      <div class="flex items-center gap-2 mb-4 p-3 bg-indigo-50 rounded-lg text-sm min-w-0">
        <span class="font-medium text-indigo-900 shrink-0">À partager :</span>
        <a :href="whitepaper.tracker_url" target="_blank" rel="noopener"
           class="text-indigo-600 hover:underline truncate">{{ whitepaper.tracker_url }}</a>
        <button @click="copyTrackerUrl" class="text-indigo-400 hover:text-indigo-700 shrink-0" v-tooltip="'Copier le lien'">
          <ClipboardDocumentIcon class="w-4 h-4" />
        </button>
      </div>

      <!-- Indicateurs -->
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

    <!-- ═══ Mode « HTML brut » (coffre) ═══ -->
    <div v-if="isHtmlMode" class="flex gap-5 items-start">
      <main class="flex-1 min-w-0 bg-white rounded-lg border border-gray-200 p-6">
        <div class="flex items-start gap-3">
          <div class="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center shrink-0">
            <BookOpenIcon class="w-5 h-5 text-indigo-500" />
          </div>
          <div>
            <h2 class="text-base font-semibold text-gray-800">Document géré en HTML</h2>
            <p class="text-sm text-gray-500 mt-1 leading-relaxed max-w-xl">
              Ce livre blanc est stocké sous forme de HTML/CSS exact. Le PDF exporté est
              fidèle au pixel à la source. Le contenu s'édite hors de l'application
              (dans un éditeur de code) puis se remet à jour ici en remplaçant le fichier.
            </p>
          </div>
        </div>

        <dl class="mt-5 grid grid-cols-2 gap-x-8 gap-y-3 text-sm max-w-md">
          <dt class="text-gray-500">Fichier source</dt>
          <dd class="text-gray-800 font-medium">source.html</dd>
          <dt class="text-gray-500">Taille</dt>
          <dd class="text-gray-800">{{ formatBytes(sourceInfo?.size_bytes) }}</dd>
          <dt class="text-gray-500">Dernière mise à jour</dt>
          <dd class="text-gray-800">{{ formatDateTime(sourceInfo?.updated_at) }}</dd>
        </dl>

        <div class="mt-6 flex items-center gap-3">
          <label class="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer whitespace-nowrap">
            <ArrowDownTrayIcon class="w-4 h-4 shrink-0 rotate-180" />
            Remplacer le HTML
            <input type="file" accept=".html,text/html" class="hidden" @change="onReplaceHtml" />
          </label>
          <span class="text-xs text-gray-400">Charge un nouveau fichier .html exporté depuis ton éditeur.</span>
        </div>
      </main>

      <!-- Métadonnées + compagnons -->
      <aside class="w-72 shrink-0 space-y-4">
        <div class="bg-white rounded-lg border border-gray-200 p-3 space-y-3">
          <div class="text-xs font-semibold uppercase tracking-wider text-gray-500">Métadonnées</div>
          <div>
            <label class="block text-xs font-medium text-gray-500 mb-1">Audience</label>
            <select
              :value="whitepaper.audience || ''"
              @change="saveMetaField('audience', $event.target.value || null)"
              class="w-full px-2 py-1.5 border border-gray-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
            >
              <option value="">Non précisée</option>
              <option v-for="(label, key) in AUDIENCE_LABELS" :key="key" :value="key">{{ label }}</option>
            </select>
          </div>
          <div>
            <label class="block text-xs font-medium text-gray-500 mb-1">Version</label>
            <input
              :value="whitepaper.version || ''"
              @change="saveMetaField('version', $event.target.value || null)"
              type="text" placeholder="1.0"
              class="w-full px-2 py-1.5 border border-gray-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
            />
          </div>
          <div class="text-xs text-gray-400">Slug : <code class="text-gray-500">{{ whitepaper.slug }}</code></div>
        </div>
        <div v-if="!isCompanion" class="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div class="px-3 py-2 border-b border-gray-100 text-xs font-semibold uppercase tracking-wider text-gray-500">
            Documents compagnons
          </div>
          <ul>
            <li
              v-for="c in companions" :key="c.id" @click="openCompanion(c)"
              class="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 cursor-pointer border-b border-gray-50 last:border-0"
            >
              <DocumentTextIcon class="w-4 h-4 text-gray-400 shrink-0" />
              <span class="truncate">{{ c.title }}</span>
            </li>
            <li v-if="!companions.length" class="px-3 py-3 text-xs text-gray-400">Aucun compagnon.</li>
          </ul>
        </div>
      </aside>
    </div>

    <!-- ═══ Mode « chapitres » (Tiptap) ═══ -->
    <div v-else class="flex gap-5 items-start">
      <!-- Sidebar gauche -->
      <aside class="w-72 shrink-0 space-y-4">
        <!-- Chapitres -->
        <div class="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div class="px-3 py-2 border-b border-gray-100 text-xs font-semibold uppercase tracking-wider text-gray-500">
            Chapitres
          </div>
          <ul>
            <li
              v-for="(ch, i) in chapters"
              :key="ch.id"
              @click="selectChapter(ch.id)"
              class="group flex items-center gap-1.5 px-3 py-2 text-sm cursor-pointer border-b border-gray-50 last:border-0"
              :class="currentChapter?.id === ch.id ? 'bg-indigo-50 text-indigo-700' : 'text-gray-700 hover:bg-gray-50'"
            >
              <span class="flex-1 truncate">{{ ch.title }}</span>
              <span v-if="ch.is_empty" class="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" v-tooltip="'Vide'" />
              <span class="hidden group-hover:flex items-center gap-0.5 shrink-0">
                <button v-if="i > 0" @click.stop="move(ch, 'up')" class="p-0.5 text-gray-400 hover:text-gray-700">
                  <ChevronUpIcon class="w-3.5 h-3.5" />
                </button>
                <button v-if="i < chapters.length - 1" @click.stop="move(ch, 'down')" class="p-0.5 text-gray-400 hover:text-gray-700">
                  <ChevronDownIcon class="w-3.5 h-3.5" />
                </button>
                <button @click.stop="removeChapter(ch)" class="p-0.5 text-gray-400 hover:text-red-600">
                  <TrashIcon class="w-3.5 h-3.5" />
                </button>
              </span>
            </li>
            <li v-if="!chapters.length" class="px-3 py-3 text-xs text-gray-400">Aucun chapitre.</li>
          </ul>
          <div class="flex gap-1.5 p-2 border-t border-gray-100">
            <input
              v-model="newChapterTitle"
              @keydown.enter="addChapter"
              type="text"
              placeholder="Titre du chapitre…"
              class="flex-1 min-w-0 px-2 py-1.5 border border-gray-200 rounded text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
            />
            <button
              @click="addChapter"
              :disabled="addingChapter"
              class="p-1.5 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50 shrink-0"
            >
              <PlusIcon class="w-4 h-4" />
            </button>
          </div>
        </div>

        <!-- Métadonnées -->
        <div class="bg-white rounded-lg border border-gray-200 p-3 space-y-3">
          <div class="text-xs font-semibold uppercase tracking-wider text-gray-500">Métadonnées</div>
          <div>
            <label class="block text-xs font-medium text-gray-500 mb-1">Audience</label>
            <select
              :value="whitepaper.audience || ''"
              @change="saveMetaField('audience', $event.target.value || null)"
              class="w-full px-2 py-1.5 border border-gray-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
            >
              <option value="">Non précisée</option>
              <option v-for="(label, key) in AUDIENCE_LABELS" :key="key" :value="key">{{ label }}</option>
            </select>
          </div>
          <div>
            <label class="block text-xs font-medium text-gray-500 mb-1">Version</label>
            <input
              :value="whitepaper.version || ''"
              @change="saveMetaField('version', $event.target.value || null)"
              type="text" placeholder="1.0"
              class="w-full px-2 py-1.5 border border-gray-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
            />
          </div>
          <div class="text-xs text-gray-400">
            Slug : <code class="text-gray-500">{{ whitepaper.slug }}</code>
          </div>
        </div>

        <!-- Compagnons (parent uniquement) -->
        <div v-if="!isCompanion" class="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div class="px-3 py-2 border-b border-gray-100 text-xs font-semibold uppercase tracking-wider text-gray-500">
            Documents compagnons
          </div>
          <ul>
            <li
              v-for="c in companions"
              :key="c.id"
              @click="openCompanion(c)"
              class="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 cursor-pointer border-b border-gray-50 last:border-0"
            >
              <DocumentTextIcon class="w-4 h-4 text-gray-400 shrink-0" />
              <span class="truncate">{{ c.title }}</span>
            </li>
            <li v-if="!companions.length" class="px-3 py-3 text-xs text-gray-400">
              Aucun compagnon. Les checklists et infographies liées apparaîtront ici.
            </li>
          </ul>
        </div>
      </aside>

      <!-- Éditeur central -->
      <main class="flex-1 min-w-0 bg-white rounded-lg border border-gray-200 p-6">
        <div v-if="currentChapter">
          <input
            v-model="currentChapter.title"
            @input="onTitleInput"
            placeholder="Titre du chapitre"
            class="w-full text-2xl font-semibold text-gray-800 bg-transparent border-0 border-b border-transparent focus:border-gray-200 focus:outline-none focus:ring-0 pb-2 mb-4"
          />
          <WhitepaperRichTextEditor
            v-model="currentChapter.body_html"
            placeholder="Rédigez le contenu du chapitre…"
            min-height="420px"
          />
        </div>
        <div v-else class="text-center py-20 text-gray-400">
          <BookOpenIcon class="w-12 h-12 mx-auto mb-3 text-gray-300" />
          <p class="text-sm">Sélectionnez un chapitre ou créez-en un pour commencer.</p>
        </div>
      </main>
    </div>

    <!-- Modale d'aperçu PDF (iframe blob, viewer PDF natif du navigateur) -->
    <WhitepaperPreviewModal
      v-if="showPreview && whitepaper?.id"
      :id="whitepaper.id"
      :title="`Aperçu PDF — ${whitepaper.title || 'Livre blanc'}`"
      @close="showPreview = false"
    />
  </div>
</template>
