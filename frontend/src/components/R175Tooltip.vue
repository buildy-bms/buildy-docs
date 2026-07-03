<script setup>
import { ref, computed, nextTick, onBeforeUnmount } from 'vue'
import { InformationCircleIcon } from '@heroicons/vue/24/outline'
import { useDecreeRefs } from '@/composables/useDecreeRefs'

/**
 * Tooltip explicatif pour un article R175 du décret BACS.
 * Affiche, au survol ou au tap, deux blocs distincts :
 *   1. le TEXTE OFFICIEL opposable de l'article (servi par bacs_knowledge via
 *      useDecreeRefs — source unique, avec lien Légifrance et version), et
 *   2. un « Repère Buildy » optionnel (contexte méthodologique par alinéa).
 *
 * Usage : <R175Tooltip article="R175-1 1°" />
 *         <R175Tooltip article="R175-3" />
 *         <R175Tooltip><p>Texte custom HTML</p></R175Tooltip>
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
const popupPos = ref({ top: 0, left: 0 })
const POPUP_WIDTH = 384 // w-96
let timer = null

function updatePosition() {
  if (!wrapperEl.value) return
  const r = wrapperEl.value.getBoundingClientRect()
  let left = r.left
  let top = r.bottom + 4
  // contraint dans la viewport horizontalement (8px de marge)
  if (left + POPUP_WIDTH > window.innerWidth - 8) {
    left = Math.max(8, window.innerWidth - POPUP_WIDTH - 8)
  }
  // flip vers le haut si pas la place en bas
  const popupH = popupEl.value?.offsetHeight ?? 200
  if (top + popupH > window.innerHeight - 8 && r.top > popupH + 8) {
    top = r.top - popupH - 4
  }
  popupPos.value = { top, left }
}

async function show() {
  clearTimeout(timer)
  open.value = true
  bindGlobal()
  await nextTick()
  updatePosition()
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
function onKeydown(e) {
  if (e.key === 'Escape') hideNow()
}
// Écoute globale seulement quand ouvert (fermeture au tap extérieur / Escape).
function bindGlobal() {
  document.addEventListener('pointerdown', onDocPointer, true)
  document.addEventListener('keydown', onKeydown)
}
function unbindGlobal() {
  document.removeEventListener('pointerdown', onDocPointer, true)
  document.removeEventListener('keydown', onKeydown)
}

onBeforeUnmount(() => { clearTimeout(timer); unbindGlobal() })

// « Repères Buildy » par alinéa : contexte méthodologique destiné à l'auditeur
// (ce que Buildy vérifie, comment il lit l'exigence). Ce N'EST PAS le texte
// opposable — celui-ci vient de l'API (useDecreeRefs) et s'affiche dans un bloc
// distinct. Notation canonique "1°", "2°"... — le lookup normalise aussi "§".
const BUILDY_NOTES = {
  'R175-1': {
    title: 'R175-1 — Définitions',
    body: `Définit les systèmes techniques du bâtiment (chauffage, climatisation, ventilation, ECS, éclairage intégré, automatisation et contrôle, production électrique sur site), la <strong>zone fonctionnelle</strong> (espace dans lequel les usages sont homogènes) et l'<strong>interopérabilité</strong> (capacité d'un produit à communiquer et interagir avec d'autres dans le respect des exigences de sécurité).`,
  },
  'R175-1 4°': {
    title: 'R175-1 4° — Éclairage intégré et production électrique',
    body: `Sous-point R175-1 4° : éclairage intégré au bâtiment et production d'électricité sur site (PV, cogénération, micro-éolien). Au-delà, la définition globale de "système technique de bâtiment" (article R175-1) couvre tout équipement de chauffage, refroidissement, ventilation, ECS, éclairage intégré, automatisation et production électrique sur site.<br/><br/>L'audit identifie pour chaque zone les systèmes attendus, leur présence effective et leurs équipements (marque, modèle, énergie, puissance, communication).`,
  },
  'R175-1 6°': {
    title: 'R175-1 6° — Zone fonctionnelle',
    body: `Toute zone dans laquelle les usages sont homogènes (open-space tertiaire, salle de réunion, atelier, local technique, parking…). Le découpage zonal est la base du suivi R175-3 1° : <strong>chaque zone doit être suivie indépendamment</strong>.`,
  },
  'R175-2': {
    title: 'R175-2 — Champ d\'application',
    body: `Le décret BACS s'applique aux bâtiments tertiaires dotés d'une puissance nominale utile <strong>cumulée chauffage + climatisation</strong> :<br/>· <strong>&gt; 290 kW</strong> : échéance 1<sup>er</sup> janvier 2025 (immédiate pour les permis postérieurs au 8 avril 2024)<br/>· <strong>70 à 290 kW</strong> : échéance 1<sup>er</sup> janvier 2030 (report acté au Journal officiel du 26 décembre 2025)<br/>· <strong>&lt; 70 kW</strong> : non assujetti.<br/><br/>Une clause de dispense existe si le TRI des travaux dépasse 10 ans (à la charge du propriétaire — Buildy ne calcule pas le TRI).`,
  },
  'R175-3': {
    title: 'R175-3 — 4 exigences fonctionnelles',
    body: `<strong>1°.</strong> Suivi continu, à pas horaire, conservation 5 ans (capacité de la GTB)<br/><strong>2°.</strong> Détection des pertes d'efficacité (capacité de la GTB)<br/><strong>3°.</strong> Interopérabilité (par système : protocole standard ouvert)<br/><strong>4°.</strong> Arrêt manuel + gestion autonome (par équipement)`,
  },
  'R175-3 1°': {
    title: 'R175-3 1° — Suivi continu et conservation',
    body: `La consommation énergétique des systèmes techniques doit être suivie en continu, à pas horaire, et les données conservées à l'échelle mensuelle pendant 5 ans minimum.<br/><br/><em>Interprétation Buildy :</em> pour respecter le suivi par zone fonctionnelle, on attend un compteur de chaque énergie (gaz, électricité, fioul, réseau de chaleur…) au niveau du bâtiment, et un sous-comptage par zone fonctionnelle pour les usages chauffage / refroidissement / ECS / éclairage.`,
  },
  'R175-3 3°': {
    title: 'R175-3 3° — Interopérabilité',
    body: `Les systèmes techniques doivent pouvoir communiquer entre eux dans le respect des exigences de sécurité. Buildy considère un équipement <strong>communicant</strong> s'il expose au moins un protocole standard ouvert : <strong>BACnet/IP, BACnet MS/TP, Modbus TCP, Modbus RTU, KNX, M-Bus, MQTT, LoRaWAN</strong>.`,
  },
  'R175-3 4°': {
    title: 'R175-3 4° — Arrêt manuel et gestion autonome',
    body: `Le décret demande que la GTB <strong>permette un arrêt manuel et la gestion autonome d'un ou plusieurs systèmes techniques</strong>. La GTB doit pouvoir être stoppée manuellement, puis reprendre la main sans intervention humaine.<br/><br/><em>Lecture Buildy :</em> ces 2 critères sont évalués au niveau de chaque équipement (lecture plus stricte que le décret, qui parle « d'un ou plusieurs systèmes techniques »).`,
  },
  'R175-4': {
    title: 'R175-4 — Vérifications périodiques',
    body: `Le BACS doit faire l'objet de <strong>vérifications périodiques</strong> documentées par des consignes écrites de maintenance. Buildy vérifie l'existence de ces consignes ; leur absence constitue une non-conformité majeure.<br/><br/><em>Bonus commercial :</em> R175-4 dispense les bâtiments équipés d'un BACS conforme des contrôles R224-31 à R224-41-3 (générateurs).`,
  },
  'R175-5': {
    title: 'R175-5 — Formation de l\'exploitant',
    body: `Le propriétaire du BACS veille à ce que son exploitant soit formé à son fonctionnement, notamment à son paramétrage. Le décret n'impose pas de modalité spécifique de formation, mais la formation doit être effective. Buildy demande la preuve documentée (date, intervenant, contenu).`,
  },
  'R175-6': {
    title: 'R175-6 — Régulation thermique automatique',
    body: `Une régulation thermique automatique <strong>par pièce ou par zone</strong> doit être installée, appréciée à l'installation ou au remplacement du générateur de chaleur. Les appareils indépendants de chauffage au bois bénéficient d'une exemption explicite.`,
  },
}

// Normalise une référence d'article : "R175-1 §4" -> "R175-1 4°"
function normalizeArticleKey(s) {
  if (!s) return s
  return s.replace(/§\s*(\d+)/g, (_, n) => `${n}°`)
}

// Bloc « Repère Buildy » (contexte méthodologique par alinéa).
const buildyNote = computed(() => {
  if (!props.article) return null
  return BUILDY_NOTES[normalizeArticleKey(props.article)] || null
})

// Bloc « Texte officiel » (article opposable, servi par l'API depuis
// bacs_knowledge). getRef remonte l'article parent d'un alinéa.
const officialRef = computed(() => (props.article ? getRef(props.article) : null))

// Titre affiché : override explicite > repère Buildy > titre officiel > code.
const displayTitle = computed(() =>
  props.title || buildyNote.value?.title || officialRef.value?.title || props.article)

// Y a-t-il quelque chose à afficher (hors slot) ?
const hasContent = computed(() =>
  !!(officialRef.value || buildyNote.value))
</script>

<template>
  <span ref="wrapperEl" class="inline-flex items-center" @mouseenter="show" @mouseleave="hideDelayed">
    <button type="button"
            class="inline-flex items-center justify-center min-w-7 min-h-7 -m-1 p-1 text-gray-400 hover:text-indigo-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 rounded transition"
            :aria-expanded="open" aria-label="Voir l'article du décret BACS"
            @click.stop.prevent="show">
      <InformationCircleIcon class="w-4 h-4" />
    </button>
    <Teleport to="body">
      <transition
        enter-active-class="transition ease-out duration-100"
        enter-from-class="opacity-0 translate-y-1"
        enter-to-class="opacity-100 translate-y-0"
        leave-active-class="transition ease-in duration-75"
        leave-from-class="opacity-100"
        leave-to-class="opacity-0"
      >
        <div v-if="open"
             ref="popupEl"
             :style="{ top: popupPos.top + 'px', left: popupPos.left + 'px', width: POPUP_WIDTH + 'px' }"
             class="fixed z-50 bg-white border border-gray-200 rounded-lg shadow-xl p-3 text-sm"
             @mouseenter="show" @mouseleave="hideDelayed">
          <div v-if="hasContent" class="font-semibold text-gray-800 mb-2">{{ displayTitle }}</div>

          <!-- Bloc 1 — Texte officiel opposable (source unique bacs_knowledge) -->
          <div v-if="officialRef" class="mb-2">
            <div class="mb-1.5">
              <span class="inline-block text-[10px] font-semibold uppercase tracking-wide text-white rounded px-1.5 py-0.5 whitespace-nowrap" style="background:#1b2842">Décret — opposable</span>
              <div v-if="officialRef.version_label" class="text-[10px] text-gray-400 mt-1 leading-snug">{{ officialRef.version_label }}</div>
            </div>
            <div class="text-gray-600 text-xs leading-relaxed max-h-52 overflow-y-auto border-l-2 border-gray-200 pl-2 pr-1" v-html="officialRef.official_html" />
            <a v-if="officialRef.source_url" :href="officialRef.source_url" target="_blank" rel="noopener"
               class="inline-flex items-center gap-1 mt-1 text-[11px] text-indigo-600 hover:underline">
              Voir sur Légifrance ↗
            </a>
          </div>

          <!-- Bloc 2 — Repère Buildy (contexte méthodologique, non opposable) -->
          <div v-if="buildyNote" class="rounded bg-gray-50 border border-gray-100 p-2">
            <span class="inline-block text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1">Repère Buildy</span>
            <div class="text-gray-600 text-xs leading-relaxed" v-html="buildyNote.body" />
          </div>

          <!-- Fallback si ni officiel ni note : renvoi annexe -->
          <div v-else-if="!officialRef && !$slots.default" class="text-gray-500 text-xs leading-relaxed">
            Texte intégral en annexe A du PDF d'audit.
          </div>

          <slot />
        </div>
      </transition>
    </Teleport>
  </span>
</template>
