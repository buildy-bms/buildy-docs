<script setup>
import { ref, computed, nextTick, onBeforeUnmount } from 'vue'
import { InformationCircleIcon } from '@heroicons/vue/24/outline'
import { useDecreeRefs } from '@/composables/useDecreeRefs'
import { computeTooltipPosition } from '@/lib/tooltip-position'
import { hideTip, tooltipWarm } from '@/lib/tooltip'
import { TOOLTIP_OPEN_DELAY, tooltipMotion, tooltipMotionOrigin, prefersReducedMotion } from '@/lib/tooltip-timing'
import { decreePlain, normalizeArticle } from '@/lib/decree-plain'

/**
 * Fiche d'un article du décret BACS (ⓘ à côté des titres), au survol (même délai que les autres
 * infobulles) ou au clic / toucher (tout de suite), sur fond navy comme toutes les infobulles
 * (2026-10-12). Trois blocs :
 *   1. « En clair » : l'exigence expliquée simplement (lib/decree-plain.js) ;
 *   2. le TEXTE OFFICIEL de l'article (servi par bacs_knowledge via useDecreeRefs — source
 *      unique, avec lien Légifrance et version) ;
 *   3. un « Repère Buildy » optionnel (comment l'audit lit l'exigence).
 * Reste ouverte quand le pointeur passe dessus (texte qui défile, lien) ; un clic l'épingle.
 * Placée par computeTooltipPosition (retournement, 8 px des bords), au-dessus des modales.
 *
 * Usage : <R175Tooltip article="R175-1 1°" />
 *         <R175Tooltip article="R175-3" />
 *         <R175Tooltip title="Comment le poids est-il estimé ?"><p>Texte</p></R175Tooltip>
 *
 * Le texte du décret n'est plus dupliqué en dur : useDecreeRefs fait 1 seul
 * fetch par session (cache module + localStorage), pas un par survol.
 */
const { getRef, decreeVersion } = useDecreeRefs()
const props = defineProps({
  article: { type: String, default: null },
  title: { type: String, default: null }, // override du titre auto
})

const open = ref(false)
const wrapperEl = ref(null)
const popupEl = ref(null)
const popupPos = ref({ top: 0, left: 0, ready: false })
let lastSide = null
let timer = null

function updatePosition() {
  if (!wrapperEl.value || !popupEl.value) return
  const r = wrapperEl.value.getBoundingClientRect()
  const p = computeTooltipPosition({
    anchor: r,
    size: { width: popupEl.value.offsetWidth, height: popupEl.value.offsetHeight },
    viewport: { width: window.innerWidth, height: window.innerHeight },
    placement: 'bottom',
    previous: lastSide,
  })
  if (!p) return hideNow()
  lastSide = p.placement
  popupPos.value = { top: p.y, left: p.x, maxHeight: p.maxHeight, ready: true }
}

async function show() {
  clearTimeout(timer)
  const opening = !open.value
  if (opening) {
    hideTip() // l'infobulle de la ligne ne reste pas sous la fiche
    lastSide = null
    popupPos.value = { top: 0, left: 0, ready: false }
  }
  open.value = true
  bindGlobal()
  await nextTick()
  updatePosition()
  if (opening && popupPos.value.ready) animate(true) // même fondu que les infobulles
}

// Fondu d'entrée et de sortie (lib/tooltip-timing.js) : depuis l'ⓘ, du côté où la fiche s'ouvre.
function animate(entering, el = popupEl.value) {
  if (!el || typeof el.animate !== 'function') return null
  const side = lastSide || 'bottom'
  el.style.transformOrigin = tooltipMotionOrigin(side)
  const { keyframes, options } = tooltipMotion(side, { entering, reduced: prefersReducedMotion() })
  return el.animate(keyframes, options)
}
// Sortie : l'élément est passé par Vue (la référence popupEl est déjà vidée à ce moment-là).
function onLeave(el, done) {
  const anim = animate(false, el)
  if (!anim) return done()
  anim.onfinish = done
  anim.oncancel = done
}
// Survol : la fiche s'ouvre quand le pointeur se pose (lib/tooltip-timing.js), sans délai si une
// infobulle vient d'être lue ; repasser sur l'ⓘ ou sur la fiche annule la fermeture.
function showSoon() {
  clearTimeout(timer)
  if (open.value) return
  timer = setTimeout(show, tooltipWarm() ? 0 : TOOLTIP_OPEN_DELAY)
}
function hideDelayed() {
  clearTimeout(timer)
  timer = setTimeout(() => { open.value = false; unbindGlobal() }, 150)
}
function hideNow() {
  clearTimeout(timer)
  open.value = false
  unbindGlobal()
}
function onDocPointer(e) {
  if (!open.value) return
  if (wrapperEl.value?.contains(e.target) || popupEl.value?.contains(e.target)) return
  hideNow()
}
// Échap ferme la fiche seulement : la fenêtre qui la contient (SystemSettingsModal) reste ouverte.
function onKeydown(e) {
  if (e.key !== 'Escape') return
  e.stopImmediatePropagation()
  hideNow()
}
// Écoute globale seulement quand ouvert (fermeture au tap extérieur / Escape / défilement).
function onScroll(e) {
  if (popupEl.value?.contains(e.target)) return // défilement du texte officiel
  hideNow()
}
function bindGlobal() {
  document.addEventListener('pointerdown', onDocPointer, true)
  window.addEventListener('keydown', onKeydown, true)
  document.addEventListener('scroll', onScroll, true)
}
function unbindGlobal() {
  document.removeEventListener('pointerdown', onDocPointer, true)
  window.removeEventListener('keydown', onKeydown, true)
  document.removeEventListener('scroll', onScroll, true)
}

onBeforeUnmount(() => { clearTimeout(timer); unbindGlobal() })

// « Repères Buildy » par alinéa : ce que l'audit vérifie et comment il lit l'exigence, en mots
// simples. Ce N'EST PAS le texte opposable — celui-ci vient de l'API (useDecreeRefs) et
// s'affiche dans un bloc distinct. Notation "1°", "2°"… (le lookup normalise aussi "§").
const BUILDY_NOTES = {
  'R175-1 4°': `Pour chaque zone, l'audit liste les usages présents (chauffage, froid, ventilation…) et leurs équipements : marque, modèle, énergie, puissance et communication.`,
  'R175-1 6°': `Une zone se définit par l'activité et les horaires, pas pièce par pièce : par exemple une zone de bureaux et une zone de restauration. C'est la base du suivi des consommations par zone.`,
  'R175-2': `<strong>Plus de 290 kW</strong> : bâtiment neuf (permis déposé après le 21 juillet 2021) dès la livraison ; bâtiment existant au plus tard le 1<sup>er</sup> janvier 2025.<br/><strong>Plus de 70 kW</strong> : bâtiment neuf (permis déposé après le 8 avril 2024) dès la livraison ; bâtiment existant au remplacement du chauffage ou de la climatisation, et au plus tard le 1<sup>er</sup> janvier 2030.<br/><strong>70 kW ou moins</strong> : pas concerné.<br/>Le chaud et le froid ne s'additionnent pas. Le propriétaire peut être dispensé si l'installation ne se rembourse pas en moins de 10 ans ; Buildy ne fait pas ce calcul.`,
  'R175-3': `Ces exigences portent sur les équipements reliés à la GTB. L'arrêt manuel et le fonctionnement autonome sont vérifiés système par système.`,
  'R175-3 1°': `Le décret ne fixe pas de plan de comptage. Buildy attend un compteur par énergie pour le bâtiment, puis un compteur par zone pour chaque usage relié à la GTB.`,
  'R175-3 3°': `Le guide du ministère admet les langages de communication normalisés (BACnet, LonWorks, KNX), les interfaces de programmation et les passerelles. Buildy vérifie que chaque équipement de production communique avec la GTB, directement ou par son régulateur. Un usage que la GTB ne gère pas compte comme non relié.`,
  'R175-3 4°': `La GTB doit permettre d'arrêter puis de relancer chaque système à la main (ou de le passer en hors gel), et chaque système doit continuer à fonctionner si la GTB s'arrête. Buildy vérifie ces deux points pour chaque système relié.`,
  'R175-4': `Sans consignes écrites de vérification, l'audit émet une réserve. Les équipements reliés à la GTB sont dispensés de certains contrôles réglementaires, mais leur entretien reste obligatoire.`,
  'R175-5': `Le décret n'impose pas de format de formation, mais elle doit avoir eu lieu. Buildy en demande la preuve : date, intervenant, contenu, feuille d'émargement.`,
  'R175-6': `Obligatoire dans les bâtiments dont le permis a été déposé après le 21 juillet 2021, et dans les autres au remplacement d'un générateur de chaleur, sauf si l'installation ne se rembourse pas en moins de 6 ans. Chauffage seulement ; les appareils de chauffage au bois indépendants ne sont pas concernés.`,
}

// Bloc « Repère Buildy » (ce que l'audit vérifie).
const buildyNote = computed(() => {
  if (!props.article) return null
  return BUILDY_NOTES[normalizeArticle(props.article)] || null
})

// Bloc « En clair » : l'exigence en une phrase simple (lib/decree-plain.js).
const plain = computed(() => (props.article ? decreePlain(props.article) : null))

// Bloc « Texte officiel » (article opposable, servi par l'API depuis
// bacs_knowledge). getRef remonte l'article parent d'un alinéa.
const officialRef = computed(() => (props.article ? getRef(props.article) : null))

// Titre affiché : override explicite > titre en clair > titre officiel > code.
const displayTitle = computed(() =>
  props.title || plain.value?.title || officialRef.value?.title || props.article)
const articleCode = computed(() => (props.article ? normalizeArticle(props.article) : ''))

// Y a-t-il quelque chose à afficher (hors slot) ?
const hasContent = computed(() =>
  !!(officialRef.value || buildyNote.value || plain.value))
</script>

<template>
  <span ref="wrapperEl" class="inline-flex items-center" data-tooltip-off @mouseenter="showSoon" @mouseleave="hideDelayed">
    <button type="button"
            class="inline-flex items-center justify-center min-w-7 min-h-7 -m-1 p-1 text-gray-400 hover:text-indigo-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 rounded transition"
            :aria-expanded="open"
            :aria-label="article ? `Voir l'article ${articleCode} du décret BACS` : (title ? `Explication : ${title}` : 'Voir l’explication')"
            @click.stop.prevent="show">
      <InformationCircleIcon class="w-4 h-4" />
    </button>
    <Teleport to="body">
      <!-- Fondu piloté en JavaScript (animate) : l'entrée part une fois la fiche placée. -->
      <transition :css="false" @leave="onLeave">
        <!-- z-[1090] : au-dessus des fenêtres (BaseModal z-110, aperçu PDF z-115), sous
             l'infobulle unique (z-1100). Navy comme toutes les infobulles. -->
        <div v-if="open"
             ref="popupEl"
             role="dialog"
             :aria-label="displayTitle || 'Explication'"
             :style="{ top: popupPos.top + 'px', left: popupPos.left + 'px', visibility: popupPos.ready ? 'visible' : 'hidden' }"
             class="fixed z-[1090] w-[min(440px,calc(100vw-16px))] overflow-hidden rounded-xl bg-primary text-white shadow-2xl shadow-primary/30 ring-1 ring-white/10"
             @mouseenter="showSoon" @mouseleave="hideDelayed">
          <span class="absolute inset-y-0 left-0 w-1 bg-sky-400" />
          <div class="overflow-y-auto py-3 pl-4 pr-4" :style="popupPos.maxHeight ? { maxHeight: popupPos.maxHeight + 'px' } : null">
            <!-- En-tête : titre en clair + code de l'article -->
            <div v-if="displayTitle" class="flex items-start gap-2.5">
              <span class="mt-px inline-flex size-6 shrink-0 items-center justify-center rounded-lg bg-sky-400/15 text-sky-300 ring-1 ring-sky-300/25">
                <InformationCircleIcon class="size-4" />
              </span>
              <p class="min-w-0 flex-1 pt-px text-[13px] font-medium leading-snug text-white text-pretty">{{ displayTitle }}</p>
              <span v-if="articleCode" class="mt-0.5 shrink-0 rounded-md bg-white/10 px-1.5 py-0.5 text-2xs text-white/70 tabular-nums">{{ articleCode }}</span>
            </div>

            <!-- Bloc 1 — En clair (lecture simple de l'exigence) -->
            <p v-if="plain" class="mt-2 text-sm leading-relaxed text-white/85 text-pretty">{{ plain.text }}</p>

            <!-- Bloc 2 — Texte officiel opposable (source unique bacs_knowledge) -->
            <div v-if="officialRef" class="mt-3">
              <p class="flex items-baseline gap-2 text-[11.5px] font-medium text-white/85">
                Texte du décret
                <span v-if="officialRef.version_label" class="text-2xs font-normal text-white/50">{{ officialRef.version_label }}</span>
              </p>
              <div class="r175-official mt-1 max-h-48 overflow-y-auto border-l-2 border-white/15 pl-2.5 pr-1 text-xs leading-relaxed text-white/70" v-html="officialRef.official_html" />
              <a v-if="officialRef.source_url" :href="officialRef.source_url" target="_blank" rel="noopener"
                 class="mt-1.5 inline-flex items-center gap-1 text-[11.5px] text-sky-300 hover:underline">
                Voir sur Légifrance ↗
              </a>
            </div>

            <!-- Bloc 3 — Repère Buildy (ce que vérifie l'audit, non opposable) -->
            <div v-if="buildyNote" class="mt-3 rounded-lg bg-white/[0.06] px-3 py-2 ring-1 ring-white/5">
              <p class="text-[11.5px] font-medium text-white/85">Ce que vérifie l’audit</p>
              <div class="r175-note mt-0.5 text-xs leading-relaxed text-white/75" v-html="buildyNote" />
            </div>

            <!-- Rien de connu pour cet article : renvoi à l'annexe -->
            <p v-else-if="!officialRef && !plain && !$slots.default" class="mt-2 text-xs leading-relaxed text-white/60">
              Texte intégral en annexe A du rapport d’audit.
            </p>

            <!-- Explication fournie par l'appelant (ex. estimation du poids d'un poste) -->
            <div v-if="$slots.default" class="r175-slot mt-2 text-sm leading-relaxed text-white/80">
              <slot />
            </div>
          </div>
        </div>
      </transition>
    </Teleport>
  </span>
</template>

<style scoped>
/* Contenu HTML (texte du décret, repère, explication fournie) relu sur le navy. */
.r175-official :deep(strong),
.r175-note :deep(strong),
.r175-slot :deep(strong) { color: #fff; }
.r175-official :deep(a),
.r175-slot :deep(a) { color: rgb(125 211 252); text-decoration: underline; }
.r175-slot :deep([class*="text-gray-"]) { color: inherit; }
</style>
