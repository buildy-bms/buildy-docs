<script setup>
/**
 * Sous-onglets d'une étape d'audit (zones de l'étape Systèmes, énergies de
 * l'étape Compteurs). Barre segmentée compacte : onglet actif blanc, les
 * autres discrets ; un onglet « vide » reste visible, grisé (jamais caché).
 *
 * items : [{ key, label, meta?, count?, icon?, iconColor?, badge?,
 *            badgeTone? ('amber'|'red'|'gray'), dot? ('amber'|'red'),
 *            tag?, muted?, tooltip? }]
 */
import { ref, watch, onMounted, nextTick } from 'vue'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import '@/lib/equipment-icons'
import { useRovingTabs } from '@/composables/useRovingTabs'

const props = defineProps({
  items: { type: Array, required: true },
  modelValue: { type: [String, Number], default: null },
  ariaLabel: { type: String, default: '' },
  idPrefix: { type: String, default: 'subtab' },
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

const scroller = ref(null)
const { onKeydown, ensureVisible } = useRovingTabs(scroller, { keyAttr: 'data-audit-subtab' })
onMounted(() => nextTick(() => ensureVisible(props.modelValue)))
watch(() => props.modelValue, (k) => nextTick(() => ensureVisible(k)))

// Actif : navy plein, texte blanc. Autres : pastilles blanches bordées ;
// un onglet « vide » (énergie sans compteur) reste visible, grisé.
function isActive(item) { return item.key === props.modelValue }
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
    @keydown="onKeydown"
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
      v-tooltip="item.tooltip ? { text: item.tooltip, placement: 'bottom' } : null"
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
    </button>
  </div>
</template>
