<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import Sortable from 'sortablejs'
import {
  MagnifyingGlassIcon, XMarkIcon, PencilIcon, PlusIcon, Bars3Icon, SparklesIcon,
  EyeIcon, DocumentArrowDownIcon, DocumentDuplicateIcon,
} from '@heroicons/vue/24/outline'
import {
  listSectionTemplates, reorderSectionTemplates, updateSectionTemplate,
  uploadSectionTemplateAttachment, previewOfferingsUrl, exportOfferingsPdfUrl,
  cloneSectionTemplate,
} from '@/api'
import PdfPreviewModal from '@/components/PdfPreviewModal.vue'
import BacsBadge from '@/components/BacsBadge.vue'
import SectionTemplateEditor from '@/components/SectionTemplateEditor.vue'
import BulkRegenerateModal from '@/components/BulkRegenerateModal.vue'
import TemplateAttachmentsGrid from '@/components/TemplateAttachmentsGrid.vue'
import BaseModal from '@/components/BaseModal.vue'
import { library } from '@fortawesome/fontawesome-svg-core'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import * as allSolidIcons from '@fortawesome/pro-solid-svg-icons'
library.add(...Object.values(allSolidIcons).filter(i => i && i.iconName && i.icon))
import { useNotification } from '@/composables/useNotification'

const { error: notifyError, success: notifySuccess } = useNotification()

// Modal "Captures d'ecran" : ouvert quand on clique sur l'icone camera
// d'une feature dans la liste. Reutilise TemplateAttachmentsGrid.
const photosModalTemplate = ref(null)
function openPhotos(t) { photosModalTemplate.value = t }
function closePhotos() {
  photosModalTemplate.value = null
  // Refresh des items pour propager le nouveau attachments_count
  refresh()
}

// Drag-drop d'une image sur une ligne -> upload direct sur ce template.
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
    for (const f of files) {
      await uploadSectionTemplateAttachment(t.id, f)
    }
    notifySuccess(`${files.length} capture${files.length > 1 ? 's' : ''} ajoutée${files.length > 1 ? 's' : ''} à « ${t.title} »`)
    await refresh()
  } catch {
    notifyError('Échec de l\'upload')
  }
}

// Statuts visuels pour la matrice de disponibilite
const AVAIL_STYLES = {
  included:    { icon: '✓', label: 'Inclus',         cls: 'bg-emerald-100 text-emerald-700 border-emerald-300' },
  paid_option: { icon: '€', label: 'Option payante', cls: 'bg-amber-100 text-amber-800 border-amber-300' },
}
function availCell(value) {
  if (!value) return null
  return AVAIL_STYLES[value] || null
}
const items = ref([])
const allTemplates = ref([])
const search = ref('')
const editing = ref(null)
const showCreate = ref(false)
const showBulk = ref(false)
const offeringsPreviewOpen = ref(false)
const generatingOfferings = ref(false)
const generatingBrochure = ref(false)

async function downloadPdfFromRoute(route, fallbackName, loadingRef, errorMsg) {
  loadingRef.value = true
  try {
    const { default: api } = await import('@/api')
    const response = await api.post(route, {}, { responseType: 'blob' })
    const dispo = response.headers['content-disposition'] || ''
    const match = /filename="([^"]+)"/.exec(dispo)
    const filename = match ? match[1] : fallbackName
    const url = URL.createObjectURL(response.data)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  } catch (e) {
    notifyError(errorMsg)
  } finally {
    loadingRef.value = false
  }
}

const downloadOfferingsPdf = () => downloadPdfFromRoute(
  '/offerings/export-pdf',
  `offres-buildy-${new Date().getFullYear()}.pdf`,
  generatingOfferings,
  'Échec de la génération du PDF des offres',
)
const downloadBrochurePdf = () => downloadPdfFromRoute(
  '/offerings/brochure-pdf',
  `brochure-buildy-${new Date().getFullYear()}.pdf`,
  generatingBrochure,
  'Échec de la génération de la brochure',
)

// Items mappes au format attendu par BulkRegenerateModal
const bulkItems = computed(() => items.value
  .filter(t => (t.body_html || '').trim())
  .map(t => ({
    id: t.id,
    title: t.title,
    kind: 'functionality',
    payload: {
      bacs_articles: t.bacs_articles || null,
      avail_e: t.avail_e, avail_s: t.avail_s, avail_p: t.avail_p,
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
function openEditor(t) { editing.value = t }
function openCreate() { showCreate.value = true }

// Clonage : duplique la fonctionnalité + son sous-arbre.
const cloning = ref(null)
function openClone(t) {
  cloning.value = { id: t.id, title: `${t.title} (copie)`, originalTitle: t.title }
}
async function submitClone() {
  if (!cloning.value || !cloning.value.title.trim()) return
  try {
    const { data } = await cloneSectionTemplate(cloning.value.id, { title: cloning.value.title.trim() })
    notifySuccess(`« ${cloning.value.originalTitle} » dupliquée${data.cloned_count > 1 ? ` avec ${data.cloned_count - 1} sous-fonctionnalité${data.cloned_count - 1 > 1 ? 's' : ''}` : ''}`)
    cloning.value = null
    await refresh()
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Échec du clonage')
  }
}
async function onSaved() {
  editing.value = null
  showCreate.value = false
  await refresh()
}
async function onDeleted() {
  editing.value = null
  await refresh()
}

async function refresh() {
  const [funcs, all] = await Promise.all([
    listSectionTemplates({ kind: 'functionality' }),
    listSectionTemplates({}),
  ])
  items.value = funcs.data
  allTemplates.value = all.data
}

// Carte parent_id -> { title, path } pour afficher la section parente
// avec son chemin (ex: "Bibliothèque › Application Hyperveez").
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
  for (const t of allTemplates.value) {
    map.set(t.id, { title: t.title, path: pathOf(t) })
  }
  return map
})

// Items enrichis du parent_title + path pour affichage et regroupement.
// feature_depth = nb d'ancetres qui sont aussi des features (is_functionality=1).
// Permet d'indenter visuellement les sous-fonctionnalites sous leur parent
// (ex: "Surveillance et controle" sous "Fonctionnalites Gojee de base").
// Le groupement par parent racine (categorie non-feature) reste sur la
// classification deja existante via parent_path.
const enrichedItems = computed(() => {
  const byId = new Map(allTemplates.value.map(t => [t.id, t]))
  function featureDepth(t) {
    let d = 0
    let cur = t.parent_template_id ? byId.get(t.parent_template_id) : null
    while (cur) {
      if (cur.is_functionality) d++
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
      feature_depth: featureDepth(t),
    }
  })
})

// Liste plate ordonnee en DFS de l'arbre des fonctionnalites :
// chaque feature parente est immediatement suivie de ses enfants
// (transitif), puis on passe au sibling suivant. Les indentations
// (feature_depth) rendent la hierarchie lisible.
//
// En mode recherche, on garde l'ordre plat brut (la hierarchie n'a
// plus de sens quand on filtre).
const flatItems = computed(() => {
  const q = search.value.trim().toLowerCase()
  const filtered = q
    ? enrichedItems.value.filter(t =>
        (t.title || '').toLowerCase().includes(q) ||
        (t.bacs_articles || '').toLowerCase().includes(q) ||
        (t.parent_title || '').toLowerCase().includes(q)
      )
    : enrichedItems.value
  if (q) return filtered

  // Index par parent_template_id, trie par position ascendante
  const byParent = new Map()
  for (const t of filtered) {
    const k = t.parent_template_id || 'orphans'
    if (!byParent.has(k)) byParent.set(k, [])
    byParent.get(k).push(t)
  }
  for (const arr of byParent.values()) arr.sort((a, b) => (a.position || 0) - (b.position || 0))

  const featureIds = new Set(filtered.map(t => t.id))
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
  // Racines : groupes dont la cle n'est PAS un id de feature affiche
  // (donc 'orphans' ou bien un parent_template_id qui pointe vers une
  // section non-functionality — categorie de regroupement).
  const rootKeys = []
  for (const k of byParent.keys()) {
    if (k === 'orphans' || !featureIds.has(k)) rootKeys.push(k)
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

// Drag-drop : un seul Sortable sur le tbody plat. onMove valide que
// le drop reste au sein de la meme fratrie (meme parent_template_id),
// sinon on rejette (pas de re-parentage par drag).
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
  if (search.value.trim()) return // pas de drag-drop pendant la recherche
  const el = tbodyRef.value
  if (!el) return
  sortableInstance = Sortable.create(el, {
    animation: 150,
    handle: '.drag-handle',
    ghostClass: 'sortable-ghost',
    chosenClass: 'sortable-chosen',
    dragClass: 'sortable-drag',
    onMove(evt) {
      // Refuse tout drop sur une ligne d'un autre parent
      const a = evt.dragged?.getAttribute('data-parent-id') || ''
      const b = evt.related?.getAttribute('data-parent-id') || ''
      return a === b
    },
    onEnd: async (evt) => {
      if (evt.oldIndex === evt.newIndex) return
      const draggedParent = evt.item.getAttribute('data-parent-id') || ''
      // Recolte les ids de la fratrie dans le nouvel ordre DOM
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

import { useRoute } from 'vue-router'
const route = useRoute()
onMounted(async () => {
  await refresh()
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
        <h1 class="text-2xl font-semibold text-gray-800">Bibliothèque de fonctionnalités</h1>
        <p class="text-sm text-gray-500 mt-1">
          {{ items.length }} fonctionnalité{{ items.length > 1 ? 's' : '' }} Buildy, regroupées par section parente.
        </p>
      </div>
      <div class="flex items-center gap-2">
        <button @click="offeringsPreviewOpen = true"
                title="Aperçu du tableau des offres Buildy (matrice fonctionnalités × niveaux E/S/P)"
                class="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-emerald-700 hover:text-emerald-900 hover:bg-emerald-50 rounded-lg whitespace-nowrap transition">
          <EyeIcon class="w-4 h-4" /> Aperçu offres
        </button>
        <button @click="downloadOfferingsPdf" :disabled="generatingOfferings"
                title="Télécharger le PDF du catalogue Buildy 2026 (régénéré depuis la base)"
                class="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded-lg whitespace-nowrap transition disabled:opacity-50">
          <DocumentArrowDownIcon class="w-4 h-4" /> {{ generatingOfferings ? 'Génération…' : 'Tableau des offres' }}
        </button>
        <button @click="downloadBrochurePdf" :disabled="generatingBrochure"
                title="Télécharger la brochure : référentiel détaillé de chaque fonctionnalité (annexe au tableau des offres)"
                class="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 hover:bg-indigo-100 rounded-lg whitespace-nowrap transition disabled:opacity-50">
          <DocumentArrowDownIcon class="w-4 h-4" /> {{ generatingBrochure ? 'Génération…' : 'Brochure détaillée' }}
        </button>
        <button @click="showBulk = true" :disabled="!bulkItems.length"
                class="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-violet-700 hover:text-violet-900 hover:bg-violet-50 rounded-lg whitespace-nowrap transition disabled:opacity-50">
          <SparklesIcon class="w-4 h-4" /> Régénérer avec Claude
        </button>
        <button @click="openCreate"
                class="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 rounded-lg shadow-sm whitespace-nowrap transition">
          <PlusIcon class="w-4 h-4" /> Nouvelle fonctionnalité
        </button>
      </div>
    </div>

    <div class="relative max-w-md mb-4">
      <MagnifyingGlassIcon class="w-4 h-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
      <input v-model="search" type="text" placeholder="Rechercher (titre, BACS)…"
             autocomplete="off" data-1p-ignore="true" data-bwignore="true" data-lpignore="true"
             class="w-full pl-9 pr-9 py-2 border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
      <button v-if="search" @click="search = ''"
              class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700">
        <XMarkIcon class="w-4 h-4" />
      </button>
    </div>

    <div class="bg-white border border-gray-200 rounded-lg shadow-sm overflow-x-auto">
      <table class="w-full text-sm" style="table-layout: auto">
        <thead class="bg-gray-50 text-xs uppercase text-gray-500 tracking-wider">
          <tr>
            <th class="text-center px-2 py-2.5 w-8"></th>
            <th class="text-left px-4 py-2.5 whitespace-nowrap">Titre</th>
            <th class="text-center px-2 py-2.5 w-10" title="Captures d'écran (cliquer pour ouvrir, glisser une image dessus pour ajouter)">Photos</th>
            <th class="text-center px-3 py-2.5 whitespace-nowrap">Essentials</th>
            <th class="text-center px-3 py-2.5 whitespace-nowrap">Smart</th>
            <th class="text-center px-3 py-2.5 whitespace-nowrap">Premium</th>
            <th class="text-left px-4 py-2.5 whitespace-nowrap">BACS</th>
            <th class="text-center px-4 py-2.5 whitespace-nowrap">AFs</th>
            <th class="text-center px-4 py-2.5 whitespace-nowrap"></th>
          </tr>
        </thead>
        <!-- Un seul tbody : items en ordre DFS (parent suivi de ses enfants).
             Drag-drop scopage par data-parent-id (cf. setupSortables.onMove). -->
        <tbody ref="tbodyRef">
            <tr v-for="t in flatItems" :key="t.id" :data-id="t.id"
                :data-parent-id="t.parent_template_id || ''"
                :class="['border-t border-gray-100 hover:bg-indigo-50/40 cursor-pointer transition-colors',
                         dragOverRowId === t.id ? 'bg-indigo-100 ring-2 ring-indigo-400 ring-inset' : '']"
                @click="openEditor(t)"
                @dragover="onRowDragOver($event, t)"
                @dragleave="onRowDragLeave"
                @drop="onRowDrop($event, t)">
              <td class="px-2 py-2 text-center align-middle drag-handle cursor-grab text-gray-300 hover:text-gray-500"
                  @click.stop>
                <Bars3Icon class="w-4 h-4 inline-block" />
              </td>
              <td class="px-4 py-2 font-medium text-gray-800 whitespace-nowrap"
                  :style="t.feature_depth ? `padding-left: ${16 + t.feature_depth * 18}px` : ''">
                <span v-if="t.feature_depth" class="text-gray-400 mr-1.5">↳</span>
                <FontAwesomeIcon v-if="t.icon_name" :icon="['fas', t.icon_name]" class="w-4 h-4 text-gray-500 mr-2 inline-block align-[-2px]" />
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
              <td v-for="lvl in ['avail_e','avail_s','avail_p']" :key="lvl"
                  class="px-3 py-2 text-center whitespace-nowrap">
                <span v-if="availCell(t[lvl])"
                      :class="['inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded-full border', availCell(t[lvl]).cls]">
                  {{ availCell(t[lvl]).icon }} {{ availCell(t[lvl]).label }}
                </span>
                <span v-else class="text-gray-300 text-xs">—</span>
              </td>
              <td class="px-4 py-2 whitespace-nowrap">
                <BacsBadge v-if="t.bacs_articles" :reference="t.bacs_articles" />
                <span v-else class="text-gray-300 italic text-xs">—</span>
              </td>
              <td class="px-4 py-2 text-center text-xs whitespace-nowrap">
                <span v-if="t.outdated_count > 0" class="inline-block px-1.5 py-0.5 bg-amber-100 text-amber-800 rounded" title="AFs utilisant cette fonctionnalité / AFs avec mise à jour en attente">
                  {{ t.affected_afs_count }} <span class="text-amber-600">↻{{ t.outdated_count }}</span>
                </span>
                <span v-else-if="t.affected_afs_count > 0" class="text-gray-500">{{ t.affected_afs_count }}</span>
                <span v-else class="text-gray-300 italic" title="Jamais utilisée — candidate au nettoyage">∅</span>
              </td>
              <td class="px-4 py-2 text-center whitespace-nowrap" @click.stop>
                <button type="button" @click="openClone(t)"
                        class="inline-flex items-center justify-center w-7 h-7 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition mr-1"
                        title="Dupliquer cette fonctionnalité (avec son sous-arbre)">
                  <DocumentDuplicateIcon class="w-4 h-4" />
                </button>
                <button type="button" @click="openEditor(t)"
                        class="inline-flex items-center justify-center w-7 h-7 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition"
                        title="Éditer">
                  <PencilIcon class="w-4 h-4" />
                </button>
              </td>
            </tr>
        </tbody>
        <tbody v-if="!flatItems.length">
          <tr>
            <td colspan="9" class="px-4 py-8 text-center text-sm text-gray-400 italic">
              {{ search ? `Aucune fonctionnalité ne correspond à « ${search} ».` : 'Aucune fonctionnalité.' }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <SectionTemplateEditor
      v-if="editing"
      :template="editing"
      mode="functionality"
      @close="editing = null"
      @saved="onSaved"
      @deleted="onDeleted"
    />

    <SectionTemplateEditor
      v-if="showCreate"
      :template="{}"
      mode="functionality"
      @close="showCreate = false"
      @saved="onSaved"
    />

    <BulkRegenerateModal
      v-if="showBulk"
      title="Régénérer les fonctionnalités avec Claude"
      :items="bulkItems"
      :get-html="bulkGetHtml"
      :on-save-html="bulkSaveHtml"
      @close="showBulk = false; refresh()"
      @done="refresh()"
    />

    <!-- Modal Captures d'écran (separe de la modal d'edition pour pouvoir
         gerer les photos sans ouvrir tout l'editeur). -->
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

    <PdfPreviewModal
      v-if="offeringsPreviewOpen"
      title="Aperçu — Tableau des fonctionnalités Buildy"
      :preview-url="previewOfferingsUrl()"
      :downloading="generatingOfferings"
      download-label="Télécharger le PDF"
      @close="offeringsPreviewOpen = false"
      @download="downloadOfferingsPdf"
    />

    <BaseModal
      v-if="cloning"
      title="Dupliquer la fonctionnalité"
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
</style>
