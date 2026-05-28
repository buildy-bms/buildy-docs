'use strict';

/**
 * Listes de suggestions des types de régulation par niveau (Production /
 * Distribution / Émission), groupées par catégorie d'usage BACS.
 *
 * Source de vérité unique côté backend (mig 184). Utilisée par :
 *   - la migration 184 (backfill des templates existants)
 *   - les seeds `equipment-templates/*.js` qui peuvent appeler
 *     `defaultsForLibraryCategory(category)` pour pré-remplir leurs listes
 *   - la route GET /equipment-templates (déjà renvoyée via la colonne)
 *
 * Côté frontend, le fallback équivalent vit dans `lib/audit-options.js`
 * (`regulationTypesForCategory`) — toute modification ici doit être
 * dupliquée côté front pour les défauts d'affichage quand la liste du
 * template est null.
 *
 * Chaque entrée : { value: snake_case_id, label: 'Libellé FR' }. Le champ
 * `regulation_type_*` du device est un TEXT libre (creatable côté UI),
 * la liste sert uniquement de suggestion.
 */

// Catégorie BACS (audit) → listes. Clés alignées avec
// `bacs_audit_systems.system_category` (heating/cooling/ventilation/dhw/
// lighting_indoor/lighting_outdoor/electricity_production).
const BACS = {
  heating: {
    production: [
      { value: 'loi_d_eau',          label: "Loi d'eau" },
      { value: 'pression_constante', label: 'Pression constante' },
      { value: 'cascade',            label: 'Cascade' },
      { value: 'modulation',         label: 'Modulation de puissance' },
      { value: 'tout_ou_rien',       label: 'Tout ou rien' },
    ],
    distribution: [
      { value: 'vanne_3_voies',  label: 'Vanne 3 voies' },
      { value: 'vanne_2_voies',  label: 'Vanne 2 voies' },
      { value: 'debit_variable', label: 'Débit variable' },
      { value: 'equilibrage',    label: 'Équilibrage hydraulique' },
    ],
    emission: [
      { value: 'thermostat_ambiant',         label: 'Thermostat ambiant' },
      { value: 'thermostat_sonde_deportee',  label: 'Thermostat avec sonde déportée' },
      { value: 'vanne_thermostatique',       label: 'Vanne thermostatique' },
      { value: 'sonde_zone',                 label: 'Sonde de zone' },
      { value: 'sonde_retour',               label: 'Sonde de retour' },
    ],
  },
  cooling: {
    production: [
      { value: 'loi_d_eau',          label: "Loi d'eau froid" },
      { value: 'pression_constante', label: 'Pression constante' },
      { value: 'cascade',            label: 'Cascade groupes froid' },
      { value: 'modulation',         label: 'Modulation de puissance' },
      { value: 'tout_ou_rien',       label: 'Tout ou rien' },
      { value: 'free_cooling',       label: 'Free-cooling' },
    ],
    distribution: [
      { value: 'vanne_3_voies',  label: 'Vanne 3 voies' },
      { value: 'vanne_2_voies',  label: 'Vanne 2 voies' },
      { value: 'debit_variable', label: 'Débit variable' },
    ],
    emission: [
      { value: 'thermostat_ambiant', label: 'Thermostat ambiant' },
      { value: 'sonde_zone',         label: 'Sonde de zone' },
      { value: 'sonde_retour',       label: 'Sonde de retour' },
    ],
  },
  ventilation: {
    production: [
      { value: 'debit_constant',    label: 'Débit constant (CAV)' },
      { value: 'debit_variable',    label: 'Débit variable (VAV)' },
      { value: 'tout_ou_rien',      label: 'Tout ou rien' },
      { value: 'modulation_freq',   label: 'Variation de fréquence' },
    ],
    distribution: [
      { value: 'registre_motorise', label: 'Registre motorisé' },
      { value: 'caisson_vav',       label: 'Caisson VAV' },
      { value: 'pressostat',        label: 'Pressostat' },
    ],
    emission: [
      { value: 'sonde_co2',         label: 'Sonde CO₂' },
      { value: 'sonde_humidite',    label: 'Sonde humidité' },
      { value: 'sonde_presence',    label: 'Détection de présence' },
      { value: 'horloge',           label: 'Horloge / programmation' },
      { value: 'debit_constant',    label: 'Débit constant' },
    ],
  },
  dhw: {
    production: [
      { value: 'thermostat_ballon', label: 'Thermostat ballon' },
      { value: 'sonde_ballon',      label: 'Sonde ballon' },
      { value: 'modulation',        label: 'Modulation de puissance' },
      { value: 'cascade',           label: 'Cascade' },
    ],
    distribution: [
      { value: 'bouclage_regule',   label: 'Bouclage régulé' },
      { value: 'horloge_bouclage',  label: 'Horloge sur bouclage' },
      { value: 'sonde_retour',      label: 'Sonde de retour bouclage' },
    ],
    emission: [
      { value: 'mitigeur_thermostatique', label: 'Mitigeur thermostatique' },
      { value: 'horloge_puisage',         label: 'Horloge de puisage' },
    ],
  },
  // L'éclairage est avant tout un sujet d'émission (régulation au point
  // d'usage). La production et la distribution gardent une liste minimale
  // pour les architectures DALI / KNX où la régulation peut être portée par
  // un contrôleur amont.
  lighting_indoor: {
    production: [
      { value: 'controleur_dali',   label: 'Contrôleur DALI' },
      { value: 'controleur_knx',    label: 'Contrôleur KNX' },
      { value: 'controleur_dmx',    label: 'Contrôleur DMX' },
    ],
    distribution: [
      { value: 'gradateur',         label: 'Gradateur de circuit' },
      { value: 'relais_pilote',     label: 'Relais piloté' },
      { value: 'bus_dali',          label: 'Bus DALI' },
    ],
    emission: [
      { value: 'detection_presence',     label: 'Détection de présence' },
      { value: 'presence_luminosite',    label: 'Présence + luminosité' },
      { value: 'lumiere_constante',      label: 'Régulation à lumière constante' },
      { value: 'horloge',                label: 'Horloge / programmation' },
      { value: 'scenario',               label: 'Scénarios' },
      { value: 'manuel',                 label: 'Commande manuelle' },
    ],
  },
  lighting_outdoor: {
    production: [
      { value: 'controleur_dali', label: 'Contrôleur DALI' },
      { value: 'controleur_knx',  label: 'Contrôleur KNX' },
    ],
    distribution: [
      { value: 'gradateur',     label: 'Gradateur' },
      { value: 'relais_pilote', label: 'Relais piloté' },
    ],
    emission: [
      { value: 'crepusculaire',          label: 'Cellule crépusculaire' },
      { value: 'horloge_astronomique',   label: 'Horloge astronomique' },
      { value: 'horloge',                label: 'Horloge / programmation' },
      { value: 'detection_presence',     label: 'Détection de présence' },
      { value: 'abaissement_nuit',       label: 'Abaissement de nuit' },
      { value: 'manuel',                 label: 'Commande manuelle' },
    ],
  },
  electricity_production: {
    production: [
      { value: 'mppt',                 label: 'MPPT (suivi de puissance)' },
      { value: 'onduleur_centralise',  label: 'Onduleur centralisé' },
      { value: 'micro_onduleur',       label: 'Micro-onduleur' },
      { value: 'autoconsommation',     label: 'Régulation autoconsommation' },
    ],
    distribution: [
      { value: 'limiteur_injection',   label: 'Limiteur d\'injection' },
      { value: 'deconnexion_reseau',   label: 'Découplage réseau' },
    ],
    emission: [],
  },
};

// Mapping `equipment_templates.category` (clés FR de la biblio) → catégorie
// BACS équivalente, pour le backfill / défaut au seeding.
// (système_categories_db.key) :
//   chauffage, climatisation, thermique_mixte, ventilation, ecs, pv,
//   eclairage_int, eclairage_ext, eclairage (legacy), prises, comptage,
//   qai, occultation, process, autres.
const LIBRARY_TO_BACS = {
  chauffage:        'heating',
  climatisation:    'cooling',
  thermique_mixte:  'heating',   // arbitraire : le chauffage est plus riche, l'utilisateur ajuste
  ventilation:      'ventilation',
  ecs:              'dhw',
  pv:               'electricity_production',
  electricite:      'electricity_production', // ancien slug
  eclairage_int:    'lighting_indoor',
  eclairage_ext:    'lighting_outdoor',
  eclairage:        'lighting_indoor',         // legacy
};

function defaultsForBacsCategory(bacsCategory) {
  return BACS[bacsCategory] || { production: [], distribution: [], emission: [] };
}

function defaultsForLibraryCategory(libraryCategory) {
  const bacs = LIBRARY_TO_BACS[libraryCategory];
  if (!bacs) return { production: null, distribution: null, emission: null };
  const d = BACS[bacs];
  return {
    production:   d.production.length   ? d.production   : null,
    distribution: d.distribution.length ? d.distribution : null,
    emission:     d.emission.length     ? d.emission     : null,
  };
}

module.exports = {
  BACS,
  LIBRARY_TO_BACS,
  defaultsForBacsCategory,
  defaultsForLibraryCategory,
};
