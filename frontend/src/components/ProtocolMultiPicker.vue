<script setup>
/**
 * Multi-select protocoles avec popover stylé. Stocke un JSON array
 * dans v-model:value (string). Click outside ferme la popover.
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { ChevronDownIcon, CheckIcon, XMarkIcon } from '@heroicons/vue/24/outline'

const props = defineProps({
  modelValue: { type: String, default: null },
  options: { type: Array, required: true }, // [{ value, label }]
  disabled: { type: Boolean, default: false },
  placeholder: { type: String, default: '—' },
  size: { type: String, default: 'sm' }, // 'xs' | 'sm'
})
const emit = defineEmits(['update:modelValue'])

const open = ref(false)
const rootEl = ref(null)

const selected = computed(() => {
  if (!props.modelValue) return []
  try {
    const v = JSON.parse(props.modelValue)
    return Array.isArray(v) ? v : []
  } catch {
    return props.modelValue ? [props.modelValue] : []
  }
})

const selectedLabels = computed(() =>
  selected.value.map(v => props.options.find(o => o.value === v)?.label || v)
)

function toggle(value) {
  const set = new Set(selected.value)
  if (set.has(value)) set.delete(value); else set.add(value)
  emit('update:modelValue', set.size ? JSON.stringify([...set]) : null)
}

function clear() {
  emit('update:modelValue', null)
}

function onDocClick(e) {
  if (!open.value) return
  if (rootEl.value && !rootEl.value.contains(e.target)) open.value = false
}
onMounted(() => document.addEventListener('mousedown', onDocClick))
onBeforeUnmount(() => document.removeEventListener('mousedown', onDocClick))

const buttonCls = computed(() => {
  const sz = props.size === 'xs' ? 'px-2 py-1 text-[11px]' : 'px-2.5 py-1.5 text-xs'
  return `w-full inline-flex items-center justify-between gap-1 ${sz} border border-gray-200 rounded-lg bg-white hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition disabled:opacity-50 disabled:cursor-not-allowed`
})
</script>

<template>
  <div class="relative" ref="rootEl">
    <button
      type="button"
      :disabled="disabled"
      :class="buttonCls"
      @click="open = !open"
    >
      <span v-if="!selected.length" class="text-gray-400 italic flex-1 text-left">{{ placeholder }}</span>
      <span v-else class="flex flex-wrap gap-1 flex-1 text-left">
        <span v-for="(label, i) in selectedLabels" :key="i"
              class="inline-flex items-center px-1.5 py-0 rounded bg-emerald-50 text-emerald-700 text-[10px] font-medium border border-emerald-200">
          {{ label }}
        </span>
      </span>
      <ChevronDownIcon class="w-3.5 h-3.5 text-gray-400 shrink-0"
                       :class="{ 'rotate-180': open }" />
    </button>

    <div v-if="open"
         class="absolute z-30 mt-1 w-64 max-h-64 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-xl py-1">
      <div class="flex items-center justify-between px-3 py-1.5 border-b border-gray-100">
        <span class="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">Protocoles</span>
        <button v-if="selected.length" @click="clear"
                class="text-[10px] text-gray-400 hover:text-red-600 inline-flex items-center gap-0.5">
          <XMarkIcon class="w-3 h-3" /> Effacer
        </button>
      </div>
      <button
        v-for="o in options"
        :key="o.value || 'null'"
        type="button"
        @click="toggle(o.value)"
        class="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-emerald-50/50 transition"
        :class="selected.includes(o.value) ? 'text-emerald-700 font-medium' : 'text-gray-700'"
      >
        <span :class="['w-4 h-4 rounded border flex items-center justify-center shrink-0',
                       selected.includes(o.value) ? 'bg-emerald-500 border-emerald-500' : 'border-gray-300']">
          <CheckIcon v-if="selected.includes(o.value)" class="w-3 h-3 text-white" />
        </span>
        {{ o.label }}
      </button>
    </div>
  </div>
</template>
