<script setup>
/**
 * Composant Button unifié — Vague 4 item 14 de l'audit BACS. Tokens
 * centralisés pour aligner les boutons éparpillés dans les sections
 * audit (toolbar, sections, modales) qui avaient chacun leurs propres
 * `px-2.5 py-1` / `px-3 py-1.5` / `px-3 py-2` incohérents.
 *
 * Adoption progressive : pas obligatoire de migrer tous les boutons
 * existants. Adopter dans le neuf, et au passage quand on touche un
 * existant.
 *
 * Props :
 *   variant : 'primary' (indigo solide, action principale)
 *           | 'secondary' (outline gris, annuler/retour)
 *           | 'tertiary' (ghost, action discrète : régénérer, plus…)
 *           | 'success' (emerald solide, livrer/valider)
 *           | 'danger' (red, supprimer)
 *   size    : 'sm' (toolbar inline) | 'md' (défaut) | 'lg' (sheets / formulaires)
 *   loading : Boolean — disable + spinner ArrowPathIcon
 *
 * Slots :
 *   default    : label
 *   icon-left  : icône à gauche (HeroIcon ou SVG)
 *   icon-right : icône à droite (chevron, etc.)
 */
import { computed } from 'vue'
import { ArrowPathIcon } from '@heroicons/vue/24/outline'

const props = defineProps({
  variant: { type: String, default: 'primary' },
  size: { type: String, default: 'md' },
  type: { type: String, default: 'button' },
  loading: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
})

const VARIANT_CLASSES = {
  primary: 'bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700 hover:border-indigo-700 disabled:bg-indigo-300 disabled:border-indigo-300',
  secondary: 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50 hover:border-gray-300 disabled:bg-gray-50 disabled:text-gray-400',
  tertiary: 'bg-transparent text-gray-700 border-transparent hover:bg-gray-100 disabled:text-gray-400 disabled:bg-transparent',
  success: 'bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700 hover:border-emerald-700 disabled:bg-emerald-300 disabled:border-emerald-300',
  danger: 'bg-white text-red-700 border-red-200 hover:bg-red-50 hover:border-red-300 disabled:text-red-300 disabled:border-red-100',
}

const SIZE_CLASSES = {
  sm: 'px-2.5 py-1 text-xs gap-1',
  md: 'px-3 py-1.5 text-sm gap-1.5',
  lg: 'px-4 py-2.5 text-base gap-2 min-h-11',
}

const ICON_SIZE = {
  sm: 'w-3.5 h-3.5',
  md: 'w-4 h-4',
  lg: 'w-5 h-5',
}

const buttonClasses = computed(() => [
  'inline-flex items-center justify-center font-medium rounded-lg border',
  'transition-colors whitespace-nowrap select-none',
  'disabled:cursor-not-allowed disabled:opacity-80',
  VARIANT_CLASSES[props.variant] || VARIANT_CLASSES.primary,
  SIZE_CLASSES[props.size] || SIZE_CLASSES.md,
  props.loading ? 'cursor-wait' : '',
])

const iconClass = computed(() => `${ICON_SIZE[props.size] || ICON_SIZE.md} shrink-0`)
</script>

<template>
  <button
    :type="type"
    :disabled="disabled || loading"
    :class="buttonClasses"
  >
    <ArrowPathIcon v-if="loading" :class="[iconClass, 'animate-spin']" />
    <slot v-else name="icon-left">
      <span v-if="$slots['icon-left']"></span>
    </slot>
    <span v-if="$slots.default" class="leading-none">
      <slot />
    </span>
    <slot name="icon-right" />
  </button>
</template>
