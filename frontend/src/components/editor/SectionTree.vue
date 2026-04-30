<script setup>
import { ref, computed, watch } from 'vue'
import {
  RectangleStackIcon, GlobeAltIcon, ChartBarSquareIcon, DocumentTextIcon,
  MagnifyingGlassIcon, PlusIcon, XMarkIcon, CheckCircleIcon,
} from '@heroicons/vue/24/outline'
import SectionTreeNode from './SectionTreeNode.vue'
import Tooltip from '@/components/Tooltip.vue'

const props = defineProps({
  sections: { type: Array, required: true }, // liste plate (parent_id pour hierarchie)
  selectedId: { type: Number, default: null },
  afId: { type: Number, default: null }, // sert de clé de persistance du collapse state
})
const emit = defineEmits(['select', 'add-child', 'add-root', 'delete', 'toggle-include', 'toggle-opt-out', 'attachment-drop'])

// Recherche live (Lot 16.1)
const search = ref('')

// Filtre "Non vérifiées uniquement" — masque les sections marquées 'verified'
// (en gardant les ancêtres pour le contexte d'arbre).
const onlyUnverified = ref(false)

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

const unverifiedIds = computed(() => {
  if (!onlyUnverified.value) return null
  return new Set(props.sections.filter(s => s.fact_check_status !== 'verified').map(s => s.id))
})

const visibleIds = computed(() => {
  if (!matchedIds.value && !unverifiedIds.value) return null
  // Intersection des deux filtres si les deux actifs
  let base = null
  if (matchedIds.value && unverifiedIds.value) {
    base = new Set([...matchedIds.value].filter(id => unverifiedIds.value.has(id)))
  } else {
    base = matchedIds.value || unverifiedIds.value
  }
  // Inclut tous les ancêtres des matches pour garder le contexte
  const set = new Set(base)
  for (const m of base) {
    let cur = props.sections.find(s => s.id === m)
    while (cur?.parent_id) {
      set.add(cur.parent_id)
      cur = props.sections.find(s => s.id === cur.parent_id)
    }
  }
  return set
})

const unverifiedCount = computed(() =>
  props.sections.filter(s => s.fact_check_status !== 'verified').length
)

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
// Persisté en localStorage par AF pour survivre F5 / changement d'onglet.
const storageKey = computed(() => props.afId ? `af-${props.afId}-collapsed` : null)

function loadCollapsed() {
  if (!storageKey.value || typeof window === 'undefined') return new Set()
  try {
    const raw = window.localStorage.getItem(storageKey.value)
    if (!raw) return new Set()
    const arr = JSON.parse(raw)
    return new Set(Array.isArray(arr) ? arr : [])
  } catch { return new Set() }
}

const collapsed = ref(loadCollapsed())

watch(() => props.afId, () => { collapsed.value = loadCollapsed() })

function persistCollapsed() {
  if (!storageKey.value || typeof window === 'undefined') return
  try {
    window.localStorage.setItem(storageKey.value, JSON.stringify(Array.from(collapsed.value)))
  } catch { /* quota / private mode → ignore */ }
}

function toggle(node) {
  if (collapsed.value.has(node.id)) collapsed.value.delete(node.id)
  else collapsed.value.add(node.id)
  collapsed.value = new Set(collapsed.value)
  persistCollapsed()
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
  let changed = false
  while (parentId) {
    if (collapsed.value.has(parentId)) { collapsed.value.delete(parentId); changed = true }
    const parent = props.sections.find(s => s.id === parentId)
    parentId = parent?.parent_id
  }
  if (changed) {
    collapsed.value = new Set(collapsed.value)
    persistCollapsed()
  }
})

// En mode recherche : tout déplié (transitoire — on ne persiste pas, l'état
// pré-recherche revient quand l'utilisateur efface la recherche)
let preSearchCollapsed = null
watch(matchedIds, (ids) => {
  if (ids) {
    if (!preSearchCollapsed) preSearchCollapsed = new Set(collapsed.value)
    collapsed.value = new Set()
  } else if (preSearchCollapsed) {
    collapsed.value = preSearchCollapsed
    preSearchCollapsed = null
  }
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
      <Tooltip
        :text="onlyUnverified
          ? `Afficher toutes les sections (${unverifiedCount} non vérifiée${unverifiedCount > 1 ? 's' : ''})`
          : `Afficher uniquement les sections non vérifiées (${unverifiedCount} non vérifiée${unverifiedCount > 1 ? 's' : ''})`"
        placement="bottom"
      >
        <button
          type="button"
          @click="onlyUnverified = !onlyUnverified"
          :class="[
            'shrink-0 p-1.5 rounded transition-colors',
            onlyUnverified ? 'bg-amber-100 text-amber-700 hover:bg-amber-200' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-700',
          ]"
        >
          <CheckCircleIcon class="w-4 h-4" />
        </button>
      </Tooltip>
      <Tooltip text="Ajouter une section racine" placement="bottom">
        <button
          @click="emit('add-root')"
          class="shrink-0 p-1.5 text-indigo-600 hover:bg-indigo-50 rounded"
        >
          <PlusIcon class="w-4 h-4" />
        </button>
      </Tooltip>
    </div>

    <p v-if="matchedIds && matchedIds.size === 0" class="text-xs text-gray-400 italic px-3 py-2">
      Aucune section ne correspond à « {{ search }} ».
    </p>
    <p v-else-if="onlyUnverified && unverifiedCount === 0" class="text-xs text-emerald-600 italic px-3 py-2">
      Toutes les sections sont vérifiées. ✓
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
      @attachment-drop="emit('attachment-drop', $event)"
    />
  </div>
</template>
