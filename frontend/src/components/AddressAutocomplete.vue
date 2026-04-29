<script setup>
import { ref, watch, onUnmounted } from 'vue'
import { MapPinIcon } from '@heroicons/vue/24/outline'

const props = defineProps({
  modelValue: { type: String, default: '' },
  placeholder: { type: String, default: 'Rechercher une adresse…' },
  required: { type: Boolean, default: false },
  inputClass: { type: String, default: '' },
})
const emit = defineEmits(['update:modelValue', 'selected'])

const query = ref(props.modelValue || '')
const suggestions = ref([])
const isOpen = ref(false)
const loading = ref(false)
const activeIndex = ref(-1)

let debounceTimer = null
let abortController = null

watch(() => props.modelValue, (v) => {
  if (v !== query.value) query.value = v || ''
})

function onInput(e) {
  const val = e.target.value
  query.value = val
  emit('update:modelValue', val)
  scheduleSearch(val)
}

function scheduleSearch(q) {
  if (debounceTimer) clearTimeout(debounceTimer)
  if ((q || '').trim().length < 3) {
    suggestions.value = []
    isOpen.value = false
    return
  }
  debounceTimer = setTimeout(() => doSearch(q), 250)
}

async function doSearch(q) {
  if (abortController) abortController.abort()
  abortController = new AbortController()
  loading.value = true
  try {
    const url = `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(q)}&limit=6&autocomplete=1`
    const res = await fetch(url, { signal: abortController.signal })
    if (!res.ok) throw new Error('search failed')
    const data = await res.json()
    suggestions.value = (data.features || []).map(f => ({
      label: f.properties.label,
      city: f.properties.city,
      postcode: f.properties.postcode,
      context: f.properties.context,
      lat: f.geometry?.coordinates?.[1] ?? null,
      lng: f.geometry?.coordinates?.[0] ?? null,
    }))
    isOpen.value = suggestions.value.length > 0
    activeIndex.value = -1
  } catch (err) {
    if (err.name !== 'AbortError') {
      // Pas de toast : fallback silencieux sur saisie libre.
      suggestions.value = []
      isOpen.value = false
    }
  } finally {
    loading.value = false
  }
}

function pick(s) {
  query.value = s.label
  emit('update:modelValue', s.label)
  emit('selected', s)
  isOpen.value = false
  suggestions.value = []
}

function onKeydown(e) {
  if (!isOpen.value || !suggestions.value.length) return
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    activeIndex.value = (activeIndex.value + 1) % suggestions.value.length
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    activeIndex.value = activeIndex.value <= 0 ? suggestions.value.length - 1 : activeIndex.value - 1
  } else if (e.key === 'Enter' && activeIndex.value >= 0) {
    e.preventDefault()
    pick(suggestions.value[activeIndex.value])
  } else if (e.key === 'Escape') {
    isOpen.value = false
  }
}

function onBlur() {
  // Delay close to allow click on suggestion
  setTimeout(() => { isOpen.value = false }, 150)
}

onUnmounted(() => {
  if (debounceTimer) clearTimeout(debounceTimer)
  if (abortController) abortController.abort()
})
</script>

<template>
  <div class="relative">
    <div class="relative">
      <MapPinIcon class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
      <input
        type="text"
        :value="query"
        @input="onInput"
        @keydown="onKeydown"
        @focus="suggestions.length && (isOpen = true)"
        @blur="onBlur"
        :placeholder="placeholder"
        :required="required"
        autocomplete="off"
        data-1p-ignore="true"
        data-bwignore="true"
        data-lpignore="true"
        :class="['w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-all', inputClass]"
      />
      <div v-if="loading" class="absolute right-3 top-1/2 -translate-y-1/2 w-3 h-3 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
    </div>
    <ul
      v-if="isOpen && suggestions.length"
      class="absolute z-50 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-72 overflow-y-auto"
    >
      <li
        v-for="(s, i) in suggestions"
        :key="i"
        @mousedown.prevent="pick(s)"
        @mouseenter="activeIndex = i"
        :class="['px-3 py-2 cursor-pointer text-sm flex items-start gap-2', activeIndex === i ? 'bg-indigo-50' : 'hover:bg-gray-50']"
      >
        <MapPinIcon class="w-3.5 h-3.5 text-gray-400 mt-0.5 shrink-0" />
        <div class="min-w-0 flex-1">
          <div class="text-gray-800 truncate">{{ s.label }}</div>
          <div class="text-[11px] text-gray-400 truncate">{{ s.context }}</div>
        </div>
      </li>
    </ul>
  </div>
</template>
