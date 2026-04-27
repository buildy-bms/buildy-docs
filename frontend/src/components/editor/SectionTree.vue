<script setup>
import { ref, computed, watch } from 'vue'
import {
  ChevronRightIcon, ChevronDownIcon,
  RectangleStackIcon, GlobeAltIcon, ChartBarSquareIcon, DocumentTextIcon,
} from '@heroicons/vue/24/outline'

const props = defineProps({
  sections: { type: Array, required: true }, // liste plate (parent_id pour hierarchie)
  selectedId: { type: Number, default: null },
})
const emit = defineEmits(['select'])

// Construction d'un arbre depuis la liste plate
const tree = computed(() => {
  const byParent = new Map()
  for (const s of props.sections) {
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
  return build('root')
})

// Etat collapsé (Set des ids fermés). Par défaut tout est ouvert pour les niveaux 1.
const collapsed = ref(new Set())

function toggle(node) {
  if (collapsed.value.has(node.id)) collapsed.value.delete(node.id)
  else collapsed.value.add(node.id)
  collapsed.value = new Set(collapsed.value) // trigger reactivity
}

const KIND_ICON = {
  standard: DocumentTextIcon,
  equipment: RectangleStackIcon,
  hyperveez_page: GlobeAltIcon,
  synthesis: ChartBarSquareIcon,
}

function isEmpty(node) {
  // Heuristique : pas de body_html ou body_html ne contient que le placeholder italique
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
</script>

<template>
  <div class="text-sm">
    <SectionTreeNode
      v-for="node in tree"
      :key="node.id"
      :node="node"
      :level="0"
      :selected-id="selectedId"
      :collapsed="collapsed"
      :kind-icon="KIND_ICON"
      :is-empty="isEmpty"
      @select="emit('select', $event)"
      @toggle="toggle"
    />
  </div>
</template>
