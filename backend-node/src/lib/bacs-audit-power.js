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

const { rolesAllowEnergySource } = require('./device-roles');

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
  // Doctrine 0.1.135 (mig 194) — seuls les équipements de PRODUCTION
  // cumulent au R175-2. Un émetteur passif (UI DRV, FCU, cassette, radiateur
  // à eau chaude, plancher chauffant) transfère vers l'air/l'eau du local
  // des kW DÉJÀ comptabilisés via la puissance du producteur amont (UE DRV,
  // chiller, chaudière, sous-station). Les cumuler côté émetteur ferait du
  // double comptage. Filtre dur — pas d'inférence aval qui puisse rattraper.
  if (!rolesAllowEnergySource(device.device_role)) return 'out_of_scope';
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
  // Bois / biomasse en chauffage = générateur par COMBUSTION (R175-1 8°a) :
  // sa puissance nominale entre dans le cumul R175-2 (→ boiler_sum via la
  // règle « catégorie chaud » ci-dessous). Seul l'« appareil INDÉPENDANT de
  // chauffage au bois » (poêle, insert — R175-6 II / PROFEEL-2) est hors
  // périmètre ; il doit être modélisé par un modèle bibliothèque dédié
  // marqué out_of_scope, PAS déduit de l'énergie seule (une chaudière bois
  // collective n'est pas un appareil indépendant et reste assujettie).
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
  out_of_scope: 'hors cumul (secours / process / aval réseau urbain)',
};

// Motif LISIBLE (par équipement) de l'exclusion du cumul R175-2. Rendu à côté
// de « Hors cumul » dans le PDF pour qu'un non-technicien comprenne POURQUOI un
// équipement — parfois le plus gros du site — n'est pas additionné.
const POWER_EXCLUSION_REASON_LABEL = {
  emitter_no_production: 'émetteur — puissance déjà comptée sur la production amont',
  excluded_type: 'secours, process ou aval réseau de chaleur',
  out_of_service: 'équipement hors service',
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
  // Doctrine 0.1.135 — filtre dur : un équipement sans fonction Production
  // ne cumule jamais au R175-2, peu importe son power_calculation_type
  // saisi explicitement. Garantit l'absence de double comptage UE DRV / UI DRV,
  // chiller / FCU, chaudière / radiateurs eau chaude, etc.
  if (!rolesAllowEnergySource(device.device_role)) {
    return { heat: 0, cool: 0, type: 'out_of_scope', inScope: false, reason: 'emitter_no_production' };
  }
  const type = device.power_calculation_type || inferPowerCalculationType(device);
  const qty = Number(device.quantity) || 1;
  const pHeat = (Number(device.power_kw) || 0) * qty;
  const pCool = (Number(device.power_kw_cooling) || 0) * qty;

  if (type === 'out_of_scope') {
    return { heat: 0, cool: 0, type, inScope: false, reason: 'excluded_type' };
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
    // Réversible (cat heating/mixte) : conformément à la FAQ ministérielle
    // n°11, la puissance chaud alimente le cumul CHAUD et la puissance froid
    // alimente le cumul FROID (« la puissance en chaud … cumulée avec les
    // autres puissances en chaud … la puissance en froid … avec les autres
    // puissances en froid »). La non-addition chaud+froid reste garantie au
    // niveau site par retainedKw = max(heatKw, coolKw) : la machine n'est
    // jamais comptée deux fois dans la puissance retenue.
    return { heat: pHeat, cool: pCool, type, inScope: true };
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
  let incompletePowerCount = 0;
  const detailed = [];
  for (const d of devices || []) {
    // Les équipements Hors-Service ne comptent pas dans le cumul.
    if (d.out_of_service) {
      detailed.push({ ...d, _power: { heat: 0, cool: 0, type: 'out_of_scope', inScope: false, reason: 'out_of_service' } });
      continue;
    }
    const contrib = devicePowerContribution(d);
    heat += contrib.heat;
    cool += contrib.cool;
    detailed.push({ ...d, _power: contrib });
    // Détection « puissance manquante » : équipement in-scope chaud/froid
    // sans aucune puissance saisie (ni power_kw ni power_kw_cooling). Sert
    // à la règle protective d'assujettissement (cf. resolveTotalPower) :
    // si le cumul auto est sous le seuil 70 kW MAIS des équipements ont
    // une puissance non saisie, on présume l'assujettissement plutôt que
    // de classer « non assujetti » à tort.
    if (contrib.inScope && !d.is_backup) {
      const cat = d.system_category;
      const isThermalCat = cat === 'heating' || cat === 'cooling' || cat === 'ventilation' || cat === 'dhw';
      const noPower = (d.power_kw == null || d.power_kw === 0) && (d.power_kw_cooling == null || d.power_kw_cooling === 0);
      if (isThermalCat && noPower) incompletePowerCount++;
    }
  }
  const round = (n) => Math.round(n * 10) / 10;
  return {
    heatKw: round(heat),
    coolKw: round(cool),
    retainedKw: round(Math.max(heat, cool)),
    incompletePowerCount,
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
  // Le CHECK DB de bacs_total_power_source vaut ('auto','manual_override').
  // Tester 'manual' (valeur inexistante) revenait à ignorer TOUJOURS la
  // saisie manuelle → l'assujettissement était recalculé sur le cumul auto,
  // voire effacé quand bacs_total_power_kw restait null (incident audit #56 :
  // 949 kW saisis à la main, statut livré « non renseigné »).
  const source = document.bacs_total_power_source === 'manual_override' ? 'manual' : 'auto';
  const manualKw = document.bacs_total_power_kw != null
    ? Number(document.bacs_total_power_kw) : null;
  const autoKw = auto.retainedKw;
  // En mode manuel sans valeur saisie, on retombe sur le cumul auto plutôt
  // que sur null (sinon l'applicabilité ne peut plus être calculée).
  const effectiveKw = source === 'manual' && manualKw != null ? manualKw : autoKw;

  // Alerte d'écart : on compare toujours auto vs manuel quand les deux
  // existent, quel que soit le mode retenu (aide à la décision).
  let discrepancy = false;
  let discrepancyPct = null;
  if (manualKw != null && autoKw > 0) {
    discrepancyPct = Math.round(Math.abs(manualKw - autoKw) / autoKw * 100);
    discrepancy = discrepancyPct > 10;
  }
  // Règle protective d'assujettissement : si le cumul auto est sous le
  // seuil 70 kW MAIS des équipements ont une puissance non saisie, on
  // considère l'audit comme potentiellement assujetti par défaut (le
  // total réel pourrait dépasser le seuil une fois les puissances
  // complétées). Le client UI affiche un warning, et computeBacsApplicability
  // (routes/afs.js) bascule de 'not_subject' à 'subject_2030' tant que
  // l'auditeur n'a pas complété les saisies.
  const incompletePowerCount = auto.incompletePowerCount || 0;
  const presumedSubjectDueToMissingData = incompletePowerCount > 0 && effectiveKw < 70;
  return {
    source,
    effectiveKw,
    // Alias rétro-compat : la card 04 frontend lit `retainedKw`
    // (= valeur retenue par l'audit pour le cumul R175-2). C'est
    // sémantiquement `effectiveKw` (manuel si défini en mode manual,
    // sinon le cumul auto). Sans ce champ, le pill « Retenue X kW »
    // affichait « Retenue kW » vide (incident audit Communay).
    retainedKw: effectiveKw,
    autoKw,
    manualKw,
    heatKw: auto.heatKw,
    coolKw: auto.coolKw,
    discrepancy,
    discrepancyPct,
    incompletePowerCount,
    presumedSubjectDueToMissingData,
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
  // ⚠️ device_role ET quantity sont INDISPENSABLES : devicePowerContribution
  // exclut tout équipement sans rôle Production (rolesAllowEnergySource) et
  // multiplie la puissance par quantity. Les omettre = TOUS les équipements
  // exclus → retenue 0 → bâtiment « non assujetti » à tort (incident #56/#45,
  // 2026-07-04 : chaque recompute mettait la puissance à 0).
  const devices = db.prepare(`
    SELECT d.id, d.power_kw, d.power_kw_cooling, d.power_calculation_type,
           d.energy_source, d.is_backup, d.out_of_service,
           d.device_role, d.quantity,
           s.system_category, t.slug AS equipment_template_slug
    FROM bacs_audit_system_devices d
    JOIN bacs_audit_systems s ON s.id = d.system_id
    LEFT JOIN equipment_templates t ON t.id = d.equipment_template_id
    WHERE s.document_id = ?
  `).all(documentId);
  const auto = computeAutoPower(devices);

  const af = db.prepare('SELECT bacs_total_power_source, bacs_building_permit_date, bacs_total_power_kw FROM afs WHERE id = ?').get(documentId);
  if (!af) return null;
  // Ne touche bacs_total_power_kw QUE si source='auto' (ou null = auto par défaut).
  // Si source='manual' ou 'manual_override', l'auditeur a saisi à la main → respect.
  // Normalise : seul 'manual_override' est un mode manuel (cf. CHECK DB).
  const source = af.bacs_total_power_source === 'manual_override' ? 'manual_override' : 'auto';
  if (source === 'auto') {
    db.prepare('UPDATE afs SET bacs_total_power_kw = ? WHERE id = ?').run(auto.retainedKw, documentId);
  }
  // Recalcul du statut d'assujettissement intégrant la règle protective :
  // si la puissance effective est sous 70 kW mais qu'il manque des
  // puissances saisies, on présume subject_2030 (au lieu de not_subject).
  // En mode manuel sans valeur saisie, on retombe sur le cumul auto (sinon
  // powerKw=null → statut effacé, incident audit #56).
  const powerKw = source === 'auto'
    ? auto.retainedKw
    : (af.bacs_total_power_kw != null ? af.bacs_total_power_kw : auto.retainedKw);
  const applic = computeBacsApplicabilityFromPower(powerKw, af.bacs_building_permit_date, auto.incompletePowerCount);
  if (applic) {
    db.prepare('UPDATE afs SET bacs_applicability_status = ?, bacs_applicable_deadline = ? WHERE id = ?')
      .run(applic.status, applic.deadline, documentId);
  } else {
    db.prepare('UPDATE afs SET bacs_applicability_status = NULL, bacs_applicable_deadline = NULL WHERE id = ?').run(documentId);
  }
  return auto;
}

/**
 * Mêmes règles d'applicabilité R175-2 que routes/afs.js mais accessible
 * depuis le helper power (évite l'import circulaire avec les routes).
 * Cf. computeBacsApplicability(routes/afs.js) pour la doc complète.
 */
function computeBacsApplicabilityFromPower(powerKw, buildingPermitDate, incompletePowerCount = 0) {
  if (powerKw == null || isNaN(powerKw)) return null;
  // PC « déposé APRÈS » une date charnière → comparaison stricte (>).
  const pcAfter = (iso) => !!buildingPermitDate
    && !isNaN(Date.parse(buildingPermitDate))
    && Date.parse(buildingPermitDate) > Date.parse(iso);

  // Seuil d'assujettissement : « puissance SUPÉRIEURE à 70 kW » (strict) —
  // R175-2 I. À 70,0 kW exactement, le bâtiment n'est pas assujetti.
  if (powerKw <= 70) {
    // Protective : puissances thermiques incomplètes → on présume
    // l'assujettissement (subject_2030) plutôt que 'not_subject' à tort.
    if (incompletePowerCount > 0) {
      return { status: 'subject_2030', deadline: '2030-01-01', presumed: true, basis: 'R175-2 II 4° (présumé)' };
    }
    return { status: 'not_subject', deadline: null };
  }
  if (powerKw > 290) {
    // R175-2 II 1° : > 290 kW ET PC déposé après le 21/07/2021 → dès la mise
    // en service, avec obligation de relier TOUS les systèmes techniques.
    if (pcAfter('2021-07-21')) {
      return { status: 'subject_immediate', deadline: buildingPermitDate, scope: 'all_connected', basis: 'R175-2 II 1°' };
    }
    // R175-2 II 2° : autres > 290 kW → au plus tard le 1er janvier 2025.
    return { status: 'subject_2025', deadline: '2025-01-01', basis: 'R175-2 II 2°' };
  }
  // 70 kW < powerKw <= 290 kW
  // R175-2 II 3° : > 70 kW ET PC déposé après le 08/04/2024 → dès la mise en
  // service, avec obligation de relier TOUS les systèmes techniques.
  if (pcAfter('2024-04-08')) {
    return { status: 'subject_immediate', deadline: buildingPermitDate, scope: 'all_connected', basis: 'R175-2 II 3°' };
  }
  // R175-2 II 4° : autres > 70 kW → lors du renouvellement du système, au
  // plus tard le 1er janvier 2030 (report 2027→2030, JO du 26/12/2025).
  return { status: 'subject_2030', deadline: '2030-01-01', basis: 'R175-2 II 4°' };
}

module.exports = {
  POWER_CALC_TYPE_LABEL,
  POWER_EXCLUSION_REASON_LABEL,
  inferPowerCalculationType,
  devicePowerContribution,
  computeAutoPower,
  resolveTotalPower,
  recomputeAndPersistAuditPower,
  computeBacsApplicabilityFromPower,
};
