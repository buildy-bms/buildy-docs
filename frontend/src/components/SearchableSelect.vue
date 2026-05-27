<script setup>
/**
 * Combobox recherchable. Props :
 *  - modelValue : valeur courante (peut etre null)
 *  - options    : Array<{ value, label, hint?, indent?, icon?, color? }>
 *                  indent : nombre d'espaces de prefixe (rendu visuel hierarchie)
 *                  icon   : 'fa-fire' / 'fa-bolt' / etc. (FontAwesome Solid Pro,
 *                           prefixe 'fa-' optionnel) — affiche en tete de ligne
 *                           ET dans le bouton trigger quand selectionne
 *                  color  : couleur hex de l'icone (defaut #6b7280)
 *  - placeholder : texte affiche quand aucune option
 *  - searchPlaceholder : placeholder de l'input recherche
 *  - clearable : afficher le bouton X pour reset a null (defaut true)
 *
 * Filtre simple sur label + hint, insensible aux accents et a la casse.
 * Auto-recherche desactivee si <6 options (UX inutile sur listes courtes).
 */
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { ChevronDownIcon, MagnifyingGlassIcon, XMarkIcon, CheckIcon } from '@heroicons/vue/24/outline'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
// Registre cure (~40 icones) pour eviter d'embarquer les ~3000 FA Pro
// Solid dans le bundle principal. Les options qui referencent une icone
// hors registre tombent sur 'cube' (cf. equipment-icons.js).
import { resolveFaIconName } from '@/lib/equipment-icons'

function faName(icon) {
  if (!icon) return null
  return resolveFaIconName(icon)
}

const props = defineProps({
  // mono : String | Number | null
  // multi : Array<String | Number>
  modelValue: { type: [String, Number, Array, null], default: null },
  options: { type: Array, default: () => [] },
  placeholder: { type: String, default: 'Sélectionner…' },
  searchPlaceholder: { type: String, default: 'Rechercher…' },
  disabled: { type: Boolean, default: false },
  clearable: { type: Boolean, default: true },
  // 'md' (defaut) = px-3 py-2 ~38px ; 'sm' = px-2 py-1 ~28px pour les
  // formulaires denses (SystemDevicesTable, inline editing).
  size: { type: String, default: 'md' },
  // Si true : permet d'ajouter une valeur libre non listée. Quand la
  // recherche ne match rien (ou même si match), un item "+ Ajouter «X»"
  // apparaît et émet update:modelValue avec la chaîne saisie. La valeur
  // courante non listée s'affiche aussi telle quelle dans le trigger.
  creatable: { type: Boolean, default: false },
  // Mode multi-select : modelValue = array, click sur une option toggle,
  // popover reste ouvert. Affichage chips dans le trigger.
  multiple: { type: Boolean, default: false },
  // Si true : habillage rouge pâle pour signaler une info manquante.
  invalid: { type: Boolean, default: false },
})

const triggerCls = computed(() => [
  // min-h-11 (44px) garantit la cible tactile iOS HIG sur mobile.
  // sm:min-h-9 (36px) sur desktop = même hauteur que les <input> avec
  // `h-9`, pour aligner verticalement avec un input texte voisin dans
  // les formulaires (incident 2026-05-27 : SearchableSelect rendait à
  // 27px là où l'input voisin faisait 32-36px → décalage visuel).
  'w-full flex items-center gap-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition min-h-11 sm:min-h-9',
  props.invalid ? 'bg-red-50 border-red-300' : 'bg-white border-gray-200',
  props.size === 'sm' ? 'px-2 py-1' : 'px-3 py-2 rounded-lg',
  props.disabled ? 'opacity-50 cursor-not-allowed' : '',
])

// Recherche auto-desactivee si la liste est courte (UX : eviter le focus
// trap sur 4 options visibles d'un coup d'oeil). En mode creatable la
// recherche est toujours visible — c'est aussi le champ de saisie libre.
const showSearch = computed(() => props.creatable || props.options.length >= 6)
// Toute option avec une icone -> on reserve la colonne icone pour aligner
// les labels meme sur les options sans icone (sinon ca saute visuellement).
const hasAnyIcon = computed(() => props.options.some(o => o.icon))
const emit = defineEmits(['update:modelValue'])

const open = ref(false)
const search = ref('')
const rootRef = ref(null)
const triggerRef = ref(null)
const inputRef = ref(null)
const listRef = ref(null)
const activeIndex = ref(0)
// Le popover est teleporté dans <body> + positionné en `position: fixed`
// avec coordonnées calculées depuis le trigger : évite tout clipping par
// `overflow-hidden`/transforms des conteneurs parents (modale, table, etc.)
// et garantit un z-index global au-dessus du reste de l'UI.
const popoverStyle = ref({ top: '0px', left: '0px', width: '0px' })
function updatePopoverPosition() {
  const el = triggerRef.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  popoverStyle.value = {
    top: `${rect.bottom + 4}px`,
    left: `${rect.left}px`,
    width: `${rect.width}px`,
    minWidth: '180px',
  }
}

// Helpers pour les 2 modes (mono | multi).
const selectedValues = computed(() => {
  if (props.multiple) {
    return Array.isArray(props.modelValue) ? props.modelValue : []
  }
  return props.modelValue == null || props.modelValue === '' ? [] : [props.modelValue]
})
function isSelected(val) {
  return selectedValues.value.some(v => v === val)
}

const selectedOption = computed(() =>
  props.options.find(o => o.value === props.modelValue) || null
)
// Liste d'options sélectionnées en mode multi (pour rendu chips dans le trigger).
const selectedOptions = computed(() => {
  if (!props.multiple) return []
  return selectedValues.value.map(v => {
    const opt = props.options.find(o => o.value === v)
    return opt || { value: v, label: String(v) }
  })
})
// En mode creatable, une valeur courante non listée doit quand même
// s'afficher dans le trigger (sinon elle paraît "perdue").
const customLabel = computed(() => {
  if (props.multiple) return null
  if (!props.creatable || selectedOption.value || props.modelValue == null
      || props.modelValue === '') return null
  return String(props.modelValue)
})
const canCreate = computed(() => {
  if (!props.creatable) return false
  const q = search.value.trim()
  if (!q) return false
  // Évite le doublon : si une option existante a exactement ce label.
  return !props.options.some(o => normalize(o.label) === normalize(q)
                                || normalize(o.value) === normalize(q))
})

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
    updatePopoverPosition()
    nextTick(() => {
      inputRef.value?.focus?.()
      activeIndex.value = Math.max(0, filteredOptions.value.findIndex(o => o.value === props.modelValue))
    })
    // Recalcule la position si la fenêtre est scrollée ou redimensionnée
    // pendant que le popover est ouvert.
    window.addEventListener('scroll', updatePopoverPosition, true)
    window.addEventListener('resize', updatePopoverPosition)
  } else {
    window.removeEventListener('scroll', updatePopoverPosition, true)
    window.removeEventListener('resize', updatePopoverPosition)
  }
}

function pick(option) {
  if (props.multiple) {
    const cur = selectedValues.value
    const next = cur.some(v => v === option.value)
      ? cur.filter(v => v !== option.value)
      : [...cur, option.value]
    emit('update:modelValue', next)
    // Reste ouvert en mode multi pour permettre l'ajout de plusieurs valeurs.
    nextTick(() => updatePopoverPosition())
    return
  }
  emit('update:modelValue', option.value)
  open.value = false
  search.value = ''
  window.removeEventListener('scroll', updatePopoverPosition, true)
  window.removeEventListener('resize', updatePopoverPosition)
}

function removeChip(val) {
  if (!props.multiple) return
  emit('update:modelValue', selectedValues.value.filter(v => v !== val))
}

function createCustom() {
  const q = search.value.trim()
  if (!q) return
  if (props.multiple) {
    if (!selectedValues.value.includes(q)) {
      emit('update:modelValue', [...selectedValues.value, q])
    }
    search.value = ''
    nextTick(() => updatePopoverPosition())
    return
  }
  emit('update:modelValue', q)
  open.value = false
  search.value = ''
  window.removeEventListener('scroll', updatePopoverPosition, true)
  window.removeEventListener('resize', updatePopoverPosition)
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
    else if (canCreate.value) createCustom()
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
  // Le popover est teleporté hors du rootRef. Vérifier aussi qu'on ne clique
  // pas dedans avant de fermer.
  if (rootRef.value && !rootRef.value.contains(ev.target)
      && !ev.target.closest?.('[data-searchable-popover="true"]')) {
    open.value = false
  }
}

onMounted(() => document.addEventListener('mousedown', onDocClick))
onBeforeUnmount(() => document.removeEventListener('mousedown', onDocClick))

function clear() {
  emit('update:modelValue', props.multiple ? [] : null)
}
</script>

<template>
  <div ref="rootRef" class="relative" @keydown="onKeydown">
    <button ref="triggerRef" type="button" @click="toggle" :disabled="disabled"
            :class="triggerCls">
      <!-- Mode multi : chips. Click sur ✕ retire la valeur sans ouvrir le popover. -->
      <template v-if="multiple">
        <span v-if="!selectedOptions.length"
              class="flex-1 text-left truncate text-gray-400 italic">{{ placeholder }}</span>
        <span v-else class="flex-1 flex flex-wrap items-center gap-1">
          <span v-for="o in selectedOptions" :key="o.value"
                class="inline-flex items-center gap-1 pl-1.5 pr-0.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 text-[11px]">
            <FontAwesomeIcon v-if="o.icon" :icon="['fas', faName(o.icon)]"
                             :style="{ color: o.color || '#6b7280' }"
                             class="w-3 h-3 shrink-0" />
            <span class="truncate max-w-40">{{ o.label }}</span>
            <button v-if="!disabled" type="button" @click.stop="removeChip(o.value)"
                    class="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full text-indigo-400 hover:text-white hover:bg-indigo-500 transition"
                    v-tooltip="'Retirer'">
              <XMarkIcon class="w-2.5 h-2.5" />
            </button>
          </span>
        </span>
      </template>
      <!-- Mode mono : un seul label -->
      <template v-else>
        <FontAwesomeIcon
          v-if="selectedOption?.icon"
          :icon="['fas', faName(selectedOption.icon)]"
          :style="{ color: selectedOption.color || '#6b7280' }"
          class="w-4 h-4 shrink-0"
        />
        <span class="flex-1 text-left truncate"
              :class="(selectedOption || customLabel) ? 'text-gray-900' : 'text-gray-400 italic'">
          {{ selectedOption?.label || customLabel || placeholder }}
        </span>
      </template>
      <button v-if="clearable && (multiple ? selectedOptions.length : (selectedOption || customLabel)) && !disabled" type="button"
              @click.stop="clear"
              class="text-gray-400 hover:text-gray-600 -my-1 p-0.5 rounded"
              v-tooltip="'Effacer la sélection'">
        <XMarkIcon class="w-3.5 h-3.5" />
      </button>
      <ChevronDownIcon class="w-4 h-4 text-gray-400 shrink-0 transition-transform"
                       :class="open ? 'rotate-180' : ''" />
    </button>
    <Teleport to="body">
      <div v-if="open"
           data-searchable-popover="true"
           :style="popoverStyle"
           class="fixed z-115 bg-white border border-gray-200 rounded-lg shadow-xl overflow-hidden"
           @keydown="onKeydown">
        <div v-if="showSearch" class="relative border-b border-gray-100">
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
                  :class="['w-full flex items-center gap-2.5 px-3 py-1.5 sm:py-1.5 text-sm text-left transition min-h-11 sm:min-h-0',
                           isSelected(o.value) ? 'bg-indigo-50 text-indigo-700 font-medium'
                             : (activeIndex === i ? 'bg-gray-50 text-gray-900' : 'text-gray-700 hover:bg-gray-50')]">
            <span v-if="o.indent" class="text-gray-300" :style="{ paddingLeft: `${(o.indent - 1) * 12}px` }">└─</span>
            <FontAwesomeIcon
              v-if="o.icon"
              :icon="['fas', faName(o.icon)]"
              :style="{ color: o.color || '#6b7280' }"
              class="w-4 h-4 shrink-0"
            />
            <span v-else-if="hasAnyIcon" class="w-4 shrink-0"></span>
            <span class="flex-1 truncate">{{ o.label }}</span>
            <span v-if="o.hint" class="text-[11px] text-gray-400 truncate">{{ o.hint }}</span>
            <CheckIcon v-if="isSelected(o.value)" class="w-3.5 h-3.5 text-indigo-600 shrink-0" />
          </button>
          <div v-if="!filteredOptions.length && !canCreate" class="px-3 py-3 text-xs text-gray-400 italic text-center">
            Aucun résultat
          </div>
          <button v-if="canCreate" type="button" @click="createCustom"
                  class="w-full flex items-center gap-2.5 px-3 py-1.5 sm:py-1.5 text-sm text-left transition border-t border-gray-100 text-indigo-700 hover:bg-indigo-50 min-h-11 sm:min-h-0">
            <span class="flex-1 truncate">+ Ajouter «&nbsp;<strong>{{ search.trim() }}</strong>&nbsp;»</span>
          </button>
        </div>
      </div>
    </Teleport>
  </div>
</template>
