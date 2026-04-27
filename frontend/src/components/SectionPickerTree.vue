<script setup>
/**
 * Arbre de sections avec cases à cocher hiérarchiques pour la modale d'export.
 * - Cocher un parent coche tous les enfants
 * - Décocher un enfant met le parent dans un état "indéterminé"
 *
 * v-model:excluded → Set<number> des IDs de sections exclues
 */
import { ref, computed } from 'vue'
import { RectangleStackIcon, GlobeAltIcon, ChartBarSquareIcon, DocumentTextIcon } from '@heroicons/vue/24/outline'
import SectionPickerRow from './SectionPickerRow.vue'

const props = defineProps({
  sections: { type: Array, required: true },
  excluded: { type: Set, required: true },
})
const emit = defineEmits(['update:excluded'])

const collapsed = ref(new Set())

const KIND_ICON = {
  standard: DocumentTextIcon,
  equipment: RectangleStackIcon,
  hyperveez_page: GlobeAltIcon,
  synthesis: ChartBarSquareIcon,
}

// Build tree
const tree = computed(() => {
  const byParent = new Map()
  for (const s of props.sections) {
    const k = s.parent_id || 'root'
    if (!byParent.has(k)) byParent.set(k, [])
    byParent.get(k).push(s)
  }
  for (const arr of byParent.values()) arr.sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
  function build(parentKey) {
    return (byParent.get(parentKey) || []).map(s => ({ ...s, children: build(s.id) }))
  }
  return build('root')
})

function descendants(node) {
  const out = [node.id]
  for (const c of node.children || []) out.push(...descendants(c))
  return out
}

function nodeStateOf(node) {
  const ids = descendants(node)
  const excludedCount = ids.filter(id => props.excluded.has(id)).length
  if (excludedCount === 0) return 'on'
  if (excludedCount === ids.length) return 'off'
  return 'partial'
}

function toggleNode(node) {
  const next = new Set(props.excluded)
  const ids = descendants(node)
  const state = nodeStateOf(node)
  if (state === 'on') ids.forEach(id => next.add(id))
  else ids.forEach(id => next.delete(id))
  emit('update:excluded', next)
}

function toggleCollapse(node) {
  if (collapsed.value.has(node.id)) collapsed.value.delete(node.id)
  else collapsed.value.add(node.id)
  collapsed.value = new Set(collapsed.value)
}

function selectAll(value) {
  if (value === 'all') emit('update:excluded', new Set())
  else emit('update:excluded', new Set(props.sections.map(s => s.id)))
}

const totalIncluded = computed(() => props.sections.filter(s => !props.excluded.has(s.id)).length)
const totalExcluded = computed(() => props.excluded.size)
</script>

<template>
  <div class="border border-gray-200 rounded-none bg-white">
    <div class="px-3 py-2 border-b border-gray-100 flex items-center justify-between text-xs">
      <span class="text-gray-700">
        <strong>{{ totalIncluded }}</strong> incluse{{ totalIncluded > 1 ? 's' : '' }}
        <span v-if="totalExcluded > 0" class="text-amber-700">
          · <strong>{{ totalExcluded }}</strong> décochée{{ totalExcluded > 1 ? 's' : '' }}
        </span>
      </span>
      <span class="flex items-center gap-2">
        <button @click="selectAll('all')" type="button" class="text-indigo-600 hover:text-indigo-800">Tout cocher</button>
        <span class="text-gray-300">|</span>
        <button @click="selectAll('none')" type="button" class="text-gray-500 hover:text-gray-800">Tout décocher</button>
      </span>
    </div>

    <div class="max-h-[40vh] overflow-y-auto p-1">
      <SectionPickerRow
        v-for="node in tree"
        :key="node.id"
        :node="node"
        :level="0"
        :collapsed="collapsed"
        :state-fn="nodeStateOf"
        :icon-map="KIND_ICON"
        @toggle="toggleNode"
        @toggle-collapse="toggleCollapse"
      />
    </div>
  </div>
</template>
