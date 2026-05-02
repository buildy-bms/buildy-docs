<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import Sortable from 'sortablejs'
import {
  MagnifyingGlassIcon, XMarkIcon, PencilIcon, PlusIcon, Bars3Icon, SparklesIcon,
  EyeIcon, DocumentArrowDownIcon,
} from '@heroicons/vue/24/outline'
import {
  listSectionTemplates, reorderSectionTemplates, updateSectionTemplate,
  previewOfferingsUrl, exportOfferingsPdfUrl,
} from '@/api'
import PdfPreviewModal from '@/components/PdfPreviewModal.vue'
import BacsBadge from '@/components/BacsBadge.vue'
import SectionTemplateEditor from '@/components/SectionTemplateEditor.vue'
import BulkRegenerateModal from '@/components/BulkRegenerateModal.vue'
import { useNotification } from '@/composables/useNotification'

const { error: notifyError } = useNotification()

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
async function downloadOfferingsPdf() {
  generatingOfferings.value = true
  try {
    // Import paresseux pour ne pas charger axios deux fois
    const { default: api } = await import('@/api')
    const response = await api.post('/offerings/export-pdf', {}, { responseType: 'blob' })
    // Recupere le nom de fichier suggere par le serveur (Content-Disposition)
    const dispo = response.headers['content-disposition'] || ''
    const match = /filename="([^"]+)"/.exec(dispo)
    const filename = match ? match[1] : `offres-buildy-${new Date().getFullYear()}.pdf`
    // Trigger telechargement
    const url = URL.createObjectURL(response.data)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  } catch (e) {
    notifyError('Échec de la génération du PDF des offres')
  } finally {
    generatingOfferings.value = false
  }
}

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

// Items enrichis du parent_title + path pour affichage et regroupement
const enrichedItems = computed(() => items.value.map(t => {
  const p = t.parent_template_id ? parentInfoById.value.get(t.parent_template_id) : null
  return { ...t, parent_title: p?.title || null, parent_path: p?.path || null }
}))

// Groupes : key = parent_template_id || 'orphelins', valeur = liste de fonctionnalites
const groupedItems = computed(() => {
  const q = search.value.trim().toLowerCase()
  const filtered = q
    ? enrichedItems.value.filter(t =>
        (t.title || '').toLowerCase().includes(q) ||
        (t.bacs_articles || '').toLowerCase().includes(q) ||
        (t.parent_title || '').toLowerCase().includes(q)
      )
    : enrichedItems.value
  const groups = new Map()
  for (const t of filtered) {
    const key = t.parent_template_id || 'orphans'
    if (!groups.has(key)) groups.set(key, { id: key, parent_path: t.parent_path, items: [] })
    groups.get(key).items.push(t)
  }
  // Ordre des groupes : par parent_path alphabetiquement, orphelins a la fin
  return [...groups.values()].sort((a, b) => {
    if (a.id === 'orphans') return 1
    if (b.id === 'orphans') return -1
    return (a.parent_path || '').localeCompare(b.parent_path || '', 'fr')
  })
})
// Drag-drop : un Sortable par <tbody> de groupe (ref dynamique). Le drag
// au sein d'un groupe (meme parent) reorganise via reorderSectionTemplates.
const groupRefs = new Map()
const sortables = []
function setGroupRef(groupId) {
  return (el) => {
    if (el) groupRefs.set(groupId, el)
    else groupRefs.delete(groupId)
  }
}
function teardownSortables() {
  while (sortables.length) {
    try { sortables.pop().destroy() } catch { /* ignore */ }
  }
}
function setupSortables() {
  teardownSortables()
  if (search.value.trim()) return // pas de drag-drop pendant la recherche
  for (const g of groupedItems.value) {
    const el = groupRefs.get(g.id)
    if (!el) continue
    const parentId = g.id === 'orphans' ? null : g.id
    const s = Sortable.create(el, {
      animation: 150,
      handle: '.drag-handle',
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      dragClass: 'sortable-drag',
      onEnd: async (evt) => {
        if (evt.oldIndex === evt.newIndex) return
        const ids = Array.from(el.children)
          .map(li => parseInt(li.getAttribute('data-id'), 10))
          .filter(Boolean)
        try {
          await reorderSectionTemplates({ ids, parent_template_id: parentId })
          await refresh()
        } catch {
          notifyError('Échec de la réorganisation')
          await refresh()
        }
      },
    })
    sortables.push(s)
  }
}

watch([groupedItems, search], async () => {
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
        <button @click="downloadOfferingsPdf"
                title="Télécharger le PDF du catalogue Buildy 2026 (régénéré depuis la base)"
                class="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded-lg whitespace-nowrap transition">
          <DocumentArrowDownIcon class="w-4 h-4" /> Tableau des offres
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
            <th class="text-center px-3 py-2.5 whitespace-nowrap">Essentials</th>
            <th class="text-center px-3 py-2.5 whitespace-nowrap">Smart</th>
            <th class="text-center px-3 py-2.5 whitespace-nowrap">Premium</th>
            <th class="text-left px-4 py-2.5 whitespace-nowrap">BACS</th>
            <th class="text-center px-4 py-2.5 whitespace-nowrap">AFs</th>
            <th class="text-center px-4 py-2.5 whitespace-nowrap"></th>
          </tr>
        </thead>
        <template v-for="g in groupedItems" :key="g.id">
          <!-- En-tete de groupe (tbody dedie pour rester hors du drag-drop) -->
          <tbody>
            <tr class="bg-indigo-50/60 border-t border-indigo-100">
              <td colspan="8" class="px-4 py-1.5 text-[11px] uppercase tracking-wider font-semibold text-indigo-700">
                <span v-if="g.id === 'orphans'" class="text-gray-500">Sans section parente</span>
                <span v-else>{{ g.parent_path }}</span>
                <span class="ml-2 text-gray-400 normal-case font-normal">· {{ g.items.length }}</span>
              </td>
            </tr>
          </tbody>
          <!-- Lignes data du groupe (sortable par groupe) -->
          <tbody :ref="setGroupRef(g.id)">
            <tr v-for="t in g.items" :key="t.id" :data-id="t.id"
                class="border-t border-gray-100 hover:bg-indigo-50/40 cursor-pointer"
                @click="openEditor(t)">
              <td class="px-2 py-2 text-center align-middle drag-handle cursor-grab text-gray-300 hover:text-gray-500"
                  @click.stop>
                <Bars3Icon class="w-4 h-4 inline-block" />
              </td>
              <td class="px-4 py-2 font-medium text-gray-800 whitespace-nowrap">{{ t.title }}</td>
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
              <td class="px-4 py-2 text-center whitespace-nowrap">
                <PencilIcon class="w-4 h-4 text-gray-400 inline-block" />
              </td>
            </tr>
          </tbody>
        </template>
        <tbody v-if="!groupedItems.length">
          <tr>
            <td colspan="8" class="px-4 py-8 text-center text-sm text-gray-400 italic">
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

    <PdfPreviewModal
      v-if="offeringsPreviewOpen"
      title="Aperçu — Tableau des offres Buildy"
      :preview-url="previewOfferingsUrl()"
      :downloading="generatingOfferings"
      download-label="Télécharger le PDF"
      @close="offeringsPreviewOpen = false"
      @download="downloadOfferingsPdf"
    />
  </div>
</template>

<style scoped>
.sortable-ghost { opacity: 0.4; background: #eef2ff; }
.sortable-chosen { background: #eef2ff; }
</style>
