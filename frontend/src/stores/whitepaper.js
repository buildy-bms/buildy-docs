import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import {
  getWhitepaper, updateWhitepaper, deleteWhitepaper,
  getWhitepaperChapter, createWhitepaperChapter, updateWhitepaperChapter,
  deleteWhitepaperChapter, moveWhitepaperChapter,
  getWhitepaperSourceHtml, replaceWhitepaperSourceHtml, publishWhitepaper,
} from '@/api'

// Store d'un livre blanc en cours d'edition. Chargement light de l'arbre
// des chapitres (titres seulement), le body_html est rapatrie a la
// selection. Cf. pattern AF detail (CLAUDE.md « AF detail performance »).
export const useWhitepaperStore = defineStore('whitepaper', () => {
  const whitepaper = ref(null)       // { id, title, slug, status, layout, audience, version, meta }
  const chapters = ref([])           // [{ id, title, position, is_empty }]
  const companions = ref([])         // [{ id, title, layout, status }]
  const currentChapter = ref(null)   // { id, title, body_html } — chapitre selectionne
  const loading = ref(false)
  const saving = ref(false)
  const publishing = ref(false)

  const isCompanion = computed(() => !!whitepaper.value?.parent_af_id)
  // Mode « HTML brut » (coffre) : le document stocke son HTML/CSS exact,
  // edite hors-app, rendu fidele au pixel. Pas d'edition par chapitres.
  const isHtmlMode = computed(() => whitepaper.value?.meta?.mode === 'html')
  const sourceInfo = ref(null)  // { size_bytes, updated_at } pour le mode html

  async function load(id) {
    loading.value = true
    try {
      const { data } = await getWhitepaper(id)
      whitepaper.value = data
      chapters.value = (data.chapters || []).slice().sort((a, b) => (a.position || 0) - (b.position || 0))
      companions.value = data.companions || []
      currentChapter.value = null
      sourceInfo.value = null
      if (data.meta?.mode === 'html') {
        try {
          const { data: src } = await getWhitepaperSourceHtml(id)
          sourceInfo.value = { size_bytes: src.size_bytes, updated_at: src.updated_at }
        } catch { sourceInfo.value = null }
      } else if (chapters.value.length) {
        await selectChapter(chapters.value[0].id)
      }
    } finally {
      loading.value = false
    }
  }

  // Mode html : remplace le fichier source.html (upload hors-app).
  async function replaceSourceHtml(file) {
    if (!whitepaper.value) return
    saving.value = true
    try {
      await replaceWhitepaperSourceHtml(whitepaper.value.id, file)
      const { data: src } = await getWhitepaperSourceHtml(whitepaper.value.id)
      sourceInfo.value = { size_bytes: src.size_bytes, updated_at: src.updated_at }
    } finally {
      saving.value = false
    }
  }

  async function selectChapter(chapterId) {
    if (!whitepaper.value) return
    const { data } = await getWhitepaperChapter(whitepaper.value.id, chapterId)
    currentChapter.value = { id: data.id, title: data.title, body_html: data.body_html || '' }
  }

  async function saveCurrentChapter() {
    if (!whitepaper.value || !currentChapter.value) return
    saving.value = true
    try {
      await updateWhitepaperChapter(whitepaper.value.id, currentChapter.value.id, {
        title: currentChapter.value.title,
        body_html: currentChapter.value.body_html,
      })
      const ch = chapters.value.find(c => c.id === currentChapter.value.id)
      if (ch) {
        ch.title = currentChapter.value.title
        ch.is_empty = !currentChapter.value.body_html
      }
    } finally {
      saving.value = false
    }
  }

  async function addChapter(title) {
    if (!whitepaper.value) return
    const { data } = await createWhitepaperChapter(whitepaper.value.id, { title })
    chapters.value.push({ id: data.id, title: data.title, position: data.position, is_empty: 1 })
    await selectChapter(data.id)
  }

  async function removeChapter(chapterId) {
    if (!whitepaper.value) return
    await deleteWhitepaperChapter(whitepaper.value.id, chapterId)
    chapters.value = chapters.value.filter(c => c.id !== chapterId)
    if (currentChapter.value?.id === chapterId) {
      currentChapter.value = null
      if (chapters.value.length) await selectChapter(chapters.value[0].id)
    }
  }

  async function moveChapter(chapterId, direction) {
    if (!whitepaper.value) return
    const { data } = await moveWhitepaperChapter(whitepaper.value.id, chapterId, direction)
    chapters.value = data.slice().sort((a, b) => (a.position || 0) - (b.position || 0))
  }

  async function saveMeta(patch) {
    if (!whitepaper.value) return
    saving.value = true
    try {
      const { data } = await updateWhitepaper(whitepaper.value.id, patch)
      whitepaper.value = { ...whitepaper.value, ...data }
    } finally {
      saving.value = false
    }
  }

  async function remove() {
    if (!whitepaper.value) return
    await deleteWhitepaper(whitepaper.value.id)
  }

  // Genere le PDF et le publie / met a jour sur le FTP OVH buildy.fr.
  async function publish() {
    if (!whitepaper.value) return
    publishing.value = true
    try {
      const { data } = await publishWhitepaper(whitepaper.value.id)
      whitepaper.value = { ...whitepaper.value, ...data }
    } finally {
      publishing.value = false
    }
  }

  function reset() {
    whitepaper.value = null
    chapters.value = []
    companions.value = []
    currentChapter.value = null
  }

  return {
    whitepaper, chapters, companions, currentChapter, loading, saving, publishing,
    isCompanion, isHtmlMode, sourceInfo,
    load, selectChapter, saveCurrentChapter, addChapter, removeChapter,
    moveChapter, saveMeta, remove, reset, replaceSourceHtml, publish,
  }
})
