<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRouter, onBeforeRouteLeave, RouterLink } from 'vue-router'
import {
  ChevronLeftIcon, ArrowUpOnSquareIcon, SparklesIcon, TrashIcon,
  CheckCircleIcon, ArrowTopRightOnSquareIcon,
  ArrowDownTrayIcon, ClockIcon,
  LinkIcon, ExclamationTriangleIcon, ArrowPathIcon,
} from '@heroicons/vue/24/outline'
import { useFaqStore } from '@/stores/faq'
import { useNotification } from '@/composables/useNotification'
import { useConfirm } from '@/composables/useConfirm'
import FaqRichTextEditor from '@/components/FaqRichTextEditor.vue'
import FaqArticleHistoryModal from '@/components/FaqArticleHistoryModal.vue'
import FaqRewriteArticleModal from '@/components/FaqRewriteArticleModal.vue'
import Tooltip from '@/components/Tooltip.vue'
import { pullFaqArticleFromCrisp, faqAiRewriteTitle, faqAiRewriteDescription } from '@/api'

const props = defineProps({ id: { type: [String, Number], required: true } })
const router = useRouter()
const store = useFaqStore()
const { success, error: notifyError } = useNotification()
const { confirm } = useConfirm()

const draft = ref({
  title: '',
  description: '',
  content_html: '',
  category_id: null,
  status: 'draft',
  visibility: 'public',
  // Codes BACS couverts par l'article (Lot 138). Permet le maillage SEO
  // automatique depuis les articles générés depuis une fonctionnalité.
  bacs_articles: '',
})
const original = ref(null)
const loading = ref(true)
const saving = ref(false)
const suggestedTitle = ref(null)

const dirty = computed(() => {
  if (!original.value) return false
  return (
    draft.value.title !== original.value.title ||
    draft.value.description !== (original.value.description || '') ||
    draft.value.content_html !== (original.value.content_html || '') ||
    draft.value.category_id !== (original.value.category_id || null) ||
    draft.value.status !== original.value.status ||
    draft.value.visibility !== original.value.visibility ||
    draft.value.bacs_articles !== (original.value.bacs_articles || '')
  )
})

// Sync biblio -> FAQ (Lot 138) : flags d'affichage pour la top-bar + bandeau
// de divergence. Récupère le statut détaillé en lazy-fetch après loadArticle.
const linkedFunctionalityId = computed(() => original.value?.source_section_template_id || null)
const sourceOverridden = computed(() => original.value?.source_overridden === 1)
const sourceSyncedAt = computed(() => original.value?.source_synced_at || null)
const syncStatus = ref(null) // { diverged, overridden, article, ... } depuis /faq-status
const regenerating = ref(false)

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

// ── Réécriture IA (article entier) — passe par la modale FaqRewriteArticleModal ──
// Pour ouvrir : depuis la top-bar OU depuis la toolbar de FaqRichTextEditor
// (qui émet @request-rewrite-full). La modale accepte des instructions
// custom optionnelles (anti-hallucination, angle éditorial, etc.).
const aiRewriting = ref(false)
const rewriteModalOpen = ref(false)

function openRewriteModal() {
  rewriteModalOpen.value = true
}
async function rewriteWithAI(instructions = null) {
  aiRewriting.value = true
  try {
    const data = await store.aiRewrite({
      articleId: parseInt(props.id, 10),
      instructions: instructions || null,
    })
    if (data.html) draft.value.content_html = data.html
    if (data.suggested_title) suggestedTitle.value = data.suggested_title
    // L'appel IA a bumpé updated_at server-side (lastAiAssistAt). Sans ce
    // rafraichissement, le prochain save renverrait l'ancien expected_updated_at
    // et déclencherait un faux "Conflit de version".
    if (data.updated_at && original.value) original.value.updated_at = data.updated_at
    rewriteModalOpen.value = false
    success(instructions
      ? 'Article réécrit avec tes instructions. Vérifie et enregistre.'
      : 'Article réécrit par l\'IA. Vérifie et enregistre si ça te convient.')
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Échec de la réécriture IA')
  } finally {
    aiRewriting.value = false
  }
}

// ── Reformulation IA du titre seul ──
const rewritingTitle = ref(false)
async function rewriteTitleWithAI() {
  rewritingTitle.value = true
  try {
    const { data } = await faqAiRewriteTitle(parseInt(props.id, 10))
    if (data.title) draft.value.title = data.title
    success('Titre reformulé par l\'IA.')
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Échec de la reformulation du titre')
  } finally {
    rewritingTitle.value = false
  }
}

// ── Reformulation / génération IA de la description ──
const rewritingDescription = ref(false)
async function rewriteDescriptionWithAI() {
  rewritingDescription.value = true
  try {
    const { data } = await faqAiRewriteDescription(parseInt(props.id, 10))
    if (data.description) draft.value.description = data.description
    success(draft.value.description ? 'Description reformulée par l\'IA.' : 'Description générée par l\'IA.')
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Échec de la génération de description')
  } finally {
    rewritingDescription.value = false
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
      description: data.description || '',
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
      description: article.description || '',
      content_html: article.content_html || '',
      category_id: article.category_id || null,
      status: article.status || 'draft',
      visibility: article.visibility || 'public',
      bacs_articles: article.bacs_articles || '',
    }
    loadSeoScore() // async, non-bloquant
    loadSyncStatus() // async, non-bloquant — alimente badge + bandeau divergence
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Article introuvable')
  } finally {
    loading.value = false
  }
})

// Sync biblio -> FAQ (Lot 138) : récupère le statut détaillé depuis la
// fonctionnalité source si l'article est lié, pour afficher le bandeau de
// divergence et permettre la regénération.
async function loadSyncStatus() {
  if (!linkedFunctionalityId.value) return
  try {
    const { getFaqStatusForFunctionality } = await import('@/api')
    const { data } = await getFaqStatusForFunctionality(linkedFunctionalityId.value)
    syncStatus.value = data
  } catch (e) {
    syncStatus.value = null
  }
}

async function regenerateFromLibrary({ force = false } = {}) {
  if (!linkedFunctionalityId.value || !original.value?.id) return
  if (!force && sourceOverridden.value) {
    if (!await confirm({
      title: 'Écraser tes éditions manuelles ?',
      message: 'Cet article a été édité à la main depuis sa génération. Une regénération va remplacer ton contenu. L\'historique est snapshoté avant pour permettre un retour arrière.',
      confirmText: 'Regénérer quand même',
      danger: true,
    })) return
    force = true
  }
  regenerating.value = true
  try {
    const { regenerateFaqFromFunctionality } = await import('@/api')
    const { data } = await regenerateFaqFromFunctionality(linkedFunctionalityId.value, {
      article_id: original.value.id, force,
    })
    original.value = data
    draft.value = {
      title: data.title || '',
      description: data.description || '',
      content_html: data.content_html || '',
      category_id: data.category_id || null,
      status: data.status || 'draft',
      visibility: data.visibility || 'public',
      bacs_articles: data.bacs_articles || '',
    }
    success('Article regénéré depuis la biblio.')
    loadSeoScore()
    loadSyncStatus()
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Échec de la regénération')
  } finally {
    regenerating.value = false
  }
}

// ── Garde-fou perte de données ──────────────────────────────────────
// 1. Fermeture onglet / refresh navigateur : prompt natif beforeunload.
// 2. Navigation Vue Router interne (ex: clic sidebar) : confirm modal.
function beforeUnloadHandler(e) {
  if (!dirty.value) return
  e.preventDefault()
  e.returnValue = '' // Chrome exige cette assignation pour afficher le prompt.
  return ''
}

onMounted(() => { window.addEventListener('beforeunload', beforeUnloadHandler) })
onBeforeUnmount(() => { window.removeEventListener('beforeunload', beforeUnloadHandler) })

onBeforeRouteLeave(async (to, from) => {
  if (!dirty.value) return true
  // Pas de confirm pour la navigation interne dans le même article (rare mais possible).
  if (to.name === from.name && to.params.id === from.params.id) return true
  const ok = await confirm({
    title: 'Quitter sans enregistrer ?',
    message: 'Les modifications de cet article ne sont pas sauvegardées. Elles seront perdues si tu quittes maintenant.',
    confirmLabel: 'Quitter',
    cancelLabel: 'Rester sur la page',
    danger: true,
  })
  return ok
})

watch(() => props.id, async (newId) => {
  if (!newId) return
  loading.value = true
  try {
    const article = await store.loadArticle(parseInt(newId, 10))
    original.value = article
    draft.value = {
      title: article.title || '',
      description: article.description || '',
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
      description: draft.value.description || null,
      content_html: draft.value.content_html,
      category_id: draft.value.category_id,
      status: draft.value.status,
      visibility: draft.value.visibility,
      bacs_articles: draft.value.bacs_articles?.trim() || null,
      // Optimistic locking : empêche un second onglet d'écraser nos changements.
      expected_updated_at: original.value?.updated_at,
    })
    original.value = data
    success('Enregistré')
    loadSeoScore() // recalcule le score SEO après save
  } catch (e) {
    if (e.response?.status === 409) {
      const ok = await confirm({
        title: 'Conflit de version',
        message: 'Cet article a été modifié dans un autre onglet ou par un autre utilisateur. Recharge la dernière version (tes modifications seront perdues), ou copie-colle ton texte avant de recharger.',
        confirmLabel: 'Recharger',
        cancelLabel: 'Garder mes modifications',
        danger: true,
      })
      if (ok) {
        const fresh = await store.loadArticle(parseInt(props.id, 10))
        original.value = fresh
        draft.value = {
          title: fresh.title || '',
          description: fresh.description || '',
          content_html: fresh.content_html || '',
          category_id: fresh.category_id || null,
          status: fresh.status || 'draft',
          visibility: fresh.visibility || 'public',
        }
      }
    } else {
      notifyError(e.response?.data?.detail || 'Échec')
    }
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
  // Émis par FaqRichTextEditor après /api/faq/ai/rewrite. Cet endpoint bumpe
  // `updated_at` server-side (via lastAiAssistAt) ; sans refresh ici, le save
  // suivant déclencherait un faux 409 "Conflit de version".
  if (payload?.html) draft.value.content_html = payload.html
  if (payload?.suggested_title) suggestedTitle.value = payload.suggested_title
  if (payload?.updated_at && original.value) original.value.updated_at = payload.updated_at
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
        <span v-if="original?.dirty" class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-orange-50 text-orange-700 text-xs whitespace-nowrap"
              v-tooltip="{ title: 'Modifications non publiées', tone: 'warning', text: 'Cette version n’est pas encore sur Crisp : help.buildy.fr montre l’ancienne, ou rien si l’article n’a jamais été publié.', todo: 'Publie-la avec « Publier vers Crisp » quand elle est prête.' }">
          <span class="w-1.5 h-1.5 rounded-full bg-orange-400" />
          Modifications non publiées
        </span>
        <span v-else-if="original?.crisp_id && !original?.dirty" class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 text-xs whitespace-nowrap"
              v-tooltip="{ title: 'À jour sur Crisp', tone: 'success', text: 'Rien n’a été modifié ici depuis le dernier échange avec Crisp : il n’y a rien à publier.' }">
          <CheckCircleIcon class="w-3 h-3 shrink-0" />
          Synchronisé avec Crisp
        </span>
        <span v-else class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-gray-100 text-gray-600 text-xs whitespace-nowrap"
              v-tooltip="{ title: 'Pas encore sur Crisp', tone: 'neutral', text: 'Cet article n’existe qu’ici : il n’a jamais été envoyé sur Crisp.', todo: 'Publie-le avec « Publier vers Crisp » quand il est prêt.' }">
          Local uniquement
        </span>
        <!-- Badge SEO score : vert ≥ 80, ambre 60-79, rouge < 60 -->
        <span v-if="seoScore !== null"
              :class="['inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs whitespace-nowrap cursor-help', seoBadgeClass]"
              v-tooltip="{ title: `Référencement (SEO) : ${seoScore}/100`, tone: seoScore >= 80 ? 'success' : seoScore >= 60 ? 'warning' : 'error', icon: 'magnifying-glass', text: 'Note du référencement de l’article dans Google, recalculée à chaque enregistrement.',
                           rows: seoChecks.length ? [{ label: 'Critères remplis', value: `${seoChecks.filter((c) => c.passed).length} sur ${seoChecks.length}` }] : null,
                           todo: seoChecks.some((c) => !c.passed) ? { title: 'À améliorer', items: seoChecks.filter((c) => !c.passed).slice(0, 3).map((c) => c.message) } : null }">
          SEO {{ seoScore }}/100
        </span>
        <!-- Badge « Lié à une fonctionnalité biblio » (Lot 138) -->
        <RouterLink v-if="linkedFunctionalityId"
                    :to="`/library/functionalities`"
                    class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 text-xs whitespace-nowrap hover:bg-indigo-100 transition"
                    v-tooltip="{ title: 'Lié à une fonctionnalité', icon: 'link', text: 'Cet article a été généré à partir d’une fonctionnalité de la bibliothèque. Le lien ouvre la liste des fonctionnalités.', rows: sourceOverridden ? [{ icon: 'pen', label: '« édité »', value: 'retouché à la main après sa génération' }] : null }">
          <LinkIcon class="w-3 h-3 shrink-0" />
          Lié à la biblio
          <span v-if="sourceOverridden" class="ml-1 text-amber-700">(édité)</span>
        </RouterLink>
        <div class="ml-auto flex items-center gap-2">
          <a v-if="original?.crisp_url && original?.status === 'published'"
             :href="original.crisp_url" target="_blank" rel="noopener"
             class="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-gray-200 hover:bg-gray-50 transition whitespace-nowrap text-gray-700"
             v-tooltip="'Ouvrir l’article sur help.buildy.fr'">
            <ArrowTopRightOnSquareIcon class="w-4 h-4 shrink-0" />
            Voir en ligne
          </a>
          <!-- Bulles des boutons grisables portées par une enveloppe <Tooltip> : visibles aussi
               quand le bouton est grisé (un bouton désactivé ne reçoit pas le survol). -->
          <Tooltip :text="!draft.content_html ? 'Écris d’abord le contenu de l’article' : { title: 'Réécrire l’article avec l’IA', icon: 'wand-magic-sparkles', text: 'L’IA réécrit tout l’article, en suivant tes consignes si tu en donnes. Vérifie puis enregistre : l’ancienne version reste dans l’historique.' }">
            <button @click="openRewriteModal" :disabled="aiRewriting || !draft.content_html"
                    class="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-violet-200 bg-violet-50 hover:bg-violet-100 text-violet-700 transition whitespace-nowrap disabled:opacity-50">
              <SparklesIcon class="w-4 h-4 shrink-0" />
              {{ aiRewriting ? 'Réécriture…' : 'Réécrire avec IA' }}
            </button>
          </Tooltip>
          <Tooltip v-if="original?.crisp_id" :text="{ title: 'Recharger depuis Crisp', tone: 'warning', icon: 'download', text: 'Remplace l’article enregistré ici par sa version sur Crisp. Ce qui a été modifié ici et pas encore publié est perdu.' }">
            <button @click="pullFromCrisp" :disabled="pulling"
                    class="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-gray-200 hover:bg-gray-50 transition whitespace-nowrap text-gray-700 disabled:opacity-50">
              <ArrowDownTrayIcon class="w-4 h-4 shrink-0" />
              {{ pulling ? 'Rechargement…' : 'Recharger' }}
            </button>
          </Tooltip>
          <button @click="historyModalOpen = true"
                  class="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-gray-200 hover:bg-gray-50 transition whitespace-nowrap text-gray-700"
                  v-tooltip="{ title: 'Historique des versions', icon: 'clock-rotate-left', text: 'Une version est gardée avant chaque publication, chaque passage de l’IA et chaque restauration. Les simples enregistrements n’en créent pas.' }">
            <ClockIcon class="w-4 h-4 shrink-0" />
            Historique
          </button>
          <Tooltip :text="!dirty && !saving ? 'Aucune modification à enregistrer' : null">
            <button @click="save" :disabled="!dirty || saving"
                    class="px-4 py-1.5 text-sm rounded-lg border border-gray-200 hover:bg-gray-50 transition whitespace-nowrap disabled:opacity-50">
              {{ saving ? 'Enregistrement…' : 'Enregistrer' }}
            </button>
          </Tooltip>
          <Tooltip :text="credentialsConfigured
                    ? { title: 'Publier l’article sur Crisp', icon: 'upload', text: draft.status === 'published' ? 'Enregistre si besoin, puis envoie l’article sur Crisp : il sera visible sur help.buildy.fr.' : 'Enregistre si besoin, puis envoie l’article sur Crisp. Son statut « Brouillon » le garde caché sur help.buildy.fr.' }
                    : { title: 'Crisp n’est pas configuré', tone: 'warning', text: 'Les accès à Crisp ne sont pas encore renseignés.', todo: 'Renseigne-les dans « Paramètres Crisp », sur la page FAQ Buildy.' }">
            <button @click="pushToCrisp" :disabled="!credentialsConfigured"
                    class="inline-flex items-center gap-2 px-4 py-1.5 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition whitespace-nowrap disabled:opacity-50">
              <ArrowUpOnSquareIcon class="w-4 h-4 shrink-0" />
              Publier vers Crisp
            </button>
          </Tooltip>
          <button @click="remove" class="p-2 text-red-500 hover:bg-red-50 rounded-lg transition"
                  v-tooltip="original?.crisp_id ? 'Supprimer cet article, ici et sur Crisp' : 'Supprimer cet article'" aria-label="Supprimer cet article">
            <TrashIcon class="w-4 h-4" />
          </button>
        </div>
      </div>

      <!-- Bandeau de divergence biblio (Lot 138) : la fonctionnalité source a
           évolué depuis la dernière génération. L'utilisateur peut regénérer
           (l'IA réécrit le contenu) ou ignorer. -->
      <div v-if="syncStatus?.diverged" class="mb-3 bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-3 text-sm">
        <ExclamationTriangleIcon class="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
        <div class="flex-1">
          <div class="font-medium text-amber-900">La fonctionnalité source a évolué.</div>
          <div class="text-amber-700 text-xs mt-0.5">
            Dernière synchro biblio : {{ sourceSyncedAt ? new Date(sourceSyncedAt).toLocaleDateString('fr-FR') : 'inconnue' }}.
            <span v-if="sourceOverridden"> Article édité manuellement — une regénération écrasera tes modifications (snapshot avant).</span>
          </div>
        </div>
        <button @click="regenerateFromLibrary()" :disabled="regenerating"
                class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-amber-600 text-white hover:bg-amber-700 transition whitespace-nowrap disabled:opacity-50">
          <ArrowPathIcon v-if="regenerating" class="w-3.5 h-3.5 shrink-0 animate-spin" />
          <SparklesIcon v-else class="w-3.5 h-3.5 shrink-0" />
          {{ regenerating ? 'Regénération…' : 'Regénérer' }}
        </button>
        <button @click="syncStatus = null"
                class="px-3 py-1.5 text-xs rounded-lg text-amber-700 hover:bg-amber-100 transition whitespace-nowrap">
          Ignorer
        </button>
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
          <div class="flex items-center justify-between mb-1">
            <label class="block text-sm font-medium text-gray-700">Titre</label>
            <Tooltip :text="{ title: 'Reformuler le titre avec l’IA', icon: 'wand-magic-sparkles', text: 'L’IA propose un titre plus clair, pensé pour ressortir dans Google. Vérifie-le puis enregistre.' }">
              <button @click="rewriteTitleWithAI" :disabled="rewritingTitle || !original"
                      type="button"
                      class="inline-flex items-center gap-1 px-2 py-1 text-xs rounded border border-violet-200 bg-violet-50 hover:bg-violet-100 text-violet-700 transition disabled:opacity-50">
                <SparklesIcon class="w-3.5 h-3.5 shrink-0" />
                {{ rewritingTitle ? 'Reformulation…' : 'Reformuler avec IA' }}
              </button>
            </Tooltip>
          </div>
          <input v-model="draft.title" type="text"
                 class="w-full px-3 py-2 text-lg border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition" />
        </div>

        <div>
          <div class="flex items-center justify-between mb-1">
            <label class="block text-sm font-medium text-gray-700">
              Meta-description SEO
              <span class="text-xs font-normal text-gray-500">— affichée dans Google et sous le titre Crisp</span>
            </label>
            <Tooltip :text="{ title: (draft.description || '').trim() ? 'Reformuler la description avec l’IA' : 'Générer une description avec l’IA', icon: 'wand-magic-sparkles', text: 'L’IA écrit une phrase de 130 à 145 caractères : celle que Google affiche sous le titre. Vérifie-la puis enregistre.' }">
              <button @click="rewriteDescriptionWithAI" :disabled="rewritingDescription || !original"
                      type="button"
                      class="inline-flex items-center gap-1 px-2 py-1 text-xs rounded border border-violet-200 bg-violet-50 hover:bg-violet-100 text-violet-700 transition disabled:opacity-50">
                <SparklesIcon class="w-3.5 h-3.5 shrink-0" />
                {{ rewritingDescription ? 'Génération…' : ((draft.description || '').trim() ? 'Reformuler avec IA' : 'Générer avec IA') }}
              </button>
            </Tooltip>
          </div>
          <textarea v-model="draft.description" rows="2" maxlength="160"
                    placeholder="1 phrase courte (140-155 chars idéal, 160 max). Ex : Pilotez à distance le chauffage et la climatisation de vos bâtiments tertiaires depuis Hyperveez."
                    class="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition resize-y"></textarea>
          <div class="flex items-center justify-between mt-1 text-xs">
            <span :class="(draft.description || '').length > 160 ? 'text-red-600' : (draft.description || '').length > 140 ? 'text-amber-600' : 'text-gray-500'">
              {{ (draft.description || '').length }}/160 caractères
            </span>
            <span class="text-gray-400">Crisp tronque au-delà de 160</span>
          </div>
        </div>

        <!-- Articles BACS couverts (Lot 138) — permet aux articles générés depuis
             une fonctionnalité de pointer ici via maillage interne SEO. -->
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">
            Articles BACS couverts
            <span class="text-xs font-normal text-gray-500">— maillage SEO interne (optionnel)</span>
          </label>
          <input v-model="draft.bacs_articles" type="text"
                 placeholder="Ex : R175-3 1°, R175-6"
                 class="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition" />
          <div class="mt-1 text-xs text-gray-500">
            Si cet article décrit une (ou plusieurs) sous-section du décret BACS, indique le(s) code(s) ici.
            Les articles fonctionnalité publiés pointeront automatiquement vers cet article quand ils couvrent les mêmes codes.
          </div>
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
                             :rewriting="aiRewriting"
                             placeholder="Rédigez l'article…" min-height="320px"
                             @suggested-title="onSuggestedTitle"
                             @rewritten="onRewritten"
                             @request-rewrite-full="openRewriteModal" />
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

    <!-- Modale réécriture article complet avec instructions custom -->
    <FaqRewriteArticleModal v-if="rewriteModalOpen"
                            :article-title="draft.title"
                            :loading="aiRewriting"
                            @close="rewriteModalOpen = false"
                            @submit="rewriteWithAI" />
  </div>
</template>
