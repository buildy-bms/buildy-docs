<script setup>
/**
 * Sous-onglets d'une étape d'audit (zones de l'étape Systèmes, énergies de
 * l'étape Compteurs). Barre segmentée compacte : onglet actif blanc, les
 * autres discrets ; un onglet « vide » reste visible, grisé (jamais caché).
 *
 * items : [{ key, label, meta?, count?, icon?, iconColor?, badge?,
 *            badgeTone? ('amber'|'red'|'gray'), dot? ('amber'|'red'),
 *            badges? ([{ text, tone ('amber'|'rose'|'dashed'), label }] : pastilles de la
 *            mise en page guidée de l'étape Systèmes, à compléter / à vérifier / sans réponse),
 *            tag?, muted?, tooltip? (étiquette ou carte v-tooltip) }]
 */
import { ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import '@/lib/equipment-icons'
import { useRovingTabs } from '@/composables/useRovingTabs'

const props = defineProps({
  items: { type: Array, required: true },
  modelValue: { type: [String, Number], default: null },
  ariaLabel: { type: String, default: '' },
  idPrefix: { type: String, default: 'subtab' },
  // Barre plus large que la place (zones nombreuses) : fondu sur le bord qui cache des onglets,
  // molette verticale = défilement horizontal (mise en page guidée de l'étape Systèmes).
  scrollHints: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue'])

const BADGE_TONES = {
  amber: 'bg-amber-100 text-amber-800',
  red: 'bg-red-100 text-red-700',
  gray: 'bg-gray-100 text-gray-600',
}
const DOT_TONES = {
  amber: 'bg-amber-400',
  red: 'bg-red-500',
}
// Pastilles multiples (mise en page guidée) : lisibles sur l'onglet blanc comme sur l'actif (navy).
const MULTI_TONES = {
  amber: { idle: 'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-300', active: 'bg-amber-200 text-amber-950' },
  rose: { idle: 'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200', active: 'bg-rose-200 text-rose-950' },
  dashed: { idle: 'border border-dashed border-slate-500 text-slate-700', active: 'border border-dashed border-white/80 text-white' },
}
function multiBadgeClass(item, b) {
  const t = MULTI_TONES[b.tone] || MULTI_TONES.amber
  return isActive(item) ? t.active : t.idle
}

const scroller = ref(null)
const { onKeydown, ensureVisible } = useRovingTabs(scroller, { keyAttr: 'data-audit-subtab' })
onMounted(() => nextTick(() => ensureVisible(props.modelValue)))
watch(() => props.modelValue, (k) => nextTick(() => ensureVisible(k)))

// Bords qui cachent des onglets (scrollHints) : masque en fondu de 28 px de ce côté.
const hiddenLeft = ref(false)
const hiddenRight = ref(false)
function measureEdges() {
  const el = scroller.value
  if (!el || !props.scrollHints) return
  hiddenLeft.value = el.scrollLeft > 1
  hiddenRight.value = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
}
let edgesObs = null
onMounted(() => {
  if (!props.scrollHints || typeof ResizeObserver === 'undefined') return
  edgesObs = new ResizeObserver(measureEdges)
  if (scroller.value) edgesObs.observe(scroller.value)
  nextTick(measureEdges)
})
onBeforeUnmount(() => { edgesObs?.disconnect(); edgesObs = null })
watch(() => props.items.length, () => nextTick(measureEdges))
function maskStyle() {
  if (!props.scrollHints || (!hiddenLeft.value && !hiddenRight.value)) return null
  const l = hiddenLeft.value ? 'transparent 0, #000 28px' : '#000 0'
  const r = hiddenRight.value ? '#000 calc(100% - 28px), transparent 100%' : '#000 100%'
  const g = `linear-gradient(to right, ${l}, ${r})`
  return { maskImage: g, WebkitMaskImage: g }
}
function onWheel(e) {
  if (!props.scrollHints) return
  const el = scroller.value
  if (!el || el.scrollWidth <= el.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return
  el.scrollLeft += e.deltaY
  e.preventDefault()
}

// Actif : navy plein, texte blanc. Autres : pastilles blanches bordées ;
// un onglet « vide » (énergie sans compteur) reste visible, grisé.
function isActive(item) { return item.key === props.modelValue }

// Bulle d'un onglet (`item.tooltip`) : étiquette (chaîne) ou carte (objet { title, … } ou
// { label }), placée sous la barre. Une ancienne chaîne sur plusieurs lignes devient une
// carte (1re ligne = titre, les suivantes = liste) : jamais d'étiquette à retours à la ligne.
function tipFor(item) {
  const t = typeof item.tooltip === 'function' ? item.tooltip() : item.tooltip
  if (!t) return null
  if (typeof t === 'string') {
    const [first, ...rest] = t.split('\n').map(s => s.trim()).filter(Boolean)
    if (!first) return null
    return rest.length
      ? { title: first, text: rest.map(l => `• ${l}`).join('\n'), placement: 'bottom' }
      : { label: first, placement: 'bottom' }
  }
  return { placement: 'bottom', ...t }
}
function tabClass(item) {
  return [
    'relative inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs whitespace-nowrap transition shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-indigo-500/50',
    isActive(item)
      ? 'bg-indigo-600 text-white shadow-md shadow-indigo-900/20'
      : item.muted
        ? 'bg-white/60 text-gray-400 ring-1 ring-inset ring-slate-200 hover:bg-white hover:text-gray-600'
        : 'bg-white text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 hover:ring-slate-400',
  ]
}
</script>

<template>
  <div
    ref="scroller"
    role="tablist"
    :aria-label="ariaLabel || undefined"
    class="relative flex items-center gap-1.5 overflow-x-auto rounded-xl bg-slate-100 p-1.5 [scrollbar-width:thin]"
    :style="maskStyle()"
    @keydown="onKeydown"
    @scroll.passive="measureEdges"
    @wheel="onWheel"
  >
    <button
      v-for="item in items"
      :key="item.key"
      type="button"
      role="tab"
      :id="`${idPrefix}-${item.key}`"
      :aria-selected="item.key === modelValue ? 'true' : 'false'"
      :tabindex="item.key === modelValue ? 0 : -1"
      :data-audit-subtab="item.key"
      :class="tabClass(item)"
      v-tooltip="tipFor(item)"
      @click="emit('update:modelValue', item.key)"
    >
      <FontAwesomeIcon
        v-if="item.icon"
        :icon="item.icon"
        class="w-3.5 h-3.5 shrink-0"
        :class="item.muted && !isActive(item) ? 'opacity-50' : ''"
        :style="item.iconColor && !isActive(item) ? { color: item.iconColor } : null"
      />
      <span class="font-medium">{{ item.label }}</span>
      <span v-if="item.tag"
            :class="['text-[10px] px-1 py-px rounded', isActive(item) ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-600']">{{ item.tag }}</span>
      <span v-if="item.meta"
            :class="['text-[10.5px]', isActive(item) ? 'text-white/80' : 'text-gray-500']">{{ item.meta }}</span>
      <span
        v-if="item.count != null"
        :class="['min-w-5 h-4 px-1 rounded-full text-[10px] leading-none inline-flex items-center justify-center',
                 isActive(item) ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-700']"
      >{{ item.count }}</span>
      <span
        v-if="item.badge"
        :class="['min-w-4 h-4 px-1 rounded-full text-[10px] leading-none inline-flex items-center justify-center', BADGE_TONES[item.badgeTone] || BADGE_TONES.amber]"
      >{{ item.badge }}</span>
      <span v-if="item.dot" :class="['w-2 h-2 rounded-full', DOT_TONES[item.dot] || DOT_TONES.amber]"></span>
      <template v-for="b in item.badges || []" :key="b.tone">
        <span aria-hidden="true"
              :class="['min-w-4 h-4 px-1.5 rounded-full text-[10px] leading-none inline-flex items-center justify-center whitespace-nowrap', multiBadgeClass(item, b)]">{{ b.text }}</span>
        <span class="sr-only">{{ b.label }}</span>
      </template>
    </button>
  </div>
</template>
