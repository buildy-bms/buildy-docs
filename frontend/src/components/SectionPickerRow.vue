<script setup>
import { computed } from 'vue'
import { ChevronRightIcon, ChevronDownIcon } from '@heroicons/vue/24/outline'

defineOptions({ name: 'SectionPickerRow' })

const props = defineProps({
  node: { type: Object, required: true },
  level: { type: Number, default: 0 },
  collapsed: { type: Set, required: true },
  stateFn: { type: Function, required: true },
  iconMap: { type: Object, required: true },
})
const emit = defineEmits(['toggle', 'toggle-collapse'])

const state = computed(() => props.stateFn(props.node))
const isCollapsed = computed(() => props.collapsed.has(props.node.id))
const hasChildren = computed(() => Array.isArray(props.node.children) && props.node.children.length > 0)
const Icon = computed(() => props.iconMap[props.node.kind] || props.iconMap.standard)

const indentStyle = computed(() => ({
  paddingLeft: `${0.25 + props.level * 0.85}rem`,
}))
const checkboxClass = computed(() => state.value === 'on'
  ? 'bg-indigo-600 border-indigo-600 text-white'
  : state.value === 'partial'
    ? 'bg-amber-200 border-amber-400 text-amber-900'
    : 'bg-white border-gray-200')
const checkSymbol = computed(() => state.value === 'on' ? '✓' : state.value === 'partial' ? '–' : '')
const titleClass = computed(() => state.value === 'off' ? 'line-through text-gray-400' : 'text-gray-800')
const fontWeight = computed(() => props.level === 0 ? 'font-bold' : props.level === 1 ? 'font-semibold' : 'font-normal')
</script>

<template>
  <div>
    <div :style="indentStyle" class="flex items-center gap-1.5 py-1 pr-2 hover:bg-gray-50 rounded-md">
      <button
        v-if="hasChildren"
        type="button"
        @click.stop="emit('toggle-collapse', node)"
        class="shrink-0 p-0.5 rounded hover:bg-gray-200"
      >
        <ChevronRightIcon v-if="isCollapsed" class="w-3 h-3 text-gray-500" />
        <ChevronDownIcon v-else class="w-3 h-3 text-gray-500" />
      </button>
      <span v-else class="w-4 h-3 shrink-0"></span>

      <button
        type="button"
        @click.stop="emit('toggle', node)"
        :class="['shrink-0 w-4 h-4 border-2 rounded flex items-center justify-center text-[10px] font-bold', checkboxClass]"
      >{{ checkSymbol }}</button>

      <component :is="Icon" class="w-3.5 h-3.5 text-gray-400 shrink-0" />

      <span v-if="node.number" class="text-[11px] text-gray-500 shrink-0 font-mono">{{ node.number }}</span>
      <span :class="['flex-1 min-w-0 truncate text-[12px]', titleClass, fontWeight]">{{ node.title }}</span>
    </div>

    <div v-if="hasChildren && !isCollapsed">
      <SectionPickerRow
        v-for="child in node.children"
        :key="child.id"
        :node="child"
        :level="level + 1"
        :collapsed="collapsed"
        :state-fn="stateFn"
        :icon-map="iconMap"
        @toggle="emit('toggle', $event)"
        @toggle-collapse="emit('toggle-collapse', $event)"
      />
    </div>
  </div>
</template>
