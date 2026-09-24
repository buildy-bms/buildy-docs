'use strict';

// Construction du bundle de donnees pour le PDF / preview audit BACS.
// Extraite de exports.js pour pouvoir alimenter aussi la route /preview
// (rendu HTML in-browser sans Puppeteer).

const path = require('path');
const config = require('../../config');
const db = require('../../database');
const { loadAssetDataUrl } = require('../../lib/pdf');
const { optimizeFileToDataUrl } = require('../../lib/image-optimizer');
const { buildReportAttachments } = require('./_report-attachments');
const { parseRoles } = require('../../lib/device-roles');
const { isTrue, isFalse } = require('./_ternary');
const { deviceOutOfGtbScope, deviceExcludedByAuditor } = require('../../lib/bacs-gtb-scope');
const { buildConnectionScope } = require('../../lib/bacs-audit-action-generator');
const { sortActions, groupByCard, cardOfAction, groupJustifications } = require('./_action-cards');
const { buildMeterCoverage } = require('./_meter-coverage');
const { systemInteropStatus, deviceCommState, deviceInteropState, deviceInteropContradiction, isInteropRelevant } = require('./_interop');
const { METER_USAGE_TO_SYSTEM_CATS, auditShortName } = require('./_shared');
const { SYSTEM_LABEL_FR, makePlainTagResolver } = require('./_action-tags');
const { buildSiteStaticMap, buildZonesStaticMap } = require('../../lib/static-map');
const { regulationTypeLabel, resolveEmissionGranularity } = require('../../lib/regulation-defaults');
const bacsArticlesData = require('../../seeds/bacs-articles');
// Fallback statique si la table pdf_boilerplate est vide (cas pre-migration 65).
const bacsAuditMethodologyStatic = require('../../lib/bacs-audit-methodology');
const bacsAuditDisclaimersStatic = require('../../lib/bacs-audit-disclaimers');

// pdf-charts charge chartjs-node-canvas qui pollue require.cache (entry
// undefined apres chargement → bug Fastify getPluginName quand il itere
// sur le cache pour resoudre le nom d'un plugin enregistre apres). Lazy
// require pour ne charger qu'a la 1re generation PDF, apres le boot.
let _charts = null;
function getCharts() {
  if (!_charts) _charts = require('../../lib/pdf-charts');
  return _charts;
}

// Labels d'enums extraits dans _labels.js pour partage avec _preview-fixture.js
// (l'atelier de design PDF). Source de verite des libelles FR — toute modif
// d'enum DB doit etre repercutee dans _labels.js.
const {
  SYSTEM_LABEL, SYSTEM_NEGATIVE_LABEL, COMM_LABEL, ENERGY_LABEL, ROLE_LABEL,
  METER_TYPE_LABEL, METER_USAGE_LABEL, REGULATION_LABEL, GENERATOR_LABEL,
  APPLICABILITY_LABEL, CLOSING_DEADLINE_PHRASE, COMPLIANCE_LABEL, ZONE_NATURE_LABEL, TECHNICAL_ZONE_NATURES, OCCUPANCY_PROFILE_LABEL,
  OWNERSHIP_STRUCTURE_LABEL, PARTY_KIND_LABEL,
} = require('./_labels');
const { buildComplianceSummary, isReserveAction, isInfoAction, frLongDate } = require('./_compliance-summary');
// Items 5 + 8 — cumul automatique des puissances chaud / froid.
const { computeAutoPower, resolveTotalPower, POWER_CALC_TYPE_LABEL, POWER_EXCLUSION_REASON_LABEL, SHARED_TO_HEATING_SQL } = require('../../lib/bacs-audit-power');
const {
  BUILDY_OFFER_LEVEL_LABEL, isBuildyOfferLevel, buildyReserves, effectiveBuildyBms,
} = require('../../lib/buildy-cloud-preset');
// Item 7 — calcul des zones fonctionnelles de suivi (regroupement BACS).
const { computeFunctionalZones, mergedMeterRoles } = require('../../lib/bacs-functional-zones');
// Item 4 — calcul automatique de l'assujetti par système.
const { computeSystemLiability } = require('../../lib/bacs-liability');
// Item 13 — base de consommations mensuelles de référence.
const { buildEnergyReference } = require('../../lib/bacs-energy-reference');

/**
 * Construit le bundle de donnees a passer au template bacs-audit.hbs.
 *
 * @param {object} af — la ligne `documents` (deja fetchee, kind='bacs_audit')
 * @param {object} opts
 * @param {object|null} opts.user — user courant (pour authorName)
 * @param {boolean} opts.previewMode — true pour preview HTML (skip generation chemin sortie + version mock)
 */
async function buildBacsAuditExportData(af, opts = {}) {
  const documentId = af.id;
  const { user = null, previewMode = false } = opts;

  // Donnees principales
  const site = af.site_id ? db.sites.getById(af.site_id) : null;
  // Coordonnees GPS du site, formatees pour l'info-card du chapitre 1.
  if (site && site.latitude != null && site.longitude != null) {
    site.coords_label = `${Number(site.latitude).toFixed(5)}, ${Number(site.longitude).toFixed(5)}`;
  }
  const zones = (site ? db.zones.listBySite(site.site_id) : []).map(z => ({
    ...z,
    natureLabel: z.nature ? (ZONE_NATURE_LABEL[z.nature] || z.nature) : '—',
    // Item 14 — régime d'occupation (libellé FR pour le PDF).
    occupancyLabel: z.occupancy_profile
      ? (OCCUPANCY_PROFILE_LABEL[z.occupancy_profile] || z.occupancy_profile)
      : null,
    // Distingue zones fonctionnelles BACS vs locaux techniques (tableaux
    // électriques, locaux compteurs, locaux techniques). Affichés dans des
    // blocs séparés du PDF (ch.2) pour clarté.
    // Source de vérité UNIFIÉE avec l'UI (ZonesSection.vue filtre par `kind`) :
    // le `kind` explicite de l'auditeur prime ; repli sur la nature pour les
    // zones legacy sans kind. Sans ça, une zone basculée « Technique » en UI
    // (ex. chaufferie, nature 'boiler-room' hors TECHNICAL_ZONE_NATURES) était
    // comptée à tort comme zone fonctionnelle BACS dans le PDF.
    isTechnical: z.kind
      ? (z.kind === 'technical')
      : (z.nature ? TECHNICAL_ZONE_NATURES.has(z.nature) : false),
    // Contrainte de confort saisie en texte libre. Si l'auditeur n'a mis qu'un
    // nombre (« 14 »), on suffixe « °C » (température = cas quasi systématique)
    // pour qu'un lecteur non-technicien ne se demande pas « 14 quoi ? ».
    comfort_constraint_display: /^\s*-?\d+([.,]\d+)?\s*$/.test(z.comfort_constraint || '')
      ? `${String(z.comfort_constraint).trim()} °C`
      : (z.comfort_constraint || null),
  }));
  // Split en deux listes pour le PDF — l'ordre interne (par position)
  // est préservé. `zonesFunctional` est la liste R175-1 6° au sens strict.
  const zonesFunctional = zones.filter(z => !z.isTechnical);
  const zonesTechnical = zones.filter(z => z.isTechnical);
  // Flags pour conditionner l'affichage du sous-bloc "Notes terrain par
  // zone" dans le PDF (évite un h3 orphelin si aucune zone n'a de note).
  // Recalculés après le rattachement des photos aux zones (bloc « Photos »
  // plus bas) : calculés ici seulement, ils ignoraient les photos, et une
  // zone sans note mais avec photos n'était jamais imprimée (relecture PDF
  // 2026-09-24).
  const hasZoneNotes = (z) => !!(z.notes_html || z.notes || (z.photos && z.photos.length) || z.comfort_constraint);
  let zonesFunctionalHaveNotes = zonesFunctional.some(hasZoneNotes);
  let zonesTechnicalHaveNotes = zonesTechnical.some(hasZoneNotes);
  const systems = db.db.prepare(`
    SELECT s.*, z.name AS zone_name, z.nature AS zone_nature
    FROM bacs_audit_systems s LEFT JOIN zones z ON z.id = s.zone_id
    WHERE s.document_id = ?
    ORDER BY z.position, z.name, s.system_category
  `).all(documentId);
  const meters = db.db.prepare(`
    SELECT m.*, z.name AS zone_name, lz.name AS location_zone_name
    FROM bacs_audit_meters m
    LEFT JOIN zones z ON z.id = m.zone_id
    LEFT JOIN zones lz ON lz.id = m.location_zone_id
    WHERE m.document_id = ?
    ORDER BY z.position NULLS LAST, m.usage
  `).all(documentId);
  // Supervision Buildy : champs découlant du niveau d'offre = valeurs du
  // modèle (cf. effectiveBuildyBms), comme le générateur d'actions.
  const bms = effectiveBuildyBms(db.db.prepare('SELECT * FROM bacs_audit_bms WHERE document_id = ?').get(documentId) || null);
  // Composants matériels de la GTB (serveurs, contrôleurs, passerelles…) saisis
  // par l'auditeur. Affichés dans le chapitre GTB du PDF si présents.
  const bmsComponents = db.db.prepare(`
    SELECT id, position, component_type, brand, model, location, ip_address,
           protocols, firmware_version, notes, notes_html
    FROM bacs_audit_bms_components WHERE document_id = ?
    ORDER BY position, id
  `).all(documentId);
  // Décodage des protocoles JSON array → libellés FR.
  for (const c of bmsComponents) {
    let list = [];
    if (c.protocols) {
      try {
        const arr = JSON.parse(c.protocols);
        if (Array.isArray(arr)) list = arr.map(p => COMM_LABEL[p] || p).filter(Boolean);
      } catch { /* legacy */ }
    }
    c.protocolsLabel = list.join(' / ');
  }
  // Inspections R175-5-1 — saisies par l'auditeur, jusqu'ici jamais
  // rendues dans le PDF. Lecture conjointe du flag « non applicable »
  // saisi sur le document (mig 187) : permet de distinguer 3 cas dans le
  // PDF — (1) inspection saisie, (2) non applicable + justification,
  // (3) chapitre non rendu si rien n'est renseigné.
  const inspections = db.db.prepare(`
    SELECT last_inspection_date, last_inspection_inspector, last_inspection_report_filename,
           last_inspection_anomalies_html, last_inspection_recommendations_html,
           next_inspection_due_date, retained_until_date, notes
    FROM bacs_audit_inspections WHERE document_id = ? LIMIT 1
  `).get(documentId) || null;
  // Décodage des protocoles fournis (JSON array TEXT) → libellés FR pour le PDF.
  if (bms && bms.provided_protocols) {
    try {
      const arr = JSON.parse(bms.provided_protocols);
      if (Array.isArray(arr)) {
        bms.providedProtocolsLabels = arr.map(p => COMM_LABEL[p] || p).filter(Boolean);
      }
    } catch { /* legacy non-JSON ou null */ }
  }
  if (!bms?.providedProtocolsLabels) {
    if (bms) bms.providedProtocolsLabels = [];
  }
  // Mig 205 — supervision Buildy Cloud : niveau d'offre + réserves de
  // conformité du niveau (doctrine 2026-09-23 : conforme sous réserves,
  // jamais « non conforme » à cause du niveau souscrit).
  if (bms && isBuildyOfferLevel(bms.buildy_offer_level)) {
    const level = bms.buildy_offer_level;
    const reserves = af.kind === 'bacs_audit' ? buildyReserves(bms) : [];
    bms.buildyOffer = {
      levelLabel: BUILDY_OFFER_LEVEL_LABEL[level],
      reserves,
      hasReserves: reserves.length > 0,
      // Essentials : 12 mois de données dans la solution → conservation
      // 5 ans assurée par les exports réguliers du client.
      retentionByExport: level === 'essentials',
      maintenanceIncluded: level !== 'essentials',
    };
  }
  // Mig 180 : 1 ligne par système. On joint sur bacs_audit_systems pour
  // récupérer le nom du système (custom_label) directement, et on filtre
  // les lignes sans system_id (pré-migration / orphelines).
  const thermalRaw = db.db.prepare(`
    SELECT t.*, z.name AS zone_name,
           s.custom_label AS system_label
    FROM bacs_audit_thermal_regulation t
    LEFT JOIN zones z ON z.id = t.zone_id
    LEFT JOIN bacs_audit_systems s ON s.id = t.system_id
    WHERE t.document_id = ? AND t.system_id IS NOT NULL
    ORDER BY z.position, z.name,
             CASE t.category WHEN 'heating' THEN 0 ELSE 1 END,
             s.position, t.position, t.id
  `).all(documentId);
  // On filtre done + declined : ces actions ne doivent pas apparaitre
  // dans le PDF livre aux integrateurs GTB.
  const actionItemsAll = db.db.prepare(`
    SELECT a.*, z.name AS zone_name FROM bacs_audit_action_items a
    LEFT JOIN zones z ON z.id = a.zone_id
    WHERE a.document_id = ? AND a.status NOT IN ('done', 'declined')
    ORDER BY a.position, a.id
  `).all(documentId);
  // Informations (INFO_SUBTYPES : systèmes exemptés par la règle des 5 %,
  // FAQ n° 16 ; points de vigilance) : ce sont des TRACES, pas des actions à
  // engager — sorties du plan, des numéros BACS-XXX et des décomptes ;
  // listées à part en fin de plan.
  // (libellés résolus plus bas, une fois zones / systèmes / équipements chargés)
  const exemptionRaw = actionItemsAll.filter(a => isInfoAction(a));
  const actionItemsRaw = actionItemsAll.filter(a => !isInfoAction(a));
  // Labels FR pour l'effort estimé saisi par l'auditeur sur chaque action.
  const EFFORT_LABEL = { low: 'Faible', medium: 'Moyen', high: 'Élevé' };
  for (const a of actionItemsRaw) {
    a.effortLabel = a.estimated_effort ? (EFFORT_LABEL[a.estimated_effort] || a.estimated_effort) : null;
  }

  // Notes par sujet de la carte GTB (mig 108 + 109).
  // Map { topic_key -> note_html } pour lookup direct dans le template
  // PDF sous chaque sous-section du chapitre 6 GTB.
  const bmsTopicNotes = db.bacsAuditGtbObservations.notesByTopic(documentId);
  const bmsTopicOpportunities = db.bacsAuditGtbObservations.opportunitiesByTopic(documentId);

  // Charge tous les devices du document (joints au systeme parent +
  // au modèle bibliothèque pour récupérer le slug — nécessaire au calcul
  // de puissance qui distingue sous-station vs émetteurs aval, et à la
  // dérivation du cas E d'assujettissement).
  const devices = db.db.prepare(`
    SELECT d.*, s.system_category, s.zone_id, z.name AS zone_name,
           t.slug AS equipment_template_slug,
           ${SHARED_TO_HEATING_SQL}
    FROM bacs_audit_system_devices d
    JOIN bacs_audit_systems s ON s.id = d.system_id
    LEFT JOIN zones z ON z.id = s.zone_id
    LEFT JOIN equipment_templates t ON t.id = d.equipment_template_id
    WHERE s.document_id = ?
    ORDER BY z.position, z.name, s.system_category, d.position, d.id
  `).all(documentId);
  // Mig 143 — systèmes supplémentaires où chaque device est partagé.
  // Nécessaire pour le badge « Partagé » (item 7f) et le calcul des zones
  // fonctionnelles de suivi (item 7d).
  const deviceExtras = db.bacsAuditDeviceSharedSystems.listExtrasForDocument(documentId);
  const extrasByDeviceId = new Map();
  for (const e of deviceExtras) {
    if (!extrasByDeviceId.has(e.device_id)) extrasByDeviceId.set(e.device_id, []);
    extrasByDeviceId.get(e.device_id).push(e.system_id);
  }
  const devicesBySystem = new Map();
  for (const d of devices) {
    d.extra_system_ids = extrasByDeviceId.get(d.id) || [];
    d.shared_zone_count = d.extra_system_ids.length;
    d.energyLabel = d.energy_source ? (ENERGY_LABEL[d.energy_source] || d.energy_source) : '—';
    // Multi-rôle (mig 117) : array → labels FR jointsavec ' / '.
    const roles = parseRoles(d.device_role);
    d.device_role = roles; // expose array (utile si template Hbs y accède directement)
    d.roleLabel = roles.length ? roles.map(r => ROLE_LABEL[r] || r).join(' / ') : '—';
    // Puissance installée = puissance unitaire × quantité. `quantity` > 1 →
    // le template affiche « 3 kW × 2 = 6 kW » ; sinon la puissance simple.
    const qty = Number(d.quantity) || 1;
    d.total_power_kw = d.power_kw != null
      ? Math.round((Number(d.power_kw) || 0) * qty * 100) / 100
      : null;
    // Froid unitaire × quantité aussi (relecture juridique R1 m11 : « 3 ×
    // 37 kW · froid 37 kW » alors que le cumul froid retenu est de 111 kW).
    d.total_power_kw_cooling = d.power_kw_cooling != null
      ? Math.round((Number(d.power_kw_cooling) || 0) * qty * 100) / 100
      : null;
    d.has_multiple = qty > 1;
    // Protocole(s) de communication du device : tableau JSON `communication_protocols`
    // (source utilisée par l'UI + le moteur de conformité), repli sur la colonne
    // singulière `communication_protocol` (dépréciée). Sans ça le PDF affichait
    // « Non communicant » sur des équipements KNX/BACnet réellement communicants
    // (colonne singulière null mais tableau rempli), contredisant la pastille
    // « ✓ Communicant » dérivée de is_communicating.
    let devProtocols = [];
    if (d.communication_protocols) {
      try {
        const arr = JSON.parse(d.communication_protocols);
        if (Array.isArray(arr)) devProtocols = arr.map(p => COMM_LABEL[p] || p).filter(Boolean);
      } catch { /* legacy */ }
    }
    if (!devProtocols.length && d.communication_protocol) {
      devProtocols = [COMM_LABEL[d.communication_protocol] || d.communication_protocol];
    }
    d.commProtocolsLabel = devProtocols.join(' / ');
    d.commLabel = devProtocols.length
      ? devProtocols.join(' / ')
      : (isTrue(d.is_communicating)
          ? 'Communicant (protocole non précisé)'
          : (isFalse(d.is_communicating) ? 'Non communicant' : 'Non renseigné'));
    // État de communication à trois états, source unique _interop.js (les
    // tableaux A3 lisaient la colonne dépréciée communication_protocol).
    d.commState = deviceCommState(d);
    // Pastille « Communicant » du chapitre 3 : déduite de la même règle que
    // la fiche (« Non communicant » saisi → ✗, et non « — ») — R2 M2.
    d.commTri = d.commState === 'yes' ? 1 : d.commState === 'no' ? 0 : null;
    if (!devicesBySystem.has(d.system_id)) devicesBySystem.set(d.system_id, []);
    devicesBySystem.get(d.system_id).push(d);
  }

  // Tri intra-système par chaîne énergétique : Production → Distribution →
  // Émission → Régulation seule → autre, puis alphabétique. Aligne le PDF
  // sur la card 04 desktop (cf. SystemDevicesTable.vue rolePriority).
  const ROLE_PRIORITY_PDF = { production: 1, distribution: 2, emission: 3, regulation: 4 };
  function rolePriorityPdf(d) {
    const roles = Array.isArray(d.device_role) ? d.device_role : [];
    if (!roles.length) return 5;
    let min = 5;
    for (const r of roles) {
      const p = ROLE_PRIORITY_PDF[String(r).toLowerCase()];
      if (p && p < min) min = p;
    }
    return min;
  }
  const byRoleThenName = (a, b) => {
    const pa = rolePriorityPdf(a);
    const pb = rolePriorityPdf(b);
    if (pa !== pb) return pa - pb;
    return (a.name || '').toLowerCase().localeCompare((b.name || '').toLowerCase());
  };
  for (const [, devs] of devicesBySystem) devs.sort(byRoleThenName);

  // Mig 143 — équipements PARTAGÉS : chaque système cible reçoit une copie
  // légère des devices partagés vers lui (ex. VC 4 tubes primaire en froid,
  // partagé en chauffage). Affichés au chap. 3 et en synthèse A3, pris en
  // compte dans le verdict R175-3 du système desservi. La puissance reste
  // comptée UNE seule fois, dans le système d'origine : jamais dans
  // total_power_kw / computeAutoPower / powerByUsage (double comptage).
  const systemById = new Map(systems.map(s => [s.id, s]));
  const systemShortLabel = (sid) => {
    const s = systemById.get(sid);
    if (!s) return null;
    const cat = s.is_bacs === 0 ? (s.custom_label || 'Usage') : (SYSTEM_LABEL[s.system_category] || s.system_category);
    return s.zone_name ? `${s.zone_name} · ${cat}` : cat;
  };
  const sharedDevicesBySystem = new Map();
  for (const d of devices) {
    if (!d.extra_system_ids.length) continue;
    d.sharedWithLabel = d.extra_system_ids.map(systemShortLabel).filter(Boolean).join(', ');
    const sharedFromLabel = systemShortLabel(d.system_id);
    for (const sid of d.extra_system_ids) {
      if (!sharedDevicesBySystem.has(sid)) sharedDevicesBySystem.set(sid, []);
      sharedDevicesBySystem.get(sid).push({ ...d, is_shared_here: true, sharedFromLabel });
    }
  }
  for (const [, devs] of sharedDevicesBySystem) devs.sort(byRoleThenName);

  // Refactor 2026-05-26 — Dérivation des flags d'assujettissement E/F
  // depuis les devices au lieu d'une saisie système :
  //  · is_district_heating_substation = au moins un device a le modèle
  //    d'équipement slug='sous-station-reseau-urbain' (seed dédié).
  //  · serves_multiple_buildings = au moins un device a le flag à 1
  //    (nouvelle colonne ajoutée par mig 175).
  // La colonne legacy sur le système est conservée pour compat : on garde
  // sa valeur si le dérivé ne s'applique pas (aucun device porteur).
  const SUBSTATION_SLUG = 'sous-station-reseau-urbain';
  const substationTplRow = db.db.prepare(
    'SELECT id FROM equipment_templates WHERE slug = ?'
  ).get(SUBSTATION_SLUG);
  const substationTplId = substationTplRow ? substationTplRow.id : null;

  // Propagation des flags d'assujettissement via metering_separable='no'.
  // Un device sous-station / multi-bâtiments dans le système A, partagé sur le
  // système B avec un comptage NON séparable, fait que B hérite du même cas
  // d'assujettissement (E ou F). Sans ça, le PDF affichait « Locaux sociaux 1 /
  // Chauffage : Cas A » alors que le même circuit alimente « Bureaux 1 /
  // Chauffage : Cas E » — incohérence relevée dans l'audit de cohérence v14.
  const sharedSubstationSystemIds = new Set();
  const sharedMultiBuildingSystemIds = new Set();
  for (const d of devices) {
    if (d.metering_separable !== 'no') continue;
    const isSub = substationTplId && d.equipment_template_id === substationTplId;
    const isMulti = d.serves_multiple_buildings === 1;
    if (!isSub && !isMulti) continue;
    for (const sid of d.extra_system_ids || []) {
      if (isSub) sharedSubstationSystemIds.add(sid);
      if (isMulti) sharedMultiBuildingSystemIds.add(sid);
    }
  }

  // Enrichit systems avec devices + sums + flags dérivés et group par zone
  // Verdict de conformité R175-3 par système (PDF chap 3). Ne s'applique
  // qu'aux audits BACS et aux postes thermiques + éclairage soumis au
  // décret. Le message est écrit pour qu'un client non technique
  // (gestionnaire, MOA) comprenne en une phrase ce qui pèche et
  // pourquoi c'est problématique. Nom des équipements concernés
  // explicite (max 3 + « + N autres »), référence au décret en
  // fin de phrase pour la traçabilité juridique (pas en attaque).
  const isBacsKind = af.kind === 'bacs_audit';
  const R175_CATS = new Set(['heating', 'cooling', 'ventilation', 'dhw', 'lighting_indoor', 'lighting_outdoor', 'electricity_production']);
  function listDeviceNames(devs) {
    const names = devs.map(d => d.name || 'Équipement sans nom').filter(Boolean);
    if (names.length <= 3) return names.join(', ');
    return `${names.slice(0, 3).join(', ')} + ${names.length - 3} autre${names.length - 3 > 1 ? 's' : ''}`;
  }
  // Portée de raccordement R175-2 II et périmètre GTB déclaré : mêmes règles
  // que le générateur d'actions, pour que le verdict par système du
  // chapitre 3 et le plan d'actions ne se contredisent jamais.
  const connectionScope = isBacsKind ? buildConnectionScope(documentId, af.bacs_applicability_status || null) : null;
  const siteWithoutGtb = !!bms && bms.present === 0;
  // Interopérabilité d'un système d'ORIGINE (équipements propres), pour les
  // systèmes de zone alimentés par un générateur partagé : une chaudière de
  // chaufferie non reliée rend non conformes les chauffages de zone qu'elle
  // dessert (relecture juridique R1 C1).
  const originInteropCache = new Map();
  function originInterop(systemId) {
    if (originInteropCache.has(systemId)) return originInteropCache.get(systemId);
    const sys = systems.find(x => x.id === systemId);
    const own = (devicesBySystem.get(systemId) || []).filter(d => !isTrue(d.out_of_service));
    const r = sys ? systemInteropStatus(own, {
      noGtb: siteWithoutGtb,
      category: sys.system_category,
      outOfScope: (d) => deviceOutOfGtbScope(bms, d, sys.system_category),
    }) : null;
    originInteropCache.set(systemId, r);
    return r;
  }

  function computeSystemCompliance(s, devs, sharedDevs = []) {
    if (!isBacsKind || !R175_CATS.has(s.system_category)) return null;
    if (isTrue(s.not_concerned)) {
      return {
        verdict: 'na',
        label: 'Système déclaré non concerné',
        reasons: [s.not_concerned_reason].filter(Boolean),
      };
    }
    if (s.present !== 1) return null;
    if (isTrue(s.marked_negligible_under_5pct)) {
      return {
        verdict: 'exempt',
        label: 'Système exempté de raccordement (règle des 5 %)',
        reasons: [s.negligible_justification
          ? `Justification relevée lors de l'audit : ${s.negligible_justification}`
          : 'Consommations d\'énergie effectives et induites de l\'ensemble des équipements régulés par la même fonction estimées à moins de 5 % de la consommation d\'énergie totale du bâtiment (FAQ ministérielle n° 16, non opposable).'],
      };
    }
    // Équipements PROPRES au système, comme le plan d'actions : un équipement
    // partagé est évalué avec son système d'origine (relecture juridique R1
    // M2 : verdict et actions calculés sur le même ensemble d'équipements).
    const buildSharedNote = (list) => {
      if (!list.length) return null;
      const origins = [...new Set(list.map(d => d.sharedFromLabel).filter(Boolean))];
      return `${list.length > 1 ? 'Les équipements partagés' : 'L\'équipement partagé'} (${listDeviceNames(list)}) ${list.length > 1 ? 'sont évalués' : 'est évalué'} avec ${list.length > 1 ? (origins.length > 1 ? 'leurs systèmes' : 'leur système') : 'son système'} d'origine${origins.length ? ` (${origins.join(', ')})` : ''}.`;
    };
    const sharedNote = buildSharedNote(sharedDevs);
    // Les générateurs partagés non reliés ont leur propre motif : la note
    // générale ne les répète pas.
    let failingShared = [];
    // Équipements déclarés « non concernés par l'intégration à la GTB » :
    // décision de l'auditeur, toujours rappelée (R3 n6).
    const excludedOwn = devs.filter(d => !isTrue(d.out_of_service) && deviceExcludedByAuditor(d));
    const excludedNote = excludedOwn.length
      ? `${excludedOwn.length > 1 ? 'Équipements déclarés' : 'Équipement déclaré'} non concerné${excludedOwn.length > 1 ? 's' : ''} par l'intégration à la GTB par l'auditeur : ${listDeviceNames(excludedOwn)}.`
      : null;
    const withShared = (reasons) => {
      const failingIds = new Set(failingShared.map(d => d.id));
      const note = buildSharedNote(sharedDevs.filter(d => !failingIds.has(d.id)));
      return [...reasons, ...(note ? [note] : []), ...(excludedNote ? [excludedNote] : [])];
    };
    const active = devs.filter(d => !isTrue(d.out_of_service));
    if (!active.length) {
      if (sharedDevs.length) {
        return { verdict: 'shared', label: 'Évalué avec le système d\'origine de ses équipements', reasons: [sharedNote] };
      }
      return {
        verdict: 'pending',
        label: 'Aucun équipement actif inventorié',
        reasons: ['Le système est déclaré présent, mais aucun équipement actif (hors service exclu) n\'a été inventorié : la conformité ne peut pas être déterminée.'],
      };
    }
    // R175-3 3° et 4° évalués au NIVEAU SYSTÈME, avec la règle du générateur
    // d'actions (source unique _interop.js) : chaque générateur communique
    // avec la GTB, directement ou par un régulateur raccordé ; site sans GTB
    // et usages que la GTB ne traite pas = « non relié ». 4° : un équipement
    // qui répond « oui » suffit ; écart seulement si TOUS répondent « non ».
    const conditional = connectionScope ? connectionScope.systemIsConditional(s) : false;
    const interop = systemInteropStatus(active, {
      noGtb: siteWithoutGtb,
      category: s.system_category,
      outOfScope: (d) => deviceOutOfGtbScope(bms, d, s.system_category),
    });
    const relevant = interop.relevant;
    // « Générateur » : chauffage, climatisation, eau chaude sanitaire et
    // production d'électricité seulement — jamais pour un luminaire ou une
    // VMC (R3 N-M5).
    const generatorWording = interop.basis === 'producers'
      && ['heating', 'cooling', 'dhw', 'electricity_production'].includes(s.system_category);
    // Générateur partagé, non relié, qui alimente ce système.
    failingShared = siteWithoutGtb ? [] : sharedDevs.filter(d => {
      if (isTrue(d.out_of_service) || isTrue(d.is_backup)) return false;
      const o = originInterop(d.system_id);
      return !!o && o.verdict === 'fail' && o.targets.some(t => t.id === d.id);
    });
    const interopFailed = interop.verdict === 'fail' || failingShared.length > 0;
    const stopOk = relevant.some(d => isTrue(d.meets_r175_3_p4));
    const autoOk = relevant.some(d => isTrue(d.meets_r175_3_p4_autonomous));
    // Système non relié : le raccordement porte aussi le 4° (pas d'écart 4°
    // distinct, comme au plan d'actions).
    // 4° évalué sur les équipements propres, comme le générateur (qui ne
    // l'écarte que si le système lui-même n'est pas relié).
    const ownInteropFailed = interop.verdict === 'fail';
    const stopFail = !siteWithoutGtb && !ownInteropFailed && relevant.length > 0 && relevant.every(d => isFalse(d.meets_r175_3_p4));
    const autoFail = !siteWithoutGtb && !ownInteropFailed && relevant.length > 0 && relevant.every(d => isFalse(d.meets_r175_3_p4_autonomous));
    const reasons = [];
    if (siteWithoutGtb) {
      reasons.push('Aucune GTB n\'est présente sur le site : le système n\'est relié à aucun système d\'automatisation et de contrôle (R175-2, R175-3).');
      if (interopFailed) reasons.push(`Équipements à relier à la future GTB : ${listDeviceNames(interop.targets)}.`);
    } else if (interop.verdict === 'fail') {
      const targets = interop.targets;
      const noInterface = targets.filter(d => deviceCommState(d) === 'no');
      const outOfGtbScope = targets.filter(d => deviceCommState(d) !== 'no' && deviceOutOfGtbScope(bms, d, s.system_category));
      const notLinked = targets.filter(d => !noInterface.includes(d) && !outOfGtbScope.includes(d));
      const parts = [];
      if (noInterface.length) parts.push(`${listDeviceNames(noInterface)} : aucune interface de communication`);
      if (outOfGtbScope.length) parts.push(`${listDeviceNames(outOfGtbScope)} : usage que la GTB en place ne traite pas`);
      if (notLinked.length) parts.push(`${listDeviceNames(notLinked)} : non relié${notLinked.length > 1 ? 's' : ''} à la GTB`);
      reasons.push(generatorWording
        ? `Le système n'est pas relié à la GTB : son générateur ne communique avec elle ni directement ni par un régulateur raccordé. ${parts.join(' ; ')} (R175-3 3°).`
        : `Le système n'est pas relié à la GTB : aucun de ses équipements ne communique avec elle. ${parts.join(' ; ')} (R175-3 3°).`);
    }
    if (failingShared.length) {
      const failOrigins = [...new Set(failingShared.map(d => d.sharedFromLabel).filter(Boolean))];
      reasons.push(`Le système est alimenté par un générateur partagé qui n'est pas relié à la GTB : ${listDeviceNames(failingShared)}${failOrigins.length ? ` (voir ${failOrigins.join(', ')} et son action de raccordement au plan)` : ''} (R175-3 3°).`);
    }
    if (stopFail) {
      reasons.push(`Arrêt manuel impossible depuis la GTB : ${listDeviceNames(relevant)} (R175-3 4°).`);
    }
    if (autoFail) {
      reasons.push(`${relevant.length > 1 ? 'Ne fonctionnent' : 'Ne fonctionne'} plus normalement si la GTB est arrêtée ou si la communication est coupée (pas de gestion autonome) : ${listDeviceNames(relevant)} (R175-3 4°).`);
    }
    if (reasons.length) {
      if (conditional) {
        return {
          verdict: 'conditional',
          label: 'Raccordement exigé sous condition de temps de retour sur investissement',
          // Condition expliquée une fois en tête du chapitre 3
          // (hasConditionalSystems) au lieu d'être répétée par système.
          reasons: withShared([...reasons, 'Bâtiment existant : raccordement exigé seulement sous condition de temps de retour sur investissement (R175-2 II, voir l\'encadré en tête de chapitre) ; les écarts figurent au plan d\'actions en actions mineures.']),
        };
      }
      // Chaud ou froid tenu pour obligatoire sans franchir le seuil d'après le
      // cumul (puissance manquante…) : même explication qu'au plan d'actions.
      const mandatoryNote = connectionScope ? connectionScope.systemMandatoryNote(s) : null;
      if (mandatoryNote) reasons.push(`Portée à confirmer : ${mandatoryNote.charAt(0).toLowerCase()}${mandatoryNote.slice(1)}`);
      // Unités réversibles reliées au titre de l'autre usage (R3 N-M1).
      const reversibleNote = connectionScope && connectionScope.systemReversibleNote ? connectionScope.systemReversibleNote(s) : null;
      if (reversibleNote) reasons.push(`Portée du raccordement : ${reversibleNote.charAt(0).toLowerCase()}${reversibleNote.slice(1)}`);
      if (siteWithoutGtb) {
        return { verdict: 'non_compliant', label: 'Non conforme — aucune GTB sur le site', reasons: withShared(reasons) };
      }
      return {
        verdict: interopFailed ? 'non_compliant' : 'partial',
        label: interopFailed ? 'Non conforme — actions correctives requises' : 'Écarts sur une partie des exigences',
        reasons: withShared(reasons),
      };
    }
    const reasonsPending = [];
    if (interop.verdict === 'na') {
      // Équipements déclarés non concernés par l'intégration à la GTB :
      // décision de l'auditeur, rapportée comme telle.
      const excluded = active.filter(deviceExcludedByAuditor);
      if (excluded.length) {
        return {
          verdict: 'exempt',
          excludedByAuditor: true,
          label: 'Non évalué — équipements déclarés non concernés par l\'intégration à la GTB',
          reasons: [`L'auditeur a déclaré ${excluded.length > 1 ? 'les équipements' : 'l\'équipement'} ${listDeviceNames(excluded)} non concerné${excluded.length > 1 ? 's' : ''} par l'intégration à la GTB (par exemple, équipement piloté par un autre équipement raccordé) : le raccordement de ce système n'est pas évalué.`,
            ...(sharedNote ? [sharedNote] : [])],
        };
      }
      if (sharedDevs.length) {
        return { verdict: 'shared', label: 'Évalué avec le système d\'origine de ses équipements', reasons: [sharedNote] };
      }
      reasonsPending.push('Aucun équipement de production, de distribution ou de régulation n\'est inventorié : l\'interopérabilité (R175-3 3°) ne peut pas être évaluée.');
    } else if (interop.verdict === 'pending') {
      const contradictory = relevant.filter(deviceInteropContradiction);
      reasonsPending.push(contradictory.length
        ? `Données contradictoires pour ${listDeviceNames(contradictory)} : la fiche indique une intégration à la GTB, mais aucune interface de communication ; le mode de raccordement est à préciser (R175-3 3°).`
        : 'Le raccordement à la GTB des équipements de production, de distribution ou de régulation n\'est pas entièrement renseigné : l\'interopérabilité (R175-3 3°) ne peut pas être établie.');
    }
    const stopPending = relevant.length > 0 && !stopOk && !stopFail;
    const autoPending = relevant.length > 0 && !autoOk && !autoFail;
    if (stopPending || autoPending) {
      reasonsPending.push(`${stopPending && autoPending ? 'L\'arrêt manuel depuis la GTB et le fonctionnement autonome n\'ont' : stopPending ? 'L\'arrêt manuel depuis la GTB n\'a' : 'Le fonctionnement autonome n\'a'} pas été renseigné${stopPending && autoPending ? 's' : ''} pour : ${listDeviceNames(relevant)} (R175-3 4°).`);
    }
    if (reasonsPending.length) {
      return {
        verdict: 'pending',
        label: 'Conformité non déterminée — informations manquantes',
        reasons: withShared(reasonsPending),
      };
    }
    return {
      verdict: 'compliant',
      label: 'Conforme aux exigences R175-3 examinées pour ce système',
      reasons: withShared([generatorWording
        ? 'Le générateur communique avec la GTB (directement ou par un régulateur raccordé qui le pilote) ; le système peut être arrêté manuellement depuis la GTB et continue de fonctionner si elle est arrêtée.'
        : 'Un équipement du système communique avec la GTB ; le système peut être arrêté manuellement depuis la GTB et continue de fonctionner si elle est arrêtée.']),
    };
  }

  const enrichedSystems = systems.map(s => {
    const devs = devicesBySystem.get(s.id) || [];
    const sharedDevs = sharedDevicesBySystem.get(s.id) || [];
    // Arrêt manuel « depuis la GTB » et gestion autonome : sans objet pour un
    // équipement relié à aucune GTB (site sans GTB, aucune interface, usage
    // non traité) — relecture clarté R2 M17.
    for (const d of [...devs, ...sharedDevs]) {
      d.p4NotApplicable = isBacsKind && deviceInteropState(d, {
        noGtb: siteWithoutGtb,
        outOfScope: (x) => deviceOutOfGtbScope(bms, x, d.system_category || s.system_category),
      }) === 'ko';
    }
    const totalKw = Math.round(devs.reduce((sum, d) => sum + (Number(d.power_kw) || 0) * (Number(d.quantity) || 1), 0) * 100) / 100;
    const derivedSubstation = (substationTplId
      ? devs.some(d => d.equipment_template_id === substationTplId)
      : false)
      || sharedSubstationSystemIds.has(s.id);
    const derivedMultiBuildings = devs.some(d => d.serves_multiple_buildings === 1)
      || sharedMultiBuildingSystemIds.has(s.id);
    return {
      ...s,
      // Override (ou complément) des flags système avec les valeurs dérivées
      // des devices. Le legacy reste actif si rien n'est dérivé.
      is_district_heating_substation: derivedSubstation
        ? 1
        : s.is_district_heating_substation,
      serves_multiple_buildings: derivedMultiBuildings
        ? 1
        : s.serves_multiple_buildings,
      categoryLabel: s.is_bacs === 0
        ? (s.custom_label || 'Usage')
        : (SYSTEM_LABEL[s.system_category] || s.system_category),
      // Mig 182 : N systèmes BACS de même catégorie autorisés par zone.
      // displayLabel = libellé catégorie + nom du système entre parens si
      // saisi (« Chauffage (Chaudière gaz centrale) »). Pour les usages
      // non-BACS, c'est juste le custom_label (déjà capturé par
      // categoryLabel). Utilisé par les templates PDF chap 3 + synthèse
      // pour distinguer 2 systèmes Chauffage dans la même zone.
      // Anti-doublon « Éclairage intérieur (Éclairage intérieur) » : si
      // le custom_label est identique au libellé catégorie (en
      // ignorant casse/accents/espaces), on ne le répète pas entre
      // parenthèses (incident PDF Communay 2026-06-08).
      displayLabel: (() => {
        if (s.is_bacs === 0) return s.custom_label || 'Usage';
        const baseLabel = SYSTEM_LABEL[s.system_category] || s.system_category;
        const custom = (s.custom_label || '').trim();
        if (!custom) return baseLabel;
        const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
        if (norm(custom) === norm(baseLabel)) return baseLabel;
        return `${baseLabel} (${custom})`;
      })(),
      negativeLabel: SYSTEM_NEGATIVE_LABEL[s.system_category] || `Pas de ${(SYSTEM_LABEL[s.system_category] || s.system_category).toLowerCase()}`,
      commLabel: s.communication ? (COMM_LABEL[s.communication] || s.communication) : '—',
      devices: devs,
      shared_devices: sharedDevs,
      shared_device_count: sharedDevs.length,
      device_count: devs.length + sharedDevs.length,
      // Puissance des seuls équipements propres (les partagés sont comptés
      // dans leur système d'origine).
      total_power_kw: totalKw,
      compliance: computeSystemCompliance(s, devs, sharedDevs),
    };
  });
  // Group systems par zone
  const systemsByZoneMap = new Map();
  for (const s of enrichedSystems) {
    const k = s.zone_id;
    if (!systemsByZoneMap.has(k)) {
      systemsByZoneMap.set(k, { zone_name: s.zone_name, zone_nature: s.zone_nature, items: [] });
    }
    systemsByZoneMap.get(k).items.push(s);
  }
  const systemsByZone = [...systemsByZoneMap.values()];
  for (const g of systemsByZone) {
    g.allAbsent = g.items.length > 0 && g.items.every(x => isTrue(x.not_concerned) || x.present === 0);
    // Usages non présents de la zone, cités sur une seule ligne sous le titre
    // de zone (au lieu d'une boîte « Absent » par usage, qui pouvait finir
    // seule sur une page — relecture PDF 2026-09-24).
    const notPresent = g.items.filter(x => !isTrue(x.present));
    g.absentLabels = notPresent.filter(x => isTrue(x.not_concerned) || x.present === 0)
      .map(x => ({ system_category: x.system_category, categoryLabel: x.categoryLabel }));
    g.unansweredLabels = notPresent.filter(x => !(isTrue(x.not_concerned) || x.present === 0))
      .map(x => ({ system_category: x.system_category, categoryLabel: x.categoryLabel }));
  }
  // Tableau A3 des systèmes : colonnes Localisation et GTB masquées quand
  // elles ne contiendraient que des « — » (aucune localisation saisie, site
  // sans GTB).
  const synthesisDevices = systemsByZone.flatMap(g => g.items.filter(x => x.present === 1)
    .flatMap(x => [...(x.devices || []), ...(x.shared_devices || [])]));
  const synthesisShowLocation = synthesisDevices.some(d => d.location && String(d.location).trim());
  const synthesisShowGtb = !siteWithoutGtb;
  const synthesisSystemsColspan = 12 - (synthesisShowLocation ? 0 : 1) - (synthesisShowGtb ? 0 : 1);

  // Zones fonctionnelles ne portant AUCUN système technique concerné par le
  // décret (chauffage, clim, ECS, ventilation, éclairage, production) → elles
  // n'ont rien à afficher dans l'inventaire du chapitre 3. Affichées en note
  // pédagogique pour qu'un lecteur exigeant sache pourquoi elles n'y
  // apparaissent pas.
  // ⚠️ On teste TOUTES les catégories R175 (pas seulement le thermique) : une
  // zone à éclairage/ventilation SANS thermique est bien listée ci-dessous
  // (elle porte des systèmes) — l'exclure ici produisait un callout mensonger
  // « ces zones ne sont pas listées ci-dessous » alors qu'elles l'étaient,
  // avec des systèmes non conformes.
  const zonesWithR175System = new Set();
  for (const s of enrichedSystems) {
    if (s.zone_id != null && R175_CATS.has(s.system_category) && s.present === 1) {
      zonesWithR175System.add(s.zone_id);
    }
  }
  const zonesOutOfBacsScope = zonesFunctional
    .filter(z => !zonesWithR175System.has(z.zone_id))
    .map(z => ({ name: z.name, natureLabel: z.natureLabel, surface_m2: z.surface_m2 || null }));

  // ── Item 4 — calcul automatique de l'assujetti par système ──
  // Charge la structure juridique + parties prenantes + affectations de
  // périmètre, puis calcule l'assujetti de chaque système (6 cas PROFEEL).
  const siteParties = site ? db.siteParties.listBySite(site.site_id) : [];
  const zonePartyLinks = site ? db.zoneParties.listBySite(site.site_id) : [];
  const systemPartyLinks = db.systemParties.listByDocument(documentId);
  const liabilityMap = computeSystemLiability({
    site,
    parties: siteParties,
    // Utilise les systèmes enrichis : ils portent les flags dérivés
    // (is_district_heating_substation / serves_multiple_buildings)
    // calculés depuis les devices, pas la saisie système legacy.
    systems: enrichedSystems,
    zonePartyLinks,
    systemPartyLinks,
  });
  for (const sys of enrichedSystems) {
    sys.liability = liabilityMap.get(sys.id) || null;
  }
  // Assujetti « par défaut » : celui de la plupart des systèmes présents. Il
  // est mentionné une fois en tête du chapitre 3 ; seuls les systèmes qui
  // s'en écartent portent leur propre mention (relecture clarté R2 m7).
  const defaultLiability = (() => {
    const counts = new Map();
    for (const sys of enrichedSystems) {
      if (sys.present !== 1 || sys.is_bacs === 0 || !sys.liability) continue;
      const key = `${sys.liability.label}|${sys.liability.explanation}`;
      const cur = counts.get(key) || { n: 0, liability: sys.liability };
      cur.n += 1;
      counts.set(key, cur);
    }
    const best = [...counts.values()].sort((a, b) => b.n - a.n)[0];
    return best && best.n >= 2 ? best.liability : null;
  })();
  for (const sys of enrichedSystems) {
    sys.liabilityIsDefault = !!(defaultLiability && sys.liability
      && sys.liability.label === defaultLiability.label
      && sys.liability.explanation === defaultLiability.explanation);
  }
  // Y a-t-il au moins une affectation d'assujetti à montrer dans le PDF ?
  const hasLiabilityData = !!(site && site.ownership_structure) || siteParties.length > 0;
  const ownershipStructureLabel = site && site.ownership_structure
    ? (OWNERSHIP_STRUCTURE_LABEL[site.ownership_structure] || site.ownership_structure)
    : null;
  // Zones rattachées à chaque partie prenante (item 5) — pour la liste
  // « Parties prenantes » du PDF.
  const zoneNameById = new Map(zones.map(z => [z.zone_id, z.name]));
  const zoneNamesByParty = {};
  for (const l of zonePartyLinks) {
    const nm = zoneNameById.get(l.zone_id);
    if (!nm) continue;
    (zoneNamesByParty[l.party_id] || (zoneNamesByParty[l.party_id] = [])).push(nm);
  }
  const sitePartiesEnriched = siteParties.map(p => ({
    ...p,
    kindLabel: PARTY_KIND_LABEL[p.kind] || p.kind,
    zoneNames: (zoneNamesByParty[p.id] || []).sort((a, b) => a.localeCompare(b, 'fr')),
  }));

  // Enrichit meters. Pour les compteurs généraux (zone_id null), la
  // notion d'usage n'a pas de sens (un compteur de tête mesure toute
  // l'énergie du site, pas un usage particulier) — on remplace par '—'
  // côté PDF/affichage. Le champ `location_zone_name` (mig 176) vient
  // du JOIN dans la route GET /bacs-audit/:id/meters.
  // Libellé « Système » d'un compteur (miroir de MeterEnergyGroup.vue) : le ou
  // les noms personnalisés des systèmes BACS de la zone qui partagent l'usage
  // du compteur, sinon un libellé GÉNÉRIQUE dérivé de l'usage (« Système ECS »,
  // « Système Éclairage »…). Sert de colonne « Système » du tableau compteurs
  // PDF quand celui-ci est groupé par zone (la zone est déjà en sous-en-tête).
  const meterSystemLabel = (m) => {
    if (m.zone_id == null) return null; // compteur général : pas de système
    const cats = METER_USAGE_TO_SYSTEM_CATS[m.usage] || [];
    const names = cats.length
      ? systems
        .filter(s => s.zone_id === m.zone_id && cats.includes(s.system_category)
          && s.custom_label && s.custom_label.trim())
        .map(s => s.custom_label.trim())
      : [];
    if (names.length) return names.join(' + ');
    const usageLabel = METER_USAGE_LABEL[m.usage];
    return usageLabel && m.usage !== 'other' ? `Système ${usageLabel}` : null;
  };
  // Zones fonctionnelles de suivi (chapitre 2) calculées une fois : elles
  // servent aussi au comptage unique des zones regroupées (même règle que le
  // générateur d'actions, lib/bacs-functional-zones.js).
  const functionalZones = computeFunctionalZones(devices, systems, { SYSTEM_LABEL });
  // Compteurs d'un usage entièrement exempté (règle des 5 %) ou déclaré non
  // concerné par l'intégration à la GTB : non requis (même règle que le
  // générateur d'actions, R3 N-M3).
  const METER_USAGE_OF_CATEGORY = {
    heating: 'heating', cooling: 'cooling', ventilation: 'ventilation', dhw: 'dhw',
    lighting_indoor: 'lighting', lighting_outdoor: 'lighting', electricity_production: 'pv',
  };
  const exemptMeterKeys = new Set();
  const excludedMeterKeys = new Set();
  const evaluatedMeterKeys = new Set();
  const exemptSystemIds = new Set(enrichedSystems
    .filter(x => x.present === 1 && isTrue(x.marked_negligible_under_5pct)).map(x => x.id));
  for (const sys of enrichedSystems) {
    if (sys.is_bacs === 0 || sys.present !== 1) continue;
    const usage = METER_USAGE_OF_CATEGORY[sys.system_category];
    if (!usage) continue;
    const k = `${sys.zone_id ?? ''}|${usage}`;
    // Système alimenté uniquement par des équipements partagés depuis des
    // systèmes exemptés : exempté lui aussi pour le comptage.
    const exemptByOrigin = !(sys.devices || []).length && (sys.shared_devices || []).length > 0
      && sys.shared_devices.every(d => exemptSystemIds.has(d.system_id));
    if (isTrue(sys.marked_negligible_under_5pct) || exemptByOrigin) exemptMeterKeys.add(k);
    // Un système qui reçoit un équipement partagé reste évalué pour le
    // comptage : son usage consomme par ce générateur (même règle que le
    // générateur du plan).
    else if (sys.compliance && sys.compliance.excludedByAuditor && !(sys.shared_devices || []).length) excludedMeterKeys.add(k);
    else evaluatedMeterKeys.add(k);
  }
  const meterNotRequiredReason = (m) => {
    const k = `${m.zone_id ?? ''}|${m.usage}`;
    if (evaluatedMeterKeys.has(k)) return null;
    if (exemptMeterKeys.has(k)) return 'système exempté de raccordement (règle des 5 %)';
    if (excludedMeterKeys.has(k)) return 'équipements déclarés non concernés par l\'intégration à la GTB';
    return null;
  };
  const meterRoles = mergedMeterRoles(functionalZones, meters.filter(m => m.meter_type === 'water' || !meterNotRequiredReason(m)));
  // Zone regroupée « comptage séparé non réalisable » alors que plusieurs de
  // ses zones ont leur propre compteur présent : le chapitre 2 le signale
  // (regroupement à confirmer ; précheck ZONE-002 — R2 M10).
  {
    const presentByGroup = new Map();
    for (const m of meters) {
      const r = meterRoles.get(m.id);
      if (!r || r.role !== 'present') continue;
      const k = `${r.group.category}|${r.group.label}|${m.usage}`;
      if (!presentByGroup.has(k)) presentByGroup.set(k, new Set());
      presentByGroup.get(k).add(m.zone_id);
    }
    for (const [k, zonesSet] of presentByGroup) {
      if (zonesSet.size < 2) continue;
      const [cat, label] = k.split('|');
      const entry = functionalZones.byCategory.find(c => c.category === cat);
      const g = entry && entry.groups.find(x => x.label === label);
      if (g) g.separateMetersPresent = true;
    }
  }
  const meterZoneNameById = new Map(meters.map(m => [m.id, m.zone_name]));
  // Libellés automatiques des anciens plans de comptage (« Compteur gaz en
  // zone « Cellule A » (chauffage) ») : figés à la création, parfois périmés,
  // ils s'affichaient comme des notes de l'auditeur (relecture clarté R2 M19).
  // (y compris les variantes « zonal » et suffixées « — fallback … », R3.)
  const AUTO_METER_NOTE_RE = /^Compteur (?:électrique de production|électrique|gaz|thermique|eau|autre)(?: zonal)? en zone « [^»]* » \([^)]*\)(?: — .*)?\.?$|^Compteur général (?:électrique|gaz|fioul|thermique)(?: du bâtiment| \(réseau de chaleur\))(?: — .*)?\.?$/;
  const isAutoMeterNote = (t) => !!t && AUTO_METER_NOTE_RE.test(String(t).trim());
  const enrichedMeters = meters.map(m => {
    // Décodage des protocoles communiquant (JSON array TEXT) → libellés FR.
    let protocolsList = [];
    if (m.communication_protocols) {
      try {
        const arr = JSON.parse(m.communication_protocols);
        if (Array.isArray(arr)) {
          protocolsList = arr.map(p => COMM_LABEL[p] || p).filter(Boolean);
        }
      } catch { /* legacy */ }
    }
    // Fallback sur communication_protocol simple si pas d'array.
    if (!protocolsList.length && m.communication_protocol) {
      protocolsList = [COMM_LABEL[m.communication_protocol] || m.communication_protocol];
    }
    // Verdict de conformité R175-3 1° pour un compteur requis :
    // - manquant (required mais pas présent_actual)
    // - non communicant (présent mais ne remonte pas) → ligne rouge pâle
    // - hors service géré séparément (badge HS)
    // Indique au lecteur PDF quelles lignes méritent action immédiate.
    const compliantPresent = isTrue(m.present_actual);
    const compliantComm = isTrue(m.communicating);
    const merged = meterRoles.get(m.id) || null;
    // Couvert par le comptage unique de sa zone regroupée : ni manquant ni
    // en écart (aucune action au plan).
    const coveredByGroup = merged && merged.role === 'covered' ? merged.group.label : null;
    const notRequiredReason = m.meter_type === 'water' ? null : meterNotRequiredReason(m);
    const reqFailed = !!m.required && !isTrue(m.out_of_service) && !coveredByGroup && !notRequiredReason
      && (!compliantPresent || !compliantComm);
    return {
      ...m,
      notes: isAutoMeterNote(m.notes) ? null : m.notes,
      isPresent: compliantPresent,
      // Présent / absent / non vérifié : une seule cellule explicite remplace
      // les quatre « — » d'un compteur non présent (relecture PDF 2026-09-24).
      presenceState: compliantPresent ? 'yes' : (isFalse(m.present_actual) ? 'no' : 'unknown'),
      notRequiredReason,
      coveredByGroup,
      coveredLeadZone: coveredByGroup && merged.leadId ? (meterZoneNameById.get(merged.leadId) || null) : null,
      mergedLeadGroup: merged && merged.role === 'lead' ? merged.group.label : null,
      typeLabel: METER_TYPE_LABEL[m.meter_type] || m.meter_type,
      usageLabel: m.zone_id ? (METER_USAGE_LABEL[m.usage] || m.usage) : '—',
      zoneLabel: m.zone_name || 'Compteur général',
      systemLabel: meterSystemLabel(m),
      locationLabel: m.location_zone_name || null,
      isGeneral: !m.zone_id,
      protocolsList,
      protocolsLabel: protocolsList.join(' / '),
      complianceFailed: reqFailed,
    };
  });
  // Liste affichée dans le PDF chapitre 4 : on retire les compteurs ni
  // requis, ni présents, ni HS — ces lignes n'ont aucune valeur
  // informative pour l'intégrateur et bruitent le tableau. Les autres
  // consommateurs (enrichedMeters, recapStats, bms*) gardent la vue
  // complète pour ne pas fausser les agrégations.
  const metersForPdf = enrichedMeters.filter(m =>
    m.required || m.present_actual || m.out_of_service);

  // ── Photos ────────────────────────────────────────────────────────
  if (site) {
    const photoRows = db.db.prepare(`
      SELECT id, filename, mime_type,
             bacs_audit_zone_id, bacs_audit_system_id, bacs_audit_meter_id,
             bacs_audit_device_id, bacs_audit_bms_document_id
      FROM site_documents
      WHERE site_id = ? AND category = 'photo'
      ORDER BY uploaded_at ASC
    `).all(site.site_id);
    const docsRoot = path.resolve(config.attachmentsDir, '..', 'site-documents', site.site_uuid);
    const zonePhotos = new Map();
    const systemPhotos = new Map();
    const meterPhotos = new Map();
    const devicePhotos = new Map();
    const bmsPhotos = [];
    const photoUrls = await Promise.all(photoRows.map((ph) =>
      optimizeFileToDataUrl(path.join(docsRoot, ph.filename)).catch(() => null)
    ));
    for (let i = 0; i < photoRows.length; i++) {
      const ph = photoRows[i];
      const url = photoUrls[i];
      if (!url) continue;
      const item = { id: ph.id, dataUrl: url };
      if (ph.bacs_audit_zone_id) {
        if (!zonePhotos.has(ph.bacs_audit_zone_id)) zonePhotos.set(ph.bacs_audit_zone_id, []);
        zonePhotos.get(ph.bacs_audit_zone_id).push(item);
      }
      if (ph.bacs_audit_system_id) {
        if (!systemPhotos.has(ph.bacs_audit_system_id)) systemPhotos.set(ph.bacs_audit_system_id, []);
        systemPhotos.get(ph.bacs_audit_system_id).push(item);
      }
      if (ph.bacs_audit_meter_id) {
        if (!meterPhotos.has(ph.bacs_audit_meter_id)) meterPhotos.set(ph.bacs_audit_meter_id, []);
        meterPhotos.get(ph.bacs_audit_meter_id).push(item);
      }
      if (ph.bacs_audit_device_id) {
        if (!devicePhotos.has(ph.bacs_audit_device_id)) devicePhotos.set(ph.bacs_audit_device_id, []);
        devicePhotos.get(ph.bacs_audit_device_id).push(item);
      }
      if (ph.bacs_audit_bms_document_id === documentId) {
        bmsPhotos.push(item);
      }
    }
    for (const z of zones) z.photos = zonePhotos.get(z.zone_id) || [];
    zonesFunctionalHaveNotes = zonesFunctional.some(hasZoneNotes);
    zonesTechnicalHaveNotes = zonesTechnical.some(hasZoneNotes);
    for (const m of enrichedMeters) m.photos = meterPhotos.get(m.id) || [];
    for (const d of devices) d.photos = devicePhotos.get(d.id) || [];
    for (const sys of enrichedSystems) sys.photos = systemPhotos.get(sys.id) || [];
    if (bms) bms.photos = bmsPhotos;
  }

  // Listes GTB integration : devices + meters integres ET ce qui reste a
  // integrer (gap analysis pour l'integrateur Buildy — c'est la partie a
  // chiffrer dans le devis).
  // Ternaires stricts (incident Communay) : managed_by_bms null = non
  // répondu → bucket « à qualifier » distinct, jamais fusionné avec le
  // « à intégrer » (qui chiffre le devis).
  const withCatLabel = d => ({
    ...d,
    categoryLabel: SYSTEM_LABEL[d.system_category] || d.system_category,
  });
  // Périmètre GTB déclaré (flags bms.manages_* + gtb_scope_override par
  // équipement, lib/bacs-gtb-scope.js) : il qualifie le statut de chaque
  // équipement, sans le retirer du tableau.
  // Relectures finales (2026-09-24) : le périmètre de la GTB ne réduit pas
  // celui du décret. Le tableau liste donc TOUS les équipements présents :
  // un équipement d'un usage que la GTB ne traite pas est « à intégrer »
  // (outOfGtbScope), un émetteur à régulation locale n'est pas visé
  // (interopNotTargeted, même règle que _interop.js) — R2 M16, m18.
  const THERMAL_CATS = new Set(['heating', 'cooling']);
  const presentDevices = devices.filter(d => !isTrue(d.out_of_service)).map(d => {
    const e = withCatLabel(d);
    e.excludedByAuditor = deviceExcludedByAuditor(d);
    e.interopNotTargeted = !e.excludedByAuditor && THERMAL_CATS.has(d.system_category) && !isInteropRelevant(d);
    e.outOfGtbScope = !e.excludedByAuditor && !e.interopNotTargeted && deviceOutOfGtbScope(bms, d, d.system_category);
    return e;
  });
  const bmsManagedDevices = presentDevices.filter(d => !d.excludedByAuditor && !d.interopNotTargeted && !d.outOfGtbScope
    && isTrue(d.managed_by_bms) && !isTrue(d.bms_integration_out_of_service));
  const bmsUnmanagedDevices = presentDevices.filter(d => !d.excludedByAuditor && !d.interopNotTargeted
    && (d.outOfGtbScope || isFalse(d.managed_by_bms)));
  const bmsUnansweredDevices = presentDevices.filter(d => !d.excludedByAuditor && !d.interopNotTargeted && !d.outOfGtbScope
    && d.managed_by_bms == null);
  const bmsNotTargetedDevices = presentDevices.filter(d => d.interopNotTargeted || d.excludedByAuditor);
  const bmsOutOfScopeDevices = presentDevices.filter(d => d.outOfGtbScope);
  // Vue regroupée par zone pour le tableau « Équipements intégrés à la GTB »
  // du PDF chapitre 6. Évite les lignes plates « Nom · Usage · Zone · Marque »
  // qui sont peu lisibles et redondent la zone à chaque ligne.
  function groupDevicesByZone(list) {
    const map = new Map();
    for (const d of list) {
      const z = d.zone_name || 'Hors zone';
      if (!map.has(z)) map.set(z, { zone_name: z, devices: [] });
      map.get(z).devices.push(d);
    }
    return [...map.values()].sort((a, b) => a.zone_name.localeCompare(b.zone_name, 'fr'));
  }
  const bmsManagedDevicesByZone = groupDevicesByZone(bmsManagedDevices);
  const bmsUnmanagedDevicesByZone = groupDevicesByZone(bmsUnmanagedDevices);
  const bmsUnansweredDevicesByZone = groupDevicesByZone(bmsUnansweredDevices);
  // Vue UNIFIÉE (tableau unique du PDF) : tous les équipements pertinents
  // (hors service exclus), groupés par zone, chacun portant son statut
  // d'intégration ternaire (managed_by_bms : 1=Oui / 0=Non / null=à qualifier).
  const bmsDevicesByZone = groupDevicesByZone(presentDevices);
  // Liaison GTB interrompue : ni « relevé par la GTB » ni « non intégré »,
  // compté à part (relecture clarté R2 M15).
  const bmsBrokenLinkMeters = enrichedMeters.filter(m =>
    isTrue(m.managed_by_bms) && isTrue(m.bms_integration_out_of_service) && !isTrue(m.out_of_service));
  const bmsManagedMeters = enrichedMeters.filter(m => isTrue(m.managed_by_bms) && !isTrue(m.bms_integration_out_of_service));
  const bmsUnmanagedMeters = enrichedMeters.filter(m =>
    isFalse(m.managed_by_bms) && isTrue(m.present_actual) && !isTrue(m.out_of_service));
  const bmsUnansweredMeters = enrichedMeters.filter(m =>
    m.managed_by_bms == null && isTrue(m.present_actual) && !isTrue(m.out_of_service));

  // Compteurs groupes par zone fonctionnelle (pour le PDF tableaux de
  // synthese paysage). Les compteurs sans zone (general batiment) vont
  // dans une zone fictive "Général bâtiment" placee en derniere position.
  const metersByZoneMap = new Map();
  for (const m of enrichedMeters) {
    const key = m.zone_id || '__general';
    if (!metersByZoneMap.has(key)) {
      metersByZoneMap.set(key, {
        zone_id: m.zone_id,
        zone_name: m.zone_id ? m.zone_name : 'Général bâtiment',
        items: [],
      });
    }
    metersByZoneMap.get(key).items.push(m);
  }
  // Ordre : zones dans l'ordre du chapitre 2 (comme les tableaux Systèmes et
  // Régulation — relecture PDF 2026-09-24), puis « Général bâtiment ».
  const meterZoneRank = new Map(zones.map((z, i) => [z.zone_id, i]));
  const metersByZone = [...metersByZoneMap.values()].sort((a, b) => {
    if (a.zone_id == null) return 1;
    if (b.zone_id == null) return -1;
    return (meterZoneRank.get(a.zone_id) ?? Number.MAX_SAFE_INTEGER) - (meterZoneRank.get(b.zone_id) ?? Number.MAX_SAFE_INTEGER);
  });
  // Colonnes facultatives des tableaux (PDF) : masquées quand elles ne
  // contiendraient que des « — ».
  const metersAnyOutOfService = enrichedMeters.some(m => isTrue(m.out_of_service));

  // ── Matrice de couverture + sections par énergie du plan de comptage
  // (logique partagée avec la preview-fixture via `_meter-coverage.js`).
  const { meterCoverageMatrix, meterEnergyGroups } = buildMeterCoverage(enrichedMeters, zones);
  // Vue des compteurs groupés PAR ÉNERGIE (comme l'UI card comptage) pour le
  // tableau « Compteurs et leur intégration à la GTB ». Réutilise les groupes
  // d'énergie (label + icône + couleur) ; ne garde que les compteurs
  // physiquement présents (hors service exclus), chacun portant son statut
  // d'intégration ternaire (managed_by_bms).
  const bmsMetersByEnergy = meterEnergyGroups
    .map(g => ({
      energy: g.energy,
      meters: g.zones
        .flatMap(z => z.items)
        .filter(m => isTrue(m.present_actual) && !isTrue(m.out_of_service)),
    }))
    .filter(g => g.meters.length);
  // Compteurs avec de VRAIES notes d'auditeur (notes_html, saisies via
  // l'éditeur riche) ou des photos. On EXCLUT le champ `notes` plein texte :
  // il est auto-rempli par le resync avec une description du compteur
  // (« Compteur électrique en zone … ») qui n'est PAS une note de l'auditeur —
  // l'afficher sous « Détails relevés par l'auditeur » induisait en erreur.
  const metersWithDetails = enrichedMeters.filter(m => m.notes_html || (m.photos && m.photos.length));

  // Map id → device pour résoudre les FK équipement / équipement de régulation
  // (mig 129) à l'export. Sinon les noms ne s'afficheraient pas dans le PDF.
  const devicesById = new Map(devices.map(d => [d.id, d]));
  const deviceNameOrDash = id => {
    if (id == null) return null;
    const d = devicesById.get(id);
    if (!d) return null;
    return d.name || d.brand || d.model_reference || `Équipement #${d.id}`;
  };

  // Mig 180 : 1 ligne par système. Le nom affichable du système vient de
  // bacs_audit_systems.custom_label (joint en SQL).
  const thermalAll = thermalRaw.map(t => {
    const prodDevice = t.generator_device_id ? devicesById.get(t.generator_device_id) : null;
    const distDevice = t.distribution_device_id ? devicesById.get(t.distribution_device_id) : null;
    const emitDevice = t.emission_device_id ? devicesById.get(t.emission_device_id) : null;
    const generatorEnergy = prodDevice?.energy_source || null;
    const generatorAgeYears = prodDevice?.age_years ?? null;
    // Granularité de l'émetteur : saisie explicite (mig 187) sinon dérivée du
    // type de régulation d'émission — même règle que l'UI et le plan d'action.
    const granularityKey = resolveEmissionGranularity(emitDevice);
    const hasAutoReg = !!(emitDevice?.regulation_type_emission
      || distDevice?.regulation_type_distribution
      || prodDevice?.regulation_type_production
      || (t.regulation_type && t.regulation_type !== 'none'));
    // Régulation automatique en 3 états : « non » seulement si un équipement
    // relié déclare explicitement ne pas en avoir ; sans information, « non
    // renseignée » (jamais ✗ déduit d'une absence de donnée).
    const linkedDevices = [prodDevice, distDevice, emitDevice].filter(Boolean);
    const autoRegState = hasAutoReg ? 'yes'
      : linkedDevices.some(d => isFalse(d.has_regulation)) ? 'no' : 'unknown';
    const categoryLabel = SYSTEM_LABEL[t.category || 'heating'] || (t.category || 'heating');
    const customLabel = (t.system_label && t.system_label.trim()) || (t.label && t.label.trim()) || null;
    return {
    ...t,
    category: t.category || 'heating',
    categoryLabel,
    // R175-6 ne vise que le chauffage : les lignes de refroidissement sont
    // présentées pour information, marquées « hors champ R175-6 ».
    outOfR175_6: (t.category || 'heating') === 'cooling',
    autoRegState,
    // Mig 180 : nom affichable = custom_label du système, fallback legacy
    // sur t.label (mig 170). Masqué s'il répète la catégorie (« Chauffage
    // Chauffage »).
    displayLabel: customLabel && customLabel.toLowerCase() !== String(categoryLabel).toLowerCase()
      ? customLabel : null,
    // Mig 180 : libellé de granularité dérivée (ex. "Par pièce", "Par zone",
    // "Centralisée"). On garde regulationLabel pour compat templates PDF.
    regulationLabel: REGULATION_LABEL[granularityKey] || granularityKey,
    granularityKey,
    // Régulation déclarée à au moins un niveau (sur device) OU legacy ok.
    has_automatic_regulation: hasAutoReg,
    // Types de régulation par niveau, lisibles dans le PDF chapitre 5.
    productionRegulationType: regulationTypeLabel(prodDevice?.regulation_type_production),
    distributionRegulationType: regulationTypeLabel(distDevice?.regulation_type_distribution),
    emissionRegulationType: regulationTypeLabel(emitDevice?.regulation_type_emission),
    // Exemption R175-6 II = appareil INDÉPENDANT de chauffage au bois, marqué
    // explicitement par l'auditeur (colonne generator_exempt_wood). Ne PAS la
    // déduire de l'énergie : une chaudière bois collective n'est pas exemptée.
    generator_exempt_wood: isTrue(t.generator_exempt_wood),
    // Compat ascendante : `generatorLabel` et `generator_age_years` exposés
    // ici à partir du device pointé pour ne pas casser les templates PDF
    // qui les référencent (bacs-audit-tables.hbs).
    // generatorEnergy est une energy_source (gas/wood/electric…) → libellé
    // via ENERGY_LABEL (GENERATOR_LABEL est indexé par type de générateur).
    generatorLabel: generatorEnergy ? (ENERGY_LABEL[generatorEnergy] || generatorEnergy) : '—',
    generator_age_years: generatorAgeYears,
    // Mig 129 : décomposition par niveau Production / Distribution / Émission.
    // Chaque niveau expose nom de l'équipement-process + nom de l'équipement
    // de régulation + notes HTML.
    levels: [
      {
        key: 'production',
        label: 'Production',
        device_name: deviceNameOrDash(t.generator_device_id),
        regulation_device_name: deviceNameOrDash(t.production_regulation_device_id),
        notes_html: t.production_notes_html || '',
        // Mig 179/181 : type de régulation + identité régulateur du device
        // d'émission process (chaudière, PAC…). On lit `regulation_type_production`
        // et la marque/réf du régulateur portée par ce device.
        regulation_type: regulationTypeLabel(prodDevice?.regulation_type_production),
        has_regulation: prodDevice?.has_regulation === 1 || prodDevice?.has_regulation === true,
        regulator_brand: prodDevice?.regulator_brand || null,
        regulator_model_reference: prodDevice?.regulator_model_reference || null,
        regulator_location: prodDevice?.regulator_location_production || null,
        has_any_regulation: !!(prodDevice?.regulation_type_production
          || prodDevice?.has_regulation === 1 || prodDevice?.has_regulation === true
          || prodDevice?.regulator_brand || prodDevice?.regulator_model_reference),
      },
      {
        key: 'distribution',
        label: 'Distribution',
        device_name: deviceNameOrDash(t.distribution_device_id),
        regulation_device_name: deviceNameOrDash(t.distribution_regulation_device_id),
        notes_html: t.distribution_notes_html || '',
        regulation_type: regulationTypeLabel(distDevice?.regulation_type_distribution),
        has_regulation: distDevice?.has_regulation === 1 || distDevice?.has_regulation === true,
        regulator_brand: distDevice?.regulator_brand || null,
        regulator_model_reference: distDevice?.regulator_model_reference || null,
        regulator_location: distDevice?.regulator_location_distribution || null,
        has_any_regulation: !!(distDevice?.regulation_type_distribution
          || distDevice?.has_regulation === 1 || distDevice?.has_regulation === true
          || distDevice?.regulator_brand || distDevice?.regulator_model_reference),
      },
      {
        key: 'emission',
        label: 'Émission',
        device_name: deviceNameOrDash(t.emission_device_id),
        regulation_device_name: deviceNameOrDash(t.emission_regulation_device_id),
        notes_html: t.emission_notes_html || '',
        regulation_type: regulationTypeLabel(emitDevice?.regulation_type_emission),
        has_regulation: emitDevice?.has_regulation === 1 || emitDevice?.has_regulation === true,
        regulator_brand: emitDevice?.regulator_brand || null,
        regulator_model_reference: emitDevice?.regulator_model_reference || null,
        regulator_location: emitDevice?.regulator_location_emission || null,
        has_any_regulation: !!(emitDevice?.regulation_type_emission
          || emitDevice?.has_regulation === 1 || emitDevice?.has_regulation === true
          || emitDevice?.regulator_brand || emitDevice?.regulator_model_reference),
      },
    ],
    };
  });
  // Parité avec l'UI (BacsAuditDetailView.thermalFiltered) : on ne garde que les
  // couples (zone, catégorie) dont un système est réellement PRÉSENT dans la
  // zone, et on exclut les zones techniques. Sans ce filtre, le chapitre 5 du
  // PDF affichait des lignes de régulation pour des usages absents (ex. une
  // « climatisation » dans une zone qui n'a pas de clim).
  const thermalTechnicalZoneIds = new Set(
    zones.filter(z => (z.kind || 'functional') === 'technical').map(z => z.zone_id)
  );
  const thermalPresentCats = new Map(); // zone_id -> Set('heating'|'cooling')
  for (const s of enrichedSystems) {
    if (s.present !== 1) continue;
    if (thermalTechnicalZoneIds.has(s.zone_id)) continue;
    if (s.system_category === 'heating' || s.system_category === 'cooling') {
      if (!thermalPresentCats.has(s.zone_id)) thermalPresentCats.set(s.zone_id, new Set());
      thermalPresentCats.get(s.zone_id).add(s.system_category);
    }
  }
  // Ordre des zones du chapitre 2 (comme les tableaux Systèmes et Compteurs),
  // chauffage avant refroidissement (relecture PDF 2026-09-24 : ordre des
  // zones différent d'un tableau à l'autre).
  const thermalZoneRank = new Map(zones.map((z, i) => [z.zone_id, i]));
  const THERMAL_CAT_RANK = { heating: 0, cooling: 1 };
  const thermal = thermalAll.filter(t =>
    !thermalTechnicalZoneIds.has(t.zone_id)
    && thermalPresentCats.get(t.zone_id)?.has(t.category || 'heating')
  ).sort((a, b) =>
    ((thermalZoneRank.get(a.zone_id) ?? Number.MAX_SAFE_INTEGER) - (thermalZoneRank.get(b.zone_id) ?? Number.MAX_SAFE_INTEGER))
    || ((THERMAL_CAT_RANK[a.category || 'heating'] ?? 9) - (THERMAL_CAT_RANK[b.category || 'heating'] ?? 9))
  );

  // Plan de mise en conformite groupe par severite
  // metersById construit ici (avant l'usage dans la map ci-dessous) ; la
  // construction d'origine plus bas est conservée mais redondante côté
  // sémantique — laissée pour ne pas casser d'autres call sites.
  const _metersByIdEarly = new Map(meters.map(m => [m.id, m]));
  // Tri par theme (A->H) puis severite (blocking->minor) puis r175 puis id.
  // Cf. lib/routes/bacs-audit/_action-cards.js. La renumerotation suit ce
  // tri : BACS-001 = premiere action du theme A en severite la plus haute.
  // Strip des balises `{{zone:N}}` / `{{system:N}}` / `{{device:N}}`
  // (utilisees cote UI pour faire des pilules cliquables) → en texte brut
  // pour le PDF, en utilisant les labels reels des entites referencees.
  // Helper local : on construit les lookups au passage si pas deja fait.
  const zonesByIdLocal = new Map((zones || []).map(z => ({ id: z.id, name: z.name })).map(z => [z.id, z]));
  const systemsByIdLocal = new Map((systems || []).map(s => [s.id, s]));
  const SYSTEM_LABEL_FR_LOCAL = SYSTEM_LABEL_FR;
  // Decor (icone FontAwesome + couleur) par categorie de systeme, aligne
  // sur CATEGORY_ICON de pdf.js et SystemCategoryIcon.vue.
  const { renderFaIconSvg } = require('../../lib/pdf');
  const SYSTEM_DECOR_PDF = {
    heating:                { icon: 'fire',         color: '#dc2626' },
    cooling:                { icon: 'snowflake',    color: '#0891b2' },
    ventilation:            { icon: 'fan',          color: '#64748b' },
    dhw:                    { icon: 'faucet',       color: '#0284c7' },
    lighting_indoor:        { icon: 'lightbulb',    color: '#f59e0b' },
    lighting_outdoor:       { icon: 'tower-cell',   color: '#f59e0b' },
    electricity_production: { icon: 'solar-panel',  color: '#16a34a' },
  };
  function escHtml(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function resolveTagAsPill(type, id) {
    const n = Number(id);
    if (type === 'zone') {
      const z = zonesByIdLocal.get(n);
      const label = z?.name || `Zone ${n}`;
      return `<span class="tag-pill tag-pill-zone">${renderFaIconSvg("location-dot", "#1b2842", "10")} ${escHtml(label)}</span>`;
    }
    if (type === 'system') {
      const s = systemsByIdLocal.get(n);
      if (!s) return `<span class="tag-pill tag-pill-system">Système ${n}</span>`;
      const label = s.custom_label || SYSTEM_LABEL_FR_LOCAL[s.system_category] || s.system_category || 'Système';
      const decor = SYSTEM_DECOR_PDF[s.system_category];
      // Pastille neutre ; seule l'icône garde la couleur de la catégorie (un
      // chauffage en rouge se lisait comme une action bloquante — charte PDF).
      const zname = s.zone_name ? `<span class="tag-pill-meta"> · ${escHtml(s.zone_name)}</span>` : '';
      return `<span class="tag-pill tag-pill-system">${decor ? renderFaIconSvg(decor.icon, decor.color, "10") + " " : ""}${escHtml(label)}${zname}</span>`;
    }
    if (type === 'device') {
      const d = devicesById.get(n);
      const label = d ? (d.name || [d.brand, d.model_reference].filter(Boolean).join(' ') || `Équipement #${n}`)
                      : `Équipement ${n}`;
      return `<span class="tag-pill tag-pill-device">${renderFaIconSvg("gear", "#475569", "10")} ${escHtml(label)}</span>`;
    }
    return '';
  }
  function stripActionTags(text) {
    if (!text) return text;
    // 1) Echappe le HTML existant
    let html = escHtml(text);
    // 2) Injecte les pilules a la place des balises
    html = html.replace(/\{\{(zone|system|device):(\d+)\}\}/g, (_m, type, id) => resolveTagAsPill(type, id));
    return html;
  }
  // Variante texte brut (PDF synthèse / tableaux denses) : remplace les
  // balises {{zone:id}} / {{system:id}} / {{device:id}} par juste le
  // libellé entité, sans chip ni SVG ni couleur. Sinon le HTML produit
  // par stripActionTags() apparaît brut dans le tableau récap quand on
  // le rend via {{title}} (handlebars escape par défaut). Résolveur partagé
  // avec la vue commerciale et l'export CSV (_action-tags.js).
  const plainTags = makePlainTagResolver({ zones, systems, devices });
  const resolveTagAsPlain = plainTags.label;
  const stripActionTagsToPlain = plainTags.strip;
  // Lignes « • … » saisies dans le texte → vraies lignes à puce (retrait
  // suspendu : la 2e ligne ne repart plus sous la puce — relecture PDF
  // 2026-09-24). Le rendu reste en `white-space: pre-line` : pas de saut de
  // ligne ajouté autour d'une ligne à puce (bloc).
  function bulletsToHtml(html) {
    if (!html || !String(html).includes('•')) return html;
    const lines = String(html).split('\n');
    const isLi = (l) => /^\s*•\s?/.test(l);
    return lines.map((line, i) => {
      const cur = isLi(line) ? `<span class="acd-li">${line.replace(/^\s*•\s?/, '')}</span>` : line;
      const sep = i > 0 && !isLi(line) && !isLi(lines[i - 1]) ? '\n' : '';
      return sep + cur;
    }).join('');
  }
  // Convertit une description multi-sections en HTML avec sous-titres.
  // Format en entree : « Titre\nContenu\n\nTitre\nContenu... ». Si pas
  // de structure detectee (pas de \n\n), retombe sur le rendu inline.
  function descriptionToHtml(text) {
    if (!text) return text;
    if (!text.includes('\n\n')) return bulletsToHtml(stripActionTags(text));
    const blocks = text.split('\n\n').map(block => {
      const idx = block.indexOf('\n');
      if (idx < 0) return `<div class="acd-body">${bulletsToHtml(stripActionTags(block))}</div>`;
      const candidate = block.slice(0, idx).trim();
      const body = block.slice(idx + 1);
      const looksLikeTitle = candidate.length > 0 && candidate.length < 80 &&
        !candidate.includes('{{') && !candidate.startsWith('•') && !candidate.startsWith('  •');
      if (looksLikeTitle) {
        return `<div class="acd-section"><div class="acd-title">${escHtml(candidate)}</div><div class="acd-body">${bulletsToHtml(stripActionTags(body))}</div></div>`;
      }
      return `<div class="acd-body">${bulletsToHtml(stripActionTags(block))}</div>`;
    });
    return blocks.join('');
  }

  const numberedItems = sortActions(actionItemsRaw).map((a, idx) => {
    // Enrichit avec usage/type de compteur + énergie (depuis source_meter_id)
    // ou usage système (depuis source_device_id) pour les pills colorées
    // du PDF chap 7. Sans ça, les actions s'affichent en texte brut alors
    // qu'on saurait coder le contexte visuellement.
    let meterUsage = null, meterType = null, deviceSystemCategory = null;
    if (a.source_meter_id) {
      const m = _metersByIdEarly.get(a.source_meter_id);
      if (m) { meterUsage = m.usage || null; meterType = m.meter_type || null; }
    }
    if (a.source_device_id) {
      const d = devicesById.get(a.source_device_id);
      if (d) deviceSystemCategory = d.system_category || null;
    }
    return {
      ...a,
      // Strip des balises pour le rendu PDF (les UI Vue parsent l'original).
      title: stripActionTags(a.title),
      // Variante texte brut pour le PDF synthèse (tableaux denses) qui
      // rend en {{title_plain}} (échappé) : chips + SVG inline n'ont
      // pas leur place dans un tableau récap scannable.
      title_plain: stripActionTagsToPlain(a.title),
      description: descriptionToHtml(a.description),
      // Section « Condition d'application » (portée R175-2 II sous condition
      // de TRI) : reprise telle quelle sur les cartes groupées.
      scope_condition: (/(?:^|\n\n)Condition d'application\n([\s\S]*?)(?=\n\n|$)/.exec(a.description || '') || [])[1] || null,
      // « Portée à confirmer » (chaud/froid tenu pour obligatoire faute de
      // puissance relevée) : reprise sur la carte groupée (relecture R2 C3).
      scope_note: (/(?:^|\n\n)Portée à confirmer\n([\s\S]*?)(?=\n\n|$)/.exec(a.description || '') || [])[1] || null,
      // Éditeur riche vide (« <p></p> ») : pas de rubrique « Préconisations
      // Buildy » sans contenu.
      alternative_solutions_html: String(a.alternative_solutions_html || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim()
        ? a.alternative_solutions_html : null,
      display_number: 'BACS-' + String(idx + 1).padStart(3, '0'),
      // Réserve (contrat de maintenance, export des données) : obligation à
      // respecter, étiquetée « Réserve » — ne dégrade pas le verdict.
      is_reserve: isReserveAction(a),
      severity_display: isReserveAction(a) ? 'reserve' : a.severity,
      card_key:         cardOfAction(a).card,
      card_subsection:  cardOfAction(a).subsection,
      meter_usage: meterUsage,
      meter_type: meterType,
      device_system_category: deviceSystemCategory,
    };
  });
  // Exemptions « règle des 5 % » regroupées par usage (une ligne par usage,
  // zones listées) : la part s'apprécie sur l'ensemble des équipements de la
  // fonction, pas zone par zone (relecture clarté R2 m19).
  const exemptionItems = (() => {
    const sysById = new Map(systems.map(x => [x.id, x]));
    const byCat = new Map();
    for (const a of exemptionRaw.filter(x => x.source_subtype === 'negligible_5pct')) {
      const sys = sysById.get(a.source_system_id) || {};
      const cat = sys.system_category || 'other';
      if (!byCat.has(cat)) byCat.set(cat, { label: SYSTEM_LABEL[cat] || 'Autre usage', zones: [], justifications: [] });
      const e = byCat.get(cat);
      if (a.zone_name && !e.zones.includes(a.zone_name)) e.zones.push(a.zone_name);
      const j = (sys.negligible_justification || '').trim();
      if (j && !e.justifications.includes(j)) e.justifications.push(j);
    }
    return [...byCat.values()].map(e => ({
      title: e.label,
      zones_label: e.zones.length
        ? `${e.zones.length} zone${e.zones.length > 1 ? 's' : ''} : ${e.zones.join(', ')}`
        : null,
      justification: e.justifications.join(' ; ') || null,
    }));
  })();
  const vigilanceItems = exemptionRaw.filter(a => a.source_subtype !== 'negligible_5pct' && a.source_subtype !== 'data_export_capability').map(a => ({
    title: stripActionTagsToPlain(a.title),
    description: stripActionTagsToPlain(a.description || ''),
  }));
  // Recommandations hors décret (non comptées dans le plan).
  const outOfDecreeItems = exemptionRaw.filter(a => a.source_subtype === 'data_export_capability').map(a => ({
    title: stripActionTagsToPlain(a.title),
    description: stripActionTagsToPlain(a.description || ''),
  }));
  const actionItems = { blocking: [], major: [], minor: [], reserves: [] };
  for (const a of numberedItems) (a.is_reserve ? actionItems.reserves : actionItems[a.severity])?.push(a);
  const actionStats = {
    blocking: actionItems.blocking.length,
    major: actionItems.major.length,
    minor: actionItems.minor.length,
    reserves: actionItems.reserves.length,
    total: actionItems.blocking.length + actionItems.major.length + actionItems.minor.length + actionItems.reserves.length,
  };

  // ── Groupement des actions repetitives par type (refonte v2.x) ──
  // Les audits genèrent souvent 10-20 actions identiques (ex : ajouter
  // un compteur électrique en zone X — éclairage). On les présente en
  // 1 carte groupée avec tableau interne plutôt qu'en N cartes répétitives.
  // Décision de groupement = même clé + au moins 3 items.
  // `devicesById` est déjà construite plus haut (cf. backfill thermal).
  const metersById = new Map(meters.map(m => [m.id, m]));
  // `justification` = le POURQUOI légal, en langage non-technique, affiché en
  // tête de chaque carte groupée (à parité avec les cartes individuelles qui
  // portent Constat/Recommandation). Sans elle, les actions BLOQUANTES — les
  // plus graves — étaient les seules du plan sans explication.
  const METER_REQUIREMENT = 'Le décret demande que la GTB suive, enregistre et analyse en continu, par zone fonctionnelle et au pas horaire, les données de production et de consommation énergétique des systèmes techniques, et qu\'elle conserve ces données à l\'échelle mensuelle pendant cinq ans (R175-3 1°).';
  const GROUP_LABELS = {
    meter_addition: {
      label: 'Installer les compteurs manquants pour le suivi des consommations',
      columns: ['zone', 'usage', 'meter_type'],
      justification: `${METER_REQUIREMENT} Les consommations listées ci-dessous ne sont mesurées par aucun compteur : un compteur communicant est à installer pour chacune.`,
    },
    meter_connection: {
      label: 'Rendre communicants les compteurs présents',
      columns: ['zone', 'usage', 'meter_type'],
      justification: 'Ces compteurs sont présents mais ne transmettent pas leurs relevés : la consommation est mesurée, mais ne peut être ni suivie au pas horaire ni archivée par la GTB (R175-3 1°). Un raccordement de chacun (liaison filaire ou passerelle) permet la remontée automatique des relevés.',
    },
    meter_bms_integration: {
      label: 'Intégrer à la GTB les compteurs communicants',
      columns: ['zone', 'usage', 'meter_type'],
      justification: 'Ces compteurs sont communicants mais ne sont pas relevés par la GTB : leur consommation n\'est ni suivie au pas horaire ni archivée (R175-3 1°). Leur intégration à la GTB est à prévoir.',
    },
    // Raccordements système identiques (souvent l'éclairage ou l'ECS de
    // chaque zone) : une carte et un tableau plutôt que N fiches répétées.
    system_connection: {
      label: 'Raccorder à la GTB les systèmes qui n\'y sont pas reliés',
      columns: ['zone', 'system', 'device'],
      justification: 'Les systèmes d\'automatisation et de contrôle « sont interopérables avec les différents systèmes techniques du bâtiment » (R175-3 3°). Les équipements listés ci-dessous ne communiquent pas avec la GTB. Le décret n\'impose ni solution ni composant particulier : un protocole normalisé, une interface de programmation (API) ou une passerelle conviennent — en général un module de communication sur le régulateur existant ou, à défaut, une passerelle. Le raccordement permet aussi l\'arrêt manuel depuis la GTB et préserve le fonctionnement autonome des systèmes (R175-3 4°).',
    },
    meter_out_of_service: {
      label: 'Remettre en service ou remplacer les compteurs hors service',
      columns: ['zone', 'usage', 'meter_type'],
      justification: `Ces compteurs sont hors service : les consommations correspondantes ne sont plus mesurées. ${METER_REQUIREMENT} Les éléments défaillants sont à réparer ou à remplacer rapidement (R175-4).`,
    },
  };
  function deriveGroupKey(item) {
    if (item.source_subtype === 'system_not_interoperable') return 'system_connection';
    if (!item.source_meter_id) return null; // sinon, seuls les compteurs sont groupés
    if (item.source_subtype === 'meter_bms_integration') return 'meter_bms_integration';
    if (item.source_subtype === 'meter_out_of_service') return 'meter_out_of_service';
    if (item.category === 'meter_addition') return 'meter_addition';
    if (item.category === 'meter_connection') return 'meter_connection';
    return null; // non groupable
  }
  function enrichItemForGroup(item) {
    const out = {
      display_number: item.display_number,
      zone_name: item.zone_name || '—',
      r175_article: item.r175_article,
      meter_type: null,
      meter_type_label: '',
      meter_usage: null,
      meter_usage_label: '',
      device_name: '',
      device_brand: '',
      system_label: '',
    };
    if (item.source_subtype === 'system_not_interoperable') {
      const sys = systems.find(x => x.id === item.source_system_id);
      out.system_label = sys ? (SYSTEM_LABEL[sys.system_category] || sys.system_category) : '—';
      out.device_name = String(item.title_plain || '').replace(/^Raccorder à la GTB : /, '');
    }
    if (item.source_meter_id) {
      const m = metersById.get(item.source_meter_id);
      const em = enrichedMeters.find(x => x.id === item.source_meter_id);
      if (em && em.mergedLeadGroup) out.zone_name = `${em.mergedLeadGroup} (zone regroupée)`;
      if (m) {
        out.meter_type = m.meter_type || null;
        out.meter_type_label = METER_TYPE_LABEL[m.meter_type] || m.meter_type || '—';
        out.meter_usage = m.usage || null;
        out.meter_usage_label = METER_USAGE_LABEL[m.usage] || m.usage || '—';
        if (!item.zone_name && !m.zone_id) out.zone_name = 'Général bâtiment';
      }
    }
    if (item.source_device_id) {
      const d = devicesById.get(item.source_device_id);
      if (d) {
        out.device_name = d.name || '—';
        out.device_brand = d.brand || '';
        out.system_label = SYSTEM_LABEL[d.system_category] || d.system_category || '—';
      }
    }
    return out;
  }
  function buildGroupedPlan(items) {
    const buckets = new Map();
    const result = [];
    // Étape 1 : remplir les buckets
    // Un groupe ne réunit que des actions de même type, de même sévérité et
    // de même portée (obligatoire / sous condition de TRI) : sinon la carte
    // affichait la sévérité la plus haute et perdait la « Condition
    // d'application » des actions mineures (relecture juridique R1 M1).
    for (const it of items) {
      const key = deriveGroupKey(it);
      if (!key) {
        result.push({ kind: 'single', item: it });
        continue;
      }
      const bucketKey = `${key}|${it.severity}|${it.scope_condition ? 'conditional' : 'mandatory'}|${it.scope_note || ''}`;
      if (!buckets.has(bucketKey)) buckets.set(bucketKey, { key, list: [] });
      buckets.get(bucketKey).list.push(it);
    }
    // Étape 2 : décider grouper ou aplatir
    for (const { key, list } of buckets.values()) {
      if (list.length >= 3) {
        const cfg = GROUP_LABELS[key];
        // Severite = celle du 1er item du bucket (homogene pour un meme
        // source_subtype). Permet au partial _action-group.hbs de styler
        // la card sans recevoir le param explicitement.
        const sev = list[0].severity;
        result.push({
          kind: 'group',
          key,
          label: cfg.label,
          justification: cfg.justification || null,
          // Bâtiment existant, systèmes raccordés sous condition de TRI
          // (R175-2 II) : la condition, portée par chaque action, est
          // rappelée une fois sur la carte groupée.
          condition: list[0].scope_condition || null,
          scope_note: list[0].scope_note || null,
          columns: cfg.columns,
          count: list.length,
          r175_article: list[0].r175_article,
          severity: sev,
          severity_label: sev === 'blocking' ? 'Bloquantes' : sev === 'major' ? 'Majeures' : 'Mineures',
          severity_class: 'sev-' + sev,
          first_number: list[0].display_number,
          last_number: list[list.length - 1].display_number,
          // Numéros du groupe : plages continues « BACS-009 → BACS-012 »,
          // sinon énumération (un groupe n'est pas toujours d'un seul tenant).
          numbers_label: (() => {
            const nums = list.map(x => Number(String(x.display_number).replace(/\D/g, ''))).sort((x, y) => x - y);
            const fmt = (n) => 'BACS-' + String(n).padStart(3, '0');
            const runs = [];
            for (const n of nums) {
              const last = runs[runs.length - 1];
              if (last && n === last[1] + 1) last[1] = n; else runs.push([n, n]);
            }
            return runs.map(([a, b]) => (a === b ? fmt(a) : b === a + 1 ? `${fmt(a)}, ${fmt(b)}` : `${fmt(a)} à ${fmt(b)}`)).join(', ');
          })(),
          items: list.map(enrichItemForGroup),
        });
      } else {
        for (const it of list) result.push({ kind: 'single', item: it });
      }
    }
    return result;
  }
  const actionItemsGrouped = {
    blocking: buildGroupedPlan(actionItems.blocking),
    major: buildGroupedPlan(actionItems.major),
    minor: buildGroupedPlan(actionItems.minor),
  };

  // ── Regroupement par CARTE de l'audit (refonte 2026-05-29 v2) ──
  // Le plan suit les cartes du stepper (Identification → Systèmes →
  // Compteurs → GTB → Régulation → Inspections → Divers) ; la carte GTB
  // contient des sous-sections (Capacités / Intégration équipements /
  // Intégration compteurs / Maintenance & formation). Voir _action-cards.js.
  // Chaque carte/sous-section embarque sa propre version condensee
  // (>=3 items du meme source_subtype regroupes en « X compteurs à poser »
  // au lieu de N lignes a plat).
  // Normalisation : chaque carte expose TOUJOURS un tableau `subsections`
  // non vide (singleton pour les cartes sans sous-division), pour que le
  // template PDF puisse iterer uniformement. Le sous-titre n'est rendu que
  // si subsections.length > 1.
  const actionItemsByCard = groupByCard(numberedItems).map(card => {
    const hasSub = (card.subsections || []).length > 0;
    const subsections = hasSub
      ? card.subsections.map(sub => ({ ...sub, grouped: buildGroupedPlan(sub.items) }))
      : [{
          key: card.key, label: card.label,
          count: card.count, blocking: card.blocking, major: card.major, minor: card.minor,
          items: card.items, grouped: buildGroupedPlan(card.items),
        }];
    return { ...card, grouped: buildGroupedPlan(card.items), subsections };
  });

  // Justifications (Annexe C). La source est derivee de la FK non-NULL
  // (mig 125) pour rester lisible dans le PDF.
  // Libellé LISIBLE de l'origine d'une action (Annexe C « Donnée audit »).
  // On résout les ids internes en noms d'équipement/système/zone — un
  // « #10818 » n'a aucun sens pour un property/asset manager.
  function actionSourceLabel(a) {
    if (a.source_system_id) {
      const label = resolveTagAsPlain('system', a.source_system_id) || '';
      return label.charAt(0).toUpperCase() + label.slice(1);
    }
    if (a.source_meter_id) {
      const m = enrichedMeters.find(mm => mm.id === a.source_meter_id);
      // Compteur unique d'une zone regroupée : l'origine est la zone regroupée
      // entière, pas sa seule zone de rattachement (relecture PDF 2026-09-24).
      const where = m && m.mergedLeadGroup ? `zone regroupée ${m.mergedLeadGroup}` : m?.zoneLabel;
      return m
        ? `Compteur ${m.usageLabel && m.usageLabel !== '—' ? m.usageLabel : (m.typeLabel || '')}`.trim()
          + (where ? ` · ${where}` : '')
        : 'Compteur';
    }
    if (a.source_thermal_id) {
      const t = thermal.find(tt => tt.id === a.source_thermal_id);
      return t
        ? `Régulation ${(t.categoryLabel || '').toLowerCase()}`.trim() + (t.zone_name ? ` · ${t.zone_name}` : '')
        : 'Régulation thermique';
    }
    if (a.source_device_id)        return resolveTagAsPlain('device', a.source_device_id);
    if (a.source_inspection_id)    return 'Inspection périodique';
    if (a.source_bms_document_id)  return 'Système de supervision (GTB)';
    return 'Point relevé pendant l\'audit';
  }
  // Annexe C — on RÉSOUT les balises {{system:NNNN}} / {{zone:...}} / {{device:...}}
  // en libellé lisible (« ventilation · Plot Bureaux »), comme le chapitre 7.
  // Sans ça, un property/asset manager voyait « Raccorder {{system:10818}} au BACS ».
  // Même ordre et mêmes numéros BACS-NNN que le plan (D-40) : le lecteur
  // relie chaque justification à son action.
  const rawActionById = new Map(actionItemsRaw.map(a => [a.id, a]));
  // Origine lisible du constat, reprise par le tableau A3 du plan.
  for (const a of numberedItems) a.source_label = actionSourceLabel(rawActionById.get(a.id) || a);
  const justifications = numberedItems.map(a => {
    const raw = rawActionById.get(a.id) || a;
    return {
      number: a.display_number,
      title: stripActionTagsToPlain(raw.title),
      article: raw.r175_article || '—',
      source: actionSourceLabel(raw),
      manual: raw.auto_generated === 0 || raw.auto_generated === false,
      // Structure la description en sous-sections HTML (Constat / Exigence /
      // Recommandation…) comme le plan, au lieu d'un pavé aplati. Les
      // balises {{system:…}} sont d'abord résolues en libellé lisible.
      description: descriptionToHtml(stripActionTagsToPlain(raw.description || raw.title)),
    };
  });
  // Annexe C : justifications identiques regroupées (cf. _action-cards.js).
  const justificationGroups = groupJustifications(justifications);

  // Articles BACS (Annexe A). Le texte riche vient du seed, mais la
  // TRAÇABILITÉ (version du décret + lien Légifrance + date d'effet) est
  // sourcée de bacs_knowledge — source unique opposable — pour que le PDF
  // livré au client renvoie au texte officiel et affiche la bonne version.
  const decreeMeta = new Map(
    db.db.prepare(`
      SELECT code, title, body_html, source_url, version_label, effective_from
      FROM bacs_knowledge WHERE source = 'decree' AND kind = 'article'
    `).all().map(r => [r.code, r])
  );
  // Le TEXTE de l'annexe vient de bacs_knowledge (body_html), source unique
  // partagée avec les tooltips UI. Repli sur le seed uniquement si la base
  // n'a pas encore été ré-ingérée (body_html null).
  const bacsArticles = bacsArticlesData.BACS_ARTICLES.map(a => {
    const meta = decreeMeta.get(a.code) || {};
    return {
      code: a.code,
      title: a.title,
      html: meta.body_html || a.full_html,
      // Repère de lecture Buildy (dates calculées, report 2030…) : toujours
      // issu du seed, jamais de bacs_knowledge — il n'est pas opposable et
      // s'affiche à part du texte officiel.
      reading_note_html: a.reading_note_html || null,
      source_url: meta.source_url || null,
      version_label: meta.version_label || null,
      effective_from: meta.effective_from || null,
    };
  });

  // Detection solution Buildy (pour mention R175-5 native)
  const buildySolution = bms && /buildy/i.test(`${bms.existing_solution || ''} ${bms.existing_solution_brand || ''}`);

  // Version (compteur d'exports BACS pour ce document) — mock en preview
  let version;
  if (previewMode) {
    version = 'bacs-vAPERCU';
  } else {
    const previousCount = db.db.prepare(`
      SELECT COUNT(*) AS c FROM exports WHERE af_id = ? AND kind = 'pdf-bacs-audit'
    `).get(documentId).c;
    version = `bacs-v${previousCount + 1}`;
  }
  // Libellé lisible de la version (couverture, en-tête) : le code interne
  // « bacs-vN » reste celui des exports et du journal.
  const versionLabel = previewMode ? 'Aperçu — document provisoire' : `Version ${version.replace(/^bacs-v/, '')}`;

  const exportDate = frLongDate(new Date().toISOString()) || new Date().toLocaleDateString('fr-FR', {
    day: '2-digit', month: 'long', year: 'numeric',
  });

  // Bouton « Devis » de la page de clôture : l'objet de l'e-mail cite le
  // site et la date du rapport, pour rattacher la demande à cet audit.
  const quoteClient = site?.customer_name || af.client_name || '';
  const quoteSubject = `Devis de mise en conformité BACS — ${auditShortName(af)}`
    + `${quoteClient ? ` (${quoteClient})` : ''} — rapport du ${exportDate}`;
  const quoteMailto = `mailto:contact@buildy.fr?subject=${encodeURIComponent(quoteSubject)}`;

  // R175-6 applicabilite : declencheur (PC > 21/07/2021 OU travaux generateur)
  const R175_6_TRIGGER = '2021-07-21';
  const pcAfter = af.bacs_building_permit_date && af.bacs_building_permit_date > R175_6_TRIGGER;
  // Travaux « engagés à compter d'un an après la publication » du décret du
  // 20 juillet 2020 : le 21/07/2021 inclus (R175-6 II 2°).
  const worksAfter = af.bacs_generator_works_date && af.bacs_generator_works_date >= R175_6_TRIGGER;
  // Formatage français des dates pour l'encart didactique du PDF
  // (« 15 mars 2018 » plutôt que « 2018-03-15 »).
  function frDate(isoDate) {
    return frLongDate(isoDate);
  }
  // R175-6 en 3 états (jamais « non applicable » déduit d'une date absente) :
  //  - applies:true  → permis déposé ou travaux sur le générateur de chaleur
  //                    après le 21/07/2021 ;
  //  - applies:false → aucun chauffage, OU permis antérieur ET (date des
  //                    derniers travaux antérieure, OU tous les générateurs de
  //                    chaleur installés avant 2021 d'après leur âge) ;
  //  - undetermined  → une date manque : « à confirmer » (verdict à qualifier).
  const r175_6_dates = {
    permitDateFr: frDate(af.bacs_building_permit_date),
    worksDateFr: frDate(af.bacs_generator_works_date),
  };
  const r175_6_heating = thermal.filter(t => (t.category || 'heating') === 'heating');
  const r175_6_genAges = r175_6_heating
    .filter(t => t.generator_device_id != null)
    .map(t => Number(t.generator_age_years));
  const r175_6_currentYear = new Date().getFullYear();
  const r175_6_generatorsOld = r175_6_genAges.length > 0
    && r175_6_genAges.every(a => Number.isFinite(a) && a > 0 && r175_6_currentYear - a <= 2020);
  let r175_6_applicable;
  if (!r175_6_heating.length) {
    r175_6_applicable = { applies: false, noHeating: true,
      reason: 'aucun système de chauffage relevé sur le site', ...r175_6_dates };
  } else if (pcAfter || worksAfter) {
    r175_6_applicable = { applies: true,
      reason: pcAfter && worksAfter
        ? 'permis de construire déposé après le 21 juillet 2021 et travaux sur le générateur de chaleur engagés depuis cette date'
        : (pcAfter ? 'permis de construire déposé après le 21 juillet 2021' : 'travaux d\'installation ou de remplacement d\'un générateur de chaleur engagés depuis le 21 juillet 2021'),
      byWorks: !!worksAfter && !pcAfter,
      ...r175_6_dates };
  } else if (af.bacs_building_permit_date && (af.bacs_generator_works_date || r175_6_generatorsOld)) {
    r175_6_applicable = { applies: false, basisAges: !af.bacs_generator_works_date,
      reason: af.bacs_generator_works_date
        ? 'permis de construire déposé au plus tard le 21 juillet 2021 et derniers travaux sur le générateur de chaleur antérieurs à cette date'
        : 'permis de construire déposé au plus tard le 21 juillet 2021 et générateurs de chaleur installés avant 2021, d\'après leur âge',
      ...r175_6_dates };
  } else {
    r175_6_applicable = { applies: false, undetermined: true,
      reason: !af.bacs_building_permit_date
        ? 'date du permis de construire non communiquée'
        : 'permis de construire déposé au plus tard le 21 juillet 2021, mais date des derniers travaux sur le générateur de chaleur non communiquée',
      ...r175_6_dates };
  }
  // Réconciliation âge générateur ↔ applicabilité (point de vigilance ciblé) :
  // quand aucun déclencheur document-level n'est renseigné mais qu'un générateur
  // PRÉSENT est assez récent pour avoir été installé vers/après le 21/07/2021,
  // la conclusion « non applicable » peut simplement refléter une date de
  // travaux non saisie. On invite alors l'auditeur à la renseigner.
  if (!r175_6_applicable.applies && !worksAfter) {
    const currentYear = new Date().getFullYear();
    const seen = new Set();
    const recent = [];
    for (const t of thermal) {
      const age = Number(t.generator_age_years);
      if (Number.isFinite(age) && age > 0 && (currentYear - age) >= 2021) {
        const key = `${t.zone_name}|${age}`;
        if (seen.has(key)) continue;
        seen.add(key);
        recent.push({ zone: t.zone_name, installYear: currentYear - age });
      }
    }
    if (recent.length) r175_6_applicable.recentGeneratorVigilance = recent;
  }

  // Detail du calcul auto chauffage + clim — initial sans contributions.
  // Les contributions effectives (heat_contrib / cool_contrib / inScope)
  // sont ajoutees plus bas apres computeAutoPower() pour pouvoir afficher
  // dans le PDF page 7 ce que CHAQUE device apporte vraiment au cumul
  // R175-2 (ex : un radiateur eau chaude « hors cumul » a contrib = 0).
  // Équipements de chauffage et de climatisation dont une puissance est
  // saisie, plus les équipements de production SANS puissance (« Non
  // renseignée — non comptée ») : le lecteur voit ce qui manque au cumul
  // (relecture clarté R2 M5).
  const heatingCoolingBreakdown = devices
    .filter(d => ['heating','cooling'].includes(d.system_category)
      && (d.power_kw != null || d.power_kw_cooling != null
        || (!isTrue(d.out_of_service) && !isTrue(d.is_backup) && parseRoles(d.device_role).includes('production'))))
    .map(d => ({
      id: d.id,
      name: d.name, brand: d.brand, model_reference: d.model_reference,
      power_kw: d.power_kw, quantity: d.quantity,
      total_power_kw: d.total_power_kw, has_multiple: d.has_multiple,
      power_kw_cooling: d.power_kw_cooling, total_power_kw_cooling: d.total_power_kw_cooling,
      power_missing: d.power_kw == null && d.power_kw_cooling == null,
      zone_name: d.zone_name,
      category: d.system_category,
      categoryLabel: SYSTEM_LABEL[d.system_category] || d.system_category,
      // Partage (mig 143) : mentionné, jamais re-compté.
      sharedWithLabel: d.sharedWithLabel || null,
    }));
  const heatingCoolingTotal = heatingCoolingBreakdown.reduce(
    (s, d) => s + (Number(d.power_kw) || 0) * (Number(d.quantity) || 1), 0);

  // Boilerplate methodologie + disclaimers : lit la DB (admin-editable),
  // fallback sur les fichiers .js statiques si la table est vide.
  const methRows = db.pdfBoilerplate.list({ kind: 'methodology' });
  const methodology = methRows.length
    ? methRows.map(r => ({ title: r.title || '', body: r.body_html }))
    : bacsAuditMethodologyStatic;
  const discRows = db.pdfBoilerplate.list({ kind: 'disclaimer' });
  const disclaimers = discRows.length
    ? discRows.map(r => r.body_html)
    : bacsAuditDisclaimersStatic;

  // Le kind 'site_audit' a été supprimé (mig 106) ; tout audit est désormais
  // un bacs_audit. On garde isBacs/isSiteAudit en sortie pour compat des
  // templates existants — les `{{#if isBacs}}` continuent à s'appliquer.
  const isBacs = true;

  // Chapitre « Inspections » (R175-5-1) : UNE règle d'affichage partagée par
  // le sommaire, le titre et la numérotation du plan (sinon deux chapitres
  // « 7 » : le chapitre s'affichait aussi sur « rien à tracer » alors que
  // le sommaire ne le listait qu'avec une inspection saisie).
  const hasInspectionData = !!(inspections && (inspections.last_inspection_date
    || inspections.last_inspection_inspector || inspections.last_inspection_anomalies_html
    || inspections.last_inspection_recommendations_html || inspections.next_inspection_due_date
    || inspections.notes));
  const showInspectionsChapter = isBacs && (hasInspectionData || isTrue(af.inspection_not_applicable));
  const planChapterNumber = showInspectionsChapter ? 8 : 7;
  // Encadré « aucune inspection tracée » : le texte dépend de
  // l'assujettissement (l'inspection vise la GTB des bâtiments assujettis).
  const applicabilityStatus = af.bacs_applicability_status || null;
  const inspectionNotice = applicabilityStatus === 'not_subject'
    ? { title: 'Inspection périodique sans objet.',
        body: 'Le bâtiment n\'est pas assujetti au décret BACS : l\'inspection périodique de la GTB (R175-5-1) ne s\'applique pas.' }
    : applicabilityStatus
      ? { title: 'Aucune inspection tracée dans l\'audit.',
          body: 'Pour ce bâtiment assujetti, l\'inspection périodique de la GTB est obligatoire : au plus tard le 1er janvier 2025 pour une GTB déjà en place au 8 avril 2023, sinon dans les deux ans qui suivent son installation, puis au moins tous les cinq ans. Elle relève de l\'initiative du propriétaire et reste distincte du présent audit.' }
      : { title: 'Aucune inspection à déclarer.',
          body: 'L\'inspection périodique de la GTB (R175-5-1) relève de l\'initiative du propriétaire ; elle est distincte du présent audit.' };

  // ── Charts (lot B2) ──
  // Donut severite : 3 segments des actions correctives.
  // Radar conformite : score 0-100 sur 7 axes R175 derive de bms.* + actions.
  // Bar usage power : kW agregee par usage (heating / cooling / ventilation /
  // dhw / lighting), pour visualiser la repartition energetique du site.
  const sevDonutDataUrl = await getCharts().donutSeverity({
    blocking: actionStats.blocking,
    major: actionStats.major,
    minor: actionStats.minor,
  });

  // Score conformite par axe : derive du nombre d'actions critiques sur
  // chaque axe / total d'exigences. Plus il y a d'actions sur l'axe, plus
  // le score baisse. 100 = aucune action ouverte sur cet axe (parfait).
  function scoreForAxis(filterFn) {
    const axisActions = actionItemsRaw.filter(filterFn);
    if (!axisActions.length) return 100;
    // Penalisations : bloquante = -40, majeure = -20, mineure = -10
    let score = 100;
    for (const a of axisActions) {
      score -= a.severity === 'blocking' ? 40 : (a.severity === 'major' ? 20 : 10);
    }
    return Math.max(0, score);
  }
  // Radar de conformite R175 retire (PO retour : pas pertinent dans le PDF,
  // synthese executive deja portee par les compteurs + donut severite).

  // Bar usage power : agrege devices par system_category
  const powerByUsage = new Map();
  for (const d of devices) {
    if (d.power_kw == null) continue;
    const cat = d.system_category || 'autre';
    powerByUsage.set(cat, (powerByUsage.get(cat) || 0) + Number(d.power_kw) * (Number(d.quantity) || 1));
  }
  const USAGE_ORDER = ['heating', 'cooling', 'ventilation', 'dhw', 'lighting_indoor', 'lighting_outdoor'];
  const barItems = USAGE_ORDER
    .filter(u => powerByUsage.has(u))
    .map(u => ({
      label: SYSTEM_LABEL[u] || u,
      kw: Math.round(powerByUsage.get(u) * 10) / 10,
      color: getCharts().COLORS[u === 'heating' ? 'heating'
        : u === 'cooling' ? 'cooling'
        : u === 'ventilation' ? 'ventilation'
        : u === 'dhw' ? 'dhw'
        : 'lighting'],
    }));
  // Graphique « puissance par usage » retiré du rapport (relecture PDF
  // 2026-09-24) : il additionnait les puissances brutes de tous les
  // équipements, émetteurs compris, et contredisait la puissance retenue du
  // tableau de calcul juste au-dessus. `barItems` reste exposé pour le débogage.
  const barUsagePowerDataUrl = null;

  // Recap chiffre pour le PDF tableaux de synthese (4 tuiles d'en-tete)
  // ATTENTION : les champs *Integrated agregent historiquement null + false.
  // Pour les consommateurs qui ont besoin de distinguer "non repondu" de
  // "explicitement non" (synthese Claude / MCP), utiliser les variantes
  // *_unanswered / *_false ajoutees ci-dessous. Helpers ternaires centralises
  // dans ./_ternary.js (cf. plan de coherence audit BACS).
  const recapStats = {
    devicesTotal: devices.length,
    devicesPresent: devices.filter(d => !d.out_of_service).length,
    devicesIntegrated: devices.filter(d => isTrue(d.managed_by_bms)).length,
    devicesIntegratedUnanswered: devices.filter(d => d.managed_by_bms == null).length,
    devicesIntegratedFalse: devices.filter(d => isFalse(d.managed_by_bms)).length,
    devicesHs: devices.filter(d => d.out_of_service).length,
    metersRequired: enrichedMeters.filter(m => m.required).length,
    metersPresent: enrichedMeters.filter(m => isTrue(m.present_actual) && !m.out_of_service).length,
    metersIntegrated: enrichedMeters.filter(m => isTrue(m.managed_by_bms)).length,
    metersIntegratedUnanswered: enrichedMeters.filter(m => m.managed_by_bms == null).length,
    metersIntegratedFalse: enrichedMeters.filter(m => isFalse(m.managed_by_bms)).length,
    // Gap analysis : compteurs requis ET CONSTATÉS absents (present_actual = 0
    // explicite). Un compteur requis dont la présence n'a PAS été vérifiée
    // (present_actual = null) n'est PAS « manquant » — il est « à qualifier »
    // (metersPresenceUnanswered). Les hors-service sont exclus (existent
    // physiquement, seront remplacés). Aligne avec _meter-coverage et le MCP.
    metersMissing: enrichedMeters.filter(m => m.required && isFalse(m.present_actual) && !m.out_of_service).length,
    metersPresenceUnanswered: enrichedMeters.filter(m => m.required && m.present_actual == null && !m.out_of_service && !m.coveredByGroup && !m.notRequiredReason).length,
    // Compteurs requis ET présents (tuile A3 « requis présents / requis ») :
    // metersPresent compte aussi les compteurs non requis (eau, etc.).
    metersRequiredPresent: enrichedMeters.filter(m => m.required && isTrue(m.present_actual) && !m.out_of_service).length,
    // Tuile A3 alignée sur le plan d'actions (relecture clarté R2 M9) : les
    // compteurs « à installer » sont ceux du plan ; ceux couverts par le
    // comptage unique d'une zone regroupée sont comptés à part.
    metersCoveredByGroup: enrichedMeters.filter(m => m.coveredByGroup && !isTrue(m.present_actual)).length,
    metersRequiredEffective: enrichedMeters.filter(m => m.required && !m.notRequiredReason && !(m.coveredByGroup && !isTrue(m.present_actual))).length,
    metersToInstall: numberedItems.filter(a => a.category === 'meter_addition' && !['done', 'declined'].includes(a.status)).length,
    metersToInstallConditional: numberedItems.filter(a => a.category === 'meter_addition' && !['done', 'declined'].includes(a.status) && a.scope_condition).length,
  };

  // ── Items 5 + 8 — cumul automatique des puissances ──
  // Calcule la puissance chaud / froid cumulée à partir des équipements
  // physiques saisis, en appliquant la règle de calcul de chaque type
  // (thermodynamique, chaudière, joule, sous-station). La puissance
  // retenue = max(chaud, froid) — « chaud et froid ne se cumulent pas ».
  const autoPower = computeAutoPower(devices);
  const powerSummary = resolveTotalPower(af, autoPower);
  // Détail par device pour la traçabilité PDF (« Puissance retenue : X kW »).
  const powerCalcByDeviceId = new Map();
  for (const d of autoPower.devices) {
    powerCalcByDeviceId.set(d.id, {
      ...d._power,
      typeLabel: POWER_CALC_TYPE_LABEL[d._power.type] || d._power.type,
      reasonLabel: d._power.reason ? (POWER_EXCLUSION_REASON_LABEL[d._power.reason] || null) : null,
    });
  }
  // Puissance RETENUE par système (chauffage, climatisation, ventilation) :
  // l'en-tête de la carte affichait la somme brute (secours et émetteurs
  // compris), près du double de la puissance retenue du site (relecture
  // clarté R2 M4). Les équipements partagés portent aussi leur calcul.
  for (const sys of enrichedSystems) {
    let retained = 0;
    for (const d of sys.devices) {
      const pc = powerCalcByDeviceId.get(d.id);
      if (!pc) continue;
      d.powerCalc = pc;
      if (sys.system_category === 'heating') retained += pc.heat || 0;
      else if (sys.system_category === 'cooling') retained += pc.cool || 0;
      else if (sys.system_category === 'ventilation') retained += Math.max(pc.heat || 0, pc.cool || 0);
    }
    for (const d of sys.shared_devices || []) {
      const pc = powerCalcByDeviceId.get(d.id);
      if (pc) d.powerCalc = pc;
    }
    sys.display_power_kw = sys.total_power_kw;
    if (['heating', 'cooling', 'ventilation'].includes(sys.system_category)) {
      sys.retained_power_kw = Math.round(retained * 10) / 10;
      // Installé > retenu (secours, émetteurs, aval) : on affiche les deux.
      sys.power_differs = (sys.total_power_kw || 0) > sys.retained_power_kw + 0.05;
      if (!sys.power_differs && sys.retained_power_kw > 0) sys.display_power_kw = sys.retained_power_kw;
    }
  }
  // Enrichi le breakdown avec les contributions effectives R175-2 : un
  // device peut être inscrit (power_kw > 0) mais ne PAS être additionné
  // au cumul (cas réseau urbain aval, secours, bois). Sans cette
  // distinction, la somme brute affichée prête à confusion (incident
  // analyse v12 : 241 kW affiché alors que la puissance retenue est 192).
  for (const row of heatingCoolingBreakdown) {
    const pc = powerCalcByDeviceId.get(row.id);
    if (pc) {
      row.heat_contrib = Math.round((pc.heat || 0) * 10) / 10;
      row.cool_contrib = Math.round((pc.cool || 0) * 10) / 10;
      row.in_scope = !!pc.inScope;
      row.calc_type_label = pc.typeLabel;
      // Motif lisible de l'exclusion (émetteur aval / secours / hors service),
      // rendu dans le PDF à côté de « Hors cumul » pour justifier l'exclusion.
      row.exclusion_reason_label = pc.reason ? (POWER_EXCLUSION_REASON_LABEL[pc.reason] || null) : null;
    } else {
      row.heat_contrib = 0;
      row.cool_contrib = 0;
      row.in_scope = false;
    }
  }
  // Vue récapitulative : 3 chiffres pour le pied du tableau page 7.
  const powerRecap = {
    heatRetained: Math.round((autoPower.heatKw || 0) * 10) / 10,
    coolRetained: Math.round((autoPower.coolKw || 0) * 10) / 10,
    retained: Math.round((autoPower.retainedKw || 0) * 10) / 10,
  };

  // ── Item 7d/7e — zones fonctionnelles de suivi ──
  // Regroupe, par catégorie technique, les zones desservies par un
  // équipement partagé non séparable (metering_separable='no'). Chaque
  // regroupement est accompagné de sa justification écrite pour le PDF.

  // Synthese de conformite (cover + page L'essentiel + tableau de bord R175)
  // La puissance affichée dans le calcul d'assujettissement R175-2 suit le
  // mode retenu (auto = cumul calculé, manual = valeur saisie).
  const applicabilityLabelForSummary = af.bacs_applicability_status ? APPLICABILITY_LABEL[af.bacs_applicability_status] : null;
  const documentForSummary = { ...af, bacs_total_power_kw: powerSummary.effectiveKw };
  const compliance = buildComplianceSummary({
    document: documentForSummary,
    actionItems,
    actionItemsRaw: numberedItems,
    bms,
    r175_6_applicable,
    applicabilityLabel: applicabilityLabelForSummary,
    // Lot 1 — evidence par axe R175 : on passe les données sources pour
    // que chaque ligne du tableau de bord porte ses chiffres-preuve.
    devices,
    thermal,
    inspections,
    powerSummary: {
      effectiveKw: powerSummary.effectiveKw,
      autoHeatKw: autoPower.heatKw,
      autoCoolKw: autoPower.coolKw,
      // Puissances non saisies → statut « présumé » (jamais présenté
      // comme un constat « entre 70 et 290 kW »).
      incompletePowerCount: powerSummary.incompletePowerCount || 0,
    },
    recapStats,
  });

  // Site sans GTB : les exigences R175-3 à R175-5 sont non conformes sans
  // action propre — toutes relèvent de « Mettre en place une GTB ». La
  // colonne des actions y renvoie au lieu d'un « — » (relecture clarté R2 m27).
  {
    const noGtbAction = numberedItems.find(a => a.source_subtype === 'no_gtb' && !['done', 'declined'].includes(a.status));
    if (noGtbAction && compliance?.r175Dashboard) {
      for (const row of compliance.r175Dashboard) {
        if (row.verdict === 'non_compliant' && !row.actionsCount && row.axis !== 'r175_2') {
          row.seeActionNumber = noGtbAction.display_number;
        }
      }
    }
  }

  // Constat identique sur plusieurs exigences (site sans GTB, GTB hors
  // service, présence non renseignée) : imprimé une seule fois au-dessus du
  // tableau de bord au lieu d'être répété ligne par ligne, pour que le
  // tableau tienne sur une page (relecture PDF 2026-09-24). Présentation PDF
  // seulement : `note` reste intact pour les autres consommateurs.
  let r175DashboardCommonNote = null;
  if (compliance?.r175Dashboard) {
    const SHARED_NOTE_PLURAL = {
      'Aucune GTB sur le site — exigence non satisfaite.':
        'aucune GTB sur le site, ces exigences ne sont pas satisfaites.',
      'GTB hors service — exigence non satisfaite tant qu\'elle n\'est pas remise en service.':
        'GTB hors service, ces exigences ne sont pas satisfaites tant qu\'elle n\'est pas remise en service.',
      'Présence d\'une GTB non renseignée lors de l\'audit : cette exigence reste à qualifier.':
        'présence d\'une GTB non renseignée lors de l\'audit, ces exigences restent à qualifier.',
    };
    const rows = compliance.r175Dashboard;
    for (const [note, plural] of Object.entries(SHARED_NOTE_PLURAL)) {
      const idx = rows.map((r, i) => (r.note === note ? i : -1)).filter(i => i >= 0);
      if (idx.length < 2) continue;
      const codeOf = (i) => rows[i].displayCode || rows[i].code;
      const contiguous = idx.every((v, k) => k === 0 || v === idx[k - 1] + 1);
      const codes = contiguous
        ? `${codeOf(idx[0])} à ${codeOf(idx[idx.length - 1])}`
        : idx.map(codeOf).join(', ');
      for (const i of idx) rows[i].noteShared = true;
      r175DashboardCommonNote = { codes, text: plural };
      break;
    }
  }

  // Lien Légifrance par axe du tableau de bord R175 : chaque exigence renvoie
  // au texte officiel de son article parent (source unique bacs_knowledge).
  // Pas d'extraction d'alinéa (risque de mauvais découpage sur un texte de
  // loi) — le texte intégral est en Annexe A, ici on ne pose que le lien.
  if (compliance?.r175Dashboard) {
    const parentDecreeCode = (code) => {
      const m = String(code || '').match(/^R175-\d+(?:-\d+)?/);
      return m ? m[0] : null;
    };
    for (const ax of compliance.r175Dashboard) {
      const parent = parentDecreeCode(ax.code);
      ax.source_url = parent ? (decreeMeta.get(parent)?.source_url || null) : null;
    }
  }

  // Vue satellite statique du site (Google Static Maps) embarquée en data
  // URL. Best-effort : null si la clé/API est indisponible → PDF sans vue.
  // `zones` sert de repli de centrage quand le site n'a pas de coordonnées.
  // ── Annexe « Documents joints » : documents du site cochés « Inclure dans
  // le rapport » (décochés par défaut). Vignettes pour les images qui ne sont
  // pas déjà imprimées dans un chapitre.
  let reportAttachments = [];
  if (site) {
    const attachmentRows = db.db.prepare(`
      SELECT * FROM site_documents
      WHERE site_id = ? AND include_in_report = 1
    `).all(site.site_id);
    if (attachmentRows.length) {
      const devLabel = (d) => d.name || [d.brand, d.model_reference].filter(Boolean).join(' ') || `Équipement ${d.id}`;
      reportAttachments = buildReportAttachments(attachmentRows, {
        documentId,
        zonesById: new Map(zones.map(z => [z.zone_id, { label: z.name }])),
        systemsById: new Map(enrichedSystems.map(x => [x.id, {
          label: [x.displayLabel || x.categoryLabel, x.zone_name].filter(Boolean).join(' · '),
        }])),
        devicesById: new Map(devices.map(d => [d.id, { label: devLabel(d) }])),
        metersById: new Map(enrichedMeters.map(m => [m.id, {
          label: [m.typeLabel, m.usageLabel, m.zone_id ? m.zone_name : 'Général bâtiment'].filter(Boolean).join(' · '),
        }])),
        actionsById: new Map(numberedItems.map(a => [a.id, { label: a.display_number }])),
        checklistById: new Map(db.db.prepare(`
          SELECT c.id, cat.label FROM bacs_audit_checklist c
          LEFT JOIN bacs_checklist_catalog cat ON cat.key = c.catalog_key
          WHERE c.document_id = ?
        `).all(documentId).filter(r => r.label).map(r => [r.id, { label: r.label }])),
        chapters: { zones: 2, systems: 3, meters: 4, bms: 6 },
      });
      const attachmentsRoot = path.resolve(config.attachmentsDir, '..', 'site-documents', site.site_uuid);
      await Promise.all(reportAttachments.filter(a => a.needsThumbnail).map(async (a) => {
        a.dataUrl = await optimizeFileToDataUrl(path.join(attachmentsRoot, a.filename)).catch(() => null);
      }));
    }
  }
  const reportAttachmentImages = reportAttachments.filter(a => a.dataUrl);
  const reportAttachmentTranscripts = reportAttachments.filter(a => a.transcript);

  const siteMapDataUrl = await buildSiteStaticMap({ site, zones });
  // Vue satellite annotée pour le chapitre 2 « Zones fonctionnelles ».
  // Apparaît uniquement si au moins une zone a des coordonnées GPS.
  const zonesMap = await buildZonesStaticMap({ site, zones: zonesFunctional });
  // Propage l'initiale + couleur de pin depuis la légende sur chaque zone
  // fonctionnelle (lookup par nom). Permet d'afficher la pastille dans le
  // tableau d'inventaire du chap 2 — cohérent avec la légende sous la map.
  if (zonesMap?.legend?.length) {
    const byName = new Map(zonesMap.legend.map(l => [l.name, l]));
    for (const z of zonesFunctional) {
      const hit = byName.get(z.name);
      if (hit) {
        z.mapInitial = hit.initial;
        z.mapColor = hit.color;
      }
    }
  }

  // Surface du site pour le pont avec le decret tertiaire (item 12).
  // Source : sites.surface_m2 si renseignee, sinon cumul des surfaces des
  // zones. Le decret tertiaire (dispositif Eco Energie Tertiaire / OPERAT)
  // vise les batiments a usage tertiaire de plus de 1000 m2.
  const zoneSurfaceTotal = zones.reduce(
    (sum, z) => sum + (Number(z.surface_m2) || 0), 0);
  const siteSurfaceM2 = (site && Number(site.surface_m2) > 0)
    ? Number(site.surface_m2)
    : (zoneSurfaceTotal > 0 ? zoneSurfaceTotal : null);
  const tertiaryDecreeApplies = isBacs && siteSurfaceM2 != null && siteSurfaceM2 > 1000;

  // ── Item 13 — base de consommations mensuelles de référence ──
  // Lignes saisies depuis les factures client/locataires. Agrégées par
  // énergie sur l'année la mieux renseignée + graphe de répartition.
  const energyHistoryRows = site
    ? db.siteEnergyHistory.listBySite(site.site_id)
    : [];
  const energyReference = buildEnergyReference(energyHistoryRows, siteSurfaceM2);
  const energyMonthlyChartDataUrl = energyReference
    ? await getCharts().energyMonthlyBar({
      series: energyReference.chartSeries,
      unit: energyReference.chartUnit,
    })
    : null;

  // Lot 5 — bordereau : enrichit l'auteur de l'audit avec son nom d'affichage
  // (display_name ou email) pour pouvoir tracer « Audit réalisé par … » sur
  // le PDF, sans casser les consommateurs qui lisent juste `document.created_by`.
  const creatorRow = af.created_by ? db.users.getById(af.created_by) : null;
  const auditDocument = {
    ...af,
    created_by_name: creatorRow?.display_name || creatorRow?.email || null,
  };

  return {
    document: auditDocument,
    isBacs,
    showInspectionsChapter,
    planChapterNumber,
    inspectionNotice,
    isSiteAudit: !isBacs,
    site,
    siteMapDataUrl,
    zonesMap,
    siteSurfaceM2,
    // Pont decret tertiaire (item 12) : true si batiment tertiaire > 1000 m2.
    tertiaryDecreeApplies,
    // Item 13 — base de consommations de référence (bandeau + graphe).
    energyReference,
    energyMonthlyChartDataUrl,
    zones,
    // Split fonctionnelles BACS vs techniques (tableaux/compteurs) pour
    // affichage en deux blocs distincts dans le PDF ch.2.
    // Les zones techniques vides (aucun équipement ni compteur ni note)
    // sont retirées pour ne pas polluer le tableau de synthèse : une
    // armoire TGBT inventoriée mais sans contenu n'apporte rien au
    // lecteur (incident PDF Communay 2026-06-08).
    zonesFunctional,
    // Parité UI↔PDF : on liste TOUTES les zones techniques inventoriées par
    // l'auditeur (le tableau « Locaux techniques » est un simple inventaire
    // nom/nature/surface). L'ancien filtre « anti-encombrement » masquait les
    // locaux sans compteur/note (ex. « PDL Enedis »), pourtant visibles dans
    // l'UI — créant un écart. Un local inventorié doit figurer au rapport.
    zonesTechnical,
    zonesFunctionalHaveNotes,
    zonesTechnicalHaveNotes,
    systemsByZone,
    // Variante synthèse : seules les zones avec au moins un système
    // présent + ≥1 équipement. Évite les zones-headers orphelins
    // « Armoire TGBT » suivis de rien. Le rapport principal continue
    // d'utiliser systemsByZone (qui montre aussi les systèmes non
    // présents / non concernés pour expliquer le hors-champ).
    systemsByZoneForSynthesis: systemsByZone
      .map(g => ({ ...g, items: g.items.filter(s => s.present === 1 && (s.device_count || 0) > 0) }))
      .filter(g => g.items.length),
    synthesisShowLocation,
    synthesisShowGtb,
    synthesisSystemsColspan,
    // Zones fonctionnelles sans système thermique présent (hors R175-2).
    zonesOutOfBacsScope,
    // Item 7d/7e — zones fonctionnelles de suivi (regroupement + justification).
    functionalZones,
    // Item 4 — structure juridique + assujettissement par périmètre.
    ownershipStructureLabel,
    defaultLiability,
    // Chapitre 3 : un encadré unique explique le raccordement « sous
    // condition de TRI » (bâtiment existant), au lieu d'une répétition par système.
    hasConditionalSystems: enrichedSystems.some(s => s.compliance && s.compliance.verdict === 'conditional'),
    siteWithoutGtb,
    // Bandeau GTB des tableaux A3 : marque et modèle non répétés s'ils
    // figurent déjà dans le nom de la solution (R2 m18).
    gtbBanner: (() => {
      if (!bms) return null;
      const name = String(bms.existing_solution || '').trim();
      const has = (part) => !!part && name.toLowerCase().includes(String(part).trim().toLowerCase());
      const brand = String(bms.existing_solution_brand || '').trim();
      const model = String(bms.model_reference || '').trim();
      return {
        name: name || 'Solution non renseignée',
        brand: brand && !has(brand) ? brand : null,
        model: model && !has(model) ? model : null,
      };
    })(),
    // « Points à qualifier » de L'essentiel : exigences dont le verdict reste
    // indéterminé faute d'information, et compteurs requis dont la présence
    // n'est pas vérifiée (relecture clarté R2 m31, juridique R1 m10).
    pointsToQualify: [
      ...(compliance.r175Dashboard || [])
        .filter(r => r.verdict === 'unknown')
        .map(r => {
          const note = (r.note || '').replace(/^Information non communiquée lors de l'audit : /, '');
          return `${r.label} (${r.displayCode})${note ? ` : ${note.charAt(0).toLowerCase()}${note.slice(1)}` : ' : à qualifier.'}`;
        }),
      ...(recapStats.metersPresenceUnanswered
        ? [recapStats.metersPresenceUnanswered > 1
          ? `La présence de ${recapStats.metersPresenceUnanswered} compteurs requis n'a pas été vérifiée lors de l'audit (chapitre 4).`
          : 'La présence d\'un compteur requis n\'a pas été vérifiée lors de l\'audit (chapitre 4).']
        : []),
    ],
    maintenanceReserveNumber: (numberedItems.find(a => a.source_subtype === 'maintenance' && !['done', 'declined'].includes(a.status)) || {}).display_number || null,
    ownershipNotes: site?.ownership_notes || null,
    siteParties: sitePartiesEnriched,
    hasLiabilityData,
    compliance,
    r175DashboardCommonNote,
    reportAttachments,
    reportAttachmentImages,
    reportAttachmentTranscripts,
    meters: enrichedMeters,
    // Vue filtrée pour le tableau du chapitre 4 (sans les compteurs ni
    // requis ni présents — bruit pour l'intégrateur).
    metersForPdf,
    metersWithDetails,
    thermal,
    bms,
    // Ligne « Accès du gestionnaire et des exploitants aux données » dérivée
    // des deux questions détaillées quand elles sont répondues (sinon le
    // champ global) : plus de « Partiel » contredit par deux « Non » (R2 M14).
    dataAccessRow: (() => {
      if (!bms) return null;
      const m = bms.data_provision_to_manager;
      const o = bms.data_provision_to_operators;
      const yn = (v) => (isTrue(v) ? 'oui' : 'non');
      if ((isTrue(m) || isFalse(m)) && (isTrue(o) || isFalse(o))) {
        if (isTrue(m) && isTrue(o)) return { state: 'yes', label: 'Oui' };
        if (isFalse(m) && isFalse(o)) return { state: 'no', label: 'Non' };
        return { state: 'partial', label: `Partiel (gestionnaire : ${yn(m)} ; exploitants : ${yn(o)})` };
      }
      const g = bms.gestionnaire_exploitant_access;
      if (g === 'yes') return { state: 'yes', label: 'Oui' };
      if (g === 'no') return { state: 'no', label: 'Non' };
      if (g === 'partial') return { state: 'partial', label: 'Partiel' };
      return { state: null, label: 'Non renseigné' };
    })(),
    bmsComponents,
    inspections,
    bmsManagedDevices,
    bmsManagedDevicesByZone,
    bmsUnmanagedDevices,
    bmsUnmanagedDevicesByZone,
    bmsUnansweredDevices,
    bmsUnansweredDevicesByZone,
    bmsNotTargetedDevices,
    bmsOutOfScopeDevices,
    bmsDevicesByZone,
    bmsManagedMeters,
    bmsBrokenLinkMeters,
    bmsUnmanagedMeters,
    bmsUnansweredMeters,
    bmsMetersByEnergy,
    metersByZone,
    metersAnyOutOfService,
    meterCoverageMatrix,
    meterEnergyGroups,
    meterCoveredCount: enrichedMeters.filter(m => m.coveredByGroup && !isTrue(m.present_actual)).length,
    recapStats,
    buildySolution,
    actionItems,
    // Plan d'action groupé par subtype pour le PDF (ch.7) — réduit le
    // nombre de cartes en condensant les actions répétitives.
    actionItemsGrouped,
    // Plan d'action regroupe par carte de l'audit (alignement stepper).
    // Refonte 2026-05-29 v2 : remplacement du tri par theme R175.
    // Cf. _action-cards.js. La carte 'bms' contient des sous-sections.
    actionItemsByCard,
    actionStats,
    exemptionItems,
    vigilanceItems,
    outOfDecreeItems,
    bmsTopicNotes,
    bmsTopicOpportunities,
    // actionItemsRaw expose en realite les items NUMEROTES (BACS-XXX) pour
    // que les tableaux de synthese puissent les afficher en forme finale.
    // Si on a besoin des bruts sans numerotation, ils sont reconstitubles
    // depuis numberedItems.
    actionItemsRaw: numberedItems,
    synthesisHtml: af.audit_synthesis_html || null,
    // Note de synthèse (rédigée par l'IA) : datée, et signalée si le plan
    // d'actions a changé après sa rédaction (le tableau de bord et le plan
    // font alors foi).
    ...(() => {
      if (!af.audit_synthesis_html || !af.audit_synthesis_generated_at) return { synthesisDateFr: null, synthesisStale: false };
      const generated = new Date(af.audit_synthesis_generated_at);
      if (isNaN(generated)) return { synthesisDateFr: null, synthesisStale: false };
      const last = db.db.prepare(
        'SELECT MAX(updated_at) AS m FROM bacs_audit_action_items WHERE document_id = ? AND auto_generated = 1'
      ).get(documentId)?.m;
      const lastDate = last ? new Date(String(last).replace(' ', 'T') + 'Z') : null;
      const stale = !!(lastDate && !isNaN(lastDate) && lastDate > generated);
      const dateFr = generated.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
      return {
        synthesisDateFr: generated.getDate() === 1 ? dateFr.replace(/^1 /, '1er ') : dateFr,
        synthesisStale: stale,
        // Note périmée (plan modifié depuis sa rédaction) : jamais imprimée,
        // elle contredirait L'essentiel et le plan (relectures R1 M5, R2 C1) ;
        // le précheck demande de la régénérer (SYN-001).
        ...(stale ? { synthesisHtml: null } : {}),
      };
    })(),
    heatingCoolingBreakdown,
    heatingCoolingTotal: Math.round(heatingCoolingTotal * 10) / 10,
    // Vue récapitulative R175-2 (chaud retenu, froid retenu, max retenu).
    powerRecap,
    // Items 5 + 8 — cumul automatique des puissances chaud / froid.
    powerSummary,
    // Lot 2 — versioning juridique : version R175 actuellement en vigueur,
    // utilisée pour le footer PDF des exports intermédiaires (avant livraison).
    // À la livraison, on grave af.decree_version_label définitif. On
    // construit un libellé synthétique « R175 version applicable au JJ/MM/YYYY »
    // à partir du MAX(effective_from) des articles du décret encore en vigueur.
    currentDecreeVersionLabel: (() => {
      const row = db.db.prepare(`
        SELECT MAX(effective_from) AS dt FROM bacs_knowledge
        WHERE source = 'decree' AND effective_until IS NULL AND code LIKE 'R175-%'
      `).get();
      if (!row?.dt) return null;
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(row.dt);
      return m ? `Articles R175-1 à R175-6, version du ${new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).replace(/^1 /, '1er ')}` : `Articles R175-1 à R175-6, version du ${row.dt}`;
    })(),
    r175_6_applicable,
    complianceLabel: bms?.overall_compliance ? COMPLIANCE_LABEL[bms.overall_compliance] : null,
    applicabilityLabel: af.bacs_applicability_status ? APPLICABILITY_LABEL[af.bacs_applicability_status] : null,
    closingDeadlinePhrase: CLOSING_DEADLINE_PHRASE[af.bacs_applicability_status] || '',
    // Actions et réserves comptées à part sur la page de clôture (R2 m13).
    closingActionCount: actionStats.blocking + actionStats.major + actionStats.minor,
    closingConditionalCount: numberedItems.filter(a => a.scope_condition && !a.is_reserve).length,
    closingInspectionNote: showInspectionsChapter && bms && isTrue(bms.present)
      ? `L'inspection de la GTB en place suit l'échéance propre de l'article R175-5-1 (chapitre 7).`
      : '',
    bacsArticles,
    methodology,
    disclaimers,
    justifications,
    justificationGroups,
    // Auditeur = créateur de l'audit (pas la personne qui exporte) ; repli
    // sur l'utilisateur courant, puis « Buildy » (jamais un nom interne).
    authorName: (() => {
      const creator = af.created_by ? db.users.getById(af.created_by) : null;
      return creator?.display_name || user?.display_name || 'Buildy';
    })(),
    exportDate,
    quoteMailto,
    versionLabel,
    version,
    logoDataUrl: loadAssetDataUrl('logo-buildy.svg'),
    logoWhiteDataUrl: loadAssetDataUrl('logo-buildy-blanc.png'),
    // Charts (lot B2)
    sevDonutDataUrl,
    barUsagePowerDataUrl,
    barItems, // expose pour debug / fallback texte si chart manquant
  };
}

module.exports = { buildBacsAuditExportData };
