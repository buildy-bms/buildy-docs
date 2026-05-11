import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import {
  getFaqSettings, saveFaqSettings, testFaqConnection, pullFaqFromCrisp,
  listFaqCategories, createFaqCategory, updateFaqCategory, deleteFaqCategory, pushFaqCategory,
  listFaqArticles, getFaqArticle, createFaqArticle, updateFaqArticle, deleteFaqArticle, pushFaqArticle,
  faqAiRewrite, faqAiGenerate, faqAiSuggestMissing, faqAiRewriteSelection,
} from '@/api'

/**
 * Store Pinia FAQ Buildy / Crisp Knowledge Base.
 *
 * State partagé entre la vue principale (`FaqBuildyView`) et l'éditeur
 * (`FaqArticleEditorView`). Les actions wrappent les appels axios + mettent
 * à jour le state local pour éviter les refetch.
 */
export const useFaqStore = defineStore('faq', () => {
  const settings = ref(null)
  const categories = ref([])
  const articles = ref([])
  const currentArticle = ref(null)
  const selectedCategoryId = ref(null)
  const loading = ref(false)
  const loadingPull = ref(false)
  const pullConflicts = ref([])

  const dirtyCount = computed(() => articles.value.filter((a) => a.dirty).length)
  const articlesByCategory = computed(() => {
    const map = new Map()
    for (const a of articles.value) {
      const k = a.category_id || 0
      if (!map.has(k)) map.set(k, [])
      map.get(k).push(a)
    }
    return map
  })

  // ── Settings ──
  async function loadSettings() {
    const { data } = await getFaqSettings()
    settings.value = data
    return data
  }
  async function saveSettings(payload) {
    const { data } = await saveFaqSettings(payload)
    settings.value = data
    return data
  }
  async function testConnection() {
    const { data } = await testFaqConnection()
    return data
  }

  // ── Sync ──
  async function pullFromCrisp() {
    loadingPull.value = true
    try {
      const { data } = await pullFaqFromCrisp()
      pullConflicts.value = data.conflicts || []
      await loadCategories()
      await loadArticles()
      return data
    } finally {
      loadingPull.value = false
    }
  }

  // ── Categories ──
  async function loadCategories() {
    const { data } = await listFaqCategories()
    categories.value = data
    return data
  }
  async function createCategory(payload) {
    const { data } = await createFaqCategory(payload)
    categories.value = [...categories.value, data]
    return data
  }
  async function updateCategory(id, payload) {
    const { data } = await updateFaqCategory(id, payload)
    categories.value = categories.value.map((c) => (c.id === id ? data : c))
    return data
  }
  async function removeCategory(id, { force = false } = {}) {
    await deleteFaqCategory(id, { force })
    categories.value = categories.value.filter((c) => c.id !== id)
    articles.value = articles.value.filter((a) => a.category_id !== id)
  }
  async function pushCategory(id) {
    const { data } = await pushFaqCategory(id)
    categories.value = categories.value.map((c) => (c.id === id ? data : c))
    return data
  }

  // ── Articles ──
  async function loadArticles({ categoryId = null, q = null, status = null } = {}) {
    loading.value = true
    try {
      const params = {}
      if (categoryId !== null && categoryId !== undefined) params.category_id = categoryId
      if (q) params.q = q
      if (status) params.status = status
      const { data } = await listFaqArticles(params)
      articles.value = data
      return data
    } finally {
      loading.value = false
    }
  }
  async function loadArticle(id) {
    const { data } = await getFaqArticle(id)
    currentArticle.value = data
    return data
  }
  async function createArticle(payload) {
    const { data } = await createFaqArticle(payload)
    articles.value = [data, ...articles.value]
    return data
  }
  async function saveArticle(id, payload) {
    const { data } = await updateFaqArticle(id, payload)
    articles.value = articles.value.map((a) => (a.id === id ? { ...a, ...data } : a))
    if (currentArticle.value?.id === id) currentArticle.value = data
    return data
  }
  async function removeArticle(id) {
    await deleteFaqArticle(id)
    articles.value = articles.value.filter((a) => a.id !== id)
    if (currentArticle.value?.id === id) currentArticle.value = null
  }
  async function pushArticle(id) {
    const { data } = await pushFaqArticle(id)
    articles.value = articles.value.map((a) => (a.id === id ? { ...a, ...data } : a))
    if (currentArticle.value?.id === id) currentArticle.value = data
    return data
  }

  // ── IA ──
  // aiRewrite(123)                                     — réécriture standard (legacy)
  // aiRewrite({ articleId: 123, instructions: '...' }) — avec instructions custom
  async function aiRewrite(payload) {
    const body = (payload && typeof payload === 'object')
      ? { article_id: payload.articleId || payload.article_id, instructions: payload.instructions || null }
      : { article_id: payload }
    const { data } = await faqAiRewrite(body)
    return data
  }
  // Accepte 2 formes :
  //   aiGenerate("question texte", categoryId)         — legacy, FaqBuildyView
  //   aiGenerate({ question, category_id, article_type, images, ... })
  // Préférer la forme objet pour les nouveaux call-sites (richer payload).
  async function aiGenerate(questionOrPayload, categoryId = null) {
    const payload = typeof questionOrPayload === 'object' && questionOrPayload !== null
      ? questionOrPayload
      : { question: questionOrPayload, category_id: categoryId }
    const { data } = await faqAiGenerate(payload)
    return data
  }
  async function aiSuggestMissing() {
    const { data } = await faqAiSuggestMissing()
    return data
  }
  async function aiRewriteSelection(payload) {
    const { data } = await faqAiRewriteSelection(payload)
    return data
  }

  return {
    // state
    settings, categories, articles, currentArticle, selectedCategoryId,
    loading, loadingPull, pullConflicts,
    // getters
    dirtyCount, articlesByCategory,
    // actions
    loadSettings, saveSettings, testConnection,
    pullFromCrisp,
    loadCategories, createCategory, updateCategory, removeCategory, pushCategory,
    loadArticles, loadArticle, createArticle, saveArticle, removeArticle, pushArticle,
    aiRewrite, aiGenerate, aiSuggestMissing, aiRewriteSelection,
  }
})
