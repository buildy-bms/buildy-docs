<script setup>
/**
 * Carte Google Maps de positionnement d'une zone (fonctionnelle ou
 * technique). Affiche toutes les zones du site en pins colorés ; la zone
 * en cours d'édition porte un pin déplaçable. Un clic sur la carte pose /
 * déplace ce pin.
 *
 * v-model:latitude / v-model:longitude — coordonnées de la zone éditée.
 */
import { ref, computed, onMounted, onBeforeUnmount, watch, defineAsyncComponent } from 'vue'
import { Cog6ToothIcon } from '@heroicons/vue/24/outline'
import { loadGoogleMaps, ZONE_PIN_COLORS } from '@/lib/google-maps'
// Import paresseux : ZoneMapPicker ↔ EditSiteModal se référencent
// mutuellement (EditSiteModal embarque une carte). L'import async casse
// le cycle de dépendances.
const EditSiteModal = defineAsyncComponent(() => import('./EditSiteModal.vue'))

const props = defineProps({
  latitude: { type: Number, default: null },
  longitude: { type: Number, default: null },
  kind: { type: String, default: 'functional' },
  // Toutes les zones du site (pour le contexte). La zone courante est
  // exclue via currentZoneId.
  zones: { type: Array, default: () => [] },
  currentZoneId: { type: Number, default: null },
  // { address, latitude, longitude } — pour centrer la carte.
  site: { type: Object, default: () => ({}) },
  // true : carte agrandie (modale dédiée de positionnement).
  large: { type: Boolean, default: false },
  // false : masque le bouton « Modifier l'adresse du site » (évite la
  // récursion quand la carte est elle-même dans EditSiteModal).
  allowSiteEdit: { type: Boolean, default: true },
  // Libellé de l'entité positionnée, pour le texte d'aide.
  pointLabel: { type: String, default: 'la zone' },
  // true : carte en lecture seule (aucun placement de pin, pas d'aide).
  readonly: { type: Boolean, default: false },
})
const emit = defineEmits(['update:latitude', 'update:longitude'])

const mapEl = ref(null)
const status = ref('loading') // 'loading' | 'ready' | 'error'
const errorMsg = ref('')

// Édition du site (adresse) directement depuis la carte : utile quand le
// centrage est mauvais parce que l'adresse du site est absente / erronée.
const showEditSite = ref(false)
const canEditSite = computed(() => !!(props.site && (props.site.site_uuid || props.site.uuid)))
function onSiteSaved() {
  // L'adresse / les coordonnées du site ont pu changer → recentrer.
  if (map && status.value === 'ready') centerMap()
}

let google = null
let map = null
let currentMarker = null
const contextMarkers = []
let siteMarker = null
let tooltipOverlay = null
let TooltipOverlayClass = null

// Construit la classe `OverlayView` custom (à appeler après loadGoogleMaps).
// Affiche un div HTML positionné au-dessus du marker, stylé comme les
// tooltips Buildy (gris foncé, blanc, rounded, font Inter).
function buildTooltipOverlayClass() {
  if (TooltipOverlayClass) return
  TooltipOverlayClass = class extends google.maps.OverlayView {
    constructor() {
      super()
      this.position = null
      this.text = ''
      this.div = null
    }
    setLabel(position, text) {
      this.position = position
      this.text = text
      if (this.div) {
        this.div.textContent = text
        this.draw()
      }
    }
    onAdd() {
      this.div = document.createElement('div')
      Object.assign(this.div.style, {
        position: 'absolute',
        background: '#1f2937',
        color: '#fff',
        padding: '5px 9px',
        borderRadius: '6px',
        fontFamily: 'Inter, sans-serif',
        fontSize: '12px',
        fontWeight: '500',
        lineHeight: '1.3',
        whiteSpace: 'nowrap',
        boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
        pointerEvents: 'none',
        transform: 'translate(-50%, -100%)',
        marginTop: '-12px',
        zIndex: '9999',
      })
      this.div.textContent = this.text
      this.getPanes().floatPane.appendChild(this.div)
    }
    draw() {
      if (!this.div || !this.position) return
      const projection = this.getProjection()
      if (!projection) return
      const pos = projection.fromLatLngToDivPixel(this.position)
      if (!pos) return
      this.div.style.left = pos.x + 'px'
      this.div.style.top = pos.y + 'px'
    }
    onRemove() {
      if (this.div && this.div.parentNode) this.div.parentNode.removeChild(this.div)
      this.div = null
    }
  }
}

// Hover handler : affiche un OverlayView positionné sur le marker.
function bindHoverTooltip(marker, label) {
  if (!label) return
  marker.addListener('mouseover', () => {
    if (!tooltipOverlay) {
      tooltipOverlay = new TooltipOverlayClass()
      tooltipOverlay.setMap(map)
    }
    tooltipOverlay.setLabel(marker.getPosition(), label)
  })
  marker.addListener('mouseout', () => {
    if (tooltipOverlay) tooltipOverlay.setMap(null)
    tooltipOverlay = null
  })
}

const FRANCE = { center: { lat: 46.6, lng: 2.4 }, zoom: 5 }

// Pin en goutte d'eau coloré (symbole vectoriel, pas besoin de Map ID).
function pinIcon(color) {
  return {
    path: 'M 0 0 C -2 -20 -12 -22 -12 -32 A 12 12 0 1 1 12 -32 C 12 -22 2 -20 0 0 z',
    fillColor: color,
    fillOpacity: 1,
    strokeColor: '#ffffff',
    strokeWeight: 1.5,
    scale: 1,
    anchor: new google.maps.Point(0, 0),
  }
}

// Nom de la zone en cours d'édition, pour le label de hover sur son pin.
const currentZoneName = computed(() => {
  if (props.currentZoneId == null) return props.pointLabel || 'Zone à positionner'
  const z = (props.zones || []).find(zz => zz.id === props.currentZoneId)
  return z?.name || props.pointLabel || 'Zone à positionner'
})

function placeCurrent(lat, lng) {
  if (!currentMarker) {
    currentMarker = new google.maps.Marker({
      map,
      position: { lat, lng },
      draggable: true,
      zIndex: 1000,
      icon: pinIcon(ZONE_PIN_COLORS[props.kind] || ZONE_PIN_COLORS.functional),
    })
    currentMarker.addListener('dragend', (e) => {
      emit('update:latitude', e.latLng.lat())
      emit('update:longitude', e.latLng.lng())
    })
    bindHoverTooltip(currentMarker, currentZoneName.value)
  } else {
    currentMarker.setPosition({ lat, lng })
  }
}

function clearPoint() {
  if (currentMarker) { currentMarker.setMap(null); currentMarker = null }
  emit('update:latitude', null)
  emit('update:longitude', null)
}

function renderContextMarkers() {
  contextMarkers.forEach(m => m.setMap(null))
  contextMarkers.length = 0
  for (const z of props.zones || []) {
    if (!z || z.latitude == null || z.longitude == null) continue
    if (props.currentZoneId != null && z.id === props.currentZoneId) continue
    const marker = new google.maps.Marker({
      map,
      position: { lat: z.latitude, lng: z.longitude },
      opacity: 0.65,
      icon: pinIcon(ZONE_PIN_COLORS[z.kind] || ZONE_PIN_COLORS.functional),
    })
    bindHoverTooltip(marker, z.name || '')
    contextMarkers.push(marker)
  }
}

// Pin du site (centre du bâtiment) — référence visuelle permanente.
// Couleur indigo distincte des zones.
function renderSiteMarker() {
  if (siteMarker) { siteMarker.setMap(null); siteMarker = null }
  if (props.site?.latitude == null || props.site?.longitude == null) return
  siteMarker = new google.maps.Marker({
    map,
    position: { lat: props.site.latitude, lng: props.site.longitude },
    zIndex: 500,
    icon: {
      ...pinIcon('#4f46e5'),
      scale: 1.1,
    },
  })
  bindHoverTooltip(siteMarker, props.site.name || 'Site')
}

// Centrage à l'ouverture. Comportement selon le contexte :
//
// - Édition d'un SITE (`kind="site"`) : on centre uniquement sur le pin
//   du site (props.latitude/longitude) ou sur les coordonnées géocodées
//   de l'adresse. On n'inclut PAS les zones (elles seraient hors-champ
//   et forceraient un dézoom inutile pour positionner le site lui-même).
//
// - Édition d'une ZONE (kind functional/technical) : fitBounds sur TOUS
//   les pins disponibles (site + zone courante + autres zones du site)
//   pour avoir le contexte complet du bâtiment.
//
// Zoom plus élevé en mode large (modale dédiée, vue précise des toits)
// que sur la carte intégrée.
async function centerMap() {
  const targetZoom = props.large ? 20 : 18
  const maxZoom = props.large ? 21 : 19

  // Mode édition site : on centre sur le pin du site (s'il est saisi)
  // ou on géocode l'adresse. On ignore complètement les zones.
  if (props.kind === 'site') {
    if (props.latitude != null && props.longitude != null) {
      map.setCenter({ lat: props.latitude, lng: props.longitude })
      map.setZoom(targetZoom)
      return
    }
    if (props.site?.address) {
      try {
        const { results } = await new google.maps.Geocoder()
          .geocode({ address: props.site.address, region: 'FR' })
        if (results?.[0]) {
          map.setCenter(results[0].geometry.location)
          map.setZoom(targetZoom)
          return
        }
      } catch { /* repli */ }
    }
    return
  }

  // Édition d'une zone : on englobe tous les pins disponibles.
  // Coordonnées du site (référence stable). Géocoder l'adresse si besoin.
  let siteLat = props.site?.latitude
  let siteLng = props.site?.longitude
  if ((siteLat == null || siteLng == null) && props.site?.address) {
    try {
      const { results } = await new google.maps.Geocoder()
        .geocode({ address: props.site.address, region: 'FR' })
      if (results?.[0]) {
        siteLat = results[0].geometry.location.lat()
        siteLng = results[0].geometry.location.lng()
      }
    } catch { /* repli */ }
  }
  const points = []
  if (siteLat != null && siteLng != null) points.push({ lat: siteLat, lng: siteLng })
  if (props.latitude != null && props.longitude != null) {
    points.push({ lat: props.latitude, lng: props.longitude })
  }
  for (const z of (props.zones || [])) {
    if (z.latitude != null && z.longitude != null) {
      if (props.currentZoneId != null && z.id === props.currentZoneId) continue
      points.push({ lat: z.latitude, lng: z.longitude })
    }
  }
  if (points.length >= 2) {
    const bounds = new google.maps.LatLngBounds()
    points.forEach(p => bounds.extend(p))
    map.fitBounds(bounds, 96)
    if (map.getZoom() > maxZoom) map.setZoom(maxZoom)
    return
  }
  if (points.length === 1) {
    map.setCenter(points[0])
    map.setZoom(targetZoom)
  }
}

async function initMap() {
  try {
    google = await loadGoogleMaps()
  } catch (e) {
    status.value = 'error'
    errorMsg.value = e.message || 'Carte indisponible.'
    return
  }
  buildTooltipOverlayClass()
  map = new google.maps.Map(mapEl.value, {
    center: FRANCE.center,
    zoom: FRANCE.zoom,
    // Vue satellite par défaut ; bascule Plan / Satellite via le contrôle natif.
    mapTypeId: 'hybrid',
    streetViewControl: false,
    mapTypeControl: true,
    fullscreenControl: true,
  })
  if (!props.readonly) {
    map.addListener('click', (e) => {
      const lat = e.latLng.lat()
      const lng = e.latLng.lng()
      placeCurrent(lat, lng)
      emit('update:latitude', lat)
      emit('update:longitude', lng)
    })
  }
  status.value = 'ready'
  renderSiteMarker()
  renderContextMarkers()
  if (props.latitude != null && props.longitude != null) {
    placeCurrent(props.latitude, props.longitude)
  }
  await centerMap()
}

// Le type de zone peut changer pendant l'édition → recolorer le pin.
watch(() => props.kind, (k) => {
  if (currentMarker) currentMarker.setIcon(pinIcon(ZONE_PIN_COLORS[k] || ZONE_PIN_COLORS.functional))
})

// Coordonnées modifiées depuis l'extérieur (ex. choix d'une adresse dans
// EditSiteModal → géocodage) : déplacer le pin et recentrer. Le garde
// d'égalité évite la boucle avec les emit update:latitude/longitude.
watch(() => [props.latitude, props.longitude], ([lat, lng]) => {
  if (status.value !== 'ready' || !map) return
  if (lat == null || lng == null) {
    if (currentMarker) { currentMarker.setMap(null); currentMarker = null }
    return
  }
  const pos = currentMarker && currentMarker.getPosition()
  if (pos && Math.abs(pos.lat() - lat) < 1e-7 && Math.abs(pos.lng() - lng) < 1e-7) return
  placeCurrent(lat, lng)
  map.setCenter({ lat, lng })
  if (map.getZoom() < 16) map.setZoom(props.large ? 20 : 18)
})

onMounted(initMap)
onBeforeUnmount(() => {
  contextMarkers.forEach(m => m.setMap(null))
  if (currentMarker) currentMarker.setMap(null)
  if (siteMarker) siteMarker.setMap(null)
  if (tooltipOverlay) tooltipOverlay.setMap(null)
})
</script>

<template>
  <div :class="large ? 'w-[78vw] max-w-240' : ''">
    <!-- Barre d'outils : éditer l'adresse du site (sert au centrage carte) -->
    <div v-if="status === 'ready' && canEditSite && allowSiteEdit && !readonly" class="mb-2 flex justify-end">
      <button type="button" @click="showEditSite = true"
              class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 hover:border-gray-400 transition whitespace-nowrap">
        <Cog6ToothIcon class="w-4 h-4 shrink-0" />
        Modifier l'adresse du site
      </button>
    </div>
    <div :class="['relative w-full rounded-lg overflow-hidden border border-gray-200 bg-gray-100',
                  large ? 'h-[64vh] min-h-95' : 'h-80']">
      <div ref="mapEl" class="absolute inset-0"></div>
      <div v-if="status === 'loading'"
           class="absolute inset-0 flex items-center justify-center text-sm text-gray-400">
        Chargement de la carte…
      </div>
      <div v-else-if="status === 'error'"
           class="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-gray-500">
        {{ errorMsg }}
      </div>
    </div>
    <div v-if="status === 'ready' && !readonly" class="mt-1.5 flex items-center justify-between gap-3 text-xs">
      <span class="text-gray-500 truncate">
        {{ latitude != null
          ? 'Déplacez le pin ou cliquez ailleurs pour ajuster la position.'
          : `Cliquez sur la carte pour positionner ${pointLabel}.` }}
      </span>
      <button v-if="latitude != null" type="button" @click="clearPoint"
              class="text-gray-400 hover:text-red-600 whitespace-nowrap shrink-0">
        Retirer le point
      </button>
    </div>
  </div>

  <EditSiteModal
    v-if="showEditSite && canEditSite"
    :site="site"
    @close="showEditSite = false"
    @saved="onSiteSaved"
  />
</template>
