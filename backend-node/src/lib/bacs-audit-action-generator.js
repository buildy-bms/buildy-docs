'use strict';

/**
 * Genere les actions correctives `bacs_audit_action_items` a partir des
 * donnees de l'audit BACS (systems / meters / bms / thermal_regulation).
 *
 * Idempotent : les items auto-generes sont identifies par la combinaison
 * (FK source non-NULL, source_subtype). Si la donnee source change,
 * l'item est mis a jour. Si la source est resolue (gap comble), l'item
 * passe en done. Si la source est hard-deletee, l'item disparait via FK
 * ON DELETE CASCADE (mig 125).
 *
 * Items manuels (auto_generated=0) ne sont jamais touches.
 *
 * Annotations commerciales (commercial_notes, estimated_effort, status hors
 * 'open'/'done') sont preservees entre regenerations.
 *
 * Regles de generation : cf plan section "Generation automatique des
 * actions correctives" + extensions cohérence inventaire equipments.
 */

const db = require('../database');
const log = require('./logger').system;
const { isTrue, isFalse } = require('../routes/bacs-audit/_ternary');
const { resolveEmissionGranularity, GRANULARITY_R175_COMPLIANT } = require('./regulation-defaults');
const {
  BUILDY_OFFER_LEVEL_LABEL, isBuildyOfferLevel, buildyReserves, effectiveBuildyBms,
} = require('./buildy-cloud-preset');
const { computeAutoPower, loadPowerDevices } = require('./bacs-audit-power');
const { deviceOutOfGtbScope } = require('./bacs-gtb-scope');
const { computeFunctionalZones, mergedMeterRoles } = require('./bacs-functional-zones');
const {
  deviceRoleArr, deviceCommState, systemInteropStatus,
} = require('../routes/bacs-audit/_interop');

// Mappings FR pour les libellés affichés dans les actions correctives
// (utilisés dans tout le code BACS — détail view, action items view, PDF).
const SYSTEM_LABEL_FR = {
  heating: 'chauffage',
  cooling: 'refroidissement',
  ventilation: 'ventilation',
  dhw: 'eau chaude sanitaire',
  lighting_indoor: 'éclairage intérieur',
  lighting_outdoor: 'éclairage extérieur',
  electricity_production: 'production photovoltaïque',
};
// Label naturel pour les titres d'actions : « le système de chauffage »
// vs « le système d'eau chaude sanitaire » (apostrophe quand la categorie
// commence par voyelle). Evite les tournures bancales « de eau chaude »
// generees par concatenation brute. Cf. retour Kevin 2026-05-29.
function systemTitleLabel(systemCategory) {
  const cat = SYSTEM_LABEL_FR[systemCategory] || systemCategory || '';
  if (!cat) return 'le système';
  // Apostrophe si la categorie commence par voyelle / h muet (en pratique
  // « eau chaude sanitaire », « éclairage intérieur », « éclairage extérieur »).
  if (/^[aeiouhéèà]/i.test(cat)) return `le système d'${cat}`;
  return `le système de ${cat}`;
}
// Formate la zone en suffixe lisible : « (zone Bureaux) » plutot que
// «  en zone « Bureaux » » (guillemets francais qui detonnent dans un
// titre court).
function zoneSuffix(zoneName) {
  if (!zoneName || !zoneName.trim()) return '';
  return ` (zone ${zoneName.trim()})`;
}
const METER_TYPE_LABEL_FR = {
  electric: 'électrique',
  electric_production: 'électrique de production',
  gas: 'gaz',
  water: 'eau',
  thermal: 'thermique',
  other: 'autre',
};
const METER_USAGE_LABEL_FR = {
  heating: 'chauffage',
  cooling: 'refroidissement',
  ventilation: 'ventilation',
  dhw: 'eau chaude sanitaire',
  pv: 'production photovoltaïque',
  lighting: 'éclairage',
  other: 'général',
};
// Nom du compteur dans les titres d'action (« Installer un compteur de gaz… »).
const METER_NOUN_FR = {
  electric: 'compteur électrique',
  electric_production: 'compteur de production électrique',
  gas: 'compteur de gaz',
  water: 'compteur d\'eau',
  thermal: 'compteur d\'énergie thermique',
  other: 'compteur',
};
// Catégorie de système → usage de compteur (inverse de
// METER_USAGE_TO_SYSTEM_CATS, routes/bacs-audit/_shared.js).
const SYSTEM_TO_METER_USAGE = {
  heating: 'heating',
  cooling: 'cooling',
  ventilation: 'ventilation',
  dhw: 'dhw',
  lighting_indoor: 'lighting',
  lighting_outdoor: 'lighting',
  electricity_production: 'pv',
};
// Libellé d'un compteur dans un titre : « compteur de gaz — usage chauffage
// (zone Bureaux) », « compteur électrique général (bâtiment entier) ».
function meterTitleLabel(m, mergedGroupLabel = null) {
  const noun = METER_NOUN_FR[m.meter_type] || 'compteur';
  const where = mergedGroupLabel
    ? ` (zone regroupée ${mergedGroupLabel})`
    : m.zone_name && m.zone_name.trim() ? zoneSuffix(m.zone_name) : ' (bâtiment entier)';
  if (!m.usage || m.usage === 'other') return `${noun} général${where}`;
  return `${noun} — usage ${METER_USAGE_LABEL_FR[m.usage] || 'autre'}${where}`;
}

// R175-2 II — périmètre de raccordement à la GTB.
//  - Bâtiment neuf (II 1° et 3°) : tous les systèmes techniques sont reliés.
//  - Bâtiment existant (II 2° et 4°) : sont reliés d'office les systèmes de
//    chauffage ou de climatisation, combinés ou non avec une ventilation,
//    dont la puissance dépasse le seuil (290 kW pour le 2°, 70 kW pour le 4°).
//    Les autres systèmes ne le sont que si leur connexion est réalisable avec
//    un temps de retour sur investissement inférieur à dix ans, déduction
//    faite des aides publiques. Buildy ne calcule jamais ce TRI : les actions
//    sur ces systèmes deviennent des recommandations (mineures) qui rappellent
//    la condition, au lieu de non-conformités.
// Constante de doctrine : false = tous les systèmes présents traités comme
// obligatoires (comportement antérieur au 2026-09-24).
const APPLY_EXISTING_BUILDING_CONNECTION_SCOPE = true;
const CONDITIONAL_SYSTEM_NOTE = 'Condition d\'application\nBâtiment existant : le raccordement de ce système à la GTB n\'est exigé que s\'il est réalisable avec un temps de retour sur investissement inférieur à dix ans, déduction faite des aides financières publiques. Ce calcul relève d\'une étude à la charge du propriétaire (R175-2 II).';
const CONDITIONAL_METER_NOTE = 'Condition d\'application\nBâtiment existant : ce comptage n\'est exigé que si le raccordement à la GTB des systèmes concernés est réalisable avec un temps de retour sur investissement inférieur à dix ans, déduction faite des aides financières publiques. Ce calcul relève d\'une étude à la charge du propriétaire (R175-2 II).';

/**
 * Portée de raccordement R175-2 II d'un audit : quels systèmes (et
 * compteurs) sont reliés d'office, lesquels le sont sous condition de TRI.
 * Inactive (tout obligatoire) pour un bâtiment neuf, un statut inconnu ou
 * si APPLY_EXISTING_BUILDING_CONNECTION_SCOPE vaut false.
 */
function buildConnectionScope(documentId, applicabilityStatus) {
  const existing = applicabilityStatus === 'subject_2025' || applicabilityStatus === 'subject_2030';
  if (!APPLY_EXISTING_BUILDING_CONNECTION_SCOPE || !existing) {
    return {
      active: false, heatingMandatory: true, coolingMandatory: true,
      systemIsConditional: () => false, systemMandatoryNote: () => null, systemReversibleNote: () => null, meterMandatoryNote: () => null,
    };
  }
  const threshold = applicabilityStatus === 'subject_2025' ? 290 : 70;
  const auto = computeAutoPower(loadPowerDevices(db.db, documentId));
  const heatAbove = auto.heatKw > threshold;
  const coolAbove = auto.coolKw > threshold;
  // Un côté dont un équipement n'a pas de puissance saisie pourrait franchir
  // le seuil : il reste obligatoire (on ne conclut pas sur une donnée
  // manquante). Si aucun côté ne franchit le seuil d'après le cumul
  // (puissance déclarée à la main, assujettissement présumé), on ne sait pas
  // lequel porte l'assujettissement : les deux restent obligatoires.
  const heatUnknownNames = [];
  const coolUnknownNames = [];
  for (const d of auto.devices) {
    if (!d._power?.inScope || d.is_backup) continue;
    if (Number(d.power_kw) > 0 || Number(d.power_kw_cooling) > 0) continue;
    const name = d.name || 'équipement sans nom';
    if (d.system_category === 'heating') heatUnknownNames.push(name);
    else if (d.system_category === 'cooling') coolUnknownNames.push(name);
    else if (d.system_category === 'ventilation') { heatUnknownNames.push(name); coolUnknownNames.push(name); }
  }
  const heatUnknown = heatUnknownNames.length > 0;
  const coolUnknown = coolUnknownNames.length > 0;
  const neitherAbove = !heatAbove && !coolAbove;
  const heatingMandatory = heatAbove || heatUnknown || neitherAbove;
  const coolingMandatory = coolAbove || coolUnknown || neitherAbove;
  // Ventilation « combinée » : ses équipements portent une puissance chaud
  // ou froid comptée au cumul (batterie de CTA) → même portée que le côté
  // chaud ou froid qu'elle sert.
  // Contributions chaud / froid par système, y compris vers les systèmes où
  // l'équipement est PARTAGÉ (split réversible rattaché au chauffage et
  // partagé vers la climatisation d'une zone) : sinon deux zones équipées des
  // mêmes unités réversibles recevaient des portées différentes (R3 N-M1).
  const extrasByDevice = new Map();
  for (const e of db.bacsAuditDeviceSharedSystems.listExtrasForDocument(documentId)) {
    if (!extrasByDevice.has(e.device_id)) extrasByDevice.set(e.device_id, []);
    extrasByDevice.get(e.device_id).push(e.system_id);
  }
  const thermalBySystem = new Map();
  for (const d of auto.devices) {
    if (!d._power?.inScope) continue;
    for (const sid of [d.system_id, ...(extrasByDevice.get(d.id) || [])]) {
      const cur = thermalBySystem.get(sid) || { heat: 0, cool: 0 };
      cur.heat += d._power.heat || 0;
      cur.cool += d._power.cool || 0;
      thermalBySystem.set(sid, cur);
    }
  }
  function systemIsConditional(s) {
    // Machine réversible : un système de climatisation dont les équipements
    // portent aussi une puissance chaud (split réversible partagé vers le
    // chauffage) suit la portée du chauffage, et inversement (R1 M7).
    const t = thermalBySystem.get(s.id) || { heat: 0, cool: 0 };
    if (s.system_category === 'heating') return !(heatingMandatory || (t.cool > 0 && coolingMandatory));
    if (s.system_category === 'cooling') return !(coolingMandatory || (t.heat > 0 && heatingMandatory));
    if (s.system_category === 'ventilation') {
      return !((t.heat > 0 && heatingMandatory) || (t.cool > 0 && coolingMandatory));
    }
    // Eau chaude sanitaire, éclairage, production d'électricité.
    return true;
  }
  // Côté chaud ou froid tenu pour obligatoire SANS franchir le seuil d'après
  // le cumul (puissance manquante, ou aucun côté au-delà du seuil) : le
  // rapport le dit, sinon le lecteur voit « 214 kW < 290 kW » et une action
  // obligatoire sans explication (relecture clarté R2 C3).
  const fmtKw = (v) => `${String(Math.round((Number(v) || 0) * 10) / 10).replace('.', ',')} kW`;
  const names = (list) => {
    const uniq = [...new Set(list)];
    return uniq.length <= 3 ? uniq.join(', ') : `${uniq.slice(0, 3).join(', ')} et ${uniq.length - 3} autre${uniq.length - 3 > 1 ? 's' : ''}`;
  };
  function sideNote(side) {
    const above = side === 'heat' ? heatAbove : coolAbove;
    if (above) return null;
    const label = side === 'heat' ? 'chauffage' : 'climatisation';
    const kw = side === 'heat' ? auto.heatKw : auto.coolKw;
    const unknown = side === 'heat' ? heatUnknownNames : coolUnknownNames;
    if (unknown.length) {
      return `La puissance de ${label} relevée (${fmtKw(kw)}) ne dépasse pas le seuil de ${threshold} kW, mais la puissance de ${new Set(unknown).size > 1 ? 'plusieurs équipements' : 'l\'équipement'} ${names(unknown)} n'est pas relevée. Tant qu'elle n'est pas complétée, le raccordement de ce système est présenté comme exigé (R175-2 II).`;
    }
    if (neitherAbove) {
      return `Les puissances relevées (chauffage ${fmtKw(auto.heatKw)}, climatisation ${fmtKw(auto.coolKw)}) ne dépassent pas le seuil de ${threshold} kW, alors que le bâtiment est déclaré assujetti : faute de savoir lequel de ces usages porte l'assujettissement, le raccordement du chauffage et de la climatisation est présenté comme exigé (R175-2 II).`;
    }
    return null;
  }
  function systemMandatoryNote(s) {
    if (systemIsConditional(s)) return null;
    const t = thermalBySystem.get(s.id) || { heat: 0, cool: 0 };
    const viaHeat = s.system_category === 'heating' || t.heat > 0;
    const viaCool = s.system_category === 'cooling' || t.cool > 0;
    // Relié d'office par un côté qui franchit réellement le seuil : rien à
    // signaler.
    if ((viaHeat && heatAbove) || (viaCool && coolAbove)) return null;
    if (viaHeat && heatingMandatory) { const n = sideNote('heat'); if (n) return n; }
    if (viaCool && coolingMandatory) { const n = sideNote('cool'); if (n) return n; }
    return null;
  }
  // Système de climatisation relié d'office parce que ses unités assurent
  // aussi le chauffage (et inversement) : le rapport le dit (R3 N-M1).
  function systemReversibleNote(s) {
    if (systemIsConditional(s)) return null;
    const t = thermalBySystem.get(s.id) || { heat: 0, cool: 0 };
    if (s.system_category === 'cooling' && !coolingMandatory && t.heat > 0 && heatingMandatory) {
      return `Ces unités réversibles assurent aussi le chauffage, dont la puissance dépasse le seuil de ${threshold} kW ; leur raccordement est donc exigé (R175-2 II).`;
    }
    if (s.system_category === 'heating' && !heatingMandatory && t.cool > 0 && coolingMandatory) {
      return `Ces unités réversibles assurent aussi la climatisation, dont la puissance dépasse le seuil de ${threshold} kW ; leur raccordement est donc exigé (R175-2 II).`;
    }
    // Ventilation combinée (batterie alimentée par le générateur de chauffage
    // ou de climatisation) : même portée que le système qu'elle combine.
    if (s.system_category === 'ventilation') {
      if (t.heat > 0 && heatingMandatory) return 'Ventilation combinée au chauffage (batterie alimentée par le générateur de chauffage) ; son raccordement est donc exigé au même titre que le chauffage (R175-2 II).';
      if (t.cool > 0 && coolingMandatory) return 'Ventilation combinée à la climatisation (batterie alimentée par le générateur de froid) ; son raccordement est donc exigé au même titre que la climatisation (R175-2 II).';
    }
    return null;
  }
  function meterMandatoryNote(usage) {
    if (usage === 'heating') return heatingMandatory ? sideNote('heat') : null;
    if (usage === 'cooling') return coolingMandatory ? sideNote('cool') : null;
    return null;
  }
  return { active: true, heatingMandatory, coolingMandatory, systemIsConditional, systemMandatoryNote, systemReversibleNote, meterMandatoryNote };
}

// Item 10 — Contre-indications de pilotage par type d'équipement.
// Chaque code bloque un certain type d'action R175-3 §4 (coupure /
// arrêt manuel) et génère à la place un encart informatif.
// Map code → { label (texte affiché dans l'action informative),
//   blocksCutPower (true = bloque l'action « arrêt manuel ») }.
const CONTRAINDICATION_INFO = {
  do_not_cut_power_thermodynamic: {
    label: 'Équipement thermodynamique : ne pas couper l\'alimentation électrique en cours de fonctionnement (lubrification du compresseur). Privilégier un arrêt piloté par la régulation.',
    blocksCutPower: true,
  },
  do_not_cut_power_winter_boiler: {
    label: 'Chaudière en période hivernale : ne pas couper l\'alimentation (perte de la protection hors-gel). L\'arrêt doit rester piloté.',
    blocksCutPower: true,
  },
  legionella_loop_ecs: {
    label: 'Boucle ECS : l\'arrêt est interdit (arrêté du 30 novembre 2005 — risque légionelle). Surveiller la température de bouclage.',
    blocksCutPower: true,
  },
  continuous_ventilation_required: {
    label: 'Ventilation en continu requise (EHPAD, hôpitaux, sanitaires) : ne pas programmer d\'arrêt — qualité d\'air et hygiène.',
    blocksCutPower: true,
  },
  aci_tank_no_long_cut: {
    label: 'Ballon ECS à anode à courant imposé (ACI) : pas de coupure prolongée (> 8 h) — perte de la protection anti-corrosion.',
    blocksCutPower: true,
  },
  circulator_degommage: {
    label: 'Circulateur avec fonction de dégommage : ne pas couper en été — perte de la protection anti-grippage.',
    blocksCutPower: true,
  },
  lighting_already_optimized: {
    label: 'Éclairage déjà optimisé (détection de présence + LED récentes) : généraliser une commande BACS n\'apporte pas de gisement d\'économies.',
    blocksCutPower: false,
  },
};

/**
 * Charge les contre-indications BACS d'un device via son modèle
 * d'équipement de la bibliothèque (`equipment_template_id`, mig 145+154).
 * Retourne un tableau de codes (vide si non rattaché ou non renseigné).
 */
function loadContraindications(equipmentTemplateId) {
  if (!equipmentTemplateId) return [];
  try {
    const row = db.db.prepare(
      'SELECT bacs_contraindications FROM equipment_templates WHERE id = ?'
    ).get(equipmentTemplateId);
    if (!row || !row.bacs_contraindications) return [];
    const parsed = JSON.parse(row.bacs_contraindications);
    return Array.isArray(parsed) ? parsed.filter(c => typeof c === 'string') : [];
  } catch { return []; }
}

// Cle d'idempotence : derivee de la FK source non-NULL (1 max parmi 6)
// + source_subtype. Permet le matching `existingByKey` sur regen.
function keyOfItem(item) {
  if (item.source_system_id != null)        return `s:${item.source_system_id}:${item.source_subtype || ''}`;
  if (item.source_meter_id != null)         return `m:${item.source_meter_id}:${item.source_subtype || ''}`;
  if (item.source_thermal_id != null)       return `t:${item.source_thermal_id}:${item.source_subtype || ''}`;
  if (item.source_device_id != null)        return `d:${item.source_device_id}:${item.source_subtype || ''}`;
  if (item.source_inspection_id != null)    return `i:${item.source_inspection_id}:${item.source_subtype || ''}`;
  if (item.source_bms_document_id != null)  return `b:${item.source_bms_document_id}:${item.source_subtype || ''}`;
  // Item synthetique sans FK (ex : inspection 'no_inspection')
  return `_:${item.source_subtype || ''}`;
}

/**
 * Construit la liste cible d'actions a poser pour un document.
 * Retourne un Map<key, item> ou key = keyOfItem(item).
 * `details` (optionnel) recoit `meters` : statut de chaque compteur au regard
 * du plan (cf. computeMeterPlanStatus).
 */
function computeTargetActions(documentId, details = null) {
  const target = new Map();
  function addTarget(item) {
    target.set(keyOfItem(item), item);
  }

  const doc = db.db.prepare(
    'SELECT bacs_applicability_status FROM afs WHERE id = ?'
  ).get(documentId) || {};
  // Bâtiment non assujetti (R175-2 I : puissance ≤ 70 kW) : aucune
  // obligation R175-3 à R175-5-1 ne s'applique. Seule la régulation R175-6,
  // indépendante de l'assujettissement, reste évaluée plus bas.
  const notSubject = doc.bacs_applicability_status === 'not_subject';
  const scope = buildConnectionScope(documentId, doc.bacs_applicability_status || null);
  // Supervision Buildy : les champs qui découlent du niveau d'offre prennent
  // la valeur du modèle, même sur une fiche pré-remplie avant un changement
  // de doctrine (cf. effectiveBuildyBms).
  const bms = effectiveBuildyBms(db.db.prepare('SELECT * FROM bacs_audit_bms WHERE document_id = ?').get(documentId));
  // present === 0 : aucune GTB sur site.
  const noGtb = !!bms && bms.present === 0;
  // Périmètre GTB déclaré par l'auditeur (usages traités + exception par
  // équipement, lib/bacs-gtb-scope.js) : il ne réduit pas le périmètre du
  // décret. Un équipement d'un usage que la GTB ne traite pas est « non
  // relié » (deviceOutOfGtbScope, relecture juridique R1 M4).

  // Systems (R175-1 §4 + R175-3 §3 + §4). Les usages manuels non BACS
  // (is_bacs=0) sont hors décret → exclus du scoring (mig 144).
  const systems = db.db.prepare(`
    SELECT s.*, z.name AS zone_name FROM bacs_audit_systems s
    LEFT JOIN zones z ON z.id = s.zone_id
    WHERE s.document_id = ? AND s.is_bacs = 1
  `).all(documentId);
  // Couples (zone, usage de compteur) lus par la boucle des compteurs :
  // systèmes exemptés (règle des 5 %) et systèmes reliés d'office.
  const exemptedMeterKeys = new Set();
  const seenMeterKeys = new Set();
  const mandatoryMeterKeys = new Set();
  // Portée « réversible » (unités qui assurent aussi l'autre usage) reprise
  // sur les compteurs de la zone et de l'usage.
  const reversibleNoteByMeterKey = new Map();
  // Systèmes dont tous les équipements sont déclarés « non concernés par
  // l'intégration à la GTB » (décision de l'auditeur) et systèmes évalués :
  // un compteur n'est pas exigé pour un usage entièrement exempté ou exclu
  // (R3 N-M3).
  const excludedMeterKeys = new Set();
  const evaluatedMeterKeys = new Set();
  // Systèmes sans équipement propre, alimentés uniquement par des équipements
  // partagés depuis des systèmes exemptés (règle des 5 %) : exemptés eux aussi
  // pour le comptage (R3 N-M3).
  const exemptSystemIds = new Set(systems.filter(x => isTrue(x.present) && isTrue(x.marked_negligible_under_5pct)).map(x => x.id));
  const ownDeviceCount = new Map();
  const sharedOrigins = new Map();
  for (const r of db.db.prepare(`
    SELECT d.id, d.system_id FROM bacs_audit_system_devices d
    JOIN bacs_audit_systems s ON s.id = d.system_id WHERE s.document_id = ?
  `).all(documentId)) {
    ownDeviceCount.set(r.system_id, (ownDeviceCount.get(r.system_id) || 0) + 1);
  }
  const deviceOrigin = new Map(db.db.prepare(`
    SELECT d.id, d.system_id FROM bacs_audit_system_devices d
    JOIN bacs_audit_systems s ON s.id = d.system_id WHERE s.document_id = ?
  `).all(documentId).map(r => [r.id, r.system_id]));
  for (const e of db.bacsAuditDeviceSharedSystems.listExtrasForDocument(documentId)) {
    if (!sharedOrigins.has(e.system_id)) sharedOrigins.set(e.system_id, []);
    sharedOrigins.get(e.system_id).push(deviceOrigin.get(e.device_id));
  }
  const exemptByOrigin = (s) => !ownDeviceCount.get(s.id)
    && (sharedOrigins.get(s.id) || []).length > 0
    && sharedOrigins.get(s.id).every(o => exemptSystemIds.has(o));

  for (const s of notSubject ? [] : systems) {
    const catFr = SYSTEM_LABEL_FR[s.system_category] || 'système technique';
    const zoneStr = zoneSuffix(s.zone_name);

    // Système absent → R175-1 §4 (plusieurs sources_id par paire systemId pour
    // ne pas se recouvrir avec les autres règles ci-dessous)
    // NE PLUS générer d'action "Ajouter un système de X" si la catégorie
    // n'est pas marquée présente : la matrice nature_zone est purement
    // indicative, pas prescriptive. Un audit ne génère d'action que sur
    // ce qui a été observé en panne (cf retour Kevin v2.7).
    // Si l'auditeur veut signaler une absence problématique, il ajoute
    // une action manuelle via la vue commerciale.
    // present est ternaire : null (non répondu) et 0 (absent) skippent
    // tous les deux — on ne génère d'action que sur du constaté présent.
    if (!isTrue(s.present)) continue;

    const meterKey = `${s.zone_id ?? ''}|${SYSTEM_TO_METER_USAGE[s.system_category] || s.system_category}`;
    // Portée R175-2 II : système relié d'office, ou sous condition de TRI
    // (bâtiment existant) → recommandation mineure qui rappelle la condition.
    const sysConditional = scope.systemIsConditional(s);
    const sysMandatoryNote = scope.systemMandatoryNote(s);
    const sysReversibleNote = scope.systemReversibleNote(s);
    const sevFor = (severity) => (sysConditional ? 'minor' : severity);
    const withScopeNote = (description) => (sysConditional
      ? `${description}\n\n${CONDITIONAL_SYSTEM_NOTE}`
      : sysMandatoryNote ? `${description}\n\nPortée à confirmer\n${sysMandatoryNote}`
        : sysReversibleNote ? `${description}\n\nPortée du raccordement\n${sysReversibleNote}` : description);

    // Item 1 — Règle des 5 % : si l'auditeur a marqué le système comme
    // négligeable (< 5 % de la consommation totale, FAQ n° 16), on ne génère
    // AUCUNE action R175-3 dessus, ni sur ses compteurs. Une information
    // trace l'exemption (bloc « Exemptions et points de vigilance » du PDF).
    if (isTrue(s.marked_negligible_under_5pct)) {
      exemptedMeterKeys.add(meterKey);
      const justif = (s.negligible_justification || '').trim();
      addTarget({
        source_system_id: s.id, source_subtype: 'negligible_5pct',
        category: 'other', severity: 'minor',
        r175_article: 'R175-2 II',
        title: `Système exempté de raccordement : ${catFr}${zoneStr}, impact inférieur à 5 %`,
        description: `Le raccordement de ce système à la GTB n'est pas exigé lorsque les consommations d'énergie effectives et induites (par exemple, les pertes thermiques par extraction pour la ventilation) de l'ensemble des équipements régulés par la même fonction représentent moins de 5 % de la consommation d'énergie totale du bâtiment. Cette part s'apprécie sur tous les équipements concernés du bâtiment, et non système par système (FAQ ministérielle n° 16, non opposable).${justif ? ` Justification relevée lors de l'audit : ${justif}` : ''}`,
        zone_id: s.zone_id, equipment_id: s.equipment_id,
      });
      continue;
    }
    if (exemptByOrigin(s)) {
      exemptedMeterKeys.add(meterKey);
      continue;
    }
    seenMeterKeys.add(meterKey);
    if (!sysConditional) mandatoryMeterKeys.add(meterKey);
    if (sysReversibleNote) reversibleNoteByMeterKey.set(meterKey, sysReversibleNote);

    // Système présent + non communicant (legacy : communication saisie au
    // niveau du système, plus proposée par l'interface).
    if (s.communication === 'non_communicant') {
      addTarget({
        source_system_id: s.id, source_subtype: 'non_communicant',
        category: 'communication_upgrade', severity: sevFor('major'),
        r175_article: 'R175-3 3°',
        title: `Rendre communicant ${systemTitleLabel(s.system_category)}${zoneStr}`,
        description: withScopeNote('Aucun équipement de ce système ne dispose d\'une interface de communication. Le décret n\'impose pas de protocole particulier : un protocole normalisé, une interface de programmation (API) ou une passerelle conviennent (R175-3 3°).'),
        zone_id: s.zone_id, equipment_id: s.equipment_id,
      });
    }

    // Refonte 2026-05-29 — R175-3 §3 et §4 evalues au niveau SYSTEME
    // (et plus device par device). Lecture stricte du decret : le texte
    // demande l'interoperabilite du BACS avec les SYSTEMES TECHNIQUES,
    // pas de chaque equipement individuel. Les emetteurs (radiateurs,
    // panneaux rayonnants, ventilo-convecteurs passifs) sous regulation
    // autonome (vanne thermostatique mecanique) restent conformes R175-6
    // — le decret n'impose pas leur communication.
    //
    // Cf. CSV ISO 52120-1 fonction 1.1.2 (Regulation individuelle par
    // piece) classe C : « L'interconnexion de la regulation terminale
    // avec le systeme de GTB est interessant a etudier mais n'est pas
    // imposee par le decret BACS. »
    //
    // Les devices Hors-Service sont ignores. Le device_role est lu pour
    // identifier le ou les equipements pertinents pour l'interoperabilite
    // du systeme (production / distribution / regulation, pas emission).
    // Équipements du système. Le périmètre GTB déclaré ne réduit PAS le
    // périmètre du décret (R175-2 II) : un équipement d'un usage que la GTB
    // en place ne traite pas est « non relié » (outOfScope ci-dessous), et
    // sa portée (obligatoire / sous condition de TRI) fixe la sévérité.
    const sysDevices = db.db.prepare(`
      SELECT id, name, brand, model_reference, communication_protocol,
             communication_protocols, is_communicating, wired,
             meets_r175_3_p4, meets_r175_3_p4_autonomous, out_of_service,
             managed_by_bms, bms_integration_out_of_service, equipment_template_id,
             device_role, regulation_integrated, regulation_type_emission,
             gtb_scope_override
      FROM bacs_audit_system_devices WHERE system_id = ?
    `).all(s.id);
    const interopOpts = {
      noGtb,
      category: s.system_category,
      outOfScope: (d) => deviceOutOfGtbScope(bms, d, s.system_category),
    };

    // Item 3 — ECS bouclée : point de vigilance sanitaire (information, pas
    // une action). Le décret ne prévoit aucune exemption : l'arrêt manuel
    // reste évalué, mais les commandes d'arrêt de la GTB doivent respecter
    // les températures de l'arrêté du 30 novembre 2005 (guide PROFEEL).
    const ecsLooped = s.system_category === 'dhw' && s.is_looped === 'looped';
    if (ecsLooped) {
      addTarget({
        source_system_id: s.id, source_subtype: 'ecs_looped_legionella',
        category: 'other', severity: 'minor',
        r175_article: null,
        title: `Boucle d'eau chaude sanitaire${zoneStr} : point de vigilance sanitaire`,
        description: 'Ce système d\'eau chaude sanitaire est bouclé. En période d\'occupation, et dans les 24 heures qui précèdent l\'utilisation, les températures de production et de distribution fixées par l\'arrêté du 30 novembre 2005 doivent être respectées. Un arrêt n\'est envisageable que pendant une inoccupation de plusieurs semaines, suivi d\'une remise en service selon les recommandations sanitaires (purge, rinçage, contrôle des températures, analyses). Les commandes d\'arrêt ou de réduction pilotées par la GTB en tiennent compte (guide PROFEEL, non opposable).',
        zone_id: s.zone_id, equipment_id: s.equipment_id,
      });
    }

    // Communication, pertinence et voie GTB d'un équipement : source unique
    // partagée avec le verdict par système du PDF (routes/bacs-audit/_interop.js).
    const commState = deviceCommState;

    // Liaison GTB interrompue (device fonctionnel mais GTB ne le voit pas).
    // Conservee au niveau device : c'est une action de reparation ciblee,
    // pas une exigence d'interoperabilite globale du systeme.
    for (const d of sysDevices) {
      if (isTrue(d.out_of_service)) continue;
      if (isTrue(d.managed_by_bms) && isTrue(d.bms_integration_out_of_service)) {
        // Réparation d'une liaison existante (R175-4) : sans condition de TRI.
        addTarget({
          source_device_id: d.id, source_subtype: 'bms_link_broken',
          category: 'bms_upgrade', severity: 'major',
          r175_article: 'R175-3 3°',
          title: `Rétablir la liaison GTB de {{device:${d.id}}}`,
          description: 'L\'équipement est intégré à la GTB, mais la liaison est interrompue (paramétrage ou communication). Un diagnostic puis une reconfiguration de la liaison sont à prévoir : les éléments défaillants sont à réparer rapidement (R175-3 3°, R175-4).',
          zone_id: s.zone_id, equipment_id: null,
        });
      }
    }

    // R175-3 3° — interoperabilite SYSTEME (source unique _interop.js) :
    // chaque generateur communique avec la GTB, directement ou via un
    // regulateur raccorde qui le pilote (PROFEEL) ; sans generateur dans le
    // systeme, un equipement pertinent raccorde suffit. Reponses manquantes
    // → pas de conclusion (principe ternaire, incident Communay).
    const interop = systemInteropStatus(sysDevices.filter(d => !isTrue(d.out_of_service)), interopOpts);
    const relevantActive = interop.relevant;
    // Un système qui reçoit aussi un équipement partagé (générateur d'un autre
    // système) reste évalué pour le comptage : son usage consomme par ce
    // générateur (même règle que le chapitre 4 du PDF).
    const fullyExcluded = interop.verdict === 'na'
      && sysDevices.some(d => !isTrue(d.out_of_service) && isFalse(d.gtb_scope_override))
      && !(sharedOrigins.get(s.id) || []).length;
    if (fullyExcluded) excludedMeterKeys.add(meterKey); else evaluatedMeterKeys.add(meterKey);
    if (interop.verdict === 'fail') {
      // Balises {{type:id}} resolues en pilules cliquables cote UI et en
      // pilules visuelles SVG FontAwesome cote PDF.
      // Structure description : sections "Titre\nContenu" separees par
      // \n\n. ActionDescription.vue / stripActionTags() rendent les titres
      // en sous-titres distinctifs.
      // On NOMME les équipements concernés (les vrais porteurs de la
      // communication) plutôt que le système abstrait, et on résout
      // CONCRÈTEMENT les émetteurs passifs exclus (retour Kévin 2026-07-04) :
      // le décret parle de « systèmes interopérables », mais ce sont les
      // équipements qui communiquent ou non — l'utilisateur doit voir lesquels.
      const targets = interop.targets; // générateurs (ou équipements) sans voie GTB
      const targetTags = targets.map(d => `{{device:${d.id}}}`).join(', ');
      const tagsOf = (list) => list.map(d => `{{device:${d.id}}}`).join(', ');
      const noInterface = targets.filter(d => commState(d) === 'no');
      const outOfGtbScope = noGtb ? [] : targets.filter(d => commState(d) !== 'no' && interopOpts.outOfScope(d));
      const notLinked = targets.filter(d => commState(d) !== 'no' && !outOfGtbScope.includes(d));
      // Libellé puis équipements (noms saisis par l'auditeur, sans article) :
      // « Aucune interface de communication : Chaudière » (R3 n13).
      const constatParts = [];
      if (noInterface.length) {
        constatParts.push(`Aucune interface de communication : ${tagsOf(noInterface)}`);
      }
      if (outOfGtbScope.length) {
        constatParts.push(`Non relié à la GTB, qui ne traite pas cet usage : ${tagsOf(outOfGtbScope)}`);
      }
      if (notLinked.length) {
        constatParts.push(noGtb
          ? `Relié à aucune GTB (aucune GTB n'est présente sur le site) : ${tagsOf(notLinked)}`
          : `Non relié à la GTB : ${tagsOf(notLinked)}`);
      }
      // Lecture Buildy sur les émetteurs : seulement pour le chauffage et la
      // climatisation (elle n'a pas de sens pour un éclairage ou une ECS,
      // dont les équipements eux-mêmes constituent le système).
      const thermalSystem = s.system_category === 'heating' || s.system_category === 'cooling';
      const relevantIds = new Set(relevantActive.map(d => d.id));
      const passiveEmitters = sysDevices.filter(d =>
        !isTrue(d.out_of_service) && !relevantIds.has(d.id) && deviceRoleArr(d).includes('emission'));
      const producerRule = interop.basis === 'producers'
        ? ' Chaque générateur communique avec la GTB, directement ou par un régulateur raccordé qui le pilote (guide PROFEEL).'
        : '';
      const lectureBuildy = !thermalSystem
        ? null
        : passiveEmitters.length
          ? `Lecture Buildy du décret\nL'action vise les équipements qui produisent, distribuent ou régulent l'énergie de ce système.${producerRule} Les émetteurs sans interface de communication, qui assurent une régulation locale autonome (radiateurs, ventilo-convecteurs passifs, robinets thermostatiques, thermostats intégrés), ne sont pas visés : ${tagsOf(passiveEmitters)}.`
          : `Lecture Buildy du décret\nL'action vise les équipements qui produisent, distribuent ou régulent l'énergie de ce système.${producerRule} Les émetteurs sans interface de communication (radiateurs, ventilo-convecteurs passifs, robinets thermostatiques, thermostats intégrés) ne sont pas visés.`;
      addTarget({
        source_system_id: s.id, source_subtype: 'system_not_interoperable',
        category: 'bms_upgrade', severity: sevFor('major'),
        r175_article: 'R175-3 3°',
        title: `Raccorder à la GTB : ${targetTags}`,
        description: withScopeNote([
          // Décret en tête — seule source opposable.
          'Exigence du décret\nLes systèmes d\'automatisation et de contrôle « sont interopérables avec les différents systèmes techniques du bâtiment » (R175-3 3°).',
          // Phrase qui commence par les équipements (noms propres) et nomme
          // le système en fin (relecture clarté R2 M20).
          `Constat\n${constatParts.join('. ')}. Système concerné : {{system:${s.id}}}.`,
          `Recommandation Buildy pour la conformité\nÉtablir une communication entre ${noGtb ? 'la GTB à mettre en place' : 'la GTB'} et les équipements suivants : ${targetTags}. Le décret n'impose ni solution ni composant particulier : un protocole normalisé, une interface de programmation (API) ou une passerelle conviennent. La solution la moins coûteuse est généralement :\n  • ajouter un module de communication sur le régulateur existant, s'il l'accepte (souvent le cas pour les régulateurs récents) ;\n  • à défaut, installer une passerelle de communication (un petit boîtier qui fait dialoguer l'équipement avec la supervision).\nLe raccordement permet aussi l'arrêt manuel du système depuis la GTB et préserve son fonctionnement autonome lorsque la GTB est arrêtée (R175-3 4°).`,
          lectureBuildy,
        ].filter(Boolean).join('\n\n')),
        zone_id: s.zone_id, equipment_id: s.equipment_id,
      });
    }

    // R175-3 4° — arret manuel + gestion autonome SYSTEME.
    // Lecture des sources officielles : la GTB permet d'arreter puis de
    // remettre en marche manuellement les systemes (ou de les passer en hors
    // gel) — guide PROFEEL § 3.1.2 — et les systemes relies continuent de
    // fonctionner normalement lorsque la GTB est arretee — guide du
    // ministere § 1.2 E. Aucune source n'exige un interrupteur local.
    // Le systeme satisfait le 4° si au moins UN device pertinent coche la
    // question ; action seulement si TOUS les devices pertinents repondent
    // « non » (principe ternaire). Sans GTB, l'action « installer une GTB »
    // porte deja ces fonctions : pas d'action par systeme.
    const hasManualStop = relevantActive.some(d => isTrue(d.meets_r175_3_p4));
    const hasAutonomous  = relevantActive.some(d => isTrue(d.meets_r175_3_p4_autonomous));
    const manualStopAnswered = relevantActive.length > 0 && relevantActive.every(d => isFalse(d.meets_r175_3_p4));
    const autonomousAnswered = relevantActive.length > 0 && relevantActive.every(d => isFalse(d.meets_r175_3_p4_autonomous));

    // Système non raccordé : l'action de raccordement porte aussi le 4°
    // (pas d'action 4° en doublon).
    const interopFailed = interop.verdict === 'fail';
    if (!noGtb && !interopFailed && manualStopAnswered && !hasManualStop) {
      addTarget({
        source_system_id: s.id, source_subtype: 'system_no_manual_stop',
        category: 'bms_upgrade', severity: sevFor('major'),
        r175_article: 'R175-3 4°',
        title: `Permettre l'arrêt manuel depuis la GTB : {{system:${s.id}}}`,
        description: withScopeNote([
          'Exigence du décret\nLes systèmes d\'automatisation et de contrôle « permettent un arrêt manuel et la gestion autonome d\'un ou plusieurs systèmes techniques de bâtiment » (R175-3 4°).',
          `Constat\nArrêt manuel impossible aujourd'hui depuis la GTB : ${relevantActive.map(d => `{{device:${d.id}}}`).join(', ')}. Système concerné : {{system:${s.id}}}.`,
          'Recommandation Buildy pour la conformité\nMettre en place, depuis la GTB, une commande manuelle d\'arrêt et de remise en marche (ou de mise hors gel) de ce système, en passant par sa régulation lorsqu\'elle le permet. Pour les générateurs thermodynamiques, et pour les chaudières en période de chauffe, l\'arrêt passe par la régulation et jamais par une coupure de l\'alimentation électrique (guide PROFEEL).',
        ].join('\n\n')),
        zone_id: s.zone_id, equipment_id: s.equipment_id,
      });
    }
    if (!noGtb && !interopFailed && autonomousAnswered && !hasAutonomous) {
      addTarget({
        source_system_id: s.id, source_subtype: 'system_not_autonomous',
        category: 'bms_upgrade', severity: sevFor('major'),
        r175_article: 'R175-3 4°',
        title: `Garantir le fonctionnement autonome en cas d'arrêt de la GTB : {{system:${s.id}}}`,
        description: withScopeNote([
          'Exigence du décret\nLes systèmes d\'automatisation et de contrôle permettent « la gestion autonome d\'un ou plusieurs systèmes techniques de bâtiment » (R175-3 4°). Le guide d\'application du ministère précise que les systèmes reliés doivent pouvoir continuer de fonctionner normalement lorsque la GTB est arrêtée.',
          `Constat\nNe continuent pas de fonctionner seuls lorsque la GTB est arrêtée ou que la communication est interrompue (déclaration de l'audit) : ${relevantActive.map(d => `{{device:${d.id}}}`).join(', ')}. Système concerné : {{system:${s.id}}}.`,
          'Recommandation Buildy pour la conformité\nVérifier que la régulation locale assure seule le fonctionnement du système (consignes, programmation, reprise après une coupure) lorsque la GTB est indisponible, et la paramétrer en conséquence.',
        ].join('\n\n')),
        zone_id: s.zone_id, equipment_id: s.equipment_id,
      });
    }

    // Contre-indications de pilotage par device (informatives, conservees
    // car utiles pour le traçage technique dans le PDF) : equipements qui
    // ne supportent pas de coupure brutale meme si §4 manuel s'applique.
    for (const d of sysDevices) {
      if (isTrue(d.out_of_service)) continue;
      const codes = loadContraindications(d.equipment_template_id)
        .filter(c => CONTRAINDICATION_INFO[c]?.blocksCutPower);
      // ECS bouclée : déjà couverte par le point de vigilance du système.
      if (isFalse(d.meets_r175_3_p4) && codes.length && !ecsLooped) {
        const infoText = codes.map(c => CONTRAINDICATION_INFO[c].label).join(' ');
        addTarget({
          source_device_id: d.id, source_subtype: 'contraindication_no_cut',
          category: 'other', severity: 'minor',
          r175_article: null,
          title: `Pilotage adapté requis pour {{device:${d.id}}} (contre-indication)`,
          description: `${infoText} L'arrêt manuel exigé par le décret (R175-3 4°) ne doit pas se traduire par une coupure brutale de l'alimentation de cet équipement (${catFr}${zoneStr}).`,
          zone_id: s.zone_id, equipment_id: null,
        });
      }
    }
  }

  // Meters (R175-3 1°) — données de production et de consommation
  // ÉNERGÉTIQUE : les compteurs d'eau ne sont jamais visés.
  const meters = db.db.prepare(`
    SELECT m.*, z.name AS zone_name FROM bacs_audit_meters m
    LEFT JOIN zones z ON z.id = m.zone_id
    WHERE m.document_id = ?
  `).all(documentId);
  // Portée R175-2 II d'un compteur : celle des systèmes qu'il mesure dans sa
  // zone ; à défaut (compteur général, usage sans système saisi), celle de
  // son usage.
  function meterIsConditional(m) {
    if (!scope.active) return false;
    const key = `${m.zone_id ?? ''}|${m.usage}`;
    if (seenMeterKeys.has(key)) return !mandatoryMeterKeys.has(key);
    if (m.usage === 'heating') return !scope.heatingMandatory;
    if (m.usage === 'cooling') return !scope.coolingMandatory;
    if (!m.usage || m.usage === 'other') return false;
    return true;
  }
  // Zones fonctionnelles regroupées (équipement partagé au comptage non
  // séparable) : un comptage unique suffit pour le groupe (même calcul que
  // le chapitre 2 du PDF, lib/bacs-functional-zones.js).
  const zoneDevices = db.db.prepare(`
    SELECT d.id, d.system_id, d.name, d.brand, d.metering_separable, d.metering_separable_note,
           s.system_category, s.zone_id, z.name AS zone_name
    FROM bacs_audit_system_devices d
    JOIN bacs_audit_systems s ON s.id = d.system_id
    LEFT JOIN zones z ON z.id = s.zone_id
    WHERE s.document_id = ?
  `).all(documentId);
  const extrasByDevice = new Map();
  for (const e of db.bacsAuditDeviceSharedSystems.listExtrasForDocument(documentId)) {
    if (!extrasByDevice.has(e.device_id)) extrasByDevice.set(e.device_id, []);
    extrasByDevice.get(e.device_id).push(e.system_id);
  }
  for (const d of zoneDevices) d.extra_system_ids = extrasByDevice.get(d.id) || [];
  const allSystems = db.db.prepare(`
    SELECT s.id, s.system_category, s.zone_id, z.name AS zone_name FROM bacs_audit_systems s
    LEFT JOIN zones z ON z.id = s.zone_id WHERE s.document_id = ?
  `).all(documentId);
  // Compteur d'un usage entièrement exempté (règle des 5 %) ou déclaré non
  // concerné : ni ajout ni raccordement exigés, et il ne porte pas le comptage
  // unique d'une zone regroupée.
  const meterNotRequirable = (m) => {
    const k = `${m.zone_id ?? ''}|${m.usage}`;
    return (exemptedMeterKeys.has(k) || excludedMeterKeys.has(k)) && !evaluatedMeterKeys.has(k);
  };
  const meterRoles = mergedMeterRoles(computeFunctionalZones(zoneDevices, allSystems), meters.filter(m => !meterNotRequirable(m)));
  if (details) details.meters = {};

  for (const m of notSubject ? [] : meters) {
    if (m.meter_type === 'water') continue;
    const merged = meterRoles.get(m.id) || null;
    // Compteur couvert par le comptage unique de sa zone regroupée.
    if (merged && merged.role === 'covered') {
      if (details) details.meters[m.id] = { status: 'covered', group: merged.group.label };
      continue;
    }
    const mergedLabel = merged && merged.role === 'lead' ? merged.group.label : null;
    const key = `${m.zone_id ?? ''}|${m.usage}`;
    // Compteur d'un usage exempté (règle des 5 %) ou déclaré non concerné,
    // sans autre système évalué du même usage dans la zone.
    if (meterNotRequirable(m)) {
      // Mêmes motifs, dans le même ordre, que le chapitre 4 du PDF
      // (_export-data.js, meterNotRequiredReason).
      if (details) {
        details.meters[m.id] = {
          status: 'not_required',
          reason: exemptedMeterKeys.has(key) ? 'exempt_5pct' : 'excluded_by_auditor',
        };
      }
      continue;
    }
    if (details && mergedLabel) details.meters[m.id] = { status: 'lead', group: mergedLabel };
    // Un compteur d'un usage que la GTB ne traite pas reste évalué : le
    // périmètre de la GTB ne réduit pas celui du décret (R1 M4, R2 M9).
    const conditional = meterIsConditional(m);
    const meterMandatoryNote = conditional ? null : scope.meterMandatoryNote(m.usage);
    const meterReversibleNote = conditional || meterMandatoryNote ? null : (reversibleNoteByMeterKey.get(key) || null);
    const sev = (severity) => (conditional ? 'minor' : severity);
    const note = (description) => (conditional
      ? `${description}\n\n${CONDITIONAL_METER_NOTE}`
      : meterMandatoryNote ? `${description}\n\nPortée à confirmer\n${meterMandatoryNote}`
        : meterReversibleNote ? `${description}\n\nPortée du raccordement\n${meterReversibleNote}` : description);
    const label = meterTitleLabel(m, mergedLabel);
    const isProduction = m.usage === 'pv' || m.meter_type === 'electric_production';
    const measured = isProduction ? 'cette production d\'électricité' : 'cette consommation';
    const requirement = 'La GTB suit, enregistre et analyse en continu, par zone fonctionnelle et au pas horaire, les données de production et de consommation énergétique des systèmes techniques, conservées à l\'échelle mensuelle pendant cinq ans (R175-3 1°).'
      + (mergedLabel ? ` Les zones ${mergedLabel.split(' + ').join(', ')} forment une seule zone fonctionnelle de suivi (comptage séparé non réalisable, chapitre 2) : un compteur unique suffit pour l'ensemble.` : '');
    // Compteur requis hors service : la mesure est perdue.
    if (isTrue(m.required) && isTrue(m.out_of_service)) {
      // Réparation d'un élément existant : R175-4 (« réparation rapide des
      // éléments défaillants »), sans condition de temps de retour ; un
      // compteur d'un système sous condition reste une action majeure (R3 n5).
      addTarget({
        source_meter_id: m.id, source_subtype: 'meter_out_of_service',
        category: 'meter_replacement', severity: conditional ? 'major' : 'blocking',
        r175_article: 'R175-3 1°',
        title: `Remettre en service ou remplacer le ${label}`,
        description: `Ce compteur est hors service : ${measured} n'est plus mesurée. ${requirement} Les éléments défaillants sont à réparer ou à remplacer rapidement (R175-4).`,
        zone_id: m.zone_id, equipment_id: m.equipment_id,
      });
      continue;
    }
    if (isTrue(m.out_of_service)) continue;
    // Ternaires stricts : `required=1 + present_actual=null` (non vérifié
    // sur place) ne génère PAS « Installer un compteur » — seul un constat
    // explicite d'absence (present_actual=0) le fait. Idem communicating.
    if (isTrue(m.required) && isFalse(m.present_actual)) {
      addTarget({
        source_meter_id: m.id,
        category: 'meter_addition', severity: sev('blocking'),
        r175_article: 'R175-3 1°',
        title: `Installer un ${label}`,
        description: note(`Aucun compteur ne mesure aujourd'hui ${measured}. ${requirement}`),
        zone_id: m.zone_id, equipment_id: null,
      });
    } else if (isTrue(m.required) && isTrue(m.present_actual) && isFalse(m.communicating)) {
      addTarget({
        source_meter_id: m.id,
        category: 'meter_connection', severity: sev('major'),
        r175_article: 'R175-3 1°',
        title: `Rendre communicant le ${label}`,
        description: note(`Ce compteur est présent mais ne transmet pas ses relevés : ${measured} est mesurée, mais ne peut être ni suivie au pas horaire ni archivée par la GTB. ${requirement} Un raccordement (liaison filaire ou passerelle) permet la remontée automatique des relevés.`),
        zone_id: m.zone_id, equipment_id: m.equipment_id,
      });
    } else if (isTrue(m.required) && isTrue(m.present_actual) && isTrue(m.communicating)
      && isFalse(m.managed_by_bms) && bms && isTrue(bms.present)) {
      // Compteur communicant mais non relevé par la GTB en place.
      addTarget({
        source_meter_id: m.id, source_subtype: 'meter_bms_integration',
        category: 'meter_connection', severity: sev('major'),
        r175_article: 'R175-3 1°',
        title: `Intégrer à la GTB le ${label}`,
        description: note(`Ce compteur communicant n'est pas relevé par la GTB : ${measured} n'est ni suivie au pas horaire ni archivée. ${requirement}`),
        zone_id: m.zone_id, equipment_id: m.equipment_id,
      });
    }
    // Liaison GTB du compteur interrompue (compteur intégré à la GTB, mais la
    // GTB ne le relève pas correctement) : le suivi du 1° est perdu.
    if (isTrue(m.managed_by_bms) && isTrue(m.bms_integration_out_of_service)) {
      addTarget({
        source_meter_id: m.id, source_subtype: 'bms_link_broken',
        category: 'bms_upgrade', severity: 'major',
        r175_article: 'R175-3 1°',
        title: `Rétablir la liaison GTB du ${label}`,
        description: 'Le compteur est intégré à la GTB, mais la remontée de ses relevés est interrompue (paramétrage, adresse, protocole). Un diagnostic puis une reconfiguration de la liaison sont à prévoir : les éléments défaillants sont à réparer rapidement (R175-3 1°, R175-4).',
        zone_id: m.zone_id, equipment_id: m.equipment_id,
      });
    }
  }

  // BMS (R175-3 P1-P4, R175-4, R175-5).
  // BMS = 1:1 avec l'AF, donc on rattache via source_bms_document_id =
  // documentId. Le discriminator entre les checks (P1, P2, maintenance...)
  // passe par source_subtype. Fiche GTB (bms, noGtb) chargée en tête.
  // Aucune GTB sur site → une seule action « installer une GTB » (obligation
  // d'équipement R175-2), et on saute toutes les vérifs de capacités GTB.
  if (noGtb && !notSubject) {
    const status = doc.bacs_applicability_status;
    const when = status === 'subject_2025' ? 'depuis le 1er janvier 2025'
      : status === 'subject_2030' ? 'lors du renouvellement de son système de chauffage ou de climatisation, et au plus tard le 1er janvier 2030'
      : status === 'subject_immediate' ? 'dès sa construction'
      : null;
    const obligation = when
      ? `Le bâtiment est assujetti au décret BACS : il doit être équipé d'un système d'automatisation et de contrôle ${when}, sauf si le propriétaire produit une étude établissant que cette installation n'est pas réalisable avec un temps de retour sur investissement inférieur à dix ans (R175-2).`
      : 'Un bâtiment assujetti au décret BACS (puissance de chauffage ou de climatisation supérieure à 70 kW) doit être équipé d\'un système d\'automatisation et de contrôle, sauf si le propriétaire produit une étude établissant que cette installation n\'est pas réalisable avec un temps de retour sur investissement inférieur à dix ans (R175-2).';
    addTarget({
      source_bms_document_id: documentId, source_subtype: 'no_gtb',
      category: 'bms_upgrade', severity: 'blocking',
      r175_article: 'R175-2',
      title: 'Mettre en place une GTB conforme au décret BACS',
      description: [
        'Constat\nAucune GTB n\'est présente sur le site.',
        `Exigence\n${obligation} Ce système suit les consommations, détecte les pertes d'efficacité, est interopérable avec les systèmes techniques et permet leur arrêt manuel et leur gestion autonome (R175-3).`,
        'Recommandation Buildy pour la conformité\nInstaller une GTB assurant ces fonctions. Si des automates ou régulateurs déjà en place peuvent en porter une partie, l\'intégrateur peut les réutiliser : l\'arbitrage dépend de l\'architecture déjà câblée sur le site.',
      ].join('\n\n'),
    });
  }
  // GTB présente mais hors service : aucune des fonctions du décret n'est
  // assurée. Les vérifications de capacités restent évaluées ci-dessous.
  if (!noGtb && bms && !notSubject && isTrue(bms.out_of_service)) {
    addTarget({
      source_bms_document_id: documentId, source_subtype: 'bms_out_of_service',
      category: 'bms_upgrade', severity: 'blocking',
      r175_article: 'R175-4',
      title: 'Remettre en service la GTB',
      description: [
        'Constat\nLa GTB du site est hors service : aucune des fonctions exigées par le décret (suivi des consommations, détection des pertes d\'efficacité, interopérabilité, arrêt manuel et gestion autonome) n\'est assurée.',
        'Exigence\nLa GTB fait l\'objet de vérifications périodiques en vue de garantir son maintien en bon état de fonctionnement ; les éléments défaillants sont réparés ou remplacés rapidement (R175-4).',
      ].join('\n\n'),
    });
  }
  if (!noGtb && bms && !notSubject) {
    // Supervision Buildy (doctrine validée le 2026-09-23) : conforme quel que
    // soit le niveau d'offre, SOUS RÉSERVE des obligations du niveau
    // (buildyReserves) — jamais « non conforme » à cause du niveau souscrit.
    // Les réserves (data_export_backup, maintenance) sont des obligations
    // mises en évidence dans le rapport, qui ne dégradent pas le verdict
    // (RESERVE_SUBTYPES, _compliance-summary.js).
    const buildyLevel = isBuildyOfferLevel(bms.buildy_offer_level) ? bms.buildy_offer_level : null;
    const reserves = buildyReserves(bms);
    if (reserves.some(r => r.key === 'data_export_backup')) {
      addTarget({
        source_bms_document_id: documentId, source_subtype: 'data_export_backup',
        category: 'data_retention_upgrade', severity: 'major',
        r175_article: 'R175-3 1°',
        title: 'Exporter et sauvegarder régulièrement les données de consommation depuis Hyperveez',
        description: [
          `Constat\nLa supervision Buildy Cloud du site est souscrite en niveau ${BUILDY_OFFER_LEVEL_LABEL[buildyLevel]} : elle conserve les données de consommation pendant 12 mois.`,
          'Exigence\nLes données de consommation sont conservées à l\'échelle mensuelle pendant cinq ans (R175-3 1°).',
          'Obligation à respecter\nLe propriétaire exporte depuis Hyperveez et sauvegarde régulièrement (au moins une fois par an) les données de consommation, afin de disposer de cinq ans d\'historique. Le niveau Smart de la supervision Buildy conserve ces données cinq ans sans export manuel.',
        ].join('\n\n'),
      });
    }
    if (bms.meets_r175_3_p1 === 0) {
      addTarget({
        source_bms_document_id: documentId, source_subtype: 'r175_3_p1',
        category: 'data_retention_upgrade', severity: 'blocking',
        r175_article: 'R175-3 1°',
        title: 'Mettre la GTB en conformité avec le suivi horaire des consommations',
        description: 'La GTB en place ne suit pas, n\'enregistre pas ou n\'analyse pas en continu, par zone fonctionnelle et au pas horaire, les consommations et productions d\'énergie des systèmes techniques, ou ne conserve pas ces données à l\'échelle mensuelle pendant cinq ans (R175-3 1°).',
      });
    }
    if (bms.meets_r175_3_p2 === 0) {
      addTarget({
        source_bms_document_id: documentId, source_subtype: 'r175_3_p2',
        category: 'bms_upgrade', severity: 'major',
        r175_article: 'R175-3 2°',
        title: 'Mettre en place la détection des pertes d\'efficacité énergétique',
        description: 'La GTB en place ne compare pas l\'efficacité énergétique du bâtiment à des valeurs de référence, ne détecte pas les pertes d\'efficacité des systèmes techniques ou n\'en informe pas l\'exploitant (R175-3 2°).',
      });
    }
    // NOTE : meets_r175_3_p3 et p4 sont désormais gérés au niveau des systèmes
    // (cf section systems ci-dessus), pas dans la GTB.
    // R175-4 : vérifications périodiques par un prestataire externe ou un
    // personnel interne compétent, encadrées par des consignes écrites. En
    // pratique, un contrat de maintenance. Réserve (doctrine Kévin du
    // 2026-09-23 : obligation mise en évidence, pas une non-conformité), pour
    // toutes les GTB : sur un « non » explicite, ou en Buildy Essentials sans
    // maintenance déclarée (non incluse à ce niveau).
    const maintenanceFromLevel = reserves.some(r => r.key === 'maintenance');
    if (isFalse(bms.has_maintenance_procedures) || maintenanceFromLevel) {
      addTarget({
        source_bms_document_id: documentId, source_subtype: 'maintenance',
        category: 'documentation', severity: 'major',
        r175_article: 'R175-4',
        title: 'Mettre en place la maintenance obligatoire de la GTB (contrat de maintenance ou personnel interne compétent)',
        description: [
          `Constat\n${maintenanceFromLevel && !isFalse(bms.has_maintenance_procedures)
            ? 'La maintenance de la GTB n\'est pas incluse dans le niveau Essentials de la supervision Buildy, et aucun contrat de maintenance ni personnel interne chargé des vérifications périodiques n\'est déclaré.'
            : 'Aucun contrat de maintenance ni aucune consigne écrite encadrant les vérifications périodiques de la GTB n\'ont été présentés.'}`,
          'Exigence\nLa GTB fait l\'objet de vérifications périodiques, réalisées par un prestataire externe ou par un personnel interne compétent, en vue de garantir son maintien en bon état de fonctionnement. Ces vérifications sont encadrées par des consignes écrites données au gestionnaire de la GTB : périodicité des interventions, points à contrôler, réparation rapide ou remplacement des éléments défaillants (R175-4).',
          `Obligation à respecter\nSouscrire un contrat de maintenance de la GTB${buildyLevel === 'essentials' ? ' (inclus dans les niveaux Smart et Premium de la supervision Buildy, ou auprès d\'un autre prestataire)' : ''}, ou confier ces vérifications à un personnel interne compétent, et remettre les consignes écrites au gestionnaire de la GTB.`,
        ].join('\n\n'),
      });
    }
    // R175-3 dernier alinea : mise a disposition des donnees
    if (bms.data_provision_to_manager === 0) {
      addTarget({
        source_bms_document_id: documentId, source_subtype: 'data_provision_manager',
        category: 'documentation', severity: 'major',
        // « dernier alinéa » → axe « Mise à disposition des données » du
        // tableau de bord (axisOfArticle matche /dernier|alin|donn/).
        r175_article: 'R175-3 dernier alinéa',
        title: 'Organiser la mise à disposition des données au gestionnaire du bâtiment',
        description: 'Aucune modalité de mise à disposition des données de la GTB au gestionnaire du bâtiment n\'a été présentée. Le propriétaire de la GTB, propriétaire des données produites et archivées, les met à la disposition du gestionnaire du bâtiment à sa demande (R175-3, dernier alinéa).',
      });
    }
    if (bms.data_provision_to_operators === 0) {
      addTarget({
        source_bms_document_id: documentId, source_subtype: 'data_provision_operators',
        category: 'documentation', severity: 'major',
        r175_article: 'R175-3 dernier alinéa',
        title: 'Organiser la transmission des données aux exploitants des systèmes techniques',
        description: 'Aucune modalité de transmission des données aux exploitants des systèmes techniques reliés n\'a été présentée. Le propriétaire de la GTB transmet à chacun de ces exploitants les données qui le concernent (R175-3, dernier alinéa).',
      });
    }
    // Accès gestionnaire / exploitants constaté « non » alors qu'aucune des
    // deux questions de mise à disposition n'a produit d'action : l'écart
    // du dernier alinéa est établi par ce constat.
    if (bms.gestionnaire_exploitant_access === 'no'
      && bms.data_provision_to_manager !== 0 && bms.data_provision_to_operators !== 0) {
      addTarget({
        source_bms_document_id: documentId, source_subtype: 'data_access_manager_operators',
        category: 'documentation', severity: 'major',
        r175_article: 'R175-3 dernier alinéa',
        title: 'Donner accès aux données au gestionnaire du bâtiment et aux exploitants',
        description: 'Ni le gestionnaire du bâtiment ni les exploitants des systèmes techniques n\'ont aujourd\'hui accès aux données de la GTB. Le propriétaire de la GTB met ces données à la disposition du gestionnaire du bâtiment, à sa demande, et transmet à chacun des exploitants les données qui le concernent (R175-3, dernier alinéa).',
      });
    }
    // Item 15 — GTB existante : stockage 5 ans + accès aux données (R175-3).
    // data_storage_5y_compliant = 'no' → action bloquante R175-3 1°.
    if (bms.data_storage_5y_compliant === 'no') {
      addTarget({
        source_bms_document_id: documentId, source_subtype: 'data_storage_5y',
        category: 'data_retention_upgrade', severity: 'blocking',
        r175_article: 'R175-3 1°',
        title: 'Mettre en place la conservation des données de consommation sur cinq ans',
        description: 'La GTB en place ne garantit pas la conservation des données de production et de consommation énergétique à l\'échelle mensuelle pendant cinq ans (R175-3 1°).',
      });
    }
    // data_owner_access = 'no' → action majeure R175-3 (le propriétaire est
    // propriétaire des données et doit y avoir accès).
    if (bms.data_owner_access === 'no') {
      addTarget({
        source_bms_document_id: documentId, source_subtype: 'data_owner_access',
        category: 'documentation', severity: 'major',
        r175_article: 'R175-3 dernier alinéa',
        title: 'Garantir l\'accès du propriétaire à ses données',
        description: 'Le propriétaire de la GTB n\'a pas accès aux données qu\'elle produit et archive, alors qu\'il en a la propriété (R175-3, dernier alinéa). L\'ouverture d\'un accès propriétaire auprès de l\'éditeur de la GTB permet d\'y remédier.',
      });
    }
    // export_capability = 'no' → recommandation mineure, hors décret (aucun
    // article : ne pèse sur aucune exigence du tableau de bord).
    if (bms.export_capability === 'no') {
      addTarget({
        source_bms_document_id: documentId, source_subtype: 'data_export_capability',
        category: 'data_retention_upgrade', severity: 'minor',
        r175_article: null,
        title: 'Permettre l\'export des données dans un format ouvert',
        description: 'La GTB ne permet pas d\'exporter les données dans un format ouvert (CSV ou tableur). Cette capacité n\'est pas exigée par le décret, mais facilite le suivi énergétique et les déclarations réglementaires.',
      });
    }

    // R175-5 : formation, y compris sur une supervision Buildy — l'assistance
    // intégrée à la solution ne remplace pas une formation attestée (feuille
    // d'émargement demandée à l'inspection, FAQ n° 30).
    if (bms.operator_trained === 0) {
      addTarget({
        source_bms_document_id: documentId, source_subtype: 'training',
        category: 'training', severity: 'major',
        r175_article: 'R175-5',
        title: 'Former l\'exploitant au fonctionnement et au paramétrage de la GTB',
        description: 'Aucune formation de l\'exploitant au fonctionnement de la GTB, notamment à son paramétrage, n\'a été attestée. Le propriétaire de la GTB doit veiller à cette formation ; elle se prouve par une attestation ou une feuille d\'émargement (date, participants), demandée lors de l\'inspection périodique (R175-5, FAQ n° 30).',
      });
    }
  }

  // Thermal regulation (R175-6) — applicable seulement si declencheur :
  // PC déposé après le 21/07/2021 (II 1°) OU travaux de générateur engagés à
  // compter du 21/07/2021 inclus (II 2°, « à compter d'un an après la
  // publication » du décret du 20 juillet 2020). Indépendant de
  // l'assujettissement R175-2 (vaut aussi pour un bâtiment non assujetti).
  const af = db.db.prepare('SELECT bacs_building_permit_date, bacs_generator_works_date FROM afs WHERE id = ?').get(documentId);
  const TRIGGER = '2021-07-21';
  const r175_6_byPermit = !!(af?.bacs_building_permit_date && af.bacs_building_permit_date > TRIGGER);
  const r175_6_byWorks = !!(af?.bacs_generator_works_date && af.bacs_generator_works_date >= TRIGGER);
  const r175_6_applicable = r175_6_byPermit || r175_6_byWorks;

  if (r175_6_applicable) {
    // Mig 180 : 1 ligne par système. On lit aussi le nom du système
    // (custom_label) via JOIN sur bacs_audit_systems, et les
    // regulation_type_* des devices Production / Distribution / Émission
    // (pour évaluer la conformité « régulation déclarée sur l'équipement »).
    const thermal = db.db.prepare(`
      SELECT t.*, z.name AS zone_name,
             s.custom_label AS system_label,
             s.present AS system_present,
             dProd.energy_source AS prod_energy_source,
             dProd.regulation_type_production AS prod_reg_type,
             dProd.has_regulation AS prod_has_regulation,
             dDist.regulation_type_distribution AS dist_reg_type,
             dDist.has_regulation AS dist_has_regulation,
             dEmit.regulation_type_emission AS emit_reg_type,
             dEmit.regulation_granularity AS emit_granularity,
             dEmit.has_regulation AS emit_has_regulation
      FROM bacs_audit_thermal_regulation t
      LEFT JOIN zones z ON z.id = t.zone_id
      LEFT JOIN bacs_audit_systems s ON s.id = t.system_id
      LEFT JOIN bacs_audit_system_devices dProd ON dProd.id = t.generator_device_id
      LEFT JOIN bacs_audit_system_devices dDist ON dDist.id = t.distribution_device_id
      LEFT JOIN bacs_audit_system_devices dEmit ON dEmit.id = t.emission_device_id
      WHERE t.document_id = ?
    `).all(documentId);
    for (const t of thermal) {
      // Seuls les systèmes déclarés PRÉSENTS sont évalués (parité card 06 et
      // PDF). Le resync crée d'office un système absent + sa ligne thermique
      // pour chaque zone intérieure (inventaire R175-1) : sans ce filtre, une
      // cellule sans chauffage était déclarée non conforme (audit Sénas 2026-09).
      if (t.system_id == null || !isTrue(t.system_present)) continue;
      const cat = t.category || 'heating';
      // R175-6 vise la régulation de la CHALEUR. La régulation du froid relève
      // d'un autre texte (décret n°2023-444 du 7 juin 2023) — hors du périmètre
      // de cet axe. On ne cite pas R175-6 pour un système de refroidissement.
      if (cat === 'cooling') continue;
      // Exemption R175-6 II : uniquement l'« appareil INDÉPENDANT de chauffage
      // au bois » (poêle, insert), marqué explicitement par l'auditeur via
      // generator_exempt_wood. NE PAS déduire de l'énergie : une chaudière bois
      // collective n'est pas un appareil indépendant et reste soumise.
      if (isTrue(t.generator_exempt_wood)) continue;
      // Conformité = régulation automatique PAR PIÈCE ou PAR ZONE au niveau de
      // l'ÉMISSION. Une loi d'eau de production seule ou une régulation
      // centralisée (central_only) ne satisfait PAS la granularité terminale.
      // Granularité résolue comme l'UI et le PDF : saisie explicite sur
      // l'émetteur, sinon dérivée du type (thermostat ambiant → par pièce…).
      // Sans émetteur lié, resolveEmissionGranularity renvoie central_only.
      // Émetteur lié mais régulation non renseignée (ni type, ni granularité,
      // ni « pas de régulation » explicite) : on ne conclut pas (principe
      // ternaire) — le précheck signale la saisie manquante.
      if (t.emission_device_id != null && !t.emit_granularity && !t.emit_reg_type
        && !isFalse(t.emit_has_regulation) && !t.regulation_type) continue;
      const emitGranularity = t.emission_device_id != null
        ? resolveEmissionGranularity({
            regulation_granularity: t.emit_granularity,
            regulation_type_emission: t.emit_reg_type,
          })
        : null;
      const emissionGranular = GRANULARITY_R175_COMPLIANT.has(emitGranularity)
        || GRANULARITY_R175_COMPLIANT.has(t.regulation_type); // fallback legacy (pré-mig 180)
      if (!emissionGranular) {
        const entryLabel = (t.system_label && t.system_label.trim())
          || (t.label && t.label.trim())
          || 'Chauffage';
        addTarget({
          source_thermal_id: t.id,
          category: 'thermal_regulation', severity: 'major',
          r175_article: r175_6_byPermit ? 'R175-6 II 1°' : 'R175-6 II 2°',
          title: `Réguler automatiquement la température par pièce ou par zone chauffée — ${entryLabel}${zoneSuffix(t.zone_name)}`,
          description: [
            `Le système « ${entryLabel} » ne dispose pas d'une régulation automatique de la température par pièce ou, si cela est justifié, par zone chauffée : une régulation centrale ou une loi d'eau sur la production ne suffit pas (R175-6, L. 175-2).`,
            r175_6_byPermit ? null
              : 'Pour un bâtiment existant, cette obligation porte sur les émetteurs reliés au générateur installé ou remplacé. Elle ne s\'applique pas si le propriétaire produit une étude établissant que cette installation n\'est pas réalisable avec un temps de retour sur investissement inférieur à six ans (R175-6 II 2°).',
            'Selon l\'existant, l\'intégrateur arbitre entre la mise à niveau d\'un thermostat déjà câblé, l\'ajout de robinets ou de têtes thermostatiques, un module de pilotage par la GTB ou une régulation terminale neuve.',
          ].filter(Boolean).join(' '),
          zone_id: t.zone_id,
        });
      }
    }
  }

  // R175-5-1 — inspection périodique de la GTB, à l'initiative du propriétaire
  // (tiers indépendant seulement « pertinent », FAQ n° 30 ; rapport conservé
  // 10 ans). Sans GTB sur site ou pour un bâtiment non assujetti, rien à
  // programmer. Aucune inspection tracée — y compris quand l'auditeur a coché
  // « Aucune inspection à déclarer » (GTB récente ou jamais inspectée) — :
  // RÉSERVE « Faire réaliser l'inspection », obligation du propriétaire
  // (même traitement que la maintenance R175-4 ; relectures R1 m10, R3 N-M6).
  const inspectionNa = db.db.prepare('SELECT inspection_not_applicable, inspection_not_applicable_reason FROM afs WHERE id = ?').get(documentId);
  const inspectionMarkedNa = inspectionNa && (inspectionNa.inspection_not_applicable === 1 || inspectionNa.inspection_not_applicable === true);
  if (!noGtb && !notSubject) {
   // Seules les fiches renseignées comptent (une ligne vide créée depuis
   // l'interface n'est pas une inspection tracée).
   const inspections = db.db.prepare(
    'SELECT * FROM bacs_audit_inspections WHERE document_id = ? ORDER BY COALESCE(last_inspection_date, \'1970\') DESC'
   ).all(documentId).filter(i => i.last_inspection_date || i.next_inspection_due_date
     || i.last_inspection_inspector || i.last_inspection_report_filename);
   const today = new Date().toISOString().slice(0, 10);
   if (inspections.length === 0) {
    const reason = String(inspectionNa?.inspection_not_applicable_reason || '').trim().replace(/[.\s]+$/, '');
    // Item synthetique : aucune inspection en DB, donc pas de FK.
    // source_subtype = 'no_inspection' assure l'unicite de la cle d'idempotence.
    addTarget({
      source_subtype: 'no_inspection',
      category: 'documentation', severity: 'major',
      r175_article: 'R175-5-1',
      title: 'Faire réaliser l\'inspection périodique de la GTB',
      description: [
        `Constat\n${inspectionMarkedNa
          ? `Aucune inspection périodique de la GTB n'a été déclarée lors de l'audit${reason ? ` (précision de l'auditeur : « ${reason} »)` : ''}.`
          : 'Aucune inspection périodique de la GTB n\'est tracée pour ce site.'}`,
        'Exigence\nÀ l\'initiative de son propriétaire, la GTB d\'un bâtiment assujetti est soumise à une inspection périodique (R175-5-1). Selon l\'arrêté du 7 avril 2023, la première inspection d\'une GTB en place au 8 avril 2023 était due au plus tard le 1er janvier 2025 ; sinon, elle a lieu dans les deux ans qui suivent l\'installation, puis au moins tous les cinq ans. Le rapport est remis dans le mois et conservé dix ans.',
        'Obligation à respecter\nFaire réaliser l\'inspection périodique de la GTB selon ce calendrier ; elle est distincte du présent audit. La FAQ ministérielle n° 30 (non opposable) indique qu\'il « peut être pertinent » de la confier à un tiers indépendant des fabricants et installateurs ; le décret ne l\'impose pas.',
      ].join('\n\n'),
    });
   } else {
    const latest = inspections[0];
    if (latest.next_inspection_due_date && latest.next_inspection_due_date < today) {
      const due = new Date(latest.next_inspection_due_date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
      addTarget({
        source_inspection_id: latest.id,
        category: 'documentation', severity: 'major',
        r175_article: 'R175-5-1',
        title: 'Replanifier l\'inspection périodique de la GTB (échéance dépassée)',
        description: `L'échéance de la prochaine inspection (${due}) est dépassée. L'inspection périodique de la GTB est à l'initiative du propriétaire, au moins tous les cinq ans ; son rapport est conservé dix ans (R175-5-1).`,
      });
    }
   }
  }

  return target;
}

/**
 * Regenere les action_items en preservant les annotations commerciales.
 *
 * Strategie :
 * 1. Calcule la liste cible (target).
 * 2. Pour chaque item auto existant : s'il est dans target, le mettre a jour
 *    (en preservant commercial_notes/estimated_effort/status non-open).
 *    S'il n'y est plus, le marquer status='done' (le gap a ete resolu).
 * 3. Pour chaque target absent en DB : INSERT avec status='open'.
 * 4. Items manuels (auto_generated=0) : ne pas toucher.
 *
 * Retourne { added, updated, resolved }.
 */
function regenerateActionItems(documentId) {
  // Skip pour les audits site (devis Buildy) : aucun plan d'actions
  // automatique R175 n'est pertinent — la synthese Claude porte les
  // recommandations Buildy.
  const doc = db.afs.getById(documentId);
  if (doc && doc.kind && doc.kind !== 'bacs_audit') {
    return { added: 0, updated: 0, resolved: 0 };
  }
  // Recalcule + persiste bacs_total_power_kw et le statut d'assujettissement
  // AVANT la cible : c'est le seul hook appelé après TOUTES les modifs metier
  // (device add/update/delete/move/duplicate, meter, BMS…), et la cible lit
  // le statut (non assujetti, portée de raccordement R175-2 II). Incident
  // audit Communay 2026-05-25 : bacs_total_power_kw=161.3 cached alors que
  // computeAutoPower donnait 112.
  try {
    const { recomputeAndPersistAuditPower } = require('./bacs-audit-power');
    recomputeAndPersistAuditPower(db.db, documentId);
  } catch (e) {
    log.warn(`recomputeAndPersistAuditPower échec pour #${documentId} : ${e.message}`);
  }
  const target = computeTargetActions(documentId);

  const existing = db.db.prepare(`
    SELECT id,
           source_system_id, source_meter_id, source_thermal_id,
           source_device_id, source_inspection_id, source_bms_document_id,
           source_subtype, status, category, severity, r175_article,
           title, description, zone_id, equipment_id
    FROM bacs_audit_action_items
    WHERE document_id = ? AND auto_generated = 1
  `).all(documentId);

  const existingByKey = new Map();
  for (const e of existing) {
    existingByKey.set(keyOfItem(e), e);
  }

  let added = 0, updated = 0, resolved = 0;

  // 1. Sync les items existants vs target
  for (const [key, e] of existingByKey) {
    const t = target.get(key);
    if (!t) {
      // Plus dans la cible -> gap resolu, marquer 'done'.
      // Concerne les items open/quoted/in_progress (gap résolu naturellement)
      // ET les items declined dont la source a disparu (sinon ils restent
      // orphelins et polluent les compteurs/PDF — Vague 4 item 16 de l'audit).
      // Les items déjà 'done' ne sont pas re-touchés (idempotence).
      if (e.status !== 'done') {
        db.db.prepare(`
          UPDATE bacs_audit_action_items
          SET status = 'done', updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(e.id);
        resolved++;
      }
    } else {
      // Mise a jour. L'item est de nouveau dans la cible :
      //  - s'il etait 'done' (gap precedemment resolu), le gap est RE-OUVERT
      //    -> on repasse en 'open' (sinon l'action reste invisible alors que
      //    le probleme est revenu — cf. bascule GTB presente/absente).
      //  - s'il etait 'declined' (ecarte manuellement par l'auditeur), on
      //    respecte ce choix et on le laisse 'declined' ;
      //  - 'quoted' / 'in_progress' (suivi commercial) sont conserves.
      const updateStatus = e.status === 'done' ? 'open' : e.status;
      // N'ecrit que si quelque chose change : la regeneration tourne aussi a
      // chaque export, et updated_at sert a dater les modifications du plan
      // (avertissement « note de synthese anterieure aux dernieres
      // modifications » du PDF).
      const same = (a, b) => (a ?? null) === (b ?? null);
      const changed = !same(e.category, t.category) || !same(e.severity, t.severity)
        || !same(e.r175_article, t.r175_article || null) || !same(e.title, t.title)
        || !same(e.description, t.description || null) || !same(e.zone_id, t.zone_id || null)
        || !same(e.equipment_id, t.equipment_id || null) || e.status !== updateStatus;
      if (changed) {
        db.db.prepare(`
          UPDATE bacs_audit_action_items
          SET category = ?, severity = ?, r175_article = ?, title = ?, description = ?,
              zone_id = ?, equipment_id = ?, status = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(
          t.category, t.severity, t.r175_article || null, t.title, t.description || null,
          t.zone_id || null, t.equipment_id || null, updateStatus, e.id,
        );
        updated++;
      }
    }
  }

  // 2. Insertions des nouveaux targets
  const ins = db.db.prepare(`
    INSERT INTO bacs_audit_action_items
      (document_id, category, severity, r175_article, title, description,
       zone_id, equipment_id,
       source_system_id, source_meter_id, source_thermal_id,
       source_device_id, source_inspection_id, source_bms_document_id,
       source_subtype, auto_generated, status, position)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'open', ?)
  `);
  let pos = 0;
  for (const [key, t] of target) {
    if (existingByKey.has(key)) continue;
    ins.run(
      documentId, t.category, t.severity, t.r175_article || null, t.title,
      t.description || null, t.zone_id || null, t.equipment_id || null,
      t.source_system_id || null, t.source_meter_id || null, t.source_thermal_id || null,
      t.source_device_id || null, t.source_inspection_id || null, t.source_bms_document_id || null,
      t.source_subtype || null, pos * 10,
    );
    added++;
    pos++;
  }

  log.info(`Regen action items document #${documentId} : +${added} new, ~${updated} synced, ✓${resolved} resolved`);

  return { added, updated, resolved };
}

/**
 * Statut de chaque compteur au regard du plan, pour que l'interface reste
 * alignée sur le plan d'actions et le chapitre 4 du PDF :
 * { [meterId]: { status: 'covered' | 'lead', group } | { status: 'not_required', reason } }.
 * - covered : couvert par le compteur unique de sa zone regroupée ;
 * - lead : porte le comptage unique de la zone regroupée ;
 * - not_required : usage exempté (exempt_5pct) ou équipements déclarés non
 *   concernés par l'intégration à la GTB (excluded_by_auditor).
 * Vide pour un audit GTB classique ou un bâtiment non assujetti.
 */
function computeMeterPlanStatus(documentId) {
  const doc = db.afs.getById(documentId);
  if (doc && doc.kind && doc.kind !== 'bacs_audit') return {};
  const details = {};
  computeTargetActions(documentId, details);
  return details.meters || {};
}

module.exports = { regenerateActionItems, computeTargetActions, computeMeterPlanStatus, buildConnectionScope };
