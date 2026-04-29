<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import Sortable from 'sortablejs'
import {
  PlusIcon, MagnifyingGlassIcon, XMarkIcon, ChevronDoubleDownIcon, ChevronDoubleUpIcon,
} from '@heroicons/vue/24/outline'
import {
  listSectionTemplates, reorderSectionTemplates,
} from '@/api'
import LibrarySectionNode from '@/components/LibrarySectionNode.vue'
import SectionTemplateEditor from '@/components/SectionTemplateEditor.vue'
import { useNotification } from '@/composables/useNotification'

const { error: notifyError } = useNotification()
const tree = ref([])           // hierarchical
const flat = ref([])           // for search
const search = ref('')
const editing = ref(null)
const showCreate = ref(false)
const collapsed = ref(new Set())
const rootRef = ref(null)
const sortables = []           // Sortable instances per <ul>

// Filtre les feuilles equipment de l'arbre : leur source d'autorite est la
// page Bibliotheque > Equipements (chaque modele expose son placement dans
// l'arbre via le multi-select chips). Les afficher ici creait une redondance.
function stripEquipmentLeaves(nodes) {
  return nodes
    .filter(n => n.kind !== 'equipment')
    .map(n => ({ ...n, children: stripEquipmentLeaves(n.children || []) }))
}

async function refresh() {
  const { data: t } = await listSectionTemplates({ tree: true })
  tree.value = stripEquipmentLeaves(t)
  // Aussi liste plate pour la recherche / count (sans les equipments)
  const { data: list } = await listSectionTemplates({})
  flat.value = list.filter(n => n.kind !== 'equipment')
  await nextTick()
  setupSortables()
}
function openEditor(node) { editing.value = node }
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

function toggle(id) {
  if (collapsed.value.has(id)) collapsed.value.delete(id)
  else collapsed.value.add(id)
  collapsed.value = new Set(collapsed.value)
  // Re-bind sortable after collapse/expand DOM change
  nextTick(setupSortables)
}
function expandAll() { collapsed.value = new Set() }
function collapseAll() {
  const set = new Set()
  function walk(nodes) {
    for (const n of nodes) {
      if (n.children?.length) { set.add(n.id); walk(n.children) }
    }
  }
  walk(tree.value)
  collapsed.value = set
}

// Numerotation auto (1, 1.1, 1.2, 2…) pour l'affichage uniquement.
// Identique a la logique du seedAfStructure : top-level zones n'ont pas de
// number et n'incrementent pas le compteur.
const numbering = computed(() => {
  const map = new Map()
  let topCounter = 0
  function walk(nodes, prefix) {
    nodes.forEach((n, i) => {
      let num
      if (!prefix && n.kind === 'zones') {
        num = ''
      } else if (!prefix) {
        topCounter += 1
        num = String(topCounter)
      } else {
        num = `${prefix}.${i + 1}`
      }
      if (num) map.set(n.id, num)
      if (n.children?.length) walk(n.children, num || '')
    })
  }
  walk(tree.value, '')
  return map
})

// Recherche : filtre le tree pour ne garder que les nodes matchant + ancetres.
const filteredTree = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return tree.value
  function match(n) {
    return (n.title || '').toLowerCase().includes(q) ||
           (n.bacs_articles || '').toLowerCase().includes(q) ||
           (numbering.value.get(n.id) || '').includes(q)
  }
  function filter(nodes) {
    const result = []
    for (const n of nodes) {
      const childMatches = filter(n.children || [])
      if (match(n) || childMatches.length) {
        result.push({ ...n, children: childMatches })
      }
    }
    return result
  }
  return filter(tree.value)
})

// Drag-and-drop nested. On applique Sortable sur chaque <ul.sortable-list>
// (root + tous les enfants). group: 'sections-tree' permet le cross-list drag.
function teardownSortables() {
  while (sortables.length) {
    try { sortables.pop().destroy() } catch (_) { /* ignore */ }
  }
}
function setupSortables() {
  teardownSortables()
  if (!rootRef.value || search.value.trim()) return
  const lists = rootRef.value.querySelectorAll('ul.sortable-list')
  for (const ul of lists) {
    const s = Sortable.create(ul, {
      group: 'sections-tree',
      handle: '.drag-handle',
      animation: 150,
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      dragClass: 'sortable-drag',
      fallbackOnBody: true,
      invertSwap: true,
      onEnd: async (evt) => {
        const targetUl = evt.to
        const parentAttr = targetUl.getAttribute('data-parent')
        const parentId = parentAttr ? parseInt(parentAttr, 10) : null
        const ids = Array.from(targetUl.children)
          .map(li => parseInt(li.getAttribute('data-id'), 10))
          .filter(Boolean)
        try {
          await reorderSectionTemplates({ ids, parent_template_id: parentId })
          await refresh()
        } catch (e) {
          notifyError(e.response?.data?.detail || 'Échec de la réorganisation')
          await refresh()
        }
      },
    })
    sortables.push(s)
  }
}

watch(search, () => nextTick(setupSortables))

onMounted(refresh)
onBeforeUnmount(teardownSortables)
</script>

<template>
  <div class="max-w-screen-2xl mx-auto">
    <div class="mb-5 flex items-end justify-between gap-3">
      <div>
        <h1 class="text-2xl font-semibold text-gray-800">Bibliothèque de sections types</h1>
        <p class="text-sm text-gray-500 mt-1">
          {{ flat.length }} entrée{{ flat.length > 1 ? 's' : '' }} dans l'arbre canonique de l'AF.
          Glisser-déposer pour réorganiser ou re-parenter — chaque AF nouvellement créée suit cette structure et la numérotation se calcule automatiquement.
        </p>
      </div>
      <div class="flex items-center gap-2">
        <button @click="expandAll" class="text-xs text-gray-500 hover:text-gray-800 inline-flex items-center gap-1">
          <ChevronDoubleDownIcon class="w-3.5 h-3.5" /> Tout déplier
        </button>
        <button @click="collapseAll" class="text-xs text-gray-500 hover:text-gray-800 inline-flex items-center gap-1">
          <ChevronDoubleUpIcon class="w-3.5 h-3.5" /> Tout replier
        </button>
        <button @click="openCreate"
                class="inline-flex items-center gap-1.5 px-3 py-2 text-sm bg-indigo-600 text-white hover:bg-indigo-700 rounded">
          <PlusIcon class="w-4 h-4" /> Nouvelle section type
        </button>
      </div>
    </div>

    <div class="relative max-w-md mb-4">
      <MagnifyingGlassIcon class="w-4 h-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
      <input v-model="search" type="text" placeholder="Rechercher (titre, numéro, BACS)…"
             autocomplete="off" data-1p-ignore="true" data-bwignore="true" data-lpignore="true"
             class="w-full pl-9 pr-9 py-2 border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
      <button v-if="search" @click="search = ''"
              class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700">
        <XMarkIcon class="w-4 h-4" />
      </button>
    </div>

    <div ref="rootRef" class="bg-white border border-gray-200 rounded-lg">
      <ul data-parent="" class="sortable-list">
        <LibrarySectionNode v-for="node in filteredTree"
                            :key="node.id"
                            :node="node"
                            :level="0"
                            :collapsed="collapsed"
                            :numbering="numbering"
                            @edit="openEditor"
                            @toggle="toggle" />
        <li v-if="!filteredTree.length" class="px-4 py-8 text-center text-sm text-gray-400 italic">
          {{ search ? `Aucune section ne correspond à « ${search} ».` : 'Aucune section type.' }}
        </li>
      </ul>
    </div>

    <SectionTemplateEditor
      v-if="editing"
      :template="editing"
      mode="standard"
      @close="editing = null"
      @saved="onSaved"
      @deleted="onDeleted"
    />

    <SectionTemplateEditor
      v-if="showCreate"
      :template="{}"
      mode="standard"
      @close="showCreate = false"
      @saved="onSaved"
    />
  </div>
</template>

<style scoped>
ul.sortable-list { list-style: none; margin: 0; padding: 0; min-height: 4px; }
.sortable-ghost { opacity: 0.4; background: #eef2ff; }
.sortable-chosen { background: #eef2ff; }
.sortable-drag { background: white; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
</style>
