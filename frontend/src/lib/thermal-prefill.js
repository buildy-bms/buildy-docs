/**
 * Pré-remplissage des lignes Régulation thermique R175-6 depuis les équipements.
 *
 * Source de vérité : `bacs_audit_system_devices`. Pour chaque (zone, catégorie),
 * on sélectionne le device présent du système matching le rôle attendu :
 *  - Production   = device avec role ∋ 'production' (le plus puissant si plusieurs)
 *  - Distribution = device avec role ∋ 'distribution'
 *  - Emission     = device avec role ∋ 'emission'
 *  - Regulation   = régulateur déporté : équipement dédié à la régulation (fonction
 *                   « Régulation » seule : sonde, régulateur, automate), jamais à
 *                   régulation intégrée (le serveur le refuse : PATCH 400, vu sur
 *                   Sénas le 2026-10-15) ni l'équipement qu'il régule
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
    // Régulateur déporté : un équipement dont la seule fonction est la régulation. Un équipement
    // de production, distribution ou émission « avec régulation » se régule lui-même (intégrée)
    // ou par un régulateur qui n'est pas cet équipement (déportée) : jamais proposé.
    const cands = live.filter(d => hasRole(d, 'regulation')
      && !['production', 'distribution', 'emission'].some(r => hasRole(d, r))
      && !(d.regulation_integrated === 1 || d.regulation_integrated === true))
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
  // Filtre sur le system_id exact si disponible (mig 188), sinon
  // fallback historique (zone × catégorie).
  const devs = t.system_id
    ? (devicesForZoneCategory(t.system_id) || [])
    : (devicesForZoneCategory(t.zone_id, t.category || 'heating') || [])
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
  // Régulateur déporté : proposé pour chaque niveau qui a un équipement (déjà choisi ou proposé
  // ci-dessus), jamais pour un niveau vide ni sur l'équipement lui-même. L'auditeur ajuste s'il a
  // une régulation distincte par niveau.
  if (derived.regulation) {
    const reg = derived.regulation.id
    const levels = [
      ['production_regulation_device_id', patch.generator_device_id ?? t.generator_device_id],
      ['distribution_regulation_device_id', patch.distribution_device_id ?? t.distribution_device_id],
      ['emission_regulation_device_id', patch.emission_device_id ?? t.emission_device_id],
    ]
    for (const [col, levelDevice] of levels) {
      if (!t[col] && levelDevice && levelDevice !== reg) patch[col] = reg
    }
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
