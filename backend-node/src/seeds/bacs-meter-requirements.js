'use strict';

/**
 * Matrice usage x nature_zone -> meter_type (R175-3 §1).
 *
 * Pour chaque zone, selon sa nature, on definit les compteurs requis :
 *   - quel usage (heating/cooling/dhw/lighting/...)
 *   - quel type de compteur (thermal/electric/gas/water)
 *
 * Cette matrice complete la matrice "categories de systemes" deja seedee
 * (bacs_requirements_by_zone_nature). Elle ne couvre QUE les compteurs
 * zonaux ; les compteurs generaux du batiment (zone_id NULL) sont gerees
 * differemment :
 *   - 1 compteur general electrique a la creation de l'audit (toujours)
 *   - 1 compteur general gaz si un device a `energy_source='gas'`
 *   - 1 compteur general fuel si `energy_source='fuel_oil'`
 *   - 1 compteur general thermique si `energy_source='district_heating'`
 *
 * Le compteur thermique zonal est pose pour les zones intérieures pour le
 * suivi par usage chauffage/refroidissement (R175-3 §1) — ne dispense pas
 * du compteur energie primaire (gaz/fuel) au general.
 */

const INDOOR_NATURES = [
  'shared-office', 'private-office', 'open-space', 'commercial-space',
  'meeting-room', 'workshop', 'switchboard', 'technical-area',
  'classroom', 'leasure-space', 'foyer', 'corridor',
  'meters', 'shared-space', 'logistic-cell', 'stock',
];

// Compteurs zonaux requis par defaut pour toutes zones interieures
const INDOOR_METERS = [
  { usage: 'heating', meter_type: 'thermal' },
  { usage: 'cooling', meter_type: 'electric' },
  { usage: 'dhw', meter_type: 'thermal' },
  { usage: 'lighting', meter_type: 'electric' },
];

module.exports = [
  // Zones interieures : compteurs thermiques + electriques par usage
  ...INDOOR_NATURES.flatMap(nature =>
    INDOOR_METERS.map(m => ({ zone_nature: nature, ...m }))
  ),
  // Outdoor : eclairage exterieur + production PV
  { zone_nature: 'outdoor', usage: 'lighting', meter_type: 'electric' },
  { zone_nature: 'outdoor', usage: 'pv', meter_type: 'electric_production' },
];
