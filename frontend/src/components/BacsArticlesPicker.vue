<script setup>
/**
 * Multi-select pour les articles du décret BACS (R175-1 à R175-6).
 *
 * v-model = string sérialisée au format historique :
 *   "R175-1 1°, 2° ; R175-3 4° ; R175-5-1"
 *
 * UI = trigger compact (pills des articles sélectionnés) qui ouvre une
 * popover contenant la liste cochable + les inputs paragraphes inline.
 * Fermé par défaut : ne prend pas de place tant qu'on n'édite pas.
 */
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { CheckIcon, ChevronDownIcon, XMarkIcon } from '@heroicons/vue/24/outline'

const props = defineProps({
  modelValue: { type: String, default: '' },
})
const emit = defineEmits(['update:modelValue'])

const ARTICLES = [
  { code: 'R175-1',   title: 'Définitions' },
  { code: 'R175-2',   title: 'Champ d\'application' },
  { code: 'R175-3',   title: 'Fonctions du système BACS' },
  { code: 'R175-4',   title: 'Échéances de mise en œuvre' },
  { code: 'R175-5',   title: 'Mise en service' },
  { code: 'R175-5-1', title: 'Inspection périodique' },
  { code: 'R175-6',   title: 'Sanctions' },
]

function parseRefs(str) {
  if (!str) return []
  return str.split(';').map(part => {
    const trimmed = part.trim()
    const m = trimmed.match(/^(R175-[\w-]+)(?:\s+(.*))?$/)
    if (!m) return null
    return { code: m[1], paragraphs: (m[2] || '').trim() }
  }).filter(Boolean)
}

function serializeRefs(arr) {
  return arr
    .map(r => r.paragraphs ? `${r.code} ${r.paragraphs}` : r.code)
    .join(' ; ')
}

const refs = ref(parseRefs(props.modelValue))
const open = ref(false)
const rootRef = ref(null)

watch(() => props.modelValue, (v) => {
  if (v !== serializeRefs(refs.value)) refs.value = parseRefs(v)
})

function emitChange() {
  emit('update:modelValue', serializeRefs(refs.value))
}

const selectedByCode = computed(() => {
  const map = new Map()
  for (const r of refs.value) map.set(r.code, r)
  return map
})

function toggle(code) {
  const idx = refs.value.findIndex(r => r.code === code)
  if (idx >= 0) refs.value.splice(idx, 1)
  else refs.value.push({ code, paragraphs: '' })
  emitChange()
}

function removeRef(code, e) {
  e?.stopPropagation()
  const idx = refs.value.findIndex(r => r.code === code)
  if (idx >= 0) refs.value.splice(idx, 1)
  emitChange()
}

function updateParagraphs(code, value) {
  const r = refs.value.find(x => x.code === code)
  if (r) {
    r.paragraphs = value.trim()
    emitChange()
  }
}

function onDocClick(e) {
  if (rootRef.value && !rootRef.value.contains(e.target)) open.value = false
}
onMounted(() => document.addEventListener('mousedown', onDocClick))
onBeforeUnmount(() => document.removeEventListener('mousedown', onDocClick))
</script>

<template>
  <div ref="rootRef" class="relative">
    <!-- Trigger : pills des selections + chevron -->
    <button type="button" @click="open = !open"
            :class="['w-full flex items-center gap-1.5 px-2.5 py-1.5 min-h-10 bg-white border border-gray-200 rounded-lg text-sm transition focus:outline-none',
                     open ? 'ring-2 ring-purple-500/30 border-purple-500' : 'hover:border-gray-300']">
      <div v-if="refs.length" class="flex flex-wrap items-center gap-1 flex-1 min-w-0">
        <span v-for="r in refs" :key="r.code"
              class="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 bg-purple-50 text-purple-700 border border-purple-200 rounded-full text-[11px]">
          {{ r.code }}<span v-if="r.paragraphs" class="text-purple-500/80">&nbsp;{{ r.paragraphs }}</span>
          <span @click="removeRef(r.code, $event)"
                class="inline-flex items-center justify-center w-4 h-4 text-purple-400 hover:text-white hover:bg-purple-500 rounded-full transition cursor-pointer"
                title="Retirer">
            <XMarkIcon class="w-3 h-3" />
          </span>
        </span>
      </div>
      <span v-else class="flex-1 text-left text-gray-400 italic">Choisir des articles…</span>
      <ChevronDownIcon class="w-4 h-4 text-gray-400 shrink-0 transition-transform" :class="open ? 'rotate-180' : ''" />
    </button>

    <!-- Popover liste cochable -->
    <div v-if="open"
         class="absolute z-30 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden">
      <div class="divide-y divide-gray-100 max-h-88 overflow-y-auto">
        <label v-for="a in ARTICLES" :key="a.code"
               :class="['flex items-center gap-3 px-3 py-2 cursor-pointer transition',
                        selectedByCode.has(a.code) ? 'bg-purple-50/40 hover:bg-purple-50/70' : 'hover:bg-gray-50']">
          <span :class="['shrink-0 w-5 h-5 rounded-md border-2 flex items-center justify-center transition',
                         selectedByCode.has(a.code) ? 'bg-purple-600 border-purple-600' : 'bg-white border-gray-300']">
            <CheckIcon v-if="selectedByCode.has(a.code)" class="w-3.5 h-3.5 text-white" />
          </span>
          <input type="checkbox" class="sr-only" :checked="selectedByCode.has(a.code)" @change="toggle(a.code)" />

          <span :class="['shrink-0 inline-flex items-center justify-center px-2 py-0.5 text-[11px] font-mono rounded-full border min-w-22',
                         selectedByCode.has(a.code)
                           ? 'bg-purple-600 text-white border-purple-600'
                           : 'bg-gray-100 text-gray-600 border-gray-200']">
            {{ a.code }}
          </span>

          <span class="text-sm text-gray-700 truncate flex-1">{{ a.title }}</span>

          <input v-if="selectedByCode.has(a.code)"
                 :value="selectedByCode.get(a.code).paragraphs"
                 @input="updateParagraphs(a.code, $event.target.value)"
                 @click.stop
                 type="text" autocomplete="off" data-1p-ignore="true"
                 placeholder="1°, 2°"
                 class="w-32 px-2 py-1 bg-white border border-purple-200 rounded-md text-xs text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500/30 focus:border-purple-500 transition" />
        </label>
      </div>
    </div>
  </div>
</template>
