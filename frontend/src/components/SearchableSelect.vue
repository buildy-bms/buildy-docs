<script setup>
/**
 * Combobox recherchable. Props :
 *  - modelValue : valeur courante (peut etre null)
 *  - options    : Array<{ value, label, hint?, indent? }>
 *                  indent : nombre d'espaces de prefixe (rendu visuel hierarchie)
 *  - placeholder : texte affiche quand aucune option
 *  - searchPlaceholder : placeholder de l'input recherche
 *  - autofocus  : focus l'input au mount du popover
 *
 * Filtre simple sur label + hint, insensible aux accents et a la casse.
 */
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { ChevronDownIcon, MagnifyingGlassIcon, XMarkIcon } from '@heroicons/vue/24/outline'

const props = defineProps({
  modelValue: { type: [String, Number, null], default: null },
  options: { type: Array, default: () => [] },
  placeholder: { type: String, default: 'Sélectionner…' },
  searchPlaceholder: { type: String, default: 'Rechercher…' },
  disabled: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue'])

const open = ref(false)
const search = ref('')
const rootRef = ref(null)
const inputRef = ref(null)
const listRef = ref(null)
const activeIndex = ref(0)

const selectedOption = computed(() =>
  props.options.find(o => o.value === props.modelValue) || null
)

function normalize(s) {
  return (s || '')
    .toString()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

const filteredOptions = computed(() => {
  const q = normalize(search.value.trim())
  if (!q) return props.options
  return props.options.filter(o =>
    normalize(o.label).includes(q) || normalize(o.hint).includes(q)
  )
})

watch(filteredOptions, () => { activeIndex.value = 0 })

function toggle() {
  if (props.disabled) return
  open.value = !open.value
  if (open.value) {
    nextTick(() => {
      inputRef.value?.focus?.()
      activeIndex.value = Math.max(0, filteredOptions.value.findIndex(o => o.value === props.modelValue))
    })
  }
}

function pick(option) {
  emit('update:modelValue', option.value)
  open.value = false
  search.value = ''
}

function onKeydown(e) {
  if (!open.value) return
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    activeIndex.value = Math.min(filteredOptions.value.length - 1, activeIndex.value + 1)
    scrollActiveIntoView()
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    activeIndex.value = Math.max(0, activeIndex.value - 1)
    scrollActiveIntoView()
  } else if (e.key === 'Enter') {
    e.preventDefault()
    const opt = filteredOptions.value[activeIndex.value]
    if (opt) pick(opt)
  } else if (e.key === 'Escape') {
    e.preventDefault()
    open.value = false
  }
}

function scrollActiveIntoView() {
  nextTick(() => {
    const el = listRef.value?.querySelector('[data-active="true"]')
    el?.scrollIntoView({ block: 'nearest' })
  })
}

function onDocClick(ev) {
  if (!open.value) return
  if (rootRef.value && !rootRef.value.contains(ev.target)) {
    open.value = false
  }
}

onMounted(() => document.addEventListener('mousedown', onDocClick))
onBeforeUnmount(() => document.removeEventListener('mousedown', onDocClick))

function clear() {
  emit('update:modelValue', null)
}
</script>

<template>
  <div ref="rootRef" class="relative" @keydown="onKeydown">
    <button type="button" @click="toggle" :disabled="disabled"
            :class="['w-full flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition',
                     disabled ? 'opacity-50 cursor-not-allowed' : '']">
      <span class="flex-1 text-left truncate" :class="selectedOption ? 'text-gray-900' : 'text-gray-400 italic'">
        {{ selectedOption?.label || placeholder }}
      </span>
      <button v-if="selectedOption && !disabled" type="button"
              @click.stop="clear"
              class="text-gray-400 hover:text-gray-600 -my-1 p-0.5 rounded"
              title="Effacer la sélection">
        <XMarkIcon class="w-3.5 h-3.5" />
      </button>
      <ChevronDownIcon class="w-4 h-4 text-gray-400 shrink-0 transition-transform"
                       :class="open ? 'rotate-180' : ''" />
    </button>
    <div v-if="open"
         class="absolute z-30 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
      <div class="relative border-b border-gray-100">
        <MagnifyingGlassIcon class="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
        <input ref="inputRef" v-model="search" type="text"
               :placeholder="searchPlaceholder"
               autocomplete="off" data-1p-ignore="true"
               class="w-full pl-8 pr-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none" />
      </div>
      <div ref="listRef" class="max-h-72 overflow-y-auto py-1">
        <button v-for="(o, i) in filteredOptions" :key="o.value ?? '__null'"
                type="button" @click="pick(o)"
                @mouseenter="activeIndex = i"
                :data-active="activeIndex === i"
                :class="['w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left transition',
                         o.value === modelValue ? 'bg-indigo-50 text-indigo-700 font-medium'
                           : (activeIndex === i ? 'bg-gray-50 text-gray-900' : 'text-gray-700 hover:bg-gray-50')]">
          <span v-if="o.indent" class="text-gray-300" :style="{ paddingLeft: `${(o.indent - 1) * 12}px` }">└─</span>
          <span class="flex-1 truncate">{{ o.label }}</span>
          <span v-if="o.hint" class="text-[11px] text-gray-400 truncate">{{ o.hint }}</span>
        </button>
        <div v-if="!filteredOptions.length" class="px-3 py-3 text-xs text-gray-400 italic text-center">
          Aucun résultat
        </div>
      </div>
    </div>
  </div>
</template>
