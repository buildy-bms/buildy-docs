'use strict';

/**
 * Matrice nature_zone -> categories BACS attendues (R175-1 §4).
 *
 * Cette matrice pilote la generation auto :
 * - du plan d'audit BACS pour une zone donnee (chapitre 3 — systemes techniques)
 * - des actions correctives (manque d'un equipement attendu => `system_addition`)
 *
 * **Strategie "exhaustif par defaut"** : pour toute zone interieure on liste
 * les 6 categories R175-1 §4 (chauffage / refroidissement / ventilation /
 * ECS / eclairage interieur / production electrique sur site). L'auditeur
 * coche "Present" uniquement pour ceux qu'il observe sur place — mais il
 * voit toujours la liste complete pour ne rien oublier.
 *
 * Pour outdoor : eclairage exterieur + production electrique uniquement.
 *
 * Note : le BACS lui-meme (R175-1 §5) n'est pas dans cette matrice — il est
 * traite au chapitre 6 (table bacs_audit_bms 1-1 par document).
 */

const INDOOR_CATEGORIES = [
  'heating',
  'cooling',
  'ventilation',
  'dhw',
  'lighting_indoor',
  'electricity_production',
];

const INDOOR_NATURES = [
  'office', 'shared-office', 'private-office', 'open-space', 'commercial-space',
  'meeting-room', 'workshop', 'switchboard', 'technical-area', 'server-room',
  'classroom', 'leasure-space', 'foyer', 'corridor',
  'meters', 'shared-space', 'logistic-cell', 'stock',
  // Item 7b — natures enrichies. Toutes intérieures (chauffées ou techniques).
  // `boiler-room` est un local technique : on l'inclut comme zone intérieure
  // au même titre que `technical-area` / `meters` (inventaire complet R175-1
  // §4, l'auditeur coche « Présent » sur les seuls usages observés).
  'changing-room', 'kitchen', 'refectory', 'bedroom', 'care-room',
  'sports-hall', 'boiler-room', 'laundry', 'restroom',
];

module.exports = [
  // 16 natures interieures : 6 categories R175-1 §4 chacune
  ...INDOOR_NATURES.map(nature => ({
    zone_nature: nature,
    required_categories: INDOOR_CATEGORIES,
  })),
  // Exterieur : eclairage exterieur + production electrique
  {
    zone_nature: 'outdoor',
    required_categories: ['lighting_outdoor', 'electricity_production'],
  },
];
