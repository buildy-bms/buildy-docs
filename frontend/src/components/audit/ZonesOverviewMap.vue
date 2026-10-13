<script setup>
/**
 * Vue satellite plein-largeur des zones fonctionnelles, affichée en tête
 * du chapitre Zones (cohérence avec le PDF chap 2).
 *
 * - Marqueurs Google Maps étiquetés A, B, C, D… avec couleurs distinctes
 *   (palette alignée sur backend/lib/static-map.js → buildZonesStaticMap).
 * - Cadrage auto via fitBounds sur l'ensemble des pins.
 * - Légende sous la map (initiale + nom de zone).
 * - Apparaît seulement si au moins une zone fonctionnelle est géolocalisée.
 *
 * Pas d'édition possible (map readonly) — pour positionner un pin, utiliser
 * le bouton « Position sur la carte » de chaque ligne du tableau.
 */
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { loadGoogleMaps } from '@/lib/google-maps'
import { ZONE_MAP_PALETTE, zoneMapInitial } from '@/lib/zone-map-legend'
import { tooltipOpenDelay, TOOLTIP_SKIP_DELAY, tooltipMotion, withBaseTransform, prefersReducedMotion } from '@/lib/tooltip-timing'

// Fondu de l'étiquette d'un repère : même réglage que les infobulles (lib/tooltip-timing.js).
function fadeLabel(div, entering) {
  if (!div || typeof div.animate !== 'function') return null
  const { keyframes, options } = tooltipMotion('top', { entering, reduced: prefersReducedMotion() })
  return div.animate(withBaseTransform(keyframes, 'translate(-50%, -100%)'), options)
}

const props = defineProps({
  zones: { type: Array, default: () => [] },
})

const mapEl = ref(null)
const status = ref('loading') // 'loading' | 'ready' | 'empty' | 'error'

const locatedZones = computed(() =>
  (props.zones || []).filter(z => z.latitude != null && z.longitude != null))

const legend = computed(() => locatedZones.value.map((z, idx) => ({
  initial: zoneMapInitial(idx),
  name: z.name || `Zone ${idx + 1}`,
  color: ZONE_MAP_PALETTE[idx % ZONE_MAP_PALETTE.length],
})))

let map = null
let markers = []
let google = null

// Nom de la zone au survol d'un repère : étiquette navy comme toutes les infobulles de l'app
// (même style que ZoneMapPicker.vue), au lieu de la bulle native grise du navigateur.
let hoverLabel = null
let HoverLabelClass = null
function buildHoverLabelClass() {
  if (HoverLabelClass) return
  HoverLabelClass = class extends google.maps.OverlayView {
    constructor(position, text) {
      super()
      this.position = position
      this.text = text
      this.div = null
    }
    onAdd() {
      this.div = window.document.createElement('div')
      Object.assign(this.div.style, {
        position: 'absolute',
        background: '#1b2842',
        color: '#fff',
        padding: '5px 9px',
        borderRadius: '12px',
        fontFamily: "var(--font-sans, 'Poppins', sans-serif)",
        fontSize: '12px',
        fontWeight: '500',
        lineHeight: '1.3',
        whiteSpace: 'nowrap',
        boxShadow: '0 0 0 1px rgba(255,255,255,0.1), 0 20px 25px -5px rgba(27,40,66,0.3), 0 8px 10px -6px rgba(27,40,66,0.3)',
        pointerEvents: 'none',
        transform: 'translate(-50%, -100%)',
        marginTop: '-20px',
        zIndex: '9999',
      })
      this.div.textContent = this.text
      this.getPanes().floatPane.appendChild(this.div)
      fadeLabel(this.div, true)
    }
    draw() {
      if (!this.div) return
      const pos = this.getProjection()?.fromLatLngToDivPixel(this.position)
      if (!pos) return
      this.div.style.left = pos.x + 'px'
      this.div.style.top = pos.y + 'px'
    }
    onRemove() {
      this.div?.parentNode?.removeChild(this.div)
      this.div = null
    }
  }
}
// Même délai d'apparition que les infobulles de l'app (lib/tooltip-timing.js) : sans délai d'un
// repère au voisin.
let hoverTimer = 0
let hoverWarmUntil = 0
function showHoverLabel(marker, text) {
  hideHoverLabel()
  hoverTimer = setTimeout(() => {
    if (!map) return
    buildHoverLabelClass()
    hoverLabel = new HoverLabelClass(marker.getPosition(), text)
    hoverLabel.setMap(map)
  }, tooltipOpenDelay({ now: Date.now(), warmUntil: hoverWarmUntil }))
}
function hideHoverLabel() {
  clearTimeout(hoverTimer)
  const label = hoverLabel
  hoverLabel = null
  if (!label) return
  hoverWarmUntil = Date.now() + TOOLTIP_SKIP_DELAY
  // Fondu de sortie, puis retrait de la carte.
  const anim = fadeLabel(label.div, false)
  if (!anim) return label.setMap(null)
  anim.onfinish = () => label.setMap(null)
}

function clearMarkers() {
  hideHoverLabel()
  for (const m of markers) m.setMap?.(null)
  markers = []
}

async function renderMap() {
  // Sans zones géolocalisées, on n'affiche rien (état `empty`) — la
  // section conserve quand même son tableau d'inventaire en dessous.
  if (!locatedZones.value.length) {
    status.value = 'empty'
    return
  }
  // v-if conditionne le rendu du conteneur ; quand les zones arrivent
  // après le mount (cas le plus fréquent : props.zones propagé depuis
  // le store de l'audit), on attend que le DOM soit prêt avant de
  // chercher la ref.
  await nextTick()
  if (!mapEl.value) return
  // Onglet masqué (page audit à onglets, v-show) : largeur nulle → un
  // fitBounds calculé maintenant serait faux. On redessine à l'affichage.
  if (!mapEl.value.offsetWidth) { pendingRender = true; return }
  pendingRender = false
  try {
    google = await loadGoogleMaps()
  } catch (e) {
    status.value = 'error'
    return
  }
  if (!map) {
    map = new google.maps.Map(mapEl.value, {
      center: { lat: 46.6, lng: 2.4 },
      zoom: 6,
      mapTypeId: 'hybrid',
      streetViewControl: false,
      mapTypeControl: false,
      fullscreenControl: true,
      zoomControl: true,
      gestureHandling: 'cooperative',
    })
  }
  clearMarkers()
  const bounds = new google.maps.LatLngBounds()
  locatedZones.value.forEach((z, idx) => {
    const item = legend.value[idx]
    const pos = { lat: Number(z.latitude), lng: Number(z.longitude) }
    const marker = new google.maps.Marker({
      position: pos,
      map,
      label: { text: item.initial, color: '#ffffff', fontWeight: '700', fontSize: '12px' },
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 14,
        fillColor: item.color,
        fillOpacity: 1,
        strokeColor: '#ffffff',
        strokeWeight: 2,
      },
    })
    marker.addListener('mouseover', () => showHoverLabel(marker, `${item.initial} · ${item.name}`))
    marker.addListener('mouseout', hideHoverLabel)
    markers.push(marker)
    bounds.extend(pos)
  })
  if (markers.length === 1) {
    map.setCenter(markers[0].getPosition())
    map.setZoom(17)
  } else {
    map.fitBounds(bounds, 60)
  }
  status.value = 'ready'
}

// Re-render quand l'inventaire géolocalisé change vraiment (ajout,
// suppression, déplacement, renommage, ordre). La synchro automatique de
// l'audit (toutes les 5 s) remplace le tableau des zones par des objets
// neufs : un `watch` profond sur `props.zones` effaçait et recréait les
// marqueurs à chaque passage et recadrait la carte (clignotement, zoom de
// l'utilisateur perdu).
const markersSignature = computed(() => locatedZones.value
  .map(z => `${z.zone_id ?? z.id}:${z.latitude},${z.longitude}:${z.name || ''}`)
  .join('|'))
watch(markersSignature, () => renderMap())

// Redessine quand la carte devient visible (retour sur l'onglet Zones).
let pendingRender = false
let resizeObs = null
if (typeof ResizeObserver !== 'undefined') {
  resizeObs = new ResizeObserver(() => {
    if (pendingRender && mapEl.value?.offsetWidth) renderMap()
  })
}
watch(mapEl, (el, old) => {
  if (!resizeObs) return
  if (old) resizeObs.unobserve(old)
  if (el) resizeObs.observe(el)
})

onMounted(renderMap)
onBeforeUnmount(() => { clearMarkers(); map = null; resizeObs?.disconnect(); resizeObs = null })
</script>

<template>
  <div v-if="locatedZones.length" class="rounded-lg border border-gray-200 overflow-hidden bg-white shadow-sm">
    <div ref="mapEl" class="w-full h-80"></div>
    <div class="flex flex-wrap gap-x-4 gap-y-1.5 px-3 py-2.5 border-t border-gray-100 text-xs text-gray-700">
      <span v-for="item in legend" :key="item.initial" class="inline-flex items-center gap-1.5">
        <span class="inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold text-white shadow"
              :style="{ background: item.color }">
          {{ item.initial }}
        </span>
        <span>{{ item.name }}</span>
      </span>
    </div>
  </div>
</template>
