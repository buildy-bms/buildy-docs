<script setup>
/**
 * Sélecteur tactile PWA : trigger plein-largeur ≥44pt + bottom sheet
 * iOS-natif quand on tap. Remplace `<select>` natif et MobileNativeSelect
 * dans tout l'audit mobile pour homogénéiser l'expérience.
 *
 * Options décorées : chaque entrée peut porter `icon` (FA Pro Solid via
 * lib/equipment-icons.js) + `color`, OU `pill` + `pillTone` pour un rendu
 * pilule colorée. Hint optionnel à droite (libellé secondaire).
 *
 * Mode `creatable` : item terminal « + Saisir une autre valeur… » qui
 * ouvre un input inline dans le sheet ; la valeur libre est émise telle
 * quelle (compatible API MobileNativeSelect).
 *
 * Sheet z-60 pour passer au-dessus d'un MobileSheet parent (z-50) tout en
 * restant sous popover SearchableSelect (z-100) et BaseModal (z-110).
 */
import { ref, computed, watch, nextTick } from 'vue'
import { Teleport } from 'vue'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { resolveFaIconName } from '@/lib/equipment-icons'

const props = defineProps({
  // Mono : String|Number|null. Multi : Array<String|Number>.
  modelValue: { type: [String, Number, Array, null], default: null },
  options: {
    type: Array,
    required: true,
    // [{ value, label, icon?, color?, pill?, pillTone?, hint? }]
  },
  placeholder: { type: String, default: '— Sélectionner —' },
  title: { type: String, default: 'Choisir' },
  creatable: { type: Boolean, default: false },
  customPlaceholder: { type: String, default: 'Saisir une valeur…' },
  searchable: { type: Boolean, default: null }, // null = auto (≥8 options)
  disabled: { type: Boolean, default: false },
  // Mode multi-select : tap toggle l'option sans fermer le sheet ; on
  // ferme via le bouton « Valider » du footer. modelValue devient un
  // tableau de values (compatible API `SearchableSelect :multiple`).
  multiple: { type: Boolean, default: false },
  // Grouper visuellement les options par le champ `hint` (chaque option
  // d'un meme hint apparait sous un sous-titre commun). Le hint disparait
  // alors de la ligne d'option (deja porte par le sous-titre).
  groupByHint: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue'])

const open = ref(false)
const search = ref('')
const customMode = ref(false)
const customDraft = ref('')
const customInput = ref(null)
const searchInput = ref(null)

function faName(icon) {
  return icon ? resolveFaIconName(icon) : null
}

function normalize(s) {
  return (s || '').toString().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

const showSearch = computed(() => {
  if (props.searchable != null) return props.searchable
  return props.options.length >= 8
})

const filtered = computed(() => {
  const q = normalize(search.value.trim())
  if (!q) return props.options
  return props.options.filter(o => normalize(o.label).includes(q) || normalize(o.hint).includes(q))
})

// L'option canonique correspondant à la valeur courante (mono only).
const matchedOption = computed(() =>
  props.options.find(o => String(o.value) === String(props.modelValue)) || null,
)
// Multi : set des valeurs sélectionnées pour lookup en O(1).
const selectedSet = computed(() => {
  if (!props.multiple) return new Set()
  const arr = Array.isArray(props.modelValue) ? props.modelValue : []
  return new Set(arr.map(String))
})
function isSelected(opt) {
  if (props.multiple) return selectedSet.value.has(String(opt.value))
  return String(opt.value) === String(props.modelValue)
}
// Options sélectionnées, dans l'ordre des options pour stabilité du
// rendu des pilules dans le trigger.
const selectedOptions = computed(() =>
  props.multiple ? props.options.filter(o => selectedSet.value.has(String(o.value))) : []
)
// Valeur libre (creatable) : la valeur n'est pas dans les options canoniques.
const isCustomValue = computed(() => {
  if (!props.creatable) return false
  if (props.multiple) return false
  const v = props.modelValue
  if (v == null || v === '') return false
  return !matchedOption.value
})
// Libellé affiché dans le trigger (mono uniquement, multi gère les
// pilules directement dans le template).
const triggerLabel = computed(() => {
  // `chipLabel` = libellé complet (« Zone · Usage »). Fallback `label`.
  if (matchedOption.value) return matchedOption.value.chipLabel || matchedOption.value.label
  if (isCustomValue.value) return String(props.modelValue)
  return null
})

function pillClass(tone) {
  switch (tone) {
    case 'indigo':  return 'bg-indigo-50 text-indigo-700 border border-indigo-200'
    case 'emerald': return 'bg-emerald-50 text-emerald-700 border border-emerald-200'
    case 'amber':   return 'bg-amber-50 text-amber-700 border border-amber-200'
    case 'violet':  return 'bg-violet-50 text-violet-700 border border-violet-200'
    case 'blue':    return 'bg-blue-50 text-blue-700 border border-blue-200'
    case 'rose':    return 'bg-rose-50 text-rose-700 border border-rose-200'
    case 'slate':   return 'bg-slate-100 text-slate-700 border border-slate-200'
    default:        return 'bg-gray-100 text-gray-700 border border-gray-200'
  }
}

function openSheet() {
  if (props.disabled) return
  open.value = true
  search.value = ''
  customMode.value = false
  customDraft.value = isCustomValue.value ? String(props.modelValue) : ''
  // Body scroll lock le temps que le sheet est ouvert.
  if (typeof document !== 'undefined') document.body.style.overflow = 'hidden'
  nextTick(() => {
    // N'auto-focus que sur clavier physique (pas mobile, sinon le clavier
    // soft monte automatiquement et masque la liste).
    if (showSearch.value && window.matchMedia?.('(pointer: fine)').matches) {
      searchInput.value?.focus()
    }
  })
}
function closeSheet() {
  open.value = false
  customMode.value = false
  if (typeof document !== 'undefined') document.body.style.overflow = ''
}

function pick(opt) {
  if (props.multiple) {
    // Toggle sans fermer le sheet.
    const current = Array.isArray(props.modelValue) ? [...props.modelValue] : []
    const idx = current.findIndex(v => String(v) === String(opt.value))
    if (idx >= 0) current.splice(idx, 1)
    else current.push(opt.value)
    emit('update:modelValue', current)
    return
  }
  emit('update:modelValue', opt.value)
  closeSheet()
}
function clear() {
  emit('update:modelValue', props.multiple ? [] : null)
}
function startCustom() {
  customMode.value = true
  customDraft.value = isCustomValue.value ? String(props.modelValue) : ''
  nextTick(() => customInput.value?.focus())
}
function commitCustom() {
  const v = customDraft.value.trim()
  if (!v) {
    emit('update:modelValue', null)
  } else {
    // Si la saisie libre matche une option, on canonise.
    const matched = props.options.find(o => normalize(o.label) === normalize(v))
    emit('update:modelValue', matched ? matched.value : v)
  }
  closeSheet()
}

// Garde-fou : si le parent change la valeur pendant que le sheet est
// ouvert, on rafraîchit le draft custom pour rester en phase.
watch(() => props.modelValue, (v) => {
  if (open.value && customMode.value) {
    customDraft.value = isCustomValue.value ? String(v) : ''
  }
})
</script>

<template>
  <div>
    <!-- Trigger : gabarit PWA standard (48px, text-base, border, rounded-xl). -->
    <button
      type="button"
      @click="openSheet"
      :disabled="disabled"
      :class="['pwa-select-trigger', disabled ? 'opacity-50 cursor-not-allowed' : 'active:bg-gray-50']"
    >
      <!-- Multi-select : pilules des options sélectionnées, à plat -->
      <template v-if="multiple">
        <span v-if="!selectedOptions.length"
              class="flex-1 text-left text-gray-500 italic truncate">{{ placeholder }}</span>
        <span v-else class="flex-1 flex items-center gap-1.5 flex-wrap min-w-0">
          <span
            v-for="o in selectedOptions" :key="o.value"
            class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-200"
          >
            <FontAwesomeIcon v-if="o.icon" :icon="['fas', faName(o.icon)]" :style="{ color: o.color || '#6366f1' }" class="w-3 h-3" />
            <!-- `chipLabel` = libellé complet (ex « Zone · Usage »). Fallback
                 sur `label` si non fourni par l'option. -->
            {{ o.chipLabel || o.label }}
          </span>
        </span>
      </template>
      <!-- Mono-select : icône + libellé classique -->
      <template v-else>
        <FontAwesomeIcon
          v-if="matchedOption?.icon"
          :icon="['fas', faName(matchedOption.icon)]"
          :style="{ color: matchedOption.color || '#6b7280' }"
          class="w-4 h-4 shrink-0"
        />
        <span
          v-else-if="matchedOption?.pill"
          :class="['inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium shrink-0', pillClass(matchedOption.pillTone)]"
        >{{ matchedOption.pill }}</span>

        <span
          class="flex-1 text-left truncate"
          :class="triggerLabel ? 'text-gray-900' : 'text-gray-500 italic'"
        >{{ triggerLabel || placeholder }}</span>
      </template>

      <FontAwesomeIcon :icon="['fas', 'chevron-down']" class="w-4 h-4 text-gray-500 shrink-0" />
    </button>

    <!-- Bottom sheet -->
    <Teleport to="body">
      <transition name="ms-fade">
        <div
          v-if="open"
          class="fixed inset-0 z-60 bg-black/40"
          @click="closeSheet"
        />
      </transition>
      <transition name="ms-slide">
        <div
          v-if="open"
          class="fixed inset-x-0 bottom-0 z-60 flex flex-col bg-white rounded-t-2xl shadow-2xl"
          :style="{ maxHeight: '85vh', paddingBottom: 'env(safe-area-inset-bottom)' }"
        >
          <!-- Drag indicator + header -->
          <div class="shrink-0 pt-2">
            <div class="mx-auto w-10 h-1.5 rounded-full bg-gray-300"></div>
          </div>
          <header class="shrink-0 flex items-center gap-2 px-3 pt-2 pb-3 border-b border-gray-100">
            <button
              type="button"
              @click="closeSheet"
              class="tap-target inline-flex items-center justify-center text-gray-600 -ml-1"
              aria-label="Fermer"
            >
              <FontAwesomeIcon :icon="['fas', 'xmark']" class="w-6 h-6" />
            </button>
            <h3 class="flex-1 min-w-0 text-center text-base font-medium text-gray-900 truncate">{{ title }}</h3>
            <!-- Multi : bouton « OK » pour confirmer la sélection courante.
                 Mono : bouton « Effacer » si une valeur est posée. -->
            <button
              v-if="multiple"
              type="button"
              @click="closeSheet"
              class="tap-target inline-flex items-center justify-center px-2 text-sm font-medium text-indigo-600 -mr-1"
            >OK</button>
            <button
              v-else-if="modelValue != null && modelValue !== '' && !customMode"
              type="button"
              @click="clear"
              class="tap-target inline-flex items-center justify-center px-2 text-sm font-medium text-gray-500 -mr-1"
            >Effacer</button>
            <span v-else class="w-7"></span>
          </header>

          <!-- Mode "Saisir une valeur libre" -->
          <div v-if="customMode" class="px-4 py-4">
            <label class="pwa-label mb-2">Saisir une valeur</label>
            <input
              ref="customInput"
              v-model="customDraft"
              type="text"
              :placeholder="customPlaceholder"
              class="pwa-input border-amber-300 focus:ring-amber-500/30 focus:border-amber-500"
              @keydown.enter.prevent="commitCustom"
            />
            <div class="mt-3 flex gap-2">
              <button
                type="button"
                @click="customMode = false"
                class="pwa-button pwa-button--neutral flex-1"
              >Annuler</button>
              <button
                type="button"
                @click="commitCustom"
                :disabled="!customDraft.trim()"
                class="pwa-button pwa-button--primary flex-1 disabled:opacity-40"
              >Utiliser</button>
            </div>
          </div>

          <!-- Mode liste : recherche + items -->
          <template v-else>
            <div v-if="showSearch" class="shrink-0 px-3 pt-3">
              <div class="relative">
                <FontAwesomeIcon :icon="['fas', 'magnifying-glass']" class="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none z-10" />
                <input
                  ref="searchInput"
                  v-model="search"
                  type="search"
                  inputmode="search"
                  placeholder="Rechercher…"
                  class="pwa-input pl-10 pr-3 bg-gray-50"
                />
              </div>
            </div>

            <div class="flex-1 overflow-y-auto overscroll-contain px-1 py-2">
              <template v-for="(o, oi) in filtered" :key="o.value ?? '__null'">
                <!-- Sous-titre de groupe (groupByHint) : insere quand la
                     valeur du hint change. Bandeau saillant pour bien
                     scander les groupes (gabarit aligne sur les cartes
                     du plan d'action, slate clair). -->
                <div v-if="groupByHint && o.hint && (oi === 0 || filtered[oi - 1].hint !== o.hint)"
                     :class="['mx-1 mb-1 px-3 py-2 rounded-lg bg-slate-100 border-l-[3px] border-slate-400 text-sm font-semibold text-slate-800',
                              oi === 0 ? 'mt-0' : 'mt-3']">
                  {{ o.hint }}
                </div>
              <button
                type="button"
                @click="pick(o)"
                :class="[
                  'pwa-list-item border-transparent',
                  isSelected(o) ? 'bg-indigo-50' : 'active:bg-gray-100',
                ]"
              >
                <FontAwesomeIcon
                  v-if="o.icon"
                  :icon="['fas', faName(o.icon)]"
                  :style="{ color: o.color || '#6b7280' }"
                  class="w-5 h-5 shrink-0"
                />
                <span
                  v-else-if="o.pill"
                  :class="['inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium shrink-0', pillClass(o.pillTone)]"
                >{{ o.pill }}</span>
                <span v-else class="w-5 shrink-0"></span>

                <span class="flex-1 min-w-0">
                  <span :class="['block text-base truncate', isSelected(o) ? 'text-indigo-700 font-medium' : 'text-gray-900']">{{ o.label }}</span>
                  <!-- En mode groupByHint, le hint est porté par le
                       sous-titre ; on évite de le doubler ici. -->
                  <span v-if="o.hint && !groupByHint" class="block text-sm text-gray-500 truncate">{{ o.hint }}</span>
                </span>

                <FontAwesomeIcon
                  v-if="isSelected(o)"
                  :icon="['fas', 'check']"
                  class="w-5 h-5 text-indigo-600 shrink-0"
                />
              </button>
              </template>

              <div v-if="!filtered.length" class="px-4 py-6 text-center text-sm text-gray-500 italic">
                Aucun résultat
              </div>

              <button
                v-if="creatable"
                type="button"
                @click="startCustom"
                class="pwa-list-item mt-1 text-amber-700 border-dashed border-amber-300 bg-amber-50/40 active:bg-amber-50"
              >
                <FontAwesomeIcon :icon="['fas', 'plus']" class="w-5 h-5 shrink-0" />
                <span class="flex-1 text-base">Saisir une autre valeur…</span>
              </button>
            </div>
          </template>
        </div>
      </transition>
    </Teleport>
  </div>
</template>

<style scoped>
.ms-fade-enter-active,
.ms-fade-leave-active { transition: opacity 200ms ease; }
.ms-fade-enter-from,
.ms-fade-leave-to { opacity: 0; }

.ms-slide-enter-active,
.ms-slide-leave-active { transition: transform 220ms cubic-bezier(0.32, 0.72, 0, 1); }
.ms-slide-enter-from,
.ms-slide-leave-to { transform: translateY(100%); }
</style>
