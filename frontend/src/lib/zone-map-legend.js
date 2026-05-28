// Palette et étiquetage des pins de zones — partagé entre la vue satellite
// du chapitre Zones (ZonesOverviewMap.vue) et le tableau d'inventaire
// (ZonesSection.vue) pour cohérence visuelle.
//
// Aligné mot-à-mot sur backend/lib/static-map.js → buildZonesStaticMap
// pour que les pins du PDF correspondent à ceux de l'app.

export const ZONE_MAP_PALETTE = [
  '#1d4ed8', '#b91c1c', '#16a34a', '#d97706', '#7c3aed',
  '#0ea5e9', '#db2777', '#059669', '#ea580c', '#6366f1',
]

export function zoneMapInitial(idx) {
  // A, B, C, D… sur les 26 premières zones. Bascule sur des chiffres
  // au-delà (cas très rare).
  return idx < 26 ? String.fromCharCode(65 + idx) : String(idx - 25)
}

/**
 * Construit la légende { initial, color } pour chaque zone géolocalisée
 * d'une liste. Les zones SANS coordonnées sont ignorées (pas de pin sur
 * la map → pas de pastille dans le tableau).
 *
 * @param {Array} zones — liste de zones (ordre = ordre d'affichage)
 * @returns {Map<zone_id, { initial: string, color: string }>}
 */
export function buildZoneLegendMap(zones) {
  const out = new Map()
  let idx = 0
  for (const z of (zones || [])) {
    if (z.latitude == null || z.longitude == null) continue
    out.set(z.zone_id ?? z.id, {
      initial: zoneMapInitial(idx),
      color: ZONE_MAP_PALETTE[idx % ZONE_MAP_PALETTE.length],
    })
    idx += 1
  }
  return out
}
