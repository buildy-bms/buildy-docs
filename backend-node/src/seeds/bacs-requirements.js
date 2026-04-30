'use strict';

/**
 * Matrice nature_zone -> categories BACS attendues (R175-1 §4).
 *
 * Cette matrice pilote la generation auto :
 * - du plan d'audit BACS pour une zone donnee (chapitre 3 — systemes techniques)
 * - des actions correctives (manque d'un equipement attendu => `system_addition`)
 *
 * 17 valeurs alignees Directus + cas Buildy. Ces valeurs sont indicatives,
 * a affiner sur 1-2 visites pilotes terrain avant figeage.
 */

module.exports = [
  // Bureaux et tertiaires : occupation humaine, regulation thermique +
  // ventilation + eclairage interieur + comptage electrique attendus.
  { zone_nature: 'shared-office',
    required_categories: ['heating', 'cooling', 'ventilation', 'lighting_indoor'] },
  { zone_nature: 'private-office',
    required_categories: ['heating', 'cooling', 'ventilation', 'lighting_indoor'] },
  { zone_nature: 'open-space',
    required_categories: ['heating', 'cooling', 'ventilation', 'lighting_indoor'] },
  { zone_nature: 'meeting-room',
    required_categories: ['heating', 'cooling', 'ventilation', 'lighting_indoor'] },
  { zone_nature: 'commercial-space',
    required_categories: ['heating', 'cooling', 'ventilation', 'lighting_indoor'] },
  { zone_nature: 'classroom',
    required_categories: ['heating', 'cooling', 'ventilation', 'lighting_indoor'] },

  // Espaces partages, communs : ventilation + eclairage essentiellement.
  { zone_nature: 'shared-space',
    required_categories: ['heating', 'ventilation', 'lighting_indoor'] },
  { zone_nature: 'leasure-space',
    required_categories: ['heating', 'ventilation', 'lighting_indoor'] },
  { zone_nature: 'foyer',
    required_categories: ['heating', 'ventilation', 'lighting_indoor'] },
  { zone_nature: 'corridor',
    required_categories: ['ventilation', 'lighting_indoor'] },

  // Industriels / logistiques : ventilation + eclairage. Le chauffage depend
  // du type d'activite (entrepot froid vs atelier chauffe), donc indicatif.
  { zone_nature: 'workshop',
    required_categories: ['ventilation', 'lighting_indoor'] },
  { zone_nature: 'logistic-cell',
    required_categories: ['ventilation', 'lighting_indoor'] },
  { zone_nature: 'stock',
    required_categories: ['ventilation', 'lighting_indoor'] },

  // Locaux techniques : ventilation + eclairage (compteur general traite par
  // bacs_audit_meters avec zone_id NULL).
  { zone_nature: 'technical-area',
    required_categories: ['ventilation', 'lighting_indoor'] },
  { zone_nature: 'switchboard',
    required_categories: ['ventilation', 'lighting_indoor'] },
  { zone_nature: 'meters',
    required_categories: ['lighting_indoor'] },

  // Exterieur : eclairage exterieur uniquement (hors strict decret BACS).
  { zone_nature: 'outdoor',
    required_categories: ['lighting_outdoor'] },
];
