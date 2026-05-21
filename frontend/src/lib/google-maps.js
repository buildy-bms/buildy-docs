// Chargement paresseux du SDK Google Maps JS.
//
// La clé provient de GET /api/public-config — elle est restreinte par
// référent HTTP côté console Google Cloud, donc sans danger côté navigateur.
// Le SDK n'est injecté qu'au premier usage réel d'une carte.
import { getPublicConfig } from '@/api'

let loadPromise = null

/**
 * Charge le SDK Google Maps une seule fois et résout le global `google`.
 * Rejette si la clé n'est pas configurée ou si le script échoue à charger.
 */
export function loadGoogleMaps() {
  if (loadPromise) return loadPromise
  loadPromise = (async () => {
    if (window.google?.maps) return window.google
    const { data } = await getPublicConfig()
    const key = (data?.googleMapsApiKey || '').trim()
    if (!key) throw new Error('Carte indisponible : clé Google Maps non configurée.')
    await new Promise((resolve, reject) => {
      const cbName = '__buildyGmapsReady'
      window[cbName] = () => resolve()
      const s = document.createElement('script')
      s.src = 'https://maps.googleapis.com/maps/api/js'
        + `?key=${encodeURIComponent(key)}`
        + `&loading=async&language=fr&region=FR&callback=${cbName}`
      s.async = true
      s.onerror = () => reject(new Error('Échec du chargement de Google Maps.'))
      document.head.appendChild(s)
    })
    return window.google
  })()
  // En cas d'échec, on autorise une nouvelle tentative ultérieure.
  loadPromise.catch(() => { loadPromise = null })
  return loadPromise
}

// Couleur des pins selon le type de zone — cohérent avec les toggles
// Fonctionnelle (indigo) / Technique (slate) de l'UI des zones.
export const ZONE_PIN_COLORS = {
  functional: '#4f46e5', // indigo-600
  technical: '#475569',  // slate-600
}
