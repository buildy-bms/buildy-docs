<script setup>
/**
 * Carte Google Maps de positionnement d'une zone (fonctionnelle ou
 * technique). Affiche toutes les zones du site en pins colorés ; la zone
 * en cours d'édition porte un pin déplaçable. Un clic sur la carte pose /
 * déplace ce pin.
 *
 * v-model:latitude / v-model:longitude — coordonnées de la zone éditée.
 */
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { Cog6ToothIcon } from '@heroicons/vue/24/outline'
import { loadGoogleMaps, ZONE_PIN_COLORS } from '@/lib/google-maps'
import EditSiteModal from './EditSiteModal.vue'

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
    contextMarkers.push(new google.maps.Marker({
      map,
      position: { lat: z.latitude, lng: z.longitude },
      opacity: 0.65,
      title: z.name || '',
      icon: pinIcon(ZONE_PIN_COLORS[z.kind] || ZONE_PIN_COLORS.functional),
    }))
  }
}

// Centrage à l'ouverture, par ordre de priorité.
async function centerMap() {
  if (props.latitude != null && props.longitude != null) {
    map.setCenter({ lat: props.latitude, lng: props.longitude })
    map.setZoom(18)
    return
  }
  const located = (props.zones || []).filter(z => z.latitude != null && z.longitude != null)
  if (located.length) {
    const bounds = new google.maps.LatLngBounds()
    located.forEach(z => bounds.extend({ lat: z.latitude, lng: z.longitude }))
    map.fitBounds(bounds, 48)
    return
  }
  if (props.site?.latitude != null && props.site?.longitude != null) {
    map.setCenter({ lat: props.site.latitude, lng: props.site.longitude })
    map.setZoom(18)
    return
  }
  if (props.site?.address) {
    try {
      const { results } = await new google.maps.Geocoder()
        .geocode({ address: props.site.address, region: 'FR' })
      if (results?.[0]) {
        map.setCenter(results[0].geometry.location)
        map.setZoom(18)
        return
      }
    } catch { /* repli silencieux sur le centre France */ }
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
  map = new google.maps.Map(mapEl.value, {
    center: FRANCE.center,
    zoom: FRANCE.zoom,
    mapTypeId: 'hybrid',
    streetViewControl: false,
    mapTypeControl: true,
    fullscreenControl: true,
  })
  map.addListener('click', (e) => {
    const lat = e.latLng.lat()
    const lng = e.latLng.lng()
    placeCurrent(lat, lng)
    emit('update:latitude', lat)
    emit('update:longitude', lng)
  })
  status.value = 'ready'
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

onMounted(initMap)
onBeforeUnmount(() => {
  contextMarkers.forEach(m => m.setMap(null))
  if (currentMarker) currentMarker.setMap(null)
})
</script>

<template>
  <div>
    <div class="relative w-full h-72 rounded-lg overflow-hidden border border-gray-200 bg-gray-100">
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
    <div v-if="status === 'ready'" class="mt-1.5 flex items-center justify-between gap-3 text-xs">
      <div class="flex items-center gap-3 min-w-0">
        <button v-if="canEditSite" type="button" @click="showEditSite = true"
                class="inline-flex items-center gap-1 text-gray-500 hover:text-indigo-600 whitespace-nowrap shrink-0">
          <Cog6ToothIcon class="w-3.5 h-3.5 shrink-0" /> Modifier le site
        </button>
        <span class="text-gray-500 truncate">
          {{ latitude != null
            ? 'Déplacez le pin ou cliquez ailleurs pour ajuster la position.'
            : 'Cliquez sur la carte pour positionner la zone.' }}
        </span>
      </div>
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
