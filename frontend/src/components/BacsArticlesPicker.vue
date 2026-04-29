<script setup>
/**
 * Multi-select pour les articles du décret BACS (R175-1 à R175-6).
 *
 * v-model = string sérialisée au format historique :
 *   "R175-1 §1, §2 ; R175-3 §4 ; R175-5-1"
 *
 * UI : liste verticale ; chaque ligne = un article avec son titre. Cliquer
 * la ligne (ou la checkbox) toggle la sélection. Quand sélectionné, un
 * input pour préciser des paragraphes apparaît à droite.
 */
import { computed, ref, watch } from 'vue'
import { CheckIcon } from '@heroicons/vue/24/outline'

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

function updateParagraphs(code, value) {
  const r = refs.value.find(x => x.code === code)
  if (r) {
    r.paragraphs = value.trim()
    emitChange()
  }
}
</script>

<template>
  <div class="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100 overflow-hidden">
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
             placeholder="§1, §2 (optionnel)"
             class="w-44 px-2.5 py-1 bg-white border border-purple-200 rounded-md text-xs text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500/30 focus:border-purple-500 transition" />
    </label>
  </div>
</template>
