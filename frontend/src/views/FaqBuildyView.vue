<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  ChatBubbleLeftRightIcon, Cog6ToothIcon, ArrowDownTrayIcon, SparklesIcon,
  PlusIcon, ArrowUpOnSquareIcon, PencilSquareIcon, TrashIcon, CheckCircleIcon,
  ExclamationTriangleIcon, MagnifyingGlassIcon, XMarkIcon, ArrowPathIcon,
} from '@heroicons/vue/24/outline'
import { useFaqStore } from '@/stores/faq'
import { useNotification } from '@/composables/useNotification'
import { useConfirm } from '@/composables/useConfirm'
import { useTableSort } from '@/composables/useTableSort'
import BaseModal from '@/components/BaseModal.vue'
import FaqCategoryNode from '@/components/FaqCategoryNode.vue'

const router = useRouter()
const store = useFaqStore()
const { success, error: notifyError, info } = useNotification()
const { confirm } = useConfirm()

const settingsOpen = ref(false)
const searchQuery = ref('')
const statusFilter = ref('')
// Filtre par niveau de score SEO. Permet de filtrer rapidement les articles
// à retravailler (< 60) ou les bons exemples (>= 80) sans regarder chaque ligne.
const seoFilter = ref('') // '' | 'low' (<60) | 'mid' (60-79) | 'high' (>=80) | 'none' (jamais score)
// Sync biblio -> FAQ (Lot 138) : filtre rapide pour ne voir que les articles
// générés depuis la bibliothèque de fonctionnalités.
const onlyLibrarySource = ref(false)
// Tri par colonne (Titre / Catégorie / Statut / SEO / Sync) — sticky 3-state.
const { sortKey, sortDir, toggleSort, sortedRows } = useTableSort('updated_at', 'desc')
const showSuggestions = ref(false)
const suggestions = ref([])
const loadingSuggestions = ref(false)

const generateModalOpen = ref(false)
const generateQuestion = ref('')
const generateCategoryId = ref(null)
const generating = ref(false)

const categoryModalOpen = ref(false)
const categoryDraft = ref({ id: null, name: '', description: '', color: '', parent_id: null })

const settingsDraft = ref({
  api_identifier: '',
  api_key: '',
  website_id: '',
  default_locale: 'fr',
})
const savingSettings = ref(false)
const testingConnection = ref(false)
const testResult = ref(null)

// ── Categories tree ──
const categoryTree = computed(() => {
  const map = new Map()
  for (const c of store.categories) map.set(c.id, { ...c, children: [] })
  const roots = []
  for (const node of map.values()) {
    if (node.parent_id && map.has(node.parent_id)) {
      map.get(node.parent_id).children.push(node)
    } else {
      roots.push(node)
    }
  }
  const sortFn = (a, b) => (a.order_index || 0) - (b.order_index || 0) || a.name.localeCompare(b.name)
  roots.sort(sortFn)
  for (const node of map.values()) node.children.sort(sortFn)
  return roots
})

function sortValueForArticle(a, key) {
  if (key === 'title') return (a.title || '').toLowerCase()
  if (key === 'category_name') return (a.category_name || '').toLowerCase()
  if (key === 'status') return a.status || ''
  if (key === 'seo_score') return a.seo_score == null ? -1 : a.seo_score
  // Sync : on prend la date la plus pertinente (pushed_at sinon updated_at).
  if (key === 'sync') return a.pushed_at || a.updated_at || ''
  if (key === 'updated_at') return a.updated_at || ''
  return ''
}

const filteredArticles = computed(() => {
  let arr = store.articles
  if (statusFilter.value) arr = arr.filter((a) => a.status === statusFilter.value)
  if (onlyLibrarySource.value) arr = arr.filter((a) => !!a.source_section_template_id)
  if (seoFilter.value === 'low') arr = arr.filter((a) => a.seo_score != null && a.seo_score < 60)
  else if (seoFilter.value === 'mid') arr = arr.filter((a) => a.seo_score != null && a.seo_score >= 60 && a.seo_score < 80)
  else if (seoFilter.value === 'high') arr = arr.filter((a) => a.seo_score != null && a.seo_score >= 80)
  else if (seoFilter.value === 'none') arr = arr.filter((a) => a.seo_score == null)
  return sortedRows(arr, sortValueForArticle)
})

const activeFilterCount = computed(() => {
  let n = 0
  if (statusFilter.value) n++
  if (seoFilter.value) n++
  if (onlyLibrarySource.value) n++
  if (searchQuery.value) n++
  if (store.selectedCategoryId) n++
  return n
})

function clearAllFilters() {
  searchQuery.value = ''
  statusFilter.value = ''
  seoFilter.value = ''
  onlyLibrarySource.value = false
  store.selectedCategoryId = null
}

const credentialsConfigured = computed(() => store.settings?.has_credentials || false)
const lastPullLabel = computed(() => {
  if (!store.settings?.last_pull_at) return null
  const d = new Date(store.settings.last_pull_at)
  return d.toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })
})

function relativeTime(iso) {
  if (!iso) return ''
  const ms = Date.now() - new Date(iso).getTime()
  const m = Math.round(ms / 60000)
  if (m < 1) return 'à l\'instant'
  if (m < 60) return `${m} min`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h`
  const d = Math.round(h / 24)
  return `${d} j`
}

// ── Lifecycle ──
onMounted(async () => {
  await store.loadSettings()
  await store.loadCategories()
  await store.loadArticles()
  if (!credentialsConfigured.value) settingsOpen.value = true
})

let watcherDebounce = null
watch([() => store.selectedCategoryId, statusFilter, searchQuery], () => {
  clearTimeout(watcherDebounce)
  watcherDebounce = setTimeout(async () => {
    await store.loadArticles({
      categoryId: store.selectedCategoryId,
      status: statusFilter.value || null,
      q: searchQuery.value || null,
    })
  }, 250)
})

// ── Settings ──
async function saveSettings() {
  if (!settingsDraft.value.api_identifier || !settingsDraft.value.api_key || !settingsDraft.value.website_id) {
    notifyError('Tous les champs sont requis')
    return
  }
  savingSettings.value = true
  try {
    await store.saveSettings(settingsDraft.value)
    success('Paramètres Crisp enregistrés')
    settingsDraft.value = { api_identifier: '', api_key: '', website_id: '', default_locale: 'fr' }
    if (credentialsConfigured.value) settingsOpen.value = false
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Échec de l\'enregistrement')
  } finally {
    savingSettings.value = false
  }
}

async function testConnection() {
  testingConnection.value = true
  testResult.value = null
  try {
    const r = await store.testConnection()
    testResult.value = r
    if (r.ok) success('Connexion Crisp OK')
    else notifyError(r.error || 'Échec de la connexion')
  } catch (e) {
    notifyError(e.message)
    testResult.value = { ok: false, error: e.message }
  } finally {
    testingConnection.value = false
  }
}

// ── Pull / Sync ──
async function pull() {
  try {
    const result = await store.pullFromCrisp()
    const { categories, articles } = result.pulled
    if (result.conflicts?.length) {
      info(`${categories} catégorie(s), ${articles} article(s) synchronisés. ${result.conflicts.length} conflit(s) détecté(s).`)
    } else {
      success(`${categories} catégorie(s), ${articles} article(s) synchronisés depuis Crisp`)
    }
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Échec de la synchronisation')
  }
}

// ── Categories ──
function openCategoryModal(parentId = null, existing = null) {
  if (existing) {
    categoryDraft.value = {
      id: existing.id,
      name: existing.name,
      description: existing.description || '',
      color: existing.color || '',
      parent_id: existing.parent_id || null,
    }
  } else {
    categoryDraft.value = {
      id: null,
      name: '',
      description: '',
      color: '',
      parent_id: parentId,
    }
  }
  categoryModalOpen.value = true
}

async function saveCategory() {
  if (!categoryDraft.value.name) {
    notifyError('Nom requis')
    return
  }
  try {
    const payload = {
      name: categoryDraft.value.name,
      description: categoryDraft.value.description || null,
      color: categoryDraft.value.color || null,
      parent_id: categoryDraft.value.parent_id || null,
    }
    if (categoryDraft.value.id) {
      await store.updateCategory(categoryDraft.value.id, payload)
    } else {
      await store.createCategory(payload)
    }
    categoryModalOpen.value = false
    success('Catégorie enregistrée')
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Échec')
  }
}

async function pushCategory(cat) {
  try {
    await store.pushCategory(cat.id)
    success(`Catégorie « ${cat.name} » publiée vers Crisp`)
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Échec du push')
  }
}

async function deleteCategory(cat) {
  const articleCount = store.articles.filter((a) => a.category_id === cat.id).length
  const ok = await confirm({
    title: 'Supprimer cette catégorie ?',
    message: articleCount > 0
      ? `La catégorie contient ${articleCount} article(s). Ils ne seront pas supprimés mais détachés. Continuer ?`
      : `La catégorie « ${cat.name} » sera supprimée localement et sur Crisp. Confirmer ?`,
    confirmLabel: 'Supprimer',
    danger: true,
  })
  if (!ok) return
  try {
    await store.removeCategory(cat.id, { force: articleCount > 0 })
    if (store.selectedCategoryId === cat.id) store.selectedCategoryId = null
    success('Catégorie supprimée')
  } catch (e) {
    if (e.response?.status === 409) {
      const force = await confirm({
        title: 'La suppression Crisp a échoué',
        message: e.response.data?.detail + ' Supprimer uniquement en local ?',
        confirmLabel: 'Forcer en local',
        danger: true,
      })
      if (force) {
        await store.removeCategory(cat.id, { force: true })
        success('Catégorie supprimée en local')
      }
    } else {
      notifyError(e.response?.data?.detail || 'Échec')
    }
  }
}

// ── Articles ──
function openArticle(article) {
  router.push(`/faq/articles/${article.id}`)
}
async function newArticle() {
  try {
    const created = await store.createArticle({
      title: 'Nouvel article',
      content_html: '<p></p>',
      category_id: store.selectedCategoryId || null,
      status: 'draft',
      locale: store.settings?.default_locale || 'fr',
    })
    router.push(`/faq/articles/${created.id}`)
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Échec')
  }
}
async function pushArticle(article) {
  try {
    await store.pushArticle(article.id)
    success(`Article « ${article.title} » publié vers Crisp`)
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Échec du push')
  }
}
async function deleteArticle(article) {
  const ok = await confirm({
    title: 'Supprimer cet article ?',
    message: `« ${article.title} » sera supprimé en local et sur Crisp.`,
    confirmLabel: 'Supprimer',
    danger: true,
  })
  if (!ok) return
  try {
    await store.removeArticle(article.id)
    success('Article supprimé')
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Échec')
  }
}

// ── IA ──
async function runSuggestMissing() {
  loadingSuggestions.value = true
  showSuggestions.value = true
  try {
    const r = await store.aiSuggestMissing()
    suggestions.value = r.suggestions || []
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Échec')
  } finally {
    loadingSuggestions.value = false
  }
}

async function createFromSuggestion(s) {
  try {
    const created = await store.createArticle({
      title: s.title,
      content_html: `<p>${s.rationale || ''}</p>`,
      category_id: store.selectedCategoryId || null,
      status: 'draft',
    })
    showSuggestions.value = false
    router.push(`/faq/articles/${created.id}`)
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Échec')
  }
}

async function runGenerate() {
  if (!generateQuestion.value.trim()) {
    notifyError('Question requise')
    return
  }
  generating.value = true
  try {
    const r = await store.aiGenerate(generateQuestion.value, generateCategoryId.value)
    const created = await store.createArticle({
      title: r.suggested_title || 'Article IA',
      content_html: r.html || '<p></p>',
      category_id: generateCategoryId.value,
      status: 'draft',
    })
    generateModalOpen.value = false
    generateQuestion.value = ''
    router.push(`/faq/articles/${created.id}`)
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Échec')
  } finally {
    generating.value = false
  }
}

function selectCategory(id) {
  store.selectedCategoryId = id
}
</script>

<template>
  <div class="max-w-screen-2xl mx-auto">
    <div class="mb-6 flex items-start justify-between gap-4 flex-wrap">
      <div>
        <h1 class="text-2xl font-semibold text-gray-800 inline-flex items-center gap-2">
          <ChatBubbleLeftRightIcon class="w-6 h-6 text-indigo-600" />
          FAQ Buildy
        </h1>
        <p class="text-sm text-gray-500 mt-1">
          Gestion de la base de connaissance Crisp avec assistance IA. Synchronisation manuelle après validation.
        </p>
      </div>
      <div class="flex items-center gap-2 flex-wrap">
        <button v-if="credentialsConfigured" @click="pull" :disabled="store.loadingPull"
                class="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-gray-200 hover:bg-gray-50 transition whitespace-nowrap disabled:opacity-50">
          <ArrowDownTrayIcon class="w-4 h-4 shrink-0" :class="store.loadingPull ? 'animate-pulse' : ''" />
          {{ store.loadingPull ? 'Synchronisation…' : 'Pull depuis Crisp' }}
        </button>
        <button @click="settingsOpen = !settingsOpen"
                class="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-gray-200 hover:bg-gray-50 transition whitespace-nowrap">
          <Cog6ToothIcon class="w-4 h-4 shrink-0" />
          Paramètres Crisp
        </button>
      </div>
    </div>

    <!-- Bandeau settings collapsible -->
    <div v-if="settingsOpen" class="mb-6 bg-white border border-gray-200 rounded-lg p-5">
      <div class="flex items-center justify-between mb-4">
        <h2 class="font-medium text-gray-800">Connexion à Crisp Helpdesk</h2>
        <button v-if="credentialsConfigured" @click="settingsOpen = false" class="p-1 hover:bg-gray-100 rounded shrink-0">
          <XMarkIcon class="w-5 h-5 text-gray-400" />
        </button>
      </div>
      <p class="text-sm text-gray-500 mb-4">
        Les credentials sont chiffrés en base via AES-256-GCM. Génère un <strong>Website Token</strong> dans Crisp :
        <em>Settings → Workspace Settings → Advanced configuration → API Token → Generate Token</em>.
        Limité à 10 000 requêtes/jour, accès au seul workspace cible.
        Le Website ID est dans l'URL du dashboard Crisp : <code>app.crisp.chat/website/&lt;website_id&gt;/...</code>.
      </p>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Token Identifier</label>
          <input v-model="settingsDraft.api_identifier" type="text"
                 class="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition" />
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Token Key</label>
          <input v-model="settingsDraft.api_key" type="password"
                 class="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition" />
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Website ID</label>
          <input v-model="settingsDraft.website_id" type="text"
                 class="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition" />
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Locale par défaut</label>
          <input v-model="settingsDraft.default_locale" type="text" placeholder="fr"
                 class="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition" />
        </div>
      </div>
      <div v-if="testResult" class="mt-3 text-sm" :class="testResult.ok ? 'text-emerald-600' : 'text-red-600'">
        <CheckCircleIcon v-if="testResult.ok" class="inline w-4 h-4 mr-1" />
        <ExclamationTriangleIcon v-else class="inline w-4 h-4 mr-1" />
        {{ testResult.ok ? 'Connexion réussie' : (testResult.error || 'Échec de la connexion') }}
      </div>
      <div class="mt-4 flex items-center gap-2 flex-wrap">
        <button @click="saveSettings" :disabled="savingSettings"
                class="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition whitespace-nowrap disabled:opacity-50">
          {{ savingSettings ? 'Enregistrement…' : 'Enregistrer' }}
        </button>
        <button v-if="credentialsConfigured" @click="testConnection" :disabled="testingConnection"
                class="px-4 py-2 text-sm rounded-lg border border-gray-200 hover:bg-gray-50 transition whitespace-nowrap disabled:opacity-50">
          {{ testingConnection ? 'Test…' : 'Tester la connexion' }}
        </button>
        <span v-if="lastPullLabel" class="text-xs text-gray-500 ml-auto">
          Dernier pull : {{ lastPullLabel }}
          <span v-if="store.settings?.last_pull_status === 'error'" class="text-red-600">(échec)</span>
        </span>
      </div>
    </div>

    <!-- Layout 2 colonnes : arbre + table -->
    <div class="grid grid-cols-12 gap-6">
      <!-- Sidebar arbre catégories -->
      <aside class="col-span-12 md:col-span-3">
        <div class="bg-white border border-gray-200 rounded-lg p-4 sticky top-4">
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-sm font-semibold text-gray-700">Catégories</h3>
            <button @click="openCategoryModal()" class="p-1 hover:bg-gray-100 rounded shrink-0" v-tooltip="'Nouvelle catégorie'">
              <PlusIcon class="w-4 h-4 text-gray-500" />
            </button>
          </div>

          <button @click="selectCategory(null)"
                  :class="['w-full text-left px-2 py-1.5 rounded text-sm transition',
                           store.selectedCategoryId === null ? 'bg-indigo-50 text-indigo-700 font-medium' : 'hover:bg-gray-50 text-gray-700']">
            Tous les articles
            <span class="text-xs text-gray-400 ml-1">({{ store.articles.length }})</span>
          </button>

          <ul class="mt-2 space-y-0.5">
            <li v-for="cat in categoryTree" :key="cat.id">
              <FaqCategoryNode :category="cat" :selected="store.selectedCategoryId"
                               @select="selectCategory" @edit="(c) => openCategoryModal(null, c)"
                               @push="pushCategory" @delete="deleteCategory"
                               @new-child="(parentId) => openCategoryModal(parentId, null)" />
            </li>
          </ul>

          <div class="mt-4 pt-4 border-t border-gray-100 space-y-2">
            <button @click="runSuggestMissing"
                    class="w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-sm rounded-lg border border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100 transition whitespace-nowrap">
              <SparklesIcon class="w-4 h-4 shrink-0" />
              Suggestions IA
            </button>
            <button @click="generateModalOpen = true"
                    class="w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-sm rounded-lg border border-gray-200 hover:bg-gray-50 transition whitespace-nowrap">
              <SparklesIcon class="w-4 h-4 shrink-0" />
              Générer depuis une question
            </button>
          </div>
        </div>
      </aside>

      <!-- Liste articles -->
      <main class="col-span-12 md:col-span-9">
        <div class="bg-white border border-gray-200 rounded-lg">
          <div class="p-4 border-b border-gray-100 flex items-center gap-3 flex-wrap">
            <div class="relative flex-1 min-w-50">
              <MagnifyingGlassIcon class="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input v-model="searchQuery" type="text" placeholder="Rechercher dans les articles…"
                     class="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition" />
            </div>
            <select v-model="statusFilter"
                    class="px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition text-sm">
              <option value="">Tous les statuts</option>
              <option value="draft">Brouillons</option>
              <option value="published">Publiés</option>
            </select>
            <select v-model="seoFilter"
                    class="px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition text-sm"
                    title="Filtrer par tranche de score SEO">
              <option value="">Tous les scores SEO</option>
              <option value="low">À améliorer (&lt; 60)</option>
              <option value="mid">Moyen (60-79)</option>
              <option value="high">Bons (≥ 80)</option>
              <option value="none">Non scorés</option>
            </select>
            <label class="inline-flex items-center gap-2 text-xs text-gray-600 cursor-pointer whitespace-nowrap"
                   title="Filtrer pour ne voir que les articles générés depuis la bibliothèque de fonctionnalités">
              <input v-model="onlyLibrarySource" type="checkbox"
                     class="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500/30" />
              Depuis biblio
            </label>
            <button v-if="activeFilterCount > 0" @click="clearAllFilters"
                    class="inline-flex items-center gap-1 px-2 py-1 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded transition whitespace-nowrap"
                    title="Effacer tous les filtres">
              <XMarkIcon class="w-3.5 h-3.5 shrink-0" />
              Effacer ({{ activeFilterCount }})
            </button>
            <button @click="newArticle"
                    class="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition whitespace-nowrap">
              <PlusIcon class="w-4 h-4 shrink-0" />
              Nouvel article
            </button>
          </div>

          <table class="w-full text-sm">
            <thead class="bg-gray-50 text-xs uppercase tracking-wider text-gray-500">
              <tr>
                <th @click="toggleSort('title')"
                    class="text-left px-4 py-2 font-medium cursor-pointer hover:bg-gray-100 transition select-none">
                  Titre <span class="ml-1 opacity-60">{{ sortKey === 'title' ? (sortDir === 'asc' ? '↑' : '↓') : '↕' }}</span>
                </th>
                <th @click="toggleSort('category_name')"
                    class="text-left px-4 py-2 font-medium whitespace-nowrap cursor-pointer hover:bg-gray-100 transition select-none">
                  Catégorie <span class="ml-1 opacity-60">{{ sortKey === 'category_name' ? (sortDir === 'asc' ? '↑' : '↓') : '↕' }}</span>
                </th>
                <th @click="toggleSort('status')"
                    class="text-left px-4 py-2 font-medium whitespace-nowrap cursor-pointer hover:bg-gray-100 transition select-none">
                  Statut <span class="ml-1 opacity-60">{{ sortKey === 'status' ? (sortDir === 'asc' ? '↑' : '↓') : '↕' }}</span>
                </th>
                <th @click="toggleSort('seo_score')"
                    v-tooltip="'Score SEO recalculé à chaque enregistrement, génération ou pull. ≥ 80 vert · 60-79 ambre · < 60 rouge.'"
                    class="text-left px-4 py-2 font-medium whitespace-nowrap cursor-pointer hover:bg-gray-100 transition select-none">
                  SEO <span class="ml-1 opacity-60">{{ sortKey === 'seo_score' ? (sortDir === 'asc' ? '↑' : '↓') : '↕' }}</span>
                </th>
                <th @click="toggleSort('sync')"
                    class="text-left px-4 py-2 font-medium whitespace-nowrap cursor-pointer hover:bg-gray-100 transition select-none">
                  Sync <span class="ml-1 opacity-60">{{ sortKey === 'sync' ? (sortDir === 'asc' ? '↑' : '↓') : '↕' }}</span>
                </th>
                <th class="text-right px-4 py-2 font-medium whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="a in filteredArticles" :key="a.id"
                  class="border-t border-gray-100 hover:bg-gray-50 transition cursor-pointer"
                  @click="openArticle(a)">
                <td class="px-4 py-3">
                  <div class="font-medium text-gray-800 inline-flex items-center gap-2">
                    {{ a.title }}
                    <span v-if="a.dirty" class="w-2 h-2 rounded-full bg-orange-400" v-tooltip="'Modifié localement, non publié'" />
                  </div>
                </td>
                <td class="px-4 py-3 text-gray-600 whitespace-nowrap">{{ a.category_name || '—' }}</td>
                <td class="px-4 py-3 whitespace-nowrap">
                  <span v-if="a.status === 'published'" class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 text-xs">
                    <CheckCircleIcon class="w-3 h-3 shrink-0" /> Publié
                  </span>
                  <span v-else class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-gray-100 text-gray-600 text-xs">
                    Brouillon
                  </span>
                </td>
                <td class="px-4 py-3 whitespace-nowrap">
                  <span v-if="a.seo_score === null || a.seo_score === undefined"
                        class="text-xs text-gray-400">—</span>
                  <span v-else
                        :class="[
                          'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium tabular-nums',
                          a.seo_score >= 80 ? 'bg-emerald-50 text-emerald-700' :
                          a.seo_score >= 60 ? 'bg-amber-50 text-amber-700' :
                          'bg-red-50 text-red-700',
                        ]">
                    {{ a.seo_score }}/100
                  </span>
                </td>
                <td class="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                  <span v-if="a.dirty" class="text-orange-600">À publier</span>
                  <span v-else-if="a.pushed_at">Publié il y a {{ relativeTime(a.pushed_at) }}</span>
                  <span v-else-if="a.crisp_id">Lu depuis Crisp</span>
                  <span v-else class="text-gray-400">Local uniquement</span>
                </td>
                <td class="px-4 py-3 text-right whitespace-nowrap" @click.stop>
                  <div class="inline-flex items-center gap-1">
                    <button v-if="a.dirty" @click="pushArticle(a)" class="p-1.5 hover:bg-emerald-50 text-emerald-600 rounded transition"
                            v-tooltip="'Publier vers Crisp'" :aria-label="`Publier « ${a.title} » vers Crisp`">
                      <ArrowUpOnSquareIcon class="w-4 h-4" />
                    </button>
                    <button @click="openArticle(a)" class="p-1.5 hover:bg-gray-100 text-gray-600 rounded transition"
                            v-tooltip="'Éditer'" :aria-label="`Éditer « ${a.title} »`">
                      <PencilSquareIcon class="w-4 h-4" />
                    </button>
                    <button @click="deleteArticle(a)" class="p-1.5 hover:bg-red-50 text-red-500 rounded transition"
                            v-tooltip="'Supprimer'" :aria-label="`Supprimer « ${a.title} »`">
                      <TrashIcon class="w-4 h-4" />
                    </button>
                  </div>
                </td>
              </tr>
              <tr v-if="!filteredArticles.length">
                <td colspan="6" class="px-4 py-12 text-center text-sm text-gray-400">
                  Aucun article. Configurez Crisp puis lancez un pull, ou créez un article manuellement.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </main>
    </div>

    <!-- Modale catégorie -->
    <BaseModal v-if="categoryModalOpen" size="md" :dismiss-on-backdrop="false"
               @close="categoryModalOpen = false"
               :title="categoryDraft.id ? 'Modifier la catégorie' : 'Nouvelle catégorie'">
      <div class="space-y-5">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1.5">Nom</label>
          <input v-model="categoryDraft.name" type="text" placeholder="Ex. : Premiers pas"
                 class="w-full px-3.5 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition" />
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1.5">Description</label>
          <textarea v-model="categoryDraft.description" rows="3" placeholder="Une phrase courte qui résume le contenu de la catégorie."
                    class="w-full px-3.5 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition resize-y" />
        </div>
        <div class="flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
          <button @click="categoryModalOpen = false"
                  class="px-4 py-2 text-sm font-medium text-gray-700 rounded-lg hover:bg-gray-100 transition whitespace-nowrap">
            Annuler
          </button>
          <button @click="saveCategory"
                  class="px-4 py-2 text-sm font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition whitespace-nowrap shadow-sm">
            Enregistrer
          </button>
        </div>
      </div>
    </BaseModal>

    <!-- Modale "Générer depuis une question" -->
    <BaseModal v-if="generateModalOpen" size="lg" :dismiss-on-backdrop="false"
               @close="generateModalOpen = false" :title="'Générer un article depuis une question'">
      <div class="space-y-5">
        <p class="text-sm text-gray-500 -mt-1">
          L'IA s'appuie sur le corpus Buildy (sections, équipements, fonctionnalités) pour produire un article cohérent en français professionnel.
        </p>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1.5">Quelle question veux-tu documenter ?</label>
          <textarea v-model="generateQuestion" rows="4"
                    placeholder="Comment configurer une alerte sur un compteur ?"
                    class="w-full px-3.5 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition resize-y" />
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1.5">Catégorie cible <span class="text-gray-400 font-normal">(optionnel)</span></label>
          <select v-model="generateCategoryId"
                  class="w-full px-3.5 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition bg-white">
            <option :value="null">— Aucune —</option>
            <option v-for="c in store.categories" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </div>
        <div class="flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
          <button @click="generateModalOpen = false"
                  class="px-4 py-2 text-sm font-medium text-gray-700 rounded-lg hover:bg-gray-100 transition whitespace-nowrap">
            Annuler
          </button>
          <button @click="runGenerate" :disabled="generating || !generateQuestion.trim()"
                  class="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-violet-600 text-white hover:bg-violet-700 transition whitespace-nowrap disabled:opacity-50 shadow-sm">
            <SparklesIcon class="w-4 h-4 shrink-0" />
            {{ generating ? 'Génération…' : 'Générer l\'article' }}
          </button>
        </div>
      </div>
    </BaseModal>

    <!-- Modale suggestions IA -->
    <BaseModal v-if="showSuggestions" size="lg" @close="showSuggestions = false" :title="'Articles FAQ manquants suggérés'">
      <div>
        <p class="text-sm text-gray-500 mb-4 -mt-1">
          L'IA a comparé le corpus Buildy à tes articles FAQ existants pour identifier les sujets non couverts.
        </p>
        <div v-if="loadingSuggestions" class="text-sm text-gray-500 italic py-12 text-center">
          <ArrowPathIcon class="w-5 h-5 inline animate-spin mr-2" />
          Analyse du corpus en cours…
        </div>
        <ul v-else-if="suggestions.length" class="space-y-3">
          <li v-for="(s, i) in suggestions" :key="i"
              class="border border-gray-200 rounded-lg p-4 hover:border-indigo-300 hover:bg-indigo-50/30 transition">
            <div class="font-medium text-gray-800 leading-snug">{{ s.title }}</div>
            <div class="text-sm text-gray-600 mt-1.5">{{ s.rationale }}</div>
            <div v-if="s.source_refs?.length" class="text-xs text-gray-400 mt-2">
              Lié à : {{ s.source_refs.join(', ') }}
            </div>
            <button @click="createFromSuggestion(s)"
                    class="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-indigo-200 text-indigo-700 hover:bg-indigo-100 transition whitespace-nowrap">
              <PlusIcon class="w-3.5 h-3.5 shrink-0" />
              Créer cet article
            </button>
          </li>
        </ul>
        <div v-else class="text-sm text-gray-500 italic py-8 text-center">
          Aucune suggestion. Le corpus FAQ semble couvrir l'essentiel.
        </div>
      </div>
    </BaseModal>
  </div>
</template>
