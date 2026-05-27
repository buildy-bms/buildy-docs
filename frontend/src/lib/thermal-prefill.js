/**
 * Pré-remplissage des lignes Régulation thermique R175-6 depuis les équipements.
 *
 * Source de vérité : `bacs_audit_system_devices`. Pour chaque (zone, catégorie),
 * on sélectionne le device présent du système matching le rôle attendu :
 *  - Production   = device avec role ∋ 'production' (le plus puissant si plusieurs)
 *  - Distribution = device avec role ∋ 'distribution'
 *  - Emission     = device avec role ∋ 'emission'
 *  - Regulation   = device avec role ∋ 'regulation' ou has_regulation = true
 *
 * Le helper ne fait que PROPOSER une valeur ; l'auditeur reste libre de
 * surcharger via le SearchableSelect de la ligne thermique.
 */

function roleArray(d) {
  if (Array.isArray(d.device_role)) return d.device_role
  if (d.device_role) return [d.device_role]
  return []
}

function hasRole(d, role) {
  return roleArray(d).includes(role)
}

/**
 * Retourne le meilleur device candidat pour un (level, devices). `devices`
 * doit déjà être filtré par (zone × catégorie). Retourne null si aucun.
 */
export function bestDeviceForLevel(devices, level) {
  if (!Array.isArray(devices) || !devices.length) return null
  // Exclure les équipements hors service.
  const live = devices.filter(d => !d.out_of_service)
  if (!live.length) return null
  if (level === 'regulation') {
    // Régulateur : un device avec role ∋ regulation OU has_regulation = true.
    const cands = live.filter(d => hasRole(d, 'regulation') || d.has_regulation === 1 || d.has_regulation === true)
    return cands[0] || null
  }
  const cands = live.filter(d => hasRole(d, level))
  if (!cands.length) return null
  if (level === 'production') {
    // Plus puissant en tête.
    return [...cands].sort((a, b) => (b.power_kw || 0) - (a.power_kw || 0))[0]
  }
  return cands[0]
}

/**
 * Pour une ligne thermique `t` et la fonction d'accès aux devices de la zone,
 * retourne un objet { production, distribution, emission, regulation } avec
 * les devices candidats (ou null).
 */
export function deriveLevelsForThermalRow(t, devicesForZoneCategory) {
  const devs = devicesForZoneCategory(t.zone_id, t.category || 'heating') || []
  return {
    production:   bestDeviceForLevel(devs, 'production'),
    distribution: bestDeviceForLevel(devs, 'distribution'),
    emission:     bestDeviceForLevel(devs, 'emission'),
    regulation:   bestDeviceForLevel(devs, 'regulation'),
  }
}

/**
 * Calcule le patch nécessaire pour pré-remplir une ligne thermique sans
 * écraser les saisies existantes. Retourne `null` si rien à patcher.
 */
export function buildPrefillPatch(t, devicesForZoneCategory) {
  const derived = deriveLevelsForThermalRow(t, devicesForZoneCategory)
  const patch = {}
  if (!t.generator_device_id && derived.production)
    patch.generator_device_id = derived.production.id
  if (!t.distribution_device_id && derived.distribution)
    patch.distribution_device_id = derived.distribution.id
  if (!t.emission_device_id && derived.emission)
    patch.emission_device_id = derived.emission.id
  // Pour la régulation, on remplit le slot Production en priorité (cas le
  // plus fréquent : un régulateur central pilote la production). Si l'auditeur
  // a une régulation distincte par niveau, il l'ajustera manuellement.
  if (derived.regulation) {
    if (!t.production_regulation_device_id)   patch.production_regulation_device_id = derived.regulation.id
    if (!t.distribution_regulation_device_id) patch.distribution_regulation_device_id = derived.regulation.id
    if (!t.emission_regulation_device_id)     patch.emission_regulation_device_id = derived.regulation.id
  }
  return Object.keys(patch).length ? patch : null
}

// Labels FR des types de régulation par niveau, partagés avec audit-options.js.
// On les ré-exporte ici pour permettre la résolution rapide dans ThermalSection
// sans avoir à connaître la liste source.
export function regulationTypeLabel(value, level, catalogs) {
  if (!value) return null
  const list = catalogs[level] || []
  return list.find(o => o.value === value)?.label || value
}
