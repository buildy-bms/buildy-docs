import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import {
  getAf, listSections, getSection, createSection, deleteSection, updateSection,
} from '@/api'

/**
 * Store Pinia pour une fiche AF (analyse fonctionnelle GTB).
 *
 * Centralise l'etat (`af`, `sections`, `selectedSection`, `loading`) et les
 * actions de fetch / mutation pour eviter la prolifération de refs locales
 * dans `AfDetailView` et la duplication de logique dans les sous-composants.
 *
 * Pattern aligne sur `useAuditStore` (audit BACS).
 */
export const useAfStore = defineStore('af', () => {
  // ── State ──
  const af = ref(null)
  const sections = ref([])
  const selectedId = ref(null)
  const selectedSection = ref(null)
  const loading = ref(true)

  // Bumpe pour forcer un recalcul du niveau requis quand une section change
  // de service_level / inclusion / opt-out (utilise par RequiredServiceLevelPanel).
  const requiredLevelKey = ref(0)

  // ── Getters ──
  const afId = computed(() => af.value?.id || null)

  // Numerotation auto des sections (1, 1.1, 1.2, 2…) calculee depuis l'arbre
  // (parent_id + position). Map<sectionId, "1.2.3">.
  // Aligne sur la numerotation du PDF AF : les sections exclues de l'export
  // (`included_in_export = 0`) ne sont PAS numerotees et ne decalent pas leurs
  // freres. Les sections opt-out (`opted_out_by_moa = 1`) restent numerotees
  // (elles apparaissent dans le PDF avec un badge "Ecartee par MOA").
  const liveSectionNumbering = computed(() => {
    const map = new Map()
    const byParent = new Map()
    for (const s of sections.value) {
      const k = s.parent_id || 'root'
      if (!byParent.has(k)) byParent.set(k, [])
      byParent.get(k).push(s)
    }
    for (const arr of byParent.values()) {
      arr.sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    }
    function walk(parentKey, prefix) {
      const arr = byParent.get(parentKey) || []
      let idx = 0
      for (const s of arr) {
        // Skip sections exclues de l'export : pas de numero et pas de
        // decalage des suivantes (= meme comportement que le PDF).
        if (s.included_in_export === 0) {
          // Continue le walk pour numeroter les eventuels descendants
          // visibles, en utilisant un prefix vide (pas de numero parent).
          walk(s.id, '')
          continue
        }
        idx++
        const num = prefix ? `${prefix}.${idx}` : String(idx)
        map.set(s.id, num)
        walk(s.id, num)
      }
    }
    walk('root', '')
    return map
  })

  // Liste plate triee selon l'ordre d'affichage dans l'arbre (parent + position).
  // Utilisee pour la navigation clavier flèches haut/bas entre sections.
  const orderedSections = computed(() => {
    const byParent = new Map()
    for (const s of sections.value) {
      const k = s.parent_id || 'root'
      if (!byParent.has(k)) byParent.set(k, [])
      byParent.get(k).push(s)
    }
    for (const arr of byParent.values()) {
      arr.sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    }
    const out = []
    function walk(parentKey) {
      for (const s of byParent.get(parentKey) || []) {
        out.push(s)
        walk(s.id)
      }
    }
    walk('root')
    return out
  })

  // Fil d'Ariane : chaine d'ancetres de la section selectionnee (sans la
  // section courante elle-meme). Permet a l'utilisateur de remonter le
  // contexte quand il edite une section profonde.
  const breadcrumbTrail = computed(() => {
    if (!selectedSection.value) return []
    const byId = new Map(sections.value.map(s => [s.id, s]))
    const trail = []
    let cur = selectedSection.value
    while (cur) {
      trail.unshift(cur)
      cur = cur.parent_id ? byId.get(cur.parent_id) : null
    }
    return trail.slice(0, -1)
  })

  const sectionsCountByKind = computed(() => {
    const c = { standard: 0, equipment: 0, hyperveez_page: 0, synthesis: 0 }
    for (const s of sections.value) c[s.kind] = (c[s.kind] || 0) + 1
    return c
  })

  // Nombre de sections verifiees / total — pour KPI dans la sidebar.
  // Reutilise la colonne fact_check_status (= 'verified' quand l'utilisateur
  // a marque la section comme finie via le bouton "Vérifiée" dans
  // SectionEditor). Pas de duplication avec un autre statut "validated_at".
  const verificationProgress = computed(() => {
    const total = sections.value.filter(s => s.included_in_export).length
    const verified = sections.value.filter(s => s.included_in_export && s.fact_check_status === 'verified').length
    return { total, verified, ratio: total ? verified / total : 0 }
  })

  // ── Actions ──
  function $reset() {
    af.value = null
    sections.value = []
    selectedId.value = null
    selectedSection.value = null
    loading.value = true
    requiredLevelKey.value = 0
  }

  // Cache localStorage de la structure d'AF (light sections + meta) pour
  // un rendu instantane lors d'une revisite de l'AF. Les donnees fraiches
  // sont ramenees en arriere-plan et remplacent le cache des qu'elles
  // arrivent (stale-while-revalidate).
  const CACHE_KEY = (id) => `af-${id}-structure-v1`
  function readCache(id) {
    if (typeof window === 'undefined') return null
    try {
      const raw = window.localStorage.getItem(CACHE_KEY(id))
      if (!raw) return null
      const parsed = JSON.parse(raw)
      // TTL 7 jours pour eviter d'afficher des donnees trop datees si
      // l'utilisateur revient apres une longue absence.
      if (!parsed?.ts || Date.now() - parsed.ts > 7 * 24 * 3600 * 1000) return null
      return parsed
    } catch { return null }
  }
  function writeCache(id, payload) {
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(CACHE_KEY(id), JSON.stringify({ ...payload, ts: Date.now() }))
    } catch { /* quota / private mode -> ignore */ }
  }

  async function loadAf(id) {
    $reset()
    // 1) Hydrate immediat depuis le cache si disponible -> tree visible
    //    sans attendre le reseau. La fraicheur arrive ensuite.
    const cached = readCache(id)
    if (cached?.af && Array.isArray(cached.sections)) {
      af.value = cached.af
      sections.value = cached.sections
      loading.value = false
      // Selectionne la 1re section pendant qu'on rafraichit (best effort)
      if (sections.value.length) selectSection(sections.value[0].id).catch(() => {})
    } else {
      loading.value = true
    }
    // 2) Refresh reseau (toujours, meme si cache hit) — light = sans body_html
    try {
      const [{ data: afData }, { data: sectionsData }] = await Promise.all([
        getAf(id),
        listSections(id, { light: true }),
      ])
      af.value = afData
      sections.value = sectionsData || []
      writeCache(id, { af: afData, sections: sectionsData || [] })
      if (!cached && sections.value.length) {
        await selectSection(sections.value[0].id)
      }
    } finally {
      loading.value = false
    }
  }

  async function refreshAf() {
    if (!af.value) return
    af.value = (await getAf(af.value.id)).data
  }

  async function refreshSections() {
    if (!af.value) return
    sections.value = (await listSections(af.value.id, { light: true })).data
    writeCache(af.value.id, { af: af.value, sections: sections.value })
    if (!selectedId.value && sections.value.length) {
      await selectSection(sections.value[0].id)
    }
  }

  async function selectSection(id) {
    selectedId.value = id
    const { data } = await getSection(id)
    selectedSection.value = data
  }

  function patchSelectedAfUpdate(updated) {
    if (!af.value) return
    const before = af.value.service_level
    af.value = { ...af.value, ...updated }
    // Si le niveau contractuel change, on force le recalcul du panel
    // « Niveau requis » (verdict OK / Dépasse / Aucun contrat) — sinon
    // l'utilisateur doit refresh la page après un changement de contrat.
    if (updated.service_level !== undefined && updated.service_level !== before) {
      requiredLevelKey.value++
    }
  }

  // Patch local + serveur d'une section. Optimiste : si l'API echoue,
  // l'appelant gere le rollback (cas typique des toggles include/opt-out).
  // Les colonnes booleennes SQLite sont stockees en 0/1 : on normalise les
  // booleens recus dans le patch pour que les comparateurs `=== 1` cote tree
  // restent coherents apres l'update optimiste (sinon UI non reactive).
  function normalizePatch(patch) {
    const norm = { ...patch }
    for (const key of ['opted_out_by_moa', 'demanded_by_moa', 'optin_paid_option', 'included_in_export']) {
      if (typeof norm[key] === 'boolean') norm[key] = norm[key] ? 1 : 0
    }
    return norm
  }
  async function patchSection(sectionId, patch) {
    const localPatch = normalizePatch(patch)
    const idx = sections.value.findIndex(s => s.id === sectionId)
    const original = idx >= 0 ? sections.value[idx] : null
    if (idx >= 0) sections.value[idx] = { ...sections.value[idx], ...localPatch }
    if (selectedSection.value?.id === sectionId) {
      selectedSection.value = { ...selectedSection.value, ...localPatch }
    }
    // Si le patch touche un flag qui se cascade aux descendants cote
    // backend (opted_out / demanded / included_in_export), on refresh
    // toute la liste pour propager visuellement la cascade au tree.
    const cascadeKeys = ['opted_out_by_moa', 'demanded_by_moa', 'optin_paid_option', 'included_in_export']
    const triggersCascade = cascadeKeys.some(k => k in patch)
    try {
      await updateSection(sectionId, patch)
      if (triggersCascade) {
        await refreshSections()
      }
      requiredLevelKey.value++
    } catch (err) {
      // Rollback
      if (original && idx >= 0) sections.value[idx] = original
      throw err
    }
  }

  async function createNewSection(payload) {
    if (!af.value) return null
    const { data } = await createSection(af.value.id, payload)
    await refreshSections()
    return data
  }

  async function removeSection(sectionId) {
    await deleteSection(sectionId)
    if (selectedId.value === sectionId) {
      selectedId.value = null
      selectedSection.value = null
    }
    await refreshSections()
  }

  // Mise a jour de la section selectionnee depuis SectionEditor (autosave).
  // Met a jour aussi la liste plate pour que le tree affiche les changements.
  function applySectionUpdate(updated) {
    const idx = sections.value.findIndex(s => s.id === updated.id)
    if (idx >= 0) {
      sections.value[idx] = { ...sections.value[idx], ...updated }
    }
    if (selectedSection.value?.id === updated.id) {
      selectedSection.value = { ...selectedSection.value, ...updated }
    }
    requiredLevelKey.value++
  }

  return {
    // state
    af, sections, selectedId, selectedSection, loading, requiredLevelKey,
    // getters
    afId, liveSectionNumbering, orderedSections, breadcrumbTrail,
    sectionsCountByKind, verificationProgress,
    // actions
    $reset, loadAf, refreshAf, refreshSections, selectSection,
    patchSelectedAfUpdate, patchSection, createNewSection, removeSection,
    applySectionUpdate,
  }
})
