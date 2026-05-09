<script setup>
/**
 * Bibliotheque des sections types narratives.
 *
 * Mise en forme alignee sur LibraryFunctionalitiesView :
 *  - tableau plat en ordre DFS (parent suivi de ses descendants)
 *  - drag-drop scope par data-parent-id (onMove rejette les re-parentages)
 *  - colonne Photos avec drag-drop d'images sur les lignes
 *  - filtre : is_functionality=0 AND kind != 'equipment' (les equipements
 *    et fonctionnalites ont leurs pages dediees)
 */
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import Sortable from 'sortablejs'
import {
  PlusIcon, MagnifyingGlassIcon, XMarkIcon, PencilIcon, Bars3Icon, SparklesIcon, TagIcon,
  DocumentDuplicateIcon,
} from '@heroicons/vue/24/outline'
import {
  listSectionTemplates, reorderSectionTemplates, updateSectionTemplate,
  uploadSectionTemplateAttachment, listDocumentKinds, cloneSectionTemplate,
} from '@/api'
import ContentValidationDot from '@/components/ContentValidationDot.vue'
import { getValidationStatus } from '@/lib/content-validation'
import { library } from '@fortawesome/fontawesome-svg-core'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { faCamera } from '@fortawesome/pro-solid-svg-icons'
library.add(faCamera)
import BacsBadge from '@/components/BacsBadge.vue'
import SectionTemplateEditor from '@/components/SectionTemplateEditor.vue'
import BulkRegenerateModal from '@/components/BulkRegenerateModal.vue'
import BulkDocumentKindsModal from '@/components/BulkDocumentKindsModal.vue'
import TemplateAttachmentsGrid from '@/components/TemplateAttachmentsGrid.vue'
import BaseModal from '@/components/BaseModal.vue'
import { useNotification } from '@/composables/useNotification'
import { useRoute } from 'vue-router'

const { error: notifyError, success: notifySuccess } = useNotification()
const route = useRoute()

const items = ref([])           // sections types affichees
const allTemplates = ref([])    // tous les templates (pour parent_path / depth)
const search = ref('')
const validationFilter = ref('all') // 'all'|'pending'|'empty'|'draft'|'validated'
const editing = ref(null)
const showCreate = ref(false)
// Selection multiple pour le bulk-tagging des document_kinds.
// Set d'IDs de section_templates ; tout est conserve a travers le filtre/tri.
const selectedIds = ref(new Set())
const showBulkDocKinds = ref(false)
function toggleSelected(id) {
  const next = new Set(selectedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selectedIds.value = next
}
function isSelected(id) { return selectedIds.value.has(id) }
function clearSelection() { selectedIds.value = new Set() }
// Master checkbox : check si toutes les lignes visibles (flatItems) sont selectionnees,
// indeterminate si partiel. Toggle = tout cocher / tout decocher (sur la liste filtree).
const allFlatSelected = computed(() => {
  if (!flatItems.value.length) return false
  return flatItems.value.every(t => selectedIds.value.has(t.id))
})
const someFlatSelected = computed(() => {
  if (!flatItems.value.length) return false
  return flatItems.value.some(t => selectedIds.value.has(t.id))
})
function toggleAllFlat() {
  if (allFlatSelected.value) {
    // Tout decocher (uniquement les visibles)
    const next = new Set(selectedIds.value)
    for (const t of flatItems.value) next.delete(t.id)
    selectedIds.value = next
  } else {
    // Tout cocher (visibles)
    const next = new Set(selectedIds.value)
    for (const t of flatItems.value) next.add(t.id)
    selectedIds.value = next
  }
}
// Items selectionnes au format { id, title } pour la modale.
const selectedItems = computed(() => {
  const byId = new Map(allTemplates.value.map(t => [t.id, t]))
  return [...selectedIds.value].map(id => byId.get(id)).filter(Boolean).map(t => ({ id: t.id, title: t.title }))
})
const showBulk = ref(false)

// Modal Captures + drag-drop d'images sur une ligne
const photosModalTemplate = ref(null)
function openPhotos(t) { photosModalTemplate.value = t }
function closePhotos() {
  photosModalTemplate.value = null
  refresh()
}
const dragOverRowId = ref(null)
function onRowDragOver(e, t) {
  if (!e.dataTransfer?.types?.includes('Files')) return
  e.preventDefault()
  dragOverRowId.value = t.id
}
function onRowDragLeave() { dragOverRowId.value = null }
async function onRowDrop(e, t) {
  dragOverRowId.value = null
  const files = Array.from(e.dataTransfer?.files || []).filter(f => f.type.startsWith('image/'))
  if (!files.length) return
  e.preventDefault()
  try {
    for (const f of files) await uploadSectionTemplateAttachment(t.id, f)
    notifySuccess(`${files.length} capture${files.length > 1 ? 's' : ''} ajoutée${files.length > 1 ? 's' : ''} à « ${t.title} »`)
    await refresh()
  } catch {
    notifyError('Échec de l\'upload')
  }
}

// Items pour BulkRegenerateModal (sections narratives uniquement avec body_html)
const bulkItems = computed(() => items.value
  .filter(t => t.kind === 'standard' && (t.body_html || '').trim())
  .map(t => ({
    id: t.id,
    title: t.title,
    kind: 'narrative_section',
    payload: {
      bacs_articles: t.bacs_articles || null,
      current_template_id: t.id,
      parent_template_id: t.parent_template_id || null,
    },
  }))
)
function bulkGetHtml(it) {
  const t = items.value.find(x => x.id === it.id)
  return t?.body_html || ''
}
async function bulkSaveHtml(it, html) {
  await updateSectionTemplate(it.id, { body_html: html })
}

async function refresh() {
  // On recupere TOUS les templates pour pouvoir calculer le parent_path
  // (ancetres non-structurels inclus dans la chaine), puis on filtre
  // l'affichage aux sections structurelles.
  const { data: all } = await listSectionTemplates({})
  allTemplates.value = all
  items.value = all.filter(t => t.kind !== 'equipment' && !t.is_functionality)
  await nextTick()
  setupSortables()
}
function openEditor(t) { editing.value = t }
function openCreate() { showCreate.value = true }

// Clonage : duplique la section type + son sous-arbre. Le titre est
// pré-rempli avec « (copie) » suffixe, l'utilisateur peut l'ajuster.
const cloning = ref(null) // { id, title, originalTitle }
function openClone(t) {
  cloning.value = { id: t.id, title: `${t.title} (copie)`, originalTitle: t.title }
}
async function submitClone() {
  if (!cloning.value || !cloning.value.title.trim()) return
  try {
    const { data } = await cloneSectionTemplate(cloning.value.id, { title: cloning.value.title.trim() })
    notifySuccess(`« ${cloning.value.originalTitle} » dupliquée${data.cloned_count > 1 ? ` avec ${data.cloned_count - 1} sous-section${data.cloned_count - 1 > 1 ? 's' : ''}` : ''}`)
    cloning.value = null
    await refresh()
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Échec du clonage')
  }
}
async function onBulkDocKindsDone() {
  showBulkDocKinds.value = false
  clearSelection()
  await refresh()
}
async function onSaved() {
  editing.value = null
  showCreate.value = false
  await refresh()
}
async function onSavedInline(savedTpl) {
  await refresh()
  if (savedTpl?.id) {
    const fresh = items.value.find(t => t.id === savedTpl.id)
    if (fresh) editing.value = fresh
  }
}
async function onDeleted() {
  editing.value = null
  await refresh()
}

// parent_template_id -> { title, path } (pour groupement DFS)
const parentInfoById = computed(() => {
  const byId = new Map(allTemplates.value.map(t => [t.id, t]))
  function pathOf(t) {
    const parts = []
    let cur = t
    while (cur) {
      parts.unshift(cur.title)
      cur = cur.parent_template_id ? byId.get(cur.parent_template_id) : null
    }
    return parts.join(' › ')
  }
  const map = new Map()
  for (const t of allTemplates.value) map.set(t.id, { title: t.title, path: pathOf(t) })
  return map
})

// depth visuel = nombre d'ancetres affiches dans la table
const enrichedItems = computed(() => {
  const visibleIds = new Set(items.value.map(t => t.id))
  const byId = new Map(allTemplates.value.map(t => [t.id, t]))
  function visualDepth(t) {
    let d = 0
    let cur = t.parent_template_id ? byId.get(t.parent_template_id) : null
    while (cur) {
      if (visibleIds.has(cur.id)) d++
      cur = cur.parent_template_id ? byId.get(cur.parent_template_id) : null
    }
    return d
  }
  return items.value.map(t => {
    const p = t.parent_template_id ? parentInfoById.value.get(t.parent_template_id) : null
    return {
      ...t,
      parent_title: p?.title || null,
      parent_path: p?.path || null,
      visual_depth: visualDepth(t),
      validation_status: getValidationStatus(t, 'body_html'),
    }
  })
})

// Compteurs globaux par statut de validation (sur tous les items, pas
// filtres). Sert de KPI dans la barre de filtres.
const validationCounts = computed(() => {
  const counts = { empty: 0, draft: 0, validated: 0 }
  for (const t of enrichedItems.value) counts[t.validation_status]++
  return counts
})

// Liste plate ordonnee en DFS (parent suivi de ses enfants).
const flatItems = computed(() => {
  const q = search.value.trim().toLowerCase()
  const matchesValidation = (t) => {
    const f = validationFilter.value
    if (f === 'all') return true
    if (f === 'pending') return t.validation_status !== 'validated'
    return t.validation_status === f
  }
  const filtered = (q
    ? enrichedItems.value.filter(t =>
        (t.title || '').toLowerCase().includes(q) ||
        (t.bacs_articles || '').toLowerCase().includes(q) ||
        (t.parent_title || '').toLowerCase().includes(q)
      )
    : enrichedItems.value
  ).filter(matchesValidation)
  if (q || validationFilter.value !== 'all') return filtered

  const byParent = new Map()
  for (const t of filtered) {
    const k = t.parent_template_id || 'orphans'
    if (!byParent.has(k)) byParent.set(k, [])
    byParent.get(k).push(t)
  }
  for (const arr of byParent.values()) arr.sort((a, b) => (a.position || 0) - (b.position || 0))

  const visibleIds = new Set(filtered.map(t => t.id))
  const out = []
  const seen = new Set()
  function emit(parentKey) {
    const arr = byParent.get(parentKey)
    if (!arr) return
    for (const t of arr) {
      if (seen.has(t.id)) continue
      seen.add(t.id)
      out.push(t)
      if (byParent.has(t.id)) emit(t.id)
    }
  }
  // Racines : groupes dont la cle pointe vers un parent NON affiche
  const rootKeys = []
  for (const k of byParent.keys()) {
    if (k === 'orphans' || !visibleIds.has(k)) rootKeys.push(k)
  }
  rootKeys.sort((a, b) => {
    if (a === 'orphans') return 1
    if (b === 'orphans') return -1
    const pa = byParent.get(a)?.[0]?.parent_path || ''
    const pb = byParent.get(b)?.[0]?.parent_path || ''
    return pa.localeCompare(pb, 'fr')
  })
  for (const k of rootKeys) emit(k)
  return out
})

// Drag-drop : single Sortable + onMove pour empecher le re-parentage
const tbodyRef = ref(null)
let sortableInstance = null
function teardownSortables() {
  if (sortableInstance) {
    try { sortableInstance.destroy() } catch { /* ignore */ }
    sortableInstance = null
  }
}
function setupSortables() {
  teardownSortables()
  if (search.value.trim() || validationFilter.value !== 'all') return
  const el = tbodyRef.value
  if (!el) return
  // Buffer des descendants visuellement masques pendant le drag (UX : "le bloc
  // parent + enfants se deplace comme un tout"). Stockes au onStart, replaces
  // dans le DOM juste apres le parent au onEnd. Les attributs data-visual-depth
  // permettent d'identifier les descendants directs/indirects (toutes les <tr>
  // qui suivent le dragged et dont la profondeur > celle du dragged).
  let draggedDescendants = []
  sortableInstance = Sortable.create(el, {
    animation: 150,
    handle: '.drag-handle',
    ghostClass: 'sortable-ghost',
    chosenClass: 'sortable-chosen',
    dragClass: 'sortable-drag',
    onStart(evt) {
      draggedDescendants = []
      const draggedDepth = parseInt(evt.item.getAttribute('data-visual-depth') || '0', 10)
      let next = evt.item.nextElementSibling
      while (next) {
        const d = parseInt(next.getAttribute('data-visual-depth') || '0', 10)
        if (d <= draggedDepth) break
        draggedDescendants.push(next)
        next = next.nextElementSibling
      }
      // Masque visuellement les descendants : ils suivront le parent au drop.
      for (const tr of draggedDescendants) tr.style.display = 'none'
    },
    onMove(evt) {
      // Empeche le drop sur l'un des descendants masques (cas theorique : on
      // ne devrait pas pouvoir, mais securite).
      if (draggedDescendants.includes(evt.related)) return false
      const a = evt.dragged?.getAttribute('data-parent-id') || ''
      const b = evt.related?.getAttribute('data-parent-id') || ''
      return a === b
    },
    onEnd: async (evt) => {
      // Replace les descendants juste apres leur parent, dans l'ordre original.
      let insertAfter = evt.item
      for (const tr of draggedDescendants) {
        insertAfter.insertAdjacentElement('afterend', tr)
        tr.style.display = ''
        insertAfter = tr
      }
      const movedDescendants = draggedDescendants.length
      draggedDescendants = []

      // Si rien n'a bouge dans la fratrie ET pas de descendants a deplacer, skip.
      if (evt.oldIndex === evt.newIndex && movedDescendants === 0) return

      const draggedParent = evt.item.getAttribute('data-parent-id') || ''
      const ids = Array.from(el.children)
        .filter(li => (li.getAttribute('data-parent-id') || '') === draggedParent)
        .map(li => parseInt(li.getAttribute('data-id'), 10))
        .filter(Boolean)
      const parentId = draggedParent === '' ? null : parseInt(draggedParent, 10)
      try {
        await reorderSectionTemplates({ ids, parent_template_id: parentId })
        await refresh()
      } catch {
        notifyError('Échec de la réorganisation')
        await refresh()
      }
    },
  })
}

watch([flatItems, search], async () => {
  await nextTick()
  setupSortables()
}, { deep: false })

// Catalogue des types de documents (Lot — migration 78). Charge au mount
// pour mapper kind -> label et appliquer la couleur du badge dans la liste.
const documentKindsCatalog = ref([])
const KIND_BADGE_CLASS = {
  af:         'bg-indigo-50 text-indigo-700 border-indigo-200',
  brochure:   'bg-emerald-50 text-emerald-700 border-emerald-200',
  bacs_audit: 'bg-amber-50 text-amber-800 border-amber-200',
}
const KIND_SHORT_LABEL = {
  af: 'AF',
  brochure: 'Brochure',
  bacs_audit: 'Audit BACS',
}
function documentKindBadgeClass(kind) {
  return KIND_BADGE_CLASS[kind] || 'bg-gray-50 text-gray-600 border-gray-200'
}
function documentKindShortLabel(kind) {
  return KIND_SHORT_LABEL[kind] || kind
}
function documentKindLabel(kind) {
  const meta = documentKindsCatalog.value.find(d => d.kind === kind)
  return meta?.label || kind
}

onMounted(async () => {
  await refresh()
  try {
    const { data } = await listDocumentKinds()
    documentKindsCatalog.value = data || []
  } catch { /* silent — fallback sur les short labels */ }
  if (route.query.open) {
    const target = items.value.find(t => t.slug === route.query.open)
    if (target) openEditor(target)
  }
  await nextTick()
  setupSortables()
})
onBeforeUnmount(teardownSortables)
</script>

<template>
  <div class="max-w-screen-2xl mx-auto">
    <div class="mb-6 flex items-end justify-between gap-3">
      <div>
        <h1 class="text-2xl font-semibold text-gray-800">Bibliothèque de sections types</h1>
        <p class="text-sm text-gray-500 mt-1">
          {{ items.length }} section{{ items.length > 1 ? 's' : '' }} narrative{{ items.length > 1 ? 's' : '' }}
          dans l'arbre canonique de l'AF. Glisser-déposer pour réorganiser au sein d'une fratrie.
        </p>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <button @click="showBulk = true" :disabled="!bulkItems.length"
                class="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-violet-700 hover:text-violet-900 hover:bg-violet-50 rounded-lg whitespace-nowrap transition disabled:opacity-50">
          <SparklesIcon class="w-4 h-4" /> Régénérer avec Claude
        </button>
        <button @click="openCreate"
                class="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 rounded-lg shadow-sm whitespace-nowrap transition">
          <PlusIcon class="w-4 h-4" /> Nouvelle section type
        </button>
      </div>
    </div>

    <div class="flex items-center gap-3 mb-4 flex-wrap">
      <div class="relative max-w-md flex-1 min-w-65">
        <MagnifyingGlassIcon class="w-4 h-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
        <input v-model="search" type="text" placeholder="Rechercher (titre, BACS)…"
               autocomplete="off" data-1p-ignore="true" data-bwignore="true" data-lpignore="true"
               class="w-full pl-9 pr-9 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition" />
        <button v-if="search" @click="search = ''"
                class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700">
          <XMarkIcon class="w-4 h-4" />
        </button>
      </div>
      <div class="inline-flex items-center bg-gray-50 border border-gray-200 rounded-lg p-1 text-xs whitespace-nowrap">
        <button @click="validationFilter = 'all'"
                :class="['px-2.5 py-1 rounded-md transition font-medium',
                         validationFilter === 'all' ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500 hover:text-gray-700']">
          Tous
        </button>
        <button @click="validationFilter = 'validated'"
                :class="['px-2.5 py-1 rounded-md transition font-medium inline-flex items-center gap-1.5',
                         validationFilter === 'validated' ? 'bg-white shadow-sm text-emerald-700' : 'text-gray-500 hover:text-gray-700']">
          <span class="inline-block w-2 h-2 rounded-full bg-emerald-500"></span>
          Validés <span class="text-gray-400 font-normal">{{ validationCounts.validated }}</span>
        </button>
        <button @click="validationFilter = 'draft'"
                :class="['px-2.5 py-1 rounded-md transition font-medium inline-flex items-center gap-1.5',
                         validationFilter === 'draft' ? 'bg-white shadow-sm text-amber-700' : 'text-gray-500 hover:text-gray-700']">
          <span class="inline-block w-2 h-2 rounded-full bg-amber-400"></span>
          Brouillons <span class="text-gray-400 font-normal">{{ validationCounts.draft }}</span>
        </button>
        <button @click="validationFilter = 'empty'"
                :class="['px-2.5 py-1 rounded-md transition font-medium inline-flex items-center gap-1.5',
                         validationFilter === 'empty' ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500 hover:text-gray-700']">
          <span class="inline-block w-2 h-2 rounded-full bg-gray-300"></span>
          Vides <span class="text-gray-400 font-normal">{{ validationCounts.empty }}</span>
        </button>
        <button @click="validationFilter = 'pending'"
                title="Vide + brouillon (tout ce qui n'est pas encore validé)"
                :class="['px-2.5 py-1 rounded-md transition font-medium',
                         validationFilter === 'pending' ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500 hover:text-gray-700']">
          À traiter <span class="text-gray-400 font-normal">{{ validationCounts.empty + validationCounts.draft }}</span>
        </button>
      </div>
    </div>

    <div class="bg-white border border-gray-200 rounded-lg shadow-sm overflow-x-auto">
      <table class="w-full text-sm" style="table-layout: auto">
        <thead class="bg-gray-50 text-xs uppercase text-gray-500 tracking-wider">
          <tr>
            <th class="text-center px-2 py-2.5 w-8" v-tooltip="'Tout cocher / décocher (lignes visibles)'">
              <input type="checkbox" class="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500/30"
                     :checked="allFlatSelected"
                     :indeterminate.prop="!allFlatSelected && someFlatSelected"
                     @click.stop="toggleAllFlat" />
            </th>
            <th class="text-center px-2 py-2.5 w-8"></th>
            <th class="text-left px-4 py-2.5 whitespace-nowrap">Titre</th>
            <th class="text-center px-2 py-2.5 w-10" title="Captures d'écran (cliquer pour ouvrir, glisser une image dessus pour ajouter)">Photos</th>
            <th class="text-left px-4 py-2.5 whitespace-nowrap">BACS</th>
            <th class="text-left px-4 py-2.5 whitespace-nowrap" v-tooltip="'Documents où cette section apparaît (AF / Brochure / Audit BACS / Audit GTB)'">Documents</th>
            <th class="text-center px-4 py-2.5 whitespace-nowrap">AFs</th>
            <th class="text-center px-4 py-2.5 whitespace-nowrap"></th>
          </tr>
        </thead>
        <tbody ref="tbodyRef">
          <tr v-for="t in flatItems" :key="t.id" :data-id="t.id"
              :data-parent-id="t.parent_template_id || ''"
              :data-visual-depth="t.visual_depth || 0"
              :class="['border-t border-gray-100 hover:bg-indigo-50/40 cursor-pointer transition-colors',
                       isSelected(t.id) ? 'bg-indigo-50/60' : '',
                       dragOverRowId === t.id ? 'bg-indigo-100 ring-2 ring-indigo-400 ring-inset' : '']"
              @click="openEditor(t)"
              @dragover="onRowDragOver($event, t)"
              @dragleave="onRowDragLeave"
              @drop="onRowDrop($event, t)">
            <td class="px-2 py-2 text-center align-middle" @click.stop>
              <input type="checkbox" class="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500/30"
                     :checked="isSelected(t.id)"
                     @change="toggleSelected(t.id)" />
            </td>
            <td class="px-2 py-2 text-center align-middle drag-handle cursor-grab text-gray-300 hover:text-gray-500"
                @click.stop>
              <Bars3Icon class="w-4 h-4 inline-block" />
            </td>
            <td class="px-4 py-2 font-medium text-gray-800 whitespace-nowrap"
                :style="t.visual_depth ? `padding-left: ${16 + t.visual_depth * 18}px` : ''">
              <span v-if="t.visual_depth" class="text-gray-400 mr-1.5">↳</span>
              <ContentValidationDot :status="t.validation_status"
                                    :validated-at="t.content_validated_at"
                                    :validated-by="t.content_validated_by_name"
                                    class="mr-2 align-middle" />
              {{ t.title }}
            </td>
            <td class="px-2 py-2 text-center align-middle" @click.stop>
              <button
                type="button"
                @click="openPhotos(t)"
                :class="['inline-flex items-center gap-1 px-1.5 py-1 rounded-md transition',
                         t.attachments_count > 0
                           ? 'text-emerald-600 hover:bg-emerald-100'
                           : 'text-gray-300 hover:bg-gray-100 hover:text-gray-500']"
                :title="t.attachments_count > 0
                  ? `${t.attachments_count} capture${t.attachments_count > 1 ? 's' : ''} — cliquer pour gérer`
                  : 'Aucune capture — cliquer pour en ajouter ou glisser une image sur la ligne'"
              >
                <FontAwesomeIcon :icon="['fas', 'camera']" class="w-4 h-4" />
                <span v-if="t.attachments_count > 0" class="text-[11px] font-semibold">{{ t.attachments_count }}</span>
              </button>
            </td>
            <td class="px-4 py-2 whitespace-nowrap">
              <BacsBadge v-if="t.bacs_articles" :reference="t.bacs_articles" />
              <span v-else class="text-gray-300 italic text-xs">—</span>
            </td>
            <td class="px-4 py-2 whitespace-nowrap">
              <div v-if="t.document_kinds?.length" class="flex flex-wrap gap-1">
                <span v-for="dk in t.document_kinds" :key="dk"
                      :class="['inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border whitespace-nowrap',
                               documentKindBadgeClass(dk)]"
                      v-tooltip="documentKindLabel(dk)">
                  {{ documentKindShortLabel(dk) }}
                </span>
              </div>
              <span v-else class="text-amber-700 italic text-[11px]" title="Cette section n'apparaît dans aucun document">⚠ aucun</span>
            </td>
            <td class="px-4 py-2 text-center text-xs whitespace-nowrap">
              <span v-if="t.outdated_count > 0" class="inline-block px-1.5 py-0.5 bg-amber-100 text-amber-800 rounded" v-tooltip="'AFs utilisant cette section / AFs avec mise à jour en attente'">
                {{ t.affected_afs_count }} <span class="text-amber-600">↻{{ t.outdated_count }}</span>
              </span>
              <span v-else-if="t.affected_afs_count > 0" class="text-gray-500">{{ t.affected_afs_count }}</span>
              <span v-else class="text-gray-300 italic" v-tooltip="'Jamais utilisée — candidate au nettoyage'">∅</span>
            </td>
            <td class="px-4 py-2 text-center whitespace-nowrap" @click.stop>
              <button type="button" @click="openClone(t)"
                      class="inline-flex items-center justify-center w-7 h-7 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition mr-1"
                      v-tooltip="'Dupliquer cette section type (avec son sous-arbre)'">
                <DocumentDuplicateIcon class="w-4 h-4" />
              </button>
              <button type="button" @click="openEditor(t)"
                      class="inline-flex items-center justify-center w-7 h-7 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition"
                      v-tooltip="'Éditer'">
                <PencilIcon class="w-4 h-4" />
              </button>
            </td>
          </tr>
          <tr v-if="!flatItems.length">
            <td colspan="8" class="px-4 py-8 text-center text-sm text-gray-400 italic">
              {{ search ? `Aucune section ne correspond à « ${search} ».` : 'Aucune section type.' }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Toolbar flottante de bulk-edit (apparait quand au moins une section est cochee) -->
    <Transition
      enter-active-class="transition duration-150 ease-out"
      enter-from-class="opacity-0 translate-y-4"
      enter-to-class="opacity-100 translate-y-0"
      leave-active-class="transition duration-100 ease-in"
      leave-from-class="opacity-100 translate-y-0"
      leave-to-class="opacity-0 translate-y-4"
    >
      <div v-if="selectedIds.size > 0"
           class="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-white border border-gray-200 shadow-xl rounded-full pl-4 pr-2 py-2 flex items-center gap-3">
        <span class="text-sm font-medium text-gray-700 whitespace-nowrap">
          {{ selectedIds.size }} section{{ selectedIds.size > 1 ? 's' : '' }} sélectionnée{{ selectedIds.size > 1 ? 's' : '' }}
        </span>
        <span class="w-px h-5 bg-gray-200" />
        <button type="button" @click="showBulkDocKinds = true"
                class="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-full transition whitespace-nowrap">
          <TagIcon class="w-4 h-4" /> Modifier les tags…
        </button>
        <button type="button" @click="clearSelection"
                class="inline-flex items-center gap-1 px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-full transition whitespace-nowrap"
                v-tooltip="'Annuler la sélection'">
          <XMarkIcon class="w-4 h-4" />
        </button>
      </div>
    </Transition>

    <BulkDocumentKindsModal
      v-if="showBulkDocKinds"
      :selected="selectedItems"
      :document-kinds-catalog="documentKindsCatalog"
      @close="showBulkDocKinds = false"
      @done="onBulkDocKindsDone"
    />

    <SectionTemplateEditor
      v-if="editing"
      :template="editing"
      mode="standard"
      @close="editing = null"
      @saved="onSaved"
      @saved-inline="onSavedInline"
      @deleted="onDeleted"
    />

    <SectionTemplateEditor
      v-if="showCreate"
      :template="{}"
      mode="standard"
      @close="showCreate = false"
      @saved="onSaved"
    />

    <BulkRegenerateModal
      v-if="showBulk"
      v-tooltip="'Régénérer les sections types avec Claude'"
      :items="bulkItems"
      :get-html="bulkGetHtml"
      :on-save-html="bulkSaveHtml"
      @close="showBulk = false; refresh()"
      @done="refresh()"
    />

    <BaseModal
      v-if="photosModalTemplate"
      :title="`Captures d'écran — ${photosModalTemplate.title}`"
      size="lg"
      @close="closePhotos"
    >
      <TemplateAttachmentsGrid
        template-kind="section"
        :template-id="photosModalTemplate.id"
      />
      <template #footer>
        <button @click="closePhotos"
                class="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 rounded-lg transition">
          Fermer
        </button>
      </template>
    </BaseModal>

    <BaseModal
      v-if="cloning"
      :title="'Dupliquer la section type'"
      size="md"
      @close="cloning = null"
    >
      <form @submit.prevent="submitClone" class="space-y-3">
        <p class="text-xs text-gray-600">
          Toute la sous-arborescence de
          <span class="font-medium text-gray-800">« {{ cloning.originalTitle }} »</span>
          sera dupliquée. Les captures sont également répliquées.
        </p>
        <div>
          <label class="block text-xs font-medium text-gray-700 mb-1">Titre de la copie</label>
          <input v-model="cloning.title" type="text" required autocomplete="off"
                 class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition" />
        </div>
      </form>
      <template #footer>
        <button @click="cloning = null"
                class="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 rounded-lg transition whitespace-nowrap">
          Annuler
        </button>
        <button @click="submitClone" :disabled="!cloning.title.trim()"
                class="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition disabled:opacity-50 whitespace-nowrap">
          Dupliquer
        </button>
      </template>
    </BaseModal>
  </div>
</template>

<style scoped>
.sortable-ghost { opacity: 0.4; background: #eef2ff; }
.sortable-chosen { background: #eef2ff; }
.sortable-drag { background: white; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
</style>
