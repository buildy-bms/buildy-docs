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
      arr.forEach((s, i) => {
        const num = prefix ? `${prefix}.${i + 1}` : String(i + 1)
        map.set(s.id, num)
        walk(s.id, num)
      })
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

  async function loadAf(id) {
    $reset()
    loading.value = true
    try {
      const [{ data: afData }, { data: sectionsData }] = await Promise.all([
        getAf(id),
        listSections(id),
      ])
      af.value = afData
      sections.value = sectionsData || []
      // Selectionne la 1re section root par defaut
      if (sections.value.length) {
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
    sections.value = (await listSections(af.value.id)).data
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
    af.value = { ...af.value, ...updated }
  }

  // Patch local + serveur d'une section. Optimiste : si l'API echoue,
  // l'appelant gere le rollback (cas typique des toggles include/opt-out).
  async function patchSection(sectionId, patch) {
    const idx = sections.value.findIndex(s => s.id === sectionId)
    const original = idx >= 0 ? sections.value[idx] : null
    if (idx >= 0) sections.value[idx] = { ...sections.value[idx], ...patch }
    try {
      await updateSection(sectionId, patch)
      if (selectedSection.value?.id === sectionId) {
        selectedSection.value = { ...selectedSection.value, ...patch }
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
