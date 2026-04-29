<script setup>
/**
 * Multi-select pour les articles du décret BACS (R175-1 à R175-6).
 *
 * v-model = string sérialisée au format historique :
 *   "R175-1 §1, §2 ; R175-3 §4 ; R175-5-1"
 *
 * Chaque pill = un article, cochable. Si coché, un mini-input apparaît
 * pour préciser des paragraphes (§1, §2). On émet la string concaténée.
 */
import { computed, ref, watch } from 'vue'

const props = defineProps({
  modelValue: { type: String, default: '' },
})
const emit = defineEmits(['update:modelValue'])

// Articles connus du décret BACS (codes de référence).
const ARTICLES = [
  { code: 'R175-1',   label: 'R175-1',   hint: 'Définitions' },
  { code: 'R175-2',   label: 'R175-2',   hint: 'Champ d\'application' },
  { code: 'R175-3',   label: 'R175-3',   hint: 'Fonctions du système BACS' },
  { code: 'R175-4',   label: 'R175-4',   hint: 'Échéances de mise en œuvre' },
  { code: 'R175-5',   label: 'R175-5',   hint: 'Mise en service' },
  { code: 'R175-5-1', label: 'R175-5-1', hint: 'Inspection périodique' },
  { code: 'R175-6',   label: 'R175-6',   hint: 'Sanctions' },
]

// Parse "R175-1 §1, §2 ; R175-3 §4" → [{code, paragraphs}]
function parseRefs(str) {
  if (!str) return []
  return str.split(';').map(part => {
    const trimmed = part.trim()
    const m = trimmed.match(/^(R175-[\w-]+)(?:\s+(.*))?$/)
    if (!m) return null
    return { code: m[1], paragraphs: (m[2] || '').trim() }
  }).filter(Boolean)
}

// Sérialise [{code, paragraphs}] → string
function serializeRefs(arr) {
  return arr
    .map(r => r.paragraphs ? `${r.code} ${r.paragraphs}` : r.code)
    .join(' ; ')
}

// État interne synchronisé avec modelValue
const refs = ref(parseRefs(props.modelValue))

watch(() => props.modelValue, (v) => {
  // Évite les boucles : ne re-parse que si la string sérialisée diffère.
  if (v !== serializeRefs(refs.value)) refs.value = parseRefs(v)
})

function emitChange() {
  emit('update:modelValue', serializeRefs(refs.value))
}

const selectedCodes = computed(() => new Set(refs.value.map(r => r.code)))

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
  <div class="space-y-2">
    <!-- Pills cochables -->
    <div class="flex flex-wrap gap-1.5">
      <button v-for="a in ARTICLES" :key="a.code" type="button" @click="toggle(a.code)"
              :title="a.hint"
              :class="['inline-flex items-center px-2.5 py-0.5 text-xs rounded-full border transition',
                       selectedCodes.has(a.code)
                         ? 'bg-purple-600 text-white border-purple-600 shadow-sm'
                         : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50']">
        {{ a.label }}
      </button>
    </div>

    <!-- Inputs paragraphes pour les articles selectionnes (un par ligne) -->
    <div v-if="refs.length" class="space-y-1">
      <div v-for="r in refs" :key="r.code" class="flex items-center gap-2">
        <span class="inline-flex items-center px-2 py-0.5 text-[11px] font-medium bg-purple-50 text-purple-700 border border-purple-200 rounded-full shrink-0 w-24 justify-center">
          {{ r.code }}
        </span>
        <input :value="r.paragraphs" @input="updateParagraphs(r.code, $event.target.value)"
               type="text" autocomplete="off" data-1p-ignore="true"
               placeholder="Paragraphes — ex : §1, §2 (optionnel)"
               class="flex-1 px-2.5 py-1 bg-white border border-gray-200 rounded-md text-xs text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500/30 focus:border-purple-500 transition" />
      </div>
    </div>
  </div>
</template>
