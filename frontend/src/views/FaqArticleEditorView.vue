<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  ChevronLeftIcon, ArrowUpOnSquareIcon, SparklesIcon, TrashIcon,
  CheckCircleIcon, ArrowTopRightOnSquareIcon,
  ArrowDownTrayIcon, ClockIcon,
} from '@heroicons/vue/24/outline'
import { useFaqStore } from '@/stores/faq'
import { useNotification } from '@/composables/useNotification'
import { useConfirm } from '@/composables/useConfirm'
import FaqRichTextEditor from '@/components/FaqRichTextEditor.vue'
import FaqArticleHistoryModal from '@/components/FaqArticleHistoryModal.vue'
import { pullFaqArticleFromCrisp } from '@/api'

const props = defineProps({ id: { type: [String, Number], required: true } })
const router = useRouter()
const store = useFaqStore()
const { success, error: notifyError } = useNotification()
const { confirm } = useConfirm()

const draft = ref({
  title: '',
  content_html: '',
  category_id: null,
  status: 'draft',
  visibility: 'public',
})
const original = ref(null)
const loading = ref(true)
const saving = ref(false)
const suggestedTitle = ref(null)

const dirty = computed(() => {
  if (!original.value) return false
  return (
    draft.value.title !== original.value.title ||
    draft.value.content_html !== (original.value.content_html || '') ||
    draft.value.category_id !== (original.value.category_id || null) ||
    draft.value.status !== original.value.status ||
    draft.value.visibility !== original.value.visibility
  )
})

const credentialsConfigured = computed(() => store.settings?.has_credentials || false)

// ── Score SEO (heuristique côté backend, recalculé à chaque save) ──
const seoChecks = ref([])
const seoScore = computed(() => {
  if (!original.value || original.value.seo_score === null || original.value.seo_score === undefined) return null
  return original.value.seo_score
})
const seoBadgeClass = computed(() => {
  const s = seoScore.value
  if (s === null) return ''
  if (s >= 80) return 'bg-emerald-50 text-emerald-700'
  if (s >= 60) return 'bg-amber-50 text-amber-700'
  return 'bg-red-50 text-red-700'
})
const seoTooltip = computed(() => {
  if (!seoChecks.value.length) return `Score SEO ${seoScore.value || '?'}/100. Clique pour les détails.`
  const failed = seoChecks.value.filter(c => !c.passed).slice(0, 3)
  if (!failed.length) return `Score SEO ${seoScore.value}/100. Excellent — tous les critères passent.`
  return `Score SEO ${seoScore.value}/100. À améliorer :\n` + failed.map(c => `• ${c.message}`).join('\n')
})

async function loadSeoScore() {
  if (!original.value?.id) return
  try {
    const { data } = await (await import('@/api')).default.get(`/faq/articles/${original.value.id}/seo-score`)
    seoChecks.value = data.checks || []
    if (original.value && data.score !== undefined) {
      original.value = { ...original.value, seo_score: data.score }
    }
  } catch (e) { /* silent — pas bloquant */ }
}

// ── Historique des versions ──
const historyModalOpen = ref(false)

// ── Réécriture IA (article entier) ──
const aiRewriting = ref(false)
async function rewriteWithAI() {
  if (!await confirm({
    title: 'Réécrire l\'article avec l\'IA ?',
    message: 'L\'article actuel sera remplacé par une version réécrite par Claude. Un snapshot est créé avant pour pouvoir revenir en arrière.',
    confirmText: 'Réécrire',
  })) return
  aiRewriting.value = true
  try {
    const data = await store.aiRewrite(parseInt(props.id, 10))
    if (data.html) draft.value.content_html = data.html
    if (data.suggested_title) suggestedTitle.value = data.suggested_title
    success('Article réécrit par l\'IA. Vérifie et enregistre si ça te convient.')
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Échec de la réécriture IA')
  } finally {
    aiRewriting.value = false
  }
}

// ── Recharger depuis Crisp ──
const pulling = ref(false)
async function pullFromCrisp() {
  if (dirty.value) {
    if (!await confirm({
      title: 'Recharger depuis Crisp ?',
      message: 'Tu as des modifications non enregistrées qui seront perdues. Continuer ?',
      confirmText: 'Recharger',
      danger: true,
    })) return
  }
  pulling.value = true
  try {
    const { data } = await pullFaqArticleFromCrisp(parseInt(props.id, 10))
    original.value = data
    draft.value = {
      title: data.title || '',
      content_html: data.content_html || '',
      category_id: data.category_id || null,
      status: data.status || 'draft',
      visibility: data.visibility || 'public',
    }
    success('Article rechargé depuis Crisp.')
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Échec du rechargement')
  } finally {
    pulling.value = false
  }
}

// Quand une version est restaurée depuis l'historique : recharge l'article
async function onVersionRestored() {
  historyModalOpen.value = false
  const article = await store.loadArticle(parseInt(props.id, 10))
  original.value = article
  draft.value = {
    title: article.title || '',
    content_html: article.content_html || '',
    category_id: article.category_id || null,
    status: article.status || 'draft',
    visibility: article.visibility || 'public',
  }
  success('Version restaurée.')
}

onMounted(async () => {
  loading.value = true
  try {
    if (!store.settings) await store.loadSettings()
    if (!store.categories.length) await store.loadCategories()
    const article = await store.loadArticle(parseInt(props.id, 10))
    original.value = article
    draft.value = {
      title: article.title || '',
      content_html: article.content_html || '',
      category_id: article.category_id || null,
      status: article.status || 'draft',
      visibility: article.visibility || 'public',
    }
    loadSeoScore() // async, non-bloquant
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Article introuvable')
  } finally {
    loading.value = false
  }
})

watch(() => props.id, async (newId) => {
  if (!newId) return
  loading.value = true
  try {
    const article = await store.loadArticle(parseInt(newId, 10))
    original.value = article
    draft.value = {
      title: article.title || '',
      content_html: article.content_html || '',
      category_id: article.category_id || null,
      status: article.status || 'draft',
      visibility: article.visibility || 'public',
    }
  } finally {
    loading.value = false
  }
})

async function save() {
  if (!dirty.value) return
  saving.value = true
  try {
    const data = await store.saveArticle(parseInt(props.id, 10), {
      title: draft.value.title,
      content_html: draft.value.content_html,
      category_id: draft.value.category_id,
      status: draft.value.status,
      visibility: draft.value.visibility,
    })
    original.value = data
    success('Enregistré')
    loadSeoScore() // recalcule le score SEO après save
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Échec')
  } finally {
    saving.value = false
  }
}

async function pushToCrisp() {
  if (dirty.value) {
    const ok = await confirm({
      title: 'Enregistrer puis publier ?',
      message: 'Il y a des modifications non enregistrées. Elles seront sauvegardées avant publication.',
      confirmLabel: 'Enregistrer et publier',
    })
    if (!ok) return
    await save()
  }
  try {
    const data = await store.pushArticle(parseInt(props.id, 10))
    original.value = data
    success(`Publié vers Crisp ${data.crisp_id ? '(' + data.crisp_id + ')' : ''}`)
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Échec du push')
  }
}

function onRewritten(payload) {
  // Émis par FaqRichTextEditor après /api/faq/ai/rewrite
  if (payload?.html) draft.value.content_html = payload.html
}
function onSuggestedTitle(title) {
  suggestedTitle.value = title
}

function applySuggestedTitle() {
  if (suggestedTitle.value) {
    draft.value.title = suggestedTitle.value
    suggestedTitle.value = null
  }
}

async function remove() {
  const ok = await confirm({
    title: 'Supprimer cet article ?',
    message: `« ${draft.value.title} » sera supprimé en local et sur Crisp.`,
    confirmLabel: 'Supprimer',
    danger: true,
  })
  if (!ok) return
  try {
    await store.removeArticle(parseInt(props.id, 10))
    success('Article supprimé')
    router.push('/faq')
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Échec')
  }
}

function back() {
  router.push('/faq')
}
</script>

<template>
  <div class="max-w-5xl mx-auto">
    <div v-if="loading" class="text-sm text-gray-500 italic py-8">Chargement…</div>

    <div v-else>
      <div class="mb-4 flex items-center gap-2 flex-wrap">
        <button @click="back" class="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg border border-gray-200 hover:bg-gray-50 transition whitespace-nowrap">
          <ChevronLeftIcon class="w-4 h-4 shrink-0" />
          Retour FAQ
        </button>
        <span v-if="original?.dirty" class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-orange-50 text-orange-700 text-xs whitespace-nowrap">
          <span class="w-1.5 h-1.5 rounded-full bg-orange-400" />
          Modifications non publiées
        </span>
        <span v-else-if="original?.crisp_id && !original?.dirty" class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 text-xs whitespace-nowrap">
          <CheckCircleIcon class="w-3 h-3 shrink-0" />
          Synchronisé avec Crisp
        </span>
        <span v-else class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-gray-100 text-gray-600 text-xs whitespace-nowrap">
          Local uniquement
        </span>
        <!-- Badge SEO score : vert ≥ 80, ambre 60-79, rouge < 60 -->
        <span v-if="seoScore !== null"
              :class="['inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs whitespace-nowrap cursor-help', seoBadgeClass]"
              :title="seoTooltip">
          SEO {{ seoScore }}/100
        </span>
        <div class="ml-auto flex items-center gap-2">
          <a v-if="original?.crisp_url && original?.status === 'published'"
             :href="original.crisp_url" target="_blank" rel="noopener"
             class="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-gray-200 hover:bg-gray-50 transition whitespace-nowrap text-gray-700"
             title="Voir l'article publié sur help.buildy.fr">
            <ArrowTopRightOnSquareIcon class="w-4 h-4 shrink-0" />
            Voir en ligne
          </a>
          <button @click="rewriteWithAI" :disabled="aiRewriting || !draft.content_html"
                  class="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-violet-200 bg-violet-50 hover:bg-violet-100 text-violet-700 transition whitespace-nowrap disabled:opacity-50"
                  title="Réécrire l'article entier avec l'IA (snapshot avant)">
            <SparklesIcon class="w-4 h-4 shrink-0" />
            {{ aiRewriting ? 'Réécriture…' : 'Réécrire avec IA' }}
          </button>
          <button v-if="original?.crisp_id" @click="pullFromCrisp" :disabled="pulling"
                  class="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-gray-200 hover:bg-gray-50 transition whitespace-nowrap text-gray-700 disabled:opacity-50"
                  title="Recharger l'article depuis Crisp (écrase la version locale)">
            <ArrowDownTrayIcon class="w-4 h-4 shrink-0" />
            {{ pulling ? 'Rechargement…' : 'Recharger' }}
          </button>
          <button @click="historyModalOpen = true"
                  class="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-gray-200 hover:bg-gray-50 transition whitespace-nowrap text-gray-700"
                  title="Voir l'historique des versions">
            <ClockIcon class="w-4 h-4 shrink-0" />
            Historique
          </button>
          <button @click="save" :disabled="!dirty || saving"
                  class="px-4 py-1.5 text-sm rounded-lg border border-gray-200 hover:bg-gray-50 transition whitespace-nowrap disabled:opacity-50">
            {{ saving ? 'Enregistrement…' : 'Enregistrer' }}
          </button>
          <button @click="pushToCrisp" :disabled="!credentialsConfigured"
                  class="inline-flex items-center gap-2 px-4 py-1.5 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition whitespace-nowrap disabled:opacity-50"
                  :title="credentialsConfigured ? 'Publier vers Crisp' : 'Configurez Crisp dans la page FAQ pour publier'">
            <ArrowUpOnSquareIcon class="w-4 h-4 shrink-0" />
            Publier vers Crisp
          </button>
          <button @click="remove" class="p-2 text-red-500 hover:bg-red-50 rounded-lg transition" title="Supprimer">
            <TrashIcon class="w-4 h-4" />
          </button>
        </div>
      </div>

      <div v-if="suggestedTitle" class="mb-3 bg-violet-50 border border-violet-200 rounded-lg p-3 flex items-center gap-3 text-sm">
        <SparklesIcon class="w-4 h-4 text-violet-600 shrink-0" />
        <span class="flex-1">L'IA suggère un nouveau titre : <strong class="text-violet-800">{{ suggestedTitle }}</strong></span>
        <button @click="applySuggestedTitle" class="px-3 py-1 rounded border border-violet-300 bg-white hover:bg-violet-100 text-violet-700 text-xs whitespace-nowrap">
          Appliquer
        </button>
        <button @click="suggestedTitle = null" class="px-3 py-1 rounded text-violet-600 hover:bg-violet-100 text-xs whitespace-nowrap">
          Ignorer
        </button>
      </div>

      <div class="bg-white border border-gray-200 rounded-lg p-6 space-y-5">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Titre</label>
          <input v-model="draft.title" type="text"
                 class="w-full px-3 py-2 text-lg border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition" />
        </div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Catégorie</label>
            <select v-model="draft.category_id"
                    class="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition">
              <option :value="null">— Aucune —</option>
              <option v-for="c in store.categories" :key="c.id" :value="c.id">{{ c.name }}</option>
            </select>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Statut</label>
            <select v-model="draft.status"
                    class="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition">
              <option value="draft">Brouillon</option>
              <option value="published">Publié</option>
            </select>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Visibilité</label>
            <select v-model="draft.visibility"
                    class="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition">
              <option value="public">Publique</option>
              <option value="private">Privée</option>
            </select>
          </div>
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Contenu</label>
          <FaqRichTextEditor v-model="draft.content_html"
                             :article-id="parseInt(props.id, 10)"
                             placeholder="Rédigez l'article…" min-height="320px"
                             @suggested-title="onSuggestedTitle"
                             @rewritten="onRewritten" />
        </div>

        <div v-if="original" class="text-xs text-gray-400 pt-3 border-t border-gray-100 flex items-center gap-4 flex-wrap">
          <span>Créé le {{ new Date(original.created_at).toLocaleString('fr-FR') }}</span>
          <span v-if="original.crisp_id">Crisp ID : <code class="bg-gray-100 px-1 rounded">{{ original.crisp_id }}</code></span>
          <span v-if="original.pushed_at">Dernier push : {{ new Date(original.pushed_at).toLocaleString('fr-FR') }}</span>
          <span v-if="original.last_ai_assist_at">Dernière assistance IA : {{ new Date(original.last_ai_assist_at).toLocaleString('fr-FR') }}</span>
        </div>
      </div>
    </div>

    <!-- Modale historique des versions -->
    <FaqArticleHistoryModal v-if="historyModalOpen"
                            :article-id="parseInt(props.id, 10)"
                            @close="historyModalOpen = false"
                            @restored="onVersionRestored" />
  </div>
</template>
