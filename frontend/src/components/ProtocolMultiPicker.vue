<script setup>
/**
 * Multi-select protocoles avec popover téléportée dans le body
 * (pour ne pas être clippée par les overflow:hidden des parents).
 * Stocke un JSON array dans v-model:value (string).
 */
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { ChevronDownIcon, CheckIcon, XMarkIcon } from '@heroicons/vue/24/outline'

const props = defineProps({
  modelValue: { type: String, default: null },
  options: { type: Array, required: true }, // [{ value, label }]
  disabled: { type: Boolean, default: false },
  placeholder: { type: String, default: '—' },
  size: { type: String, default: 'sm' }, // 'xs' | 'sm' | 'md'
  // Lorsque la question « Communicant ? » est gérée séparément en amont
  // (cf. DeviceEditModal refondue), on n'a plus besoin de proposer
  // « Non communicant » dans la liste — la réponse Non au toggle suffit.
  excludeNonCommunicant: { type: Boolean, default: false },
})

// Options effectivement présentées : on retire `non_communicant` si demandé.
const effectiveOptions = computed(() => {
  if (!props.excludeNonCommunicant) return props.options
  return props.options.filter(o => o.value !== 'non_communicant')
})
const emit = defineEmits(['update:modelValue'])

const open = ref(false)
const rootEl = ref(null)
const popoverEl = ref(null)
const popoverPos = ref({ top: 0, left: 0, width: 256 })

const selected = computed(() => {
  if (!props.modelValue) return []
  try {
    const v = JSON.parse(props.modelValue)
    return Array.isArray(v) ? v : []
  } catch {
    return props.modelValue ? [props.modelValue] : []
  }
})

// Filtre les valeurs legacy qui ne sont plus dans les options (ex :
// 'non_communicant', 'other') : la case « Communicant » porte déjà
// l'info, on ne veut pas dupliquer côté pilule.
// Filtre les valeurs legacy qui ne sont plus dans les options effectives
// (ex. 'non_communicant' quand excludeNonCommunicant=true) : la pilule ne doit
// pas les afficher non plus, sinon on voit fantôme une « Non communicant »
// alors que la question est portée par un toggle externe.
const validValues = computed(() => new Set(effectiveOptions.value.map(o => o.value)))
const selectedLabels = computed(() =>
  selected.value
    .filter(v => validValues.value.has(v))
    .map(v => effectiveOptions.value.find(o => o.value === v)?.label || v)
)

function toggle(value) {
  const set = new Set(selected.value)
  if (set.has(value)) set.delete(value); else set.add(value)
  emit('update:modelValue', set.size ? JSON.stringify([...set]) : null)
}

function clear() {
  emit('update:modelValue', null)
}

function updatePosition() {
  if (!rootEl.value) return
  const r = rootEl.value.getBoundingClientRect()
  const W = Math.max(256, r.width)
  const H = 256 // max-h-64
  let top = r.bottom + 4
  let left = r.left
  // flip vers le haut si pas la place en bas
  if (top + H > window.innerHeight - 8 && r.top > H + 8) {
    top = r.top - H - 4
  }
  // contraint dans la viewport horizontalement
  if (left + W > window.innerWidth - 8) {
    left = Math.max(8, window.innerWidth - W - 8)
  }
  popoverPos.value = { top, left, width: W }
}

async function openPopover() {
  open.value = true
  await nextTick()
  updatePosition()
}

function onDocClick(e) {
  if (!open.value) return
  const inRoot = rootEl.value && rootEl.value.contains(e.target)
  const inPop = popoverEl.value && popoverEl.value.contains(e.target)
  if (!inRoot && !inPop) open.value = false
}
onMounted(() => {
  document.addEventListener('mousedown', onDocClick)
  window.addEventListener('scroll', updatePosition, true)
  window.addEventListener('resize', updatePosition)
})
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocClick)
  window.removeEventListener('scroll', updatePosition, true)
  window.removeEventListener('resize', updatePosition)
})

const buttonCls = computed(() => {
  // Sur mobile (< sm = 640px), force min-h 44px + text-base (anti-zoom Safari)
  // pour respecter les cibles tactiles iOS, peu importe la taille demandée.
  let sz
  if (props.size === 'xs') {
    sz = 'px-3 py-3 sm:px-2 sm:py-1 min-h-11 sm:min-h-0 text-base sm:text-[11px]'
  } else if (props.size === 'md') {
    // Taille « md » : assez haute pour s'aligner sur un SegmentedToggle
    // (utilisée dans la modale DeviceEditModal pour la ligne Communicant
    // + protocoles côte à côte).
    sz = 'px-3 py-3 sm:px-3 sm:py-2 min-h-11 text-base sm:text-sm'
  } else {
    sz = 'px-3 py-3 sm:px-2.5 sm:py-1.5 min-h-11 sm:min-h-0 text-base sm:text-xs'
  }
  return `w-full inline-flex items-center justify-between gap-1 ${sz} border border-gray-200 rounded-lg bg-white hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition disabled:opacity-50 disabled:cursor-not-allowed`
})
</script>

<template>
  <div class="relative" ref="rootEl">
    <button
      type="button"
      :disabled="disabled"
      :class="buttonCls"
      @click="open ? (open = false) : openPopover()"
    >
      <span v-if="!selected.length" class="text-gray-400 italic flex-1 text-left">{{ placeholder }}</span>
      <span v-else class="flex items-center gap-1 flex-1 text-left whitespace-nowrap">
        <!-- 1er protocole en pill, "+N" badge si d'autres existent. Click
             sur le bouton ouvre le popover qui les liste tous. -->
        <span class="inline-flex items-center px-1.5 py-0 rounded bg-emerald-50 text-emerald-700 text-[10px] font-medium border border-emerald-200">
          {{ selectedLabels[0] }}
        </span>
        <span v-if="selectedLabels.length > 1"
              class="inline-flex items-center px-1.5 py-0 rounded bg-emerald-100 text-emerald-700 text-[10px] font-semibold border border-emerald-200"
              :title="selectedLabels.slice(1).join(', ')">
          +{{ selectedLabels.length - 1 }}
        </span>
      </span>
      <ChevronDownIcon class="w-3.5 h-3.5 text-gray-400 shrink-0"
                       :class="{ 'rotate-180': open }" />
    </button>

    <Teleport to="body">
      <div
        v-if="open"
        ref="popoverEl"
        :style="{ top: popoverPos.top + 'px', left: popoverPos.left + 'px', width: popoverPos.width + 'px' }"
        class="fixed z-115 max-h-64 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-xl py-1"
      >
        <div class="flex items-center justify-between px-3 py-1.5 border-b border-gray-100 sticky top-0 bg-white">
          <span class="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">Protocole(s)</span>
          <button v-if="selected.length" @click="clear"
                  class="text-[10px] text-gray-400 hover:text-red-600 inline-flex items-center gap-0.5">
            <XMarkIcon class="w-3 h-3" /> Effacer
          </button>
        </div>
        <button
          v-for="o in effectiveOptions"
          :key="o.value || 'null'"
          type="button"
          @click="toggle(o.value)"
          class="w-full flex items-center gap-3 px-3 py-3 sm:py-1.5 min-h-11 sm:min-h-0 text-base sm:text-xs text-left active:bg-emerald-100 sm:hover:bg-emerald-50/50 transition"
          :class="selected.includes(o.value) ? 'text-emerald-700 font-medium' : 'text-gray-700'"
        >
          <span :class="['w-7 h-7 sm:w-4 sm:h-4 rounded border-2 sm:border flex items-center justify-center shrink-0',
                         selected.includes(o.value) ? 'bg-emerald-500 border-emerald-500' : 'border-gray-300']">
            <CheckIcon v-if="selected.includes(o.value)" class="w-5 h-5 sm:w-3 sm:h-3 text-white" />
          </span>
          {{ o.label }}
        </button>
      </div>
    </Teleport>
  </div>
</template>
