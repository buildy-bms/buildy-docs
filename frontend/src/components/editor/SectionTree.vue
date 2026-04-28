<script setup>
import { ref, computed, watch } from 'vue'
import {
  RectangleStackIcon, GlobeAltIcon, ChartBarSquareIcon, DocumentTextIcon,
  MagnifyingGlassIcon, PlusIcon, XMarkIcon,
} from '@heroicons/vue/24/outline'
import SectionTreeNode from './SectionTreeNode.vue'

const props = defineProps({
  sections: { type: Array, required: true }, // liste plate (parent_id pour hierarchie)
  selectedId: { type: Number, default: null },
})
const emit = defineEmits(['select', 'add-child', 'add-root', 'delete', 'toggle-include', 'toggle-opt-out'])

// Recherche live (Lot 16.1)
const search = ref('')

function normalize(s) {
  return (s || '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

const matchedIds = computed(() => {
  const q = normalize(search.value).trim()
  if (q.length < 2) return null
  return new Set(props.sections.filter(s =>
    normalize(s.title).includes(q) || normalize(s.number).includes(q)
  ).map(s => s.id))
})

const visibleIds = computed(() => {
  if (!matchedIds.value) return null
  // Inclut tous les ancêtres des matches pour garder le contexte
  const set = new Set(matchedIds.value)
  for (const m of matchedIds.value) {
    let cur = props.sections.find(s => s.id === m)
    while (cur?.parent_id) {
      set.add(cur.parent_id)
      cur = props.sections.find(s => s.id === cur.parent_id)
    }
  }
  return set
})

// Construction d'un arbre depuis la liste plate
const tree = computed(() => {
  const filtered = visibleIds.value
    ? props.sections.filter(s => visibleIds.value.has(s.id))
    : props.sections
  const byParent = new Map()
  for (const s of filtered) {
    const k = s.parent_id || 'root'
    if (!byParent.has(k)) byParent.set(k, [])
    byParent.get(k).push(s)
  }
  for (const arr of byParent.values()) {
    arr.sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
  }
  function build(parentKey) {
    return (byParent.get(parentKey) || []).map((s) => ({
      ...s,
      children: build(s.id),
    }))
  }
  // Si on filtre, certaines sections gardent leur parent_id mais le parent peut être absent → racine.
  if (visibleIds.value) {
    const rootCandidates = filtered.filter(s => !s.parent_id || !filtered.find(p => p.id === s.parent_id))
    return rootCandidates.map(s => ({ ...s, children: build(s.id) }))
  }
  return build('root')
})

// Etat collapsé (Set des ids fermés). Auto-déplie tout en mode recherche.
const collapsed = ref(new Set())

function toggle(node) {
  if (collapsed.value.has(node.id)) collapsed.value.delete(node.id)
  else collapsed.value.add(node.id)
  collapsed.value = new Set(collapsed.value)
}

const KIND_ICON = {
  standard: DocumentTextIcon,
  equipment: RectangleStackIcon,
  hyperveez_page: GlobeAltIcon,
  synthesis: ChartBarSquareIcon,
}

function isEmpty(node) {
  if (!node.body_html) return true
  if (node.body_html.includes('class="text-gray-400"')) return true
  return false
}

// Expand-to-selected : si selectedId change, dérouler les ancêtres
watch(() => props.selectedId, (id) => {
  if (!id) return
  const target = props.sections.find(s => s.id === id)
  if (!target) return
  let parentId = target.parent_id
  while (parentId) {
    collapsed.value.delete(parentId)
    const parent = props.sections.find(s => s.id === parentId)
    parentId = parent?.parent_id
  }
  collapsed.value = new Set(collapsed.value)
})

// En mode recherche : tout déplié
watch(matchedIds, (ids) => {
  if (ids) collapsed.value = new Set()
})
</script>

<template>
  <div class="text-sm">
    <!-- Barre de recherche + ajout root -->
    <div class="px-2 py-2 sticky top-0 bg-white z-20 border-b border-gray-100 -mx-2 mb-2 flex items-center gap-1.5">
      <div class="flex-1 relative">
        <MagnifyingGlassIcon class="w-3.5 h-3.5 text-gray-400 absolute left-2 top-1/2 -translate-y-1/2" />
        <input
          v-model="search"
          type="text"
          placeholder="Rechercher…"
          autocomplete="off"
          data-1p-ignore="true"
          data-bwignore="true"
          data-lpignore="true"
          class="w-full pl-7 pr-7 py-1.5 text-[12px] border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
        />
        <button v-if="search" @click="search = ''" class="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700">
          <XMarkIcon class="w-3.5 h-3.5" />
        </button>
      </div>
      <button
        @click="emit('add-root')"
        class="shrink-0 p-1.5 text-indigo-600 hover:bg-indigo-50 rounded"
        title="Ajouter une section racine"
      >
        <PlusIcon class="w-4 h-4" />
      </button>
    </div>

    <p v-if="matchedIds && matchedIds.size === 0" class="text-xs text-gray-400 italic px-3 py-2">
      Aucune section ne correspond à « {{ search }} ».
    </p>

    <SectionTreeNode
      v-for="node in tree"
      :key="node.id"
      :node="node"
      :level="0"
      :selected-id="selectedId"
      :collapsed="collapsed"
      :kind-icon="KIND_ICON"
      :is-empty="isEmpty"
      :search="search"
      @select="emit('select', $event)"
      @toggle="toggle"
      @add-child="emit('add-child', $event)"
      @delete="emit('delete', $event)"
      @toggle-include="emit('toggle-include', $event)"
      @toggle-opt-out="emit('toggle-opt-out', $event)"
    />
  </div>
</template>
