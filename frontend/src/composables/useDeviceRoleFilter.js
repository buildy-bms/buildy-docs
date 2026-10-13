// Filtrage tolérant des équipements par rôle (production / distribution /
// emission / regulation / autre, multi-valeurs JSON depuis mig 117).
//
// Trois buckets :
//   0 — pertinent (rôle requis présent)
//   1 — neutre (aucun rôle assigné, on les laisse remontés en bas)
//   2 — incompatible (rôle assigné mais pas le bon → masqué)
//
// Ce module est l'équivalent côté front de backend-node/src/lib/device-roles.js.

// Une valeur peut avoir été encodée en JSON plusieurs fois (« ["[\"production\"]"] » : vu sur des
// modèles de la bibliothèque re-sauvés) : on déballe chaque niveau jusqu'aux rôles eux-mêmes.
export function parseRoles(raw, depth = 0) {
  if (raw == null || depth > 8) return []
  if (Array.isArray(raw)) {
    const out = raw.flatMap(v => (typeof v === 'string' && v.trim().startsWith('[') ? parseRoles(v, depth + 1) : (typeof v === 'string' && v.trim() ? [v.trim()] : [])))
    return [...new Set(out)]
  }
  const s = String(raw).trim()
  if (!s) return []
  if (s.startsWith('[')) {
    try {
      const parsed = JSON.parse(s)
      if (Array.isArray(parsed)) return parseRoles(parsed, depth + 1)
    } catch { /* legacy non-JSON */ }
  }
  return [s]
}

export function rankDeviceForRole(device, role) {
  const wanted = String(role || '').toLowerCase()
  const roles = parseRoles(device?.device_role)
  if (roles.length === 0) return 1
  if (roles.some(r => String(r).toLowerCase() === wanted)) return 0
  return 2
}

export function filterAndSortByRole(devices, role) {
  if (!Array.isArray(devices) || devices.length === 0) return []
  return devices
    .map(d => ({ d, rank: rankDeviceForRole(d, role) }))
    .filter(x => x.rank < 2)
    .sort((a, b) => a.rank - b.rank)
    .map(x => x.d)
}
