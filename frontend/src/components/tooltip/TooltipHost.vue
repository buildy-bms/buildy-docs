<script setup>
// L'unique infobulle de l'application (montée une fois dans App.vue, chargée en différé) : rend
// la valeur v-tooltip de l'élément survolé (lib/tooltip.js), mesure sa taille puis la place
// (lib/tooltip-position.js) avant que le navigateur ne peigne : ni saut ni clignotement. Le
// contenu est recalculé en direct s'il lit des données réactives.
// Fondu (2026-10-12, lib/tooltip-timing.js) : à l'ouverture, fondu + glissement de 4 px depuis
// l'élément ; à la fermeture, la bulle reste affichée le temps de s'effacer (contenu gardé
// en mémoire). D'un élément au voisin, ou si une bulle s'ouvre pendant l'effacement de la
// précédente : changement sur place, sans fondu. Fermeture au défilement : immédiate.
import { computed, reactive, ref, shallowRef, watch } from 'vue'
import '@/lib/tooltip-icons'
import { tooltipState, hideTip, TOOLTIP_ID } from '@/lib/tooltip'
import { normalizeTip } from '@/lib/tooltip-content'
import { computeTooltipPosition } from '@/lib/tooltip-position'
import { tooltipMotion, tooltipMotionOrigin, prefersReducedMotion } from '@/lib/tooltip-timing'
import TipLabel from './TipLabel.vue'
import TipCard from './TipCard.vue'

const box = ref(null)
const motion = ref(null) // enveloppe animée (le placement reste sur la boîte extérieure)
const content = computed(() => {
  void tooltipState.version // relu à chaque mise à jour de la valeur
  return tooltipState.anchor ? normalizeTip(tooltipState.value) : null
})
// Contenu affiché et sa présentation : suivent la bulle ouverte, et RESTENT tels quels pendant
// le fondu de sortie (mis à jour sans attendre le rendu : la bulle n'est jamais reconstruite).
const shown = shallowRef(null)
const variant = ref('action')
const wide = ref(false)
watch(
  content,
  (c) => {
    if (!c) return
    shown.value = c
    variant.value = tooltipState.variant || 'action'
    wide.value = !!tooltipState.anchor?.__vtipMods?.overflow
  },
  { flush: 'sync', immediate: true },
)

const pos = reactive({ x: 0, y: 0, placement: 'top', arrow: null, maxHeight: null, ready: false })
let placedFor = null // ancre de la dernière mise en place (garde le même côté pendant les mises à jour)
let onScreen = false // une bulle est visible (ou en train de s'effacer)
let leaving = null // animation de sortie en cours

function place() {
  const anchor = tooltipState.anchor
  const node = box.value
  if (!anchor || !content.value || !node) {
    pos.ready = false
    placedFor = null
    return
  }
  if (!anchor.isConnected) return hideTip({ instant: true })
  const same = anchor === placedFor
  const p = computeTooltipPosition({
    anchor: anchor.getBoundingClientRect(),
    size: { width: node.offsetWidth, height: node.offsetHeight },
    viewport: { width: window.innerWidth, height: window.innerHeight },
    placement: tooltipState.placement,
    offset: content.value.kind === 'card' ? 8 : 7,
    previous: same ? pos.placement : null,
    pointer: tooltipState.pointer,
  })
  if (!p) return hideTip({ instant: true })
  Object.assign(pos, p, { ready: true })
  placedFor = anchor
}

let enteringAnim = null // fondu d'ouverture en cours

function play(entering) {
  const el = motion.value
  if (!el || typeof el.animate !== 'function') return null
  el.style.transformOrigin = tooltipMotionOrigin(pos.placement, pos.arrow)
  const { keyframes, options } = tooltipMotion(pos.placement, { entering, reduced: prefersReducedMotion() })
  // Fermeture pendant l'ouverture : la sortie part de l'état atteint (pas de sursaut).
  if (!entering && enteringAnim?.playState === 'running') {
    const cs = getComputedStyle(el)
    keyframes[0] = { ...keyframes[0], opacity: +cs.opacity, ...(keyframes[0].transform ? { transform: cs.transform === 'none' ? keyframes[0].transform : cs.transform } : {}) }
    enteringAnim.cancel()
  }
  const anim = el.animate(keyframes, options)
  if (entering) enteringAnim = anim
  return anim
}

function clearNow() {
  if (leaving) { leaving.cancel(); leaving = null }
  shown.value = null
  onScreen = false
  pos.ready = false
  placedFor = null
}

watch(
  () => [tooltipState.anchor, content.value],
  ([anchor, c], [prevAnchor] = []) => {
    if (c) {
      // Bulle qui s'efface encore : remplacée sur place, sans fondu (comme d'un élément au voisin).
      if (leaving) { leaving.cancel(); leaving = null }
      if (anchor !== prevAnchor) {
        pos.ready = false
        pos.maxHeight = null
      }
      place()
      if (!pos.ready) return
      if (!onScreen) play(true) // ouverture « à froid » : fondu d'entrée
      onScreen = true
      return
    }
    if (!onScreen || tooltipState.instant) return clearNow()
    // Fermeture : la bulle reste le temps de s'effacer (contenu inchangé), puis disparaît.
    const anim = play(false)
    if (!anim) return clearNow()
    leaving = anim
    anim.onfinish = () => {
      if (leaving !== anim) return
      leaving = null
      anim.cancel() // efface l'état final (opacité 0) : la prochaine bulle repart de zéro
      shown.value = null
      onScreen = false
      pos.ready = false
      placedFor = null
    }
  },
  { flush: 'post', immediate: true },
)
</script>

<template>
  <Teleport to="body">
    <div
      :id="TOOLTIP_ID"
      ref="box"
      role="tooltip"
      class="pointer-events-none fixed left-0 top-0 z-[1100]"
      :style="{
        transform: `translate3d(${pos.x}px, ${pos.y}px, 0)`,
        visibility: shown && pos.ready ? 'visible' : 'hidden',
      }"
    >
      <!-- Toujours présent (pas de v-show) : le contenu est rendu, donc mesurable, avant le
           placement, qui s'exécute après le rendu. L'enveloppe porte le fondu. -->
      <div ref="motion" class="will-change-[opacity,transform]">
        <TipLabel
          v-if="shown?.kind === 'label'"
          :tip="shown"
          :variant="variant"
          :placement="pos.placement"
          :arrow="pos.arrow"
          :wide="wide"
        />
        <TipCard v-else-if="shown" :tip="shown" :max-height="pos.maxHeight" />
      </div>
    </div>
  </Teleport>
</template>
