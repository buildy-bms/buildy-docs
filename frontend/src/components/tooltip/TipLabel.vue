<script setup>
// Infobulle ÉTIQUETTE (navy, comme toutes les infobulles : elle se détache des pages claires).
// Icône choisie d'après le premier mot (labelIcon) : poubelle rouge pour « Supprimer », crayon
// pour « Modifier », horloge pour une date… Large (460 px) pour tenir sur une ligne ; flèche vers
// l'élément. Rendue par TooltipHost, ou telle quelle dans /style-guide.
import { computed } from 'vue'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { formatKeys, labelIcon } from '@/lib/tooltip-content'

const props = defineProps({
  tip: { type: Object, required: true }, // { kind:'label', label, keys, mono, icon }
  variant: { type: String, default: 'action' }, // 'action' | 'info'
  placement: { type: String, default: 'top' },
  arrow: { type: Number, default: null }, // position de la flèche (px), null = sans flèche
  // Texte complet d'un texte coupé (.overflow) : jusqu'à 640 px, pour qu'un long titre tienne
  // sur une ligne (au lieu de 460 px pour une étiquette d'action).
  wide: { type: Boolean, default: false },
})

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
const keys = computed(() => formatKeys(props.tip.keys, isMac))
// icon : false = aucune, 'nom' = imposée, null = d'après le premier mot.
const icon = computed(() => {
  if (props.tip.icon === false) return null
  if (props.tip.icon) return { icon: props.tip.icon, tone: 'default' }
  return labelIcon(props.tip.label, props.variant)
})
// Couleurs claires : lisibles sur le navy (contrastes mesurés sur Buildy Tools).
const ICON_TONES = {
  danger: 'text-red-300',
  success: 'text-emerald-300',
  info: 'text-sky-300',
  default: 'text-white/60',
}

const arrowStyle = computed(() => {
  if (props.arrow == null) return null
  const vertical = props.placement === 'top' || props.placement === 'bottom'
  return vertical ? { left: `${props.arrow - 4}px` } : { top: `${props.arrow - 4}px` }
})
const ARROW_SIDE = { top: '-bottom-1', bottom: '-top-1', right: '-left-1', left: '-right-1' }
</script>

<template>
  <div
    class="relative w-max rounded-xl bg-primary px-3 py-[7px] text-sm font-medium leading-snug text-white shadow-xl shadow-primary/30 ring-1 ring-white/10"
    :class="wide ? 'max-w-[min(640px,calc(100vw-16px))]' : 'max-w-[min(460px,calc(100vw-16px))]'"
  >
    <span class="flex items-start gap-2">
      <FontAwesomeIcon v-if="icon" :icon="['fas', icon.icon]" class="mt-[0.2em] size-3.5 shrink-0" :class="ICON_TONES[icon.tone]" />
      <span class="min-w-0 whitespace-pre-line text-pretty" :class="tip.mono ? 'break-all tabular-nums' : ''">{{ tip.label }}</span>
      <span v-if="keys.length" class="ml-1 inline-flex shrink-0 gap-0.5 pt-px">
        <kbd
          v-for="k in keys"
          :key="k"
          class="inline-flex h-[1.5em] min-w-[1.5em] items-center justify-center rounded-md border border-white/20 bg-white/10 px-1 font-sans text-2xs font-medium text-white/85"
          >{{ k }}</kbd
        >
      </span>
    </span>
    <span v-if="arrowStyle" class="absolute size-2 rotate-45 bg-primary" :class="ARROW_SIDE[placement]" :style="arrowStyle" />
  </div>
</template>
