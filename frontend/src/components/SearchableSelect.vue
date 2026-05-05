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
import { library } from '@fortawesome/fontawesome-svg-core'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import * as allSolidIcons from '@fortawesome/pro-solid-svg-icons'
library.add(...Object.values(allSolidIcons).filter(i => i && i.iconName && i.icon))

function faName(icon) {
  if (!icon) return null
  return icon.replace(/^fa-/, '')
}

const props = defineProps({
  modelValue: { type: [String, Number, null], default: null },
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
})

const triggerCls = computed(() => [
  // min-h-11 (44px) garantit la cible tactile iOS HIG sur mobile pour
  // toutes les variantes (sm/md). Sur desktop le visuel reste compact
  // car le contenu ne dépasse pas la hauteur intrinsèque du texte.
  'w-full flex items-center gap-2 bg-white border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition min-h-11 sm:min-h-0',
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

const selectedOption = computed(() =>
  props.options.find(o => o.value === props.modelValue) || null
)
// En mode creatable, une valeur courante non listée doit quand même
// s'afficher dans le trigger (sinon elle paraît "perdue").
const customLabel = computed(() => {
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
  emit('update:modelValue', option.value)
  open.value = false
  search.value = ''
  window.removeEventListener('scroll', updatePopoverPosition, true)
  window.removeEventListener('resize', updatePopoverPosition)
}

function createCustom() {
  const q = search.value.trim()
  if (!q) return
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
  emit('update:modelValue', null)
}
</script>

<template>
  <div ref="rootRef" class="relative" @keydown="onKeydown">
    <button ref="triggerRef" type="button" @click="toggle" :disabled="disabled"
            :class="triggerCls">
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
      <button v-if="clearable && (selectedOption || customLabel) && !disabled" type="button"
              @click.stop="clear"
              class="text-gray-400 hover:text-gray-600 -my-1 p-0.5 rounded"
              title="Effacer la sélection">
        <XMarkIcon class="w-3.5 h-3.5" />
      </button>
      <ChevronDownIcon class="w-4 h-4 text-gray-400 shrink-0 transition-transform"
                       :class="open ? 'rotate-180' : ''" />
    </button>
    <Teleport to="body">
      <div v-if="open"
           data-searchable-popover="true"
           :style="popoverStyle"
           class="fixed z-100 bg-white border border-gray-200 rounded-lg shadow-xl overflow-hidden"
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
                           o.value === modelValue ? 'bg-indigo-50 text-indigo-700 font-medium'
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
            <CheckIcon v-if="o.value === modelValue" class="w-3.5 h-3.5 text-indigo-600 shrink-0" />
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
