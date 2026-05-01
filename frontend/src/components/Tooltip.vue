<script setup>
/**
 * Tooltip léger : instantané, fond sombre, flèche, téléporté dans <body>
 * pour ne pas être clippé par les parents `overflow-hidden / overflow-auto`
 * (cas typique : tooltips dans une sidebar avec scroll vertical).
 *
 * Usage :
 *   <Tooltip text="Section vérifiée">
 *     <CheckCircleIcon class="w-4 h-4" />
 *   </Tooltip>
 *
 * Props :
 *   - text : contenu du tooltip (vide = désactivé)
 *   - placement : 'top' (défaut) | 'bottom' | 'left' | 'right'
 *
 * Implementation : `mouseenter` calcule la position du trigger via
 * getBoundingClientRect, le tooltip est rendu en `position: fixed` dans le
 * body. Pas de transition (= apparition instantanée). Recalcul auto sur
 * scroll/resize tant que le tooltip est visible.
 */
import { ref, useTemplateRef, onUnmounted } from 'vue'

const props = defineProps({
  text: { type: String, required: true },
  placement: { type: String, default: 'top' },
})

const triggerRef = useTemplateRef('triggerRef')
const visible = ref(false)
const position = ref({ top: 0, left: 0 })

function updatePosition() {
  const el = triggerRef.value?.firstElementChild || triggerRef.value
  if (!el?.getBoundingClientRect) return
  const r = el.getBoundingClientRect()
  // Le tooltip est positionné après affichage initial : on se base sur le
  // centre du trigger et le placement; le translate CSS finit le travail.
  let top, left
  switch (props.placement) {
    case 'bottom':
      top = r.bottom + 6
      left = r.left + r.width / 2
      break
    case 'left':
      top = r.top + r.height / 2
      left = r.left - 6
      break
    case 'right':
      top = r.top + r.height / 2
      left = r.right + 6
      break
    case 'top':
    default:
      top = r.top - 6
      left = r.left + r.width / 2
      break
  }
  position.value = { top, left }
}

function show() {
  updatePosition()
  visible.value = true
  window.addEventListener('scroll', updatePosition, true)
  window.addEventListener('resize', updatePosition)
}
function hide() {
  visible.value = false
  window.removeEventListener('scroll', updatePosition, true)
  window.removeEventListener('resize', updatePosition)
}

onUnmounted(hide)
</script>

<template>
  <span
    ref="triggerRef"
    class="inline-flex"
    @mouseenter="show"
    @mouseleave="hide"
    @focusin="show"
    @focusout="hide"
  >
    <slot />
  </span>
  <Teleport to="body">
    <span
      v-if="visible && text"
      role="tooltip"
      :style="{ top: position.top + 'px', left: position.left + 'px' }"
      class="pointer-events-none fixed z-100 px-2.5 py-1.5 text-[11px] font-medium leading-snug text-white bg-gray-900 rounded-md shadow-lg max-w-xs"
      :class="{
        '-translate-x-1/2 -translate-y-full': placement === 'top',
        '-translate-x-1/2': placement === 'bottom',
        '-translate-x-full -translate-y-1/2': placement === 'left',
        '-translate-y-1/2': placement === 'right',
      }"
    >
      {{ text }}
      <span
        class="absolute w-1.5 h-1.5 bg-gray-900 rotate-45"
        :class="{
          'left-1/2 -translate-x-1/2 -bottom-0.5': placement === 'top',
          'left-1/2 -translate-x-1/2 -top-0.5': placement === 'bottom',
          'top-1/2 -translate-y-1/2 -right-0.5': placement === 'left',
          'top-1/2 -translate-y-1/2 -left-0.5': placement === 'right',
        }"
      ></span>
    </span>
  </Teleport>
</template>
