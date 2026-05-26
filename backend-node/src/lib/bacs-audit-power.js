'use strict';

/**
 * Cumul automatique des puissances d'un audit BACS (items 5 + 8 du plan
 * PROFEEL). Calcule la puissance chaud / froid cumulée du site à partir des
 * équipements physiques (`bacs_audit_system_devices`), en appliquant la règle
 * de calcul propre à chaque type de système (guide PROFEEL p.8, tableau 2).
 *
 * Règle « chaud et froid ne se cumulent pas » (guide PROFEEL p.7) :
 *   puissance retenue = max(chaud cumulé, froid cumulé).
 *
 * Ce module ne dépend pas de la DB — il opère sur des structures déjà
 * chargées, pour être réutilisable par _export-data.js (audit réel) et
 * _preview-fixture.js (dataset fictif).
 *
 * Types de calcul (`power_calculation_type` sur le device) :
 *  - thermodynamic_max          : PAC / DRV / clim — max(chaud, froid) déclaré
 *                                 constructeur (norme EN 14511).
 *  - boiler_sum                 : chaudières — somme des puissances nominales.
 *  - joule_sum                  : effet joule (radiateurs élec, batterie
 *                                 chaude élec) — somme des puissances élec.
 *  - district_heating_substation: sous-station réseau de chaleur/froid —
 *                                 puissance de l'échangeur primaire.
 *  - out_of_scope               : secours, mobile, bois indépendant, process
 *                                 — exclu du cumul.
 *
 * À défaut de `power_calculation_type` saisi, le type est inféré depuis la
 * catégorie du système et l'énergie de l'équipement (heuristique douce).
 */

// Catégories de systèmes considérées comme « chaud » / « froid » pour le
// rattachement par défaut d'une puissance device sans cooling explicite.
const HEAT_CATEGORIES = new Set(['heating']);
const COOL_CATEGORIES = new Set(['cooling']);
// La ventilation peut porter une batterie chaude OU froide : on s'appuie
// alors sur power_calculation_type / power_kw_cooling pour trancher.
const MIXED_CATEGORIES = new Set(['ventilation']);

/**
 * Infère le type de calcul de puissance d'un device quand il n'est pas
 * explicitement renseigné. Heuristique conservatrice.
 *
 * Refactor 2026-05-26 — Le type `district_heating_substation` n'est plus
 * inféré depuis `energy_source='district_heating'` (qui peut être porté
 * par un radiateur eau chaude en aval d'un réseau urbain). Il est
 * désormais déclenché EXCLUSIVEMENT par l'usage du modèle bibliothèque
 * `sous-station-reseau-urbain` (l'échangeur primaire est la seule
 * puissance retenue R175-2 — les émetteurs aval ne sont pas additionnés).
 *
 * @param {object} device — { system_category, energy_source, is_backup,
 *                            equipment_template_slug? }
 * @returns {string} un power_calculation_type
 */
function inferPowerCalculationType(device) {
  if (device.is_backup) return 'out_of_scope';
  const energy = device.energy_source || null;
  const cat = device.system_category || null;
  const tplSlug = device.equipment_template_slug || null;
  // Sous-station de réseau urbain : déclenchée par le slug du modèle
  // bibliothèque uniquement. Évite que les radiateurs aval (energy_source
  // = 'district_heating' par défaut sur le template radiateur) soient
  // qualifiés à tort comme sous-station — sinon double comptage R175-2.
  if (tplSlug === 'sous-station-reseau-urbain') return 'district_heating_substation';
  // Émetteurs aval de réseau urbain (radiateurs, ventilo-convecteurs,
  // batterie CTA alimentés en eau chaude / glacée par une sous-station) :
  // leur puissance ne doit PAS être additionnée au cumul (R175-2 : la
  // puissance retenue est celle de la station d'échange, pas du cumul
  // aval). On les rend explicitement hors cumul.
  if (energy === 'district_heating') return 'out_of_scope';
  // Bois (appareil indépendant) → hors périmètre.
  if (energy === 'wood' || energy === 'biomass') return 'out_of_scope';
  // Thermodynamique : PAC (heat_pump) ou catégorie froid.
  if (energy === 'heat_pump' || COOL_CATEGORIES.has(cat)) return 'thermodynamic_max';
  // Gaz / fioul en chauffage → chaudière.
  if ((energy === 'gas' || energy === 'fuel_oil') && HEAT_CATEGORIES.has(cat)) return 'boiler_sum';
  // Électrique en chauffage → effet joule.
  if (energy === 'electric' && HEAT_CATEGORIES.has(cat)) return 'joule_sum';
  // Catégorie chaud sans énergie claire → chaudière par défaut.
  if (HEAT_CATEGORIES.has(cat)) return 'boiler_sum';
  // Ventilation ou inconnu : hors cumul tant que rien n'est précisé.
  return 'out_of_scope';
}

const POWER_CALC_TYPE_LABEL = {
  thermodynamic_max: 'max chaud/froid thermodynamique',
  boiler_sum: 'somme des puissances nominales',
  joule_sum: 'somme des puissances électriques',
  district_heating_substation: 'puissance de la sous-station',
  out_of_scope: 'hors cumul (secours / process / bois)',
};

/**
 * Calcule la puissance retenue d'un device unitaire (× quantité), répartie
 * en composantes chaud / froid selon son type de calcul.
 *
 * @param {object} device — ligne bacs_audit_system_devices enrichie de
 *   `system_category`. Utilise power_kw, power_kw_cooling, quantity,
 *   power_calculation_type, energy_source, is_backup.
 * @returns {{ heat:number, cool:number, type:string, inScope:boolean }}
 */
function devicePowerContribution(device) {
  const type = device.power_calculation_type || inferPowerCalculationType(device);
  const qty = Number(device.quantity) || 1;
  const pHeat = (Number(device.power_kw) || 0) * qty;
  const pCool = (Number(device.power_kw_cooling) || 0) * qty;

  if (type === 'out_of_scope') {
    return { heat: 0, cool: 0, type, inScope: false };
  }
  if (type === 'thermodynamic_max') {
    // Une machine thermodynamique compte UNE fois, sur sa puissance la plus
    // élevée. On la rattache au poste correspondant (chaud OU froid).
    const cat = device.system_category;
    // Catégorie FROID (split, DRV non réversible) : la puissance saisie
    // (qu'elle soit en power_kw ou power_kw_cooling) est celle du poste
    // FROID. Bug Communay 2026-05-25 : sans cette branche, un split avec
    // power_kw=3 (pCool=0) en catégorie cooling était basculé en chaud par
    // la règle pHeat>=pCool — résultat heat=21.7 cumulé à tort.
    if (COOL_CATEGORIES.has(cat)) {
      return { heat: 0, cool: pCool || pHeat, type, inScope: true };
    }
    // Réversible (cat heating/mixte) : la puissance dominante est portée
    // par le poste chaud (cas le plus fréquent d'une PAC en chauffage).
    // Si seule la frigorifique est saisie, elle bascule en froid.
    if (pHeat >= pCool) return { heat: pHeat, cool: 0, type, inScope: true };
    return { heat: 0, cool: pCool, type, inScope: true };
  }
  // boiler_sum / joule_sum / district_heating_substation : on somme la
  // puissance sur le poste correspondant à la catégorie du système.
  const cat = device.system_category;
  if (COOL_CATEGORIES.has(cat)) {
    return { heat: 0, cool: pCool || pHeat, type, inScope: true };
  }
  if (MIXED_CATEGORIES.has(cat)) {
    // Ventilation à batterie : chaud et/ou froid selon ce qui est saisi.
    return { heat: pHeat, cool: pCool, type, inScope: true };
  }
  // Chauffage (et défaut).
  return { heat: pHeat, cool: pCool, type, inScope: true };
}

/**
 * Cumule les puissances de tous les équipements d'un audit.
 *
 * @param {Array} devices — liste de bacs_audit_system_devices enrichis avec
 *   `system_category` (et idéalement out_of_service).
 * @returns {object} { heatKw, coolKw, retainedKw, devices: [...] }
 *   - heatKw / coolKw : cumul chaud / froid (kW, arrondi 0.1).
 *   - retainedKw : max(heatKw, coolKw) — règle « chaud et froid ne se
 *     cumulent pas ».
 *   - devices : détail par device { ...device, _power: {heat,cool,type} }.
 */
function computeAutoPower(devices) {
  let heat = 0, cool = 0;
  const detailed = [];
  for (const d of devices || []) {
    // Les équipements Hors-Service ne comptent pas dans le cumul.
    if (d.out_of_service) {
      detailed.push({ ...d, _power: { heat: 0, cool: 0, type: 'out_of_scope', inScope: false } });
      continue;
    }
    const contrib = devicePowerContribution(d);
    heat += contrib.heat;
    cool += contrib.cool;
    detailed.push({ ...d, _power: contrib });
  }
  const round = (n) => Math.round(n * 10) / 10;
  return {
    heatKw: round(heat),
    coolKw: round(cool),
    retainedKw: round(Math.max(heat, cool)),
    devices: detailed,
  };
}

/**
 * Résout la puissance totale BACS d'un document : auto ou manuelle.
 *
 * @param {object} document — la ligne afs/documents (bacs_total_power_kw,
 *   bacs_total_power_source).
 * @param {object} auto — résultat de computeAutoPower().
 * @returns {object} {
 *   source, effectiveKw, autoKw, manualKw, heatKw, coolKw,
 *   discrepancy: bool, discrepancyPct: number|null
 * }
 */
function resolveTotalPower(document, auto) {
  const source = document.bacs_total_power_source === 'manual' ? 'manual' : 'auto';
  const manualKw = document.bacs_total_power_kw != null
    ? Number(document.bacs_total_power_kw) : null;
  const autoKw = auto.retainedKw;
  const effectiveKw = source === 'manual' && manualKw != null ? manualKw : autoKw;

  // Alerte d'écart : on compare toujours auto vs manuel quand les deux
  // existent, quel que soit le mode retenu (aide à la décision).
  let discrepancy = false;
  let discrepancyPct = null;
  if (manualKw != null && autoKw > 0) {
    discrepancyPct = Math.round(Math.abs(manualKw - autoKw) / autoKw * 100);
    discrepancy = discrepancyPct > 10;
  }
  return {
    source,
    effectiveKw,
    autoKw,
    manualKw,
    heatKw: auto.heatKw,
    coolKw: auto.coolKw,
    discrepancy,
    discrepancyPct,
  };
}

/**
 * Recalcule la puissance totale d'un audit depuis ses devices et la PERSISTE
 * dans afs.bacs_total_power_kw — uniquement si source='auto' (sinon respecte
 * la valeur manuelle saisie par l'auditeur).
 *
 * À appeler après chaque modif/ajout/suppression de device pour que la
 * valeur stockée reflète toujours le calcul réel (sinon elle dérive et
 * l'UI / les readers brut document.bacs_total_power_kw voient une valeur
 * obsolete — incident audit Communay 2026-05-25).
 *
 * @param {object} db — instance better-sqlite3 (db.db ou équivalent).
 * @param {number} documentId — id de l'AF.
 */
function recomputeAndPersistAuditPower(db, documentId) {
  // Lis tous les devices in-scope de l'audit avec leur catégorie système +
  // le slug du modèle bibliothèque (pour que inferPowerCalculationType
  // puisse distinguer sous-station vs émetteur aval — refactor 2026-05-26).
  const devices = db.prepare(`
    SELECT d.id, d.power_kw, d.power_kw_cooling, d.power_calculation_type,
           d.energy_source, d.is_backup, d.out_of_service,
           s.system_category, t.slug AS equipment_template_slug
    FROM bacs_audit_system_devices d
    JOIN bacs_audit_systems s ON s.id = d.system_id
    LEFT JOIN equipment_templates t ON t.id = d.equipment_template_id
    WHERE s.document_id = ?
  `).all(documentId);
  const auto = computeAutoPower(devices);

  const af = db.prepare('SELECT bacs_total_power_source FROM afs WHERE id = ?').get(documentId);
  if (!af) return null;
  // Ne touche bacs_total_power_kw QUE si source='auto' (ou null = auto par défaut).
  // Si source='manual' ou 'manual_override', l'auditeur a saisi à la main → respect.
  const source = af.bacs_total_power_source || 'auto';
  if (source === 'auto') {
    db.prepare('UPDATE afs SET bacs_total_power_kw = ? WHERE id = ?').run(auto.retainedKw, documentId);
  }
  return auto;
}

module.exports = {
  POWER_CALC_TYPE_LABEL,
  inferPowerCalculationType,
  devicePowerContribution,
  computeAutoPower,
  resolveTotalPower,
  recomputeAndPersistAuditPower,
};
