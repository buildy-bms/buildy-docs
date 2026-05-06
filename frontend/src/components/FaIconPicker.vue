<script setup>
/**
 * Picker d'icone FontAwesome Pro Solid.
 *
 * Pattern : input texte avec datalist (autocomplete navigateur) +
 * preview live de l'icone selectionnee + bouton "Effacer".
 *
 * v-model = nom FA en kebab-case (ex: "camera", "chart-line", "building").
 * Pas de prefixe 'fa-'. null/'' = pas d'icone.
 */
import { computed, ref, onMounted } from 'vue'
import { library } from '@fortawesome/fontawesome-svg-core'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { XMarkIcon, MagnifyingGlassIcon } from '@heroicons/vue/24/outline'

// Lazy load de la full lib FA Pro Solid (~1 Mo gzipped) UNIQUEMENT quand
// le picker est instancie (admin only). Evite de polluer le bundle main.
const allNames = ref([])
const knownNames = ref(new Set())
onMounted(async () => {
  const allSolidIcons = await import('@fortawesome/pro-solid-svg-icons')
  const iconObjs = Object.values(allSolidIcons).filter(i => i && i.iconName && i.icon)
  library.add(...iconObjs)
  const names = iconObjs.map(i => i.iconName).sort()
  allNames.value = names
  knownNames.value = new Set(names)
})

const props = defineProps({
  modelValue: { type: String, default: null },
})
const emit = defineEmits(['update:modelValue'])

const query = ref(props.modelValue || '')
const showSuggestions = ref(false)

const validIcon = computed(() => {
  const v = (query.value || '').trim().toLowerCase()
  return v && knownNames.value.has(v) ? v : null
})

// Suggestions filtrees : prefixe d'abord, puis substring
const suggestions = computed(() => {
  const q = (query.value || '').trim().toLowerCase()
  if (!q) return allNames.value.slice(0, 30)
  const prefix = []
  const sub = []
  for (const n of allNames.value) {
    if (n === q) continue
    if (n.startsWith(q)) prefix.push(n)
    else if (n.includes(q)) sub.push(n)
    if (prefix.length + sub.length > 60) break
  }
  return [...prefix, ...sub].slice(0, 30)
})

function pick(name) {
  query.value = name
  emit('update:modelValue', name)
  showSuggestions.value = false
}
function clear() {
  query.value = ''
  emit('update:modelValue', null)
}
function onInput() {
  // Si l'user tape un nom valide, on emit immediatement. Sinon on attend.
  const v = (query.value || '').trim().toLowerCase()
  if (!v) emit('update:modelValue', null)
  else if (knownNames.value.has(v)) emit('update:modelValue', v)
}
function onBlur() { setTimeout(() => { showSuggestions.value = false }, 150) }
</script>

<template>
  <div class="relative">
    <div class="flex items-center gap-2 px-3 py-2 border border-gray-200 rounded-lg bg-white focus-within:ring-2 focus-within:ring-indigo-500/30 focus-within:border-indigo-500 transition">
      <span class="w-7 h-7 flex items-center justify-center shrink-0 text-gray-600 text-lg">
        <FontAwesomeIcon v-if="validIcon" :icon="['fas', validIcon]" />
        <MagnifyingGlassIcon v-else class="w-4 h-4 text-gray-300" />
      </span>
      <input
        v-model="query"
        @input="onInput"
        @focus="showSuggestions = true"
        @blur="onBlur"
        type="text"
        autocomplete="off"
        placeholder="ex: camera, chart-line, building…"
        class="flex-1 min-w-0 text-sm bg-transparent border-0 focus:outline-none focus:ring-0 px-0"
      />
      <button v-if="query" type="button" @click="clear"
              class="text-gray-400 hover:text-red-500 p-0.5 shrink-0"
              title="Retirer l'icône">
        <XMarkIcon class="w-4 h-4" />
      </button>
    </div>

    <!-- Suggestions : grille d'icones cliquables -->
    <div v-if="showSuggestions && suggestions.length"
         class="absolute z-30 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-72 overflow-y-auto p-2">
      <div class="grid grid-cols-6 gap-1.5">
        <button
          v-for="name in suggestions"
          :key="name"
          type="button"
          @mousedown.prevent="pick(name)"
          :class="['flex flex-col items-center gap-1 p-2 rounded-md hover:bg-indigo-50 transition',
                   validIcon === name ? 'bg-indigo-100 ring-1 ring-indigo-300' : '']"
          :title="name"
        >
          <FontAwesomeIcon :icon="['fas', name]" class="w-5 h-5 text-gray-700" />
          <span class="text-[9px] text-gray-500 truncate max-w-full">{{ name }}</span>
        </button>
      </div>
    </div>
  </div>
</template>
