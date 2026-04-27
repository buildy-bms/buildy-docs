<script setup>
import { computed } from 'vue'
import { ChevronRightIcon, ChevronDownIcon } from '@heroicons/vue/24/outline'
import ServiceLevelBadge from '@/components/ServiceLevelBadge.vue'

// Nom explicite pour permettre l'auto-référence récursive dans le template
defineOptions({ name: 'SectionTreeNode' })

const props = defineProps({
  node: { type: Object, required: true },
  level: { type: Number, default: 0 },
  selectedId: { type: Number, default: null },
  collapsed: { type: Set, required: true },
  kindIcon: { type: Object, required: true },
  isEmpty: { type: Function, required: true },
})
const emit = defineEmits(['select', 'toggle'])

const hasChildren = computed(() => Array.isArray(props.node.children) && props.node.children.length > 0)
const isCollapsed = computed(() => props.collapsed.has(props.node.id))
const isSelected = computed(() => props.selectedId === props.node.id)
const Icon = computed(() => props.kindIcon[props.node.kind] || props.kindIcon.standard)
const empty = computed(() => props.isEmpty(props.node))

const indentStyle = computed(() => ({
  paddingLeft: `${0.5 + props.level * 0.75}rem`,
}))
</script>

<template>
  <div>
    <button
      :style="indentStyle"
      :class="[
        'group w-full text-left flex items-center gap-1.5 py-1.5 pr-2 rounded-md transition-colors',
        isSelected ? 'bg-indigo-50 text-indigo-900' : 'hover:bg-gray-100 text-gray-700',
      ]"
      @click="emit('select', node.id)"
    >
      <button
        v-if="hasChildren"
        type="button"
        @click.stop="emit('toggle', node)"
        class="shrink-0 p-0.5 -my-0.5 rounded hover:bg-gray-200"
      >
        <ChevronRightIcon v-if="isCollapsed" class="w-3 h-3 text-gray-500" />
        <ChevronDownIcon v-else class="w-3 h-3 text-gray-500" />
      </button>
      <span v-else class="w-4 h-3 shrink-0"></span>

      <component :is="Icon" :class="['w-3.5 h-3.5 shrink-0', isSelected ? 'text-indigo-600' : 'text-gray-400']" />

      <span v-if="node.number" :class="['text-[11px] font-medium shrink-0', isSelected ? 'text-indigo-700' : 'text-gray-500']">
        {{ node.number }}
      </span>

      <span class="flex-1 min-w-0 truncate text-[13px]">{{ node.title }}</span>

      <ServiceLevelBadge v-if="node.service_level" :level="node.service_level" />

      <span v-if="empty" class="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" title="Section vide — à rédiger"></span>
    </button>

    <div v-if="hasChildren && !isCollapsed">
      <SectionTreeNode
        v-for="child in node.children"
        :key="child.id"
        :node="child"
        :level="level + 1"
        :selected-id="selectedId"
        :collapsed="collapsed"
        :kind-icon="kindIcon"
        :is-empty="isEmpty"
        @select="emit('select', $event)"
        @toggle="emit('toggle', $event)"
      />
    </div>
  </div>
</template>
