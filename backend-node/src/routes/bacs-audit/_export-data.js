'use strict';

// Construction du bundle de donnees pour le PDF / preview audit BACS.
// Extraite de exports.js pour pouvoir alimenter aussi la route /preview
// (rendu HTML in-browser sans Puppeteer).

const path = require('path');
const config = require('../../config');
const db = require('../../database');
const { loadAssetDataUrl } = require('../../lib/pdf');
const { optimizeFileToDataUrl } = require('../../lib/image-optimizer');
const { parseRoles } = require('../../lib/device-roles');
const { isTrue, isFalse } = require('./_ternary');
const { buildMeterCoverage } = require('./_meter-coverage');
const { buildSiteStaticMap, buildZonesStaticMap } = require('../../lib/static-map');
const { regulationTypeLabel } = require('../../lib/regulation-defaults');
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
  APPLICABILITY_LABEL, COMPLIANCE_LABEL, ZONE_NATURE_LABEL, TECHNICAL_ZONE_NATURES, OCCUPANCY_PROFILE_LABEL,
  OWNERSHIP_STRUCTURE_LABEL, PARTY_KIND_LABEL,
} = require('./_labels');
const { buildComplianceSummary } = require('./_compliance-summary');
// Items 5 + 8 — cumul automatique des puissances chaud / froid.
const { computeAutoPower, resolveTotalPower, POWER_CALC_TYPE_LABEL } = require('../../lib/bacs-audit-power');
// Item 7 — calcul des zones fonctionnelles de suivi (regroupement BACS).
const { computeFunctionalZones } = require('../../lib/bacs-functional-zones');
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
    isTechnical: z.nature ? TECHNICAL_ZONE_NATURES.has(z.nature) : false,
  }));
  // Split en deux listes pour le PDF — l'ordre interne (par position)
  // est préservé. `zonesFunctional` est la liste R175-1 6° au sens strict.
  const zonesFunctional = zones.filter(z => !z.isTechnical);
  const zonesTechnical = zones.filter(z => z.isTechnical);
  // Flags pour conditionner l'affichage du sous-bloc "Notes terrain par
  // zone" dans le PDF (évite un h3 orphelin si aucune zone n'a de note).
  const hasZoneNotes = (z) => !!(z.notes_html || z.notes || (z.photos && z.photos.length) || z.comfort_constraint);
  const zonesFunctionalHaveNotes = zonesFunctional.some(hasZoneNotes);
  const zonesTechnicalHaveNotes = zonesTechnical.some(hasZoneNotes);
  const systems = db.db.prepare(`
    SELECT s.*, z.name AS zone_name, z.nature AS zone_nature
    FROM bacs_audit_systems s LEFT JOIN zones z ON z.id = s.zone_id
    WHERE s.document_id = ?
    ORDER BY z.position, z.name, s.system_category
  `).all(documentId);
  const meters = db.db.prepare(`
    SELECT m.*, z.name AS zone_name FROM bacs_audit_meters m
    LEFT JOIN zones z ON z.id = m.zone_id
    WHERE m.document_id = ?
    ORDER BY z.position NULLS LAST, m.usage
  `).all(documentId);
  const bms = db.db.prepare('SELECT * FROM bacs_audit_bms WHERE document_id = ?').get(documentId) || null;
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
  const actionItemsRaw = db.db.prepare(`
    SELECT a.*, z.name AS zone_name FROM bacs_audit_action_items a
    LEFT JOIN zones z ON z.id = a.zone_id
    WHERE a.document_id = ? AND a.status NOT IN ('done', 'declined')
    ORDER BY a.position, a.id
  `).all(documentId);
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
           t.slug AS equipment_template_slug
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
      ? Math.round((Number(d.power_kw) || 0) * qty * 10) / 10
      : null;
    d.has_multiple = qty > 1;
    d.commLabel = d.communication_protocol
      ? (COMM_LABEL[d.communication_protocol] || d.communication_protocol)
      : 'Non communicant';
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
  for (const [, devs] of devicesBySystem) {
    devs.sort((a, b) => {
      const pa = rolePriorityPdf(a);
      const pb = rolePriorityPdf(b);
      if (pa !== pb) return pa - pb;
      return (a.name || '').toLowerCase().localeCompare((b.name || '').toLowerCase());
    });
  }

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
  const enrichedSystems = systems.map(s => {
    const devs = devicesBySystem.get(s.id) || [];
    const totalKw = devs.reduce((sum, d) => sum + (Number(d.power_kw) || 0) * (Number(d.quantity) || 1), 0);
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
      displayLabel: s.is_bacs === 0
        ? (s.custom_label || 'Usage')
        : (s.custom_label && s.custom_label.trim()
            ? `${SYSTEM_LABEL[s.system_category] || s.system_category} (${s.custom_label.trim()})`
            : (SYSTEM_LABEL[s.system_category] || s.system_category)),
      negativeLabel: SYSTEM_NEGATIVE_LABEL[s.system_category] || `Pas de ${(SYSTEM_LABEL[s.system_category] || s.system_category).toLowerCase()}`,
      commLabel: s.communication ? (COMM_LABEL[s.communication] || s.communication) : '—',
      devices: devs,
      device_count: devs.length,
      total_power_kw: totalKw,
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

  // Zones fonctionnelles sans système thermique présent → hors périmètre
  // R175-2 (assujettissement BACS calé sur chauffage/clim/ECS). Affichées
  // sous forme de note pédagogique en tête du chapitre 3 pour qu'un
  // lecteur exigeant (BE, organisme tiers R175-5-1) sache pourquoi
  // ces zones n'apparaissent pas dans l'inventaire des systèmes.
  const THERMAL_CATS = new Set(['heating', 'cooling', 'dhw']);
  const zonesWithThermal = new Set();
  for (const s of enrichedSystems) {
    if (s.zone_id != null && THERMAL_CATS.has(s.system_category) && s.present === 1) {
      zonesWithThermal.add(s.zone_id);
    }
  }
  const zonesOutOfBacsScope = zonesFunctional
    .filter(z => !zonesWithThermal.has(z.zone_id))
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
    return {
      ...m,
      typeLabel: METER_TYPE_LABEL[m.meter_type] || m.meter_type,
      usageLabel: m.zone_id ? (METER_USAGE_LABEL[m.usage] || m.usage) : '—',
      zoneLabel: m.zone_name || 'Compteur général',
      locationLabel: m.location_zone_name || null,
      isGeneral: !m.zone_id,
      protocolsList,
      protocolsLabel: protocolsList.join(' / '),
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
    for (const m of enrichedMeters) m.photos = meterPhotos.get(m.id) || [];
    for (const d of devices) d.photos = devicePhotos.get(d.id) || [];
    for (const sys of enrichedSystems) sys.photos = systemPhotos.get(sys.id) || [];
    if (bms) bms.photos = bmsPhotos;
  }

  // Listes GTB integration : devices + meters integres ET ce qui reste a
  // integrer (gap analysis pour l'integrateur Buildy — c'est la partie a
  // chiffrer dans le devis).
  const bmsManagedDevices = devices.filter(d => d.managed_by_bms).map(d => ({
    ...d,
    categoryLabel: SYSTEM_LABEL[d.system_category] || d.system_category,
  }));
  const bmsUnmanagedDevices = devices.filter(d => !d.managed_by_bms && !d.out_of_service).map(d => ({
    ...d,
    categoryLabel: SYSTEM_LABEL[d.system_category] || d.system_category,
  }));
  const bmsManagedMeters = enrichedMeters.filter(m => m.managed_by_bms);
  const bmsUnmanagedMeters = enrichedMeters.filter(m => !m.managed_by_bms && m.present_actual && !m.out_of_service);

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
  // Ordre : zones avec id en premier (suivant l'ordre d'apparition), puis general
  const metersByZone = [...metersByZoneMap.values()].sort((a, b) => {
    if (a.zone_id == null) return 1;
    if (b.zone_id == null) return -1;
    return 0;
  });

  // ── Matrice de couverture + sections par énergie du plan de comptage
  // (logique partagée avec la preview-fixture via `_meter-coverage.js`).
  const { meterCoverageMatrix, meterEnergyGroups } = buildMeterCoverage(enrichedMeters, zones);
  // Compteurs avec notes ou photos : pour le sous-bloc "Notes terrain"
  // de la section 4 (sinon on n'affiche rien, plutot que des cards vides).
  const metersWithDetails = enrichedMeters.filter(m => m.notes_html || m.notes || (m.photos && m.photos.length));

  // Map id → device pour résoudre les FK équipement / équipement de régulation
  // (mig 129) à l'export. Sinon les noms ne s'afficheraient pas dans le PDF.
  const devicesById = new Map(devices.map(d => [d.id, d]));
  const deviceNameOrDash = id => {
    if (id == null) return null;
    const d = devicesById.get(id);
    if (!d) return null;
    return d.name || d.brand || d.model_reference || `Équipement #${d.id}`;
  };

  // Mig 180 : 1 ligne par système. La granularité (per_room/per_zone/…)
  // est désormais dérivée du type de régulation d'émission du device
  // émetteur (regulation_type_emission). Le nom affichable du système
  // vient de bacs_audit_systems.custom_label (joint en SQL).
  const granularityFromEmissionType = emissionType => {
    if (!emissionType) return 'central_only';
    if (emissionType === 'thermostat_ambiant' || emissionType === 'vanne_thermostatique') return 'per_room';
    if (emissionType === 'sonde_zone') return 'per_zone';
    return 'central_only';
  };

  const thermal = thermalRaw.map(t => {
    const prodDevice = t.generator_device_id ? devicesById.get(t.generator_device_id) : null;
    const distDevice = t.distribution_device_id ? devicesById.get(t.distribution_device_id) : null;
    const emitDevice = t.emission_device_id ? devicesById.get(t.emission_device_id) : null;
    const generatorEnergy = prodDevice?.energy_source || null;
    const generatorAgeYears = prodDevice?.age_years ?? null;
    // Granularité dérivée de l'émetteur (mig 180), fallback sur l'archive.
    const derivedKey = granularityFromEmissionType(emitDevice?.regulation_type_emission);
    // Mig 187 : saisie explicite du champ regulation_granularity sur le device
    // émetteur prioritaire sur la dérivation depuis le type d'émission.
    const granularityKey = emitDevice?.regulation_granularity || derivedKey;
    const hasAutoReg = !!(emitDevice?.regulation_type_emission
      || distDevice?.regulation_type_distribution
      || prodDevice?.regulation_type_production
      || (t.regulation_type && t.regulation_type !== 'none'));
    return {
    ...t,
    category: t.category || 'heating',
    categoryLabel: SYSTEM_LABEL[t.category || 'heating'] || (t.category || 'heating'),
    // Mig 180 : nom affichable = custom_label du système, fallback legacy
    // sur t.label (mig 170), puis catégorie par défaut.
    displayLabel: (t.system_label && t.system_label.trim())
      || (t.label && t.label.trim())
      || SYSTEM_LABEL[t.category || 'heating']
      || (t.category || 'heating'),
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
    // Exemption R175-6 II déduite de l'énergie de production.
    generator_exempt_wood: generatorEnergy === 'wood',
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
      },
    ],
    };
  });

  // Plan de mise en conformite groupe par severite
  // metersById construit ici (avant l'usage dans la map ci-dessous) ; la
  // construction d'origine plus bas est conservée mais redondante côté
  // sémantique — laissée pour ne pas casser d'autres call sites.
  const _metersByIdEarly = new Map(meters.map(m => [m.id, m]));
  const numberedItems = [
    ...actionItemsRaw.filter(a => a.severity === 'blocking'),
    ...actionItemsRaw.filter(a => a.severity === 'major'),
    ...actionItemsRaw.filter(a => a.severity === 'minor'),
  ].map((a, idx) => {
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
      display_number: 'BACS-' + String(idx + 1).padStart(3, '0'),
      meter_usage: meterUsage,
      meter_type: meterType,
      device_system_category: deviceSystemCategory,
    };
  });
  const actionItems = { blocking: [], major: [], minor: [] };
  for (const a of numberedItems) actionItems[a.severity]?.push(a);
  const actionStats = {
    blocking: actionItems.blocking.length,
    major: actionItems.major.length,
    minor: actionItems.minor.length,
    total: actionItems.blocking.length + actionItems.major.length + actionItems.minor.length,
  };

  // ── Groupement des actions repetitives par type (refonte v2.x) ──
  // Les audits genèrent souvent 10-20 actions identiques (ex : ajouter
  // un compteur électrique en zone X — éclairage). On les présente en
  // 1 carte groupée avec tableau interne plutôt qu'en N cartes répétitives.
  // Décision de groupement = même clé + au moins 3 items.
  // `devicesById` est déjà construite plus haut (cf. backfill thermal).
  const metersById = new Map(meters.map(m => [m.id, m]));
  const GROUP_LABELS = {
    meter_addition: {
      label: 'Ajouter les compteurs manquants pour le suivi continu',
      columns: ['zone', 'usage', 'meter_type'],
    },
    meter_connection: {
      label: 'Raccorder les compteurs présents mais non communicants',
      columns: ['zone', 'usage', 'meter_type'],
    },
    r175_3_p4: {
      label: 'Permettre l\'arrêt manuel des équipements',
      columns: ['zone', 'system', 'device'],
    },
    r175_3_p4_autonomous: {
      label: 'Activer le fonctionnement autonome des équipements',
      columns: ['zone', 'system', 'device'],
    },
    r175_3_p3_replace: {
      label: 'Prévoir le remplacement des équipements non communicants',
      columns: ['zone', 'system', 'device'],
    },
    r175_3_p3_connect: {
      label: 'Raccorder les équipements communicants à la GTB',
      columns: ['zone', 'system', 'device'],
    },
  };
  function deriveGroupKey(item) {
    // Compteurs : clé par category (subtype rarement set)
    if (item.source_meter_id && item.category === 'meter_addition') return 'meter_addition';
    if (item.source_meter_id && item.category === 'meter_connection') return 'meter_connection';
    // Devices : subtype explicite
    if (item.source_device_id && item.source_subtype) {
      if (GROUP_LABELS[item.source_subtype]) return item.source_subtype;
    }
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
    if (item.source_meter_id) {
      const m = metersById.get(item.source_meter_id);
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
    for (const it of items) {
      const key = deriveGroupKey(it);
      if (!key) {
        result.push({ kind: 'single', item: it });
        continue;
      }
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(it);
    }
    // Étape 2 : décider grouper ou aplatir
    for (const [key, list] of buckets) {
      if (list.length >= 3) {
        const cfg = GROUP_LABELS[key];
        result.push({
          kind: 'group',
          key,
          label: cfg.label,
          columns: cfg.columns,
          count: list.length,
          r175_article: list[0].r175_article,
          first_number: list[0].display_number,
          last_number: list[list.length - 1].display_number,
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

  // Justifications (Annexe C). La source est derivee de la FK non-NULL
  // (mig 125) pour rester lisible dans le PDF.
  function actionSourceLabel(a) {
    if (a.source_system_id)        return `système (#${a.source_system_id})`;
    if (a.source_meter_id)         return `compteur (#${a.source_meter_id})`;
    if (a.source_thermal_id)       return `régulation thermique (#${a.source_thermal_id})`;
    if (a.source_device_id)        return `équipement (#${a.source_device_id})`;
    if (a.source_inspection_id)    return `inspection (#${a.source_inspection_id})`;
    if (a.source_bms_document_id)  return `GTB (${a.source_subtype || ''})`;
    return 'Item manuel';
  }
  const justifications = actionItemsRaw.map(a => ({
    title: a.title,
    article: a.r175_article || '—',
    source: actionSourceLabel(a),
    description: a.description || a.title,
  }));

  // Articles BACS (Annexe A)
  const bacsArticles = bacsArticlesData.BACS_ARTICLES.map(a => ({
    code: a.code,
    title: a.title,
    html: a.full_html,
  }));

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

  const exportDate = new Date().toLocaleDateString('fr-FR', {
    day: '2-digit', month: 'long', year: 'numeric',
  });

  // R175-6 applicabilite : declencheur (PC > 21/07/2021 OU travaux generateur)
  const R175_6_TRIGGER = '2021-07-21';
  const pcAfter = af.bacs_building_permit_date && af.bacs_building_permit_date > R175_6_TRIGGER;
  const worksAfter = af.bacs_generator_works_date && af.bacs_generator_works_date > R175_6_TRIGGER;
  // Formatage français des dates pour l'encart didactique du PDF
  // (« 15 mars 2018 » plutôt que « 2018-03-15 »).
  function frDate(isoDate) {
    if (!isoDate) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
    if (!m) return null;
    return `${m[3]}/${m[2]}/${m[1]}`;
  }
  const r175_6_applicable = pcAfter || worksAfter
    ? { applies: true,
        reason: pcAfter && worksAfter
          ? 'permis de construire postérieur au 21/07/2021 et travaux générateur récents'
          : (pcAfter ? 'permis de construire postérieur au 21/07/2021' : 'travaux d\'installation/remplacement de générateur postérieurs au 21/07/2021'),
        permitDateFr: frDate(af.bacs_building_permit_date),
        worksDateFr: frDate(af.bacs_generator_works_date) }
    : { applies: false,
        reason: 'aucun déclencheur (permis de construire et travaux générateur antérieurs ou égaux au 21/07/2021)',
        permitDateFr: frDate(af.bacs_building_permit_date),
        worksDateFr: frDate(af.bacs_generator_works_date) };

  // Detail du calcul auto chauffage + clim — initial sans contributions.
  // Les contributions effectives (heat_contrib / cool_contrib / inScope)
  // sont ajoutees plus bas apres computeAutoPower() pour pouvoir afficher
  // dans le PDF page 7 ce que CHAQUE device apporte vraiment au cumul
  // R175-2 (ex : un radiateur eau chaude « hors cumul » a contrib = 0).
  const heatingCoolingBreakdown = devices
    .filter(d => ['heating','cooling'].includes(d.system_category) && d.power_kw != null)
    .map(d => ({
      id: d.id,
      name: d.name, brand: d.brand, model_reference: d.model_reference,
      power_kw: d.power_kw, quantity: d.quantity,
      total_power_kw: d.total_power_kw, has_multiple: d.has_multiple,
      zone_name: d.zone_name,
      category: d.system_category,
      categoryLabel: SYSTEM_LABEL[d.system_category] || d.system_category,
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
  const barUsagePowerDataUrl = barItems.length ? await getCharts().barUsagePower({ items: barItems }) : null;

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
    metersPresent: enrichedMeters.filter(m => m.present_actual && !m.out_of_service).length,
    metersIntegrated: enrichedMeters.filter(m => isTrue(m.managed_by_bms)).length,
    metersIntegratedUnanswered: enrichedMeters.filter(m => m.managed_by_bms == null).length,
    metersIntegratedFalse: enrichedMeters.filter(m => isFalse(m.managed_by_bms)).length,
    // Gap analysis : compteurs requis ET absents. Les compteurs hors-service
    // sont EXCLUS (un compteur HS n'est pas "manquant", il existe physiquement
    // mais sera remplace). Aligne avec audit_get_summary cote MCP.
    metersMissing: enrichedMeters.filter(m => m.required && !m.present_actual && !m.out_of_service).length,
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
    });
  }
  for (const sys of enrichedSystems) {
    for (const d of sys.devices) {
      const pc = powerCalcByDeviceId.get(d.id);
      if (pc) d.powerCalc = pc;
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
  const functionalZones = computeFunctionalZones(devices, systems, { SYSTEM_LABEL });

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
  });

  // Vue satellite statique du site (Google Static Maps) embarquée en data
  // URL. Best-effort : null si la clé/API est indisponible → PDF sans vue.
  // `zones` sert de repli de centrage quand le site n'a pas de coordonnées.
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

  return {
    document: af,
    isBacs,
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
    zonesFunctional,
    zonesTechnical,
    zonesFunctionalHaveNotes,
    zonesTechnicalHaveNotes,
    systemsByZone,
    // Zones fonctionnelles sans système thermique présent (hors R175-2).
    zonesOutOfBacsScope,
    // Item 7d/7e — zones fonctionnelles de suivi (regroupement + justification).
    functionalZones,
    // Item 4 — structure juridique + assujettissement par périmètre.
    ownershipStructureLabel,
    ownershipNotes: site?.ownership_notes || null,
    siteParties: sitePartiesEnriched,
    hasLiabilityData,
    compliance,
    meters: enrichedMeters,
    // Vue filtrée pour le tableau du chapitre 4 (sans les compteurs ni
    // requis ni présents — bruit pour l'intégrateur).
    metersForPdf,
    metersWithDetails,
    thermal,
    bms,
    bmsComponents,
    inspections,
    bmsManagedDevices,
    bmsUnmanagedDevices,
    bmsManagedMeters,
    bmsUnmanagedMeters,
    metersByZone,
    meterCoverageMatrix,
    meterEnergyGroups,
    recapStats,
    buildySolution,
    actionItems,
    // Plan d'action groupé par subtype pour le PDF (ch.7) — réduit le
    // nombre de cartes en condensant les actions répétitives.
    actionItemsGrouped,
    actionStats,
    bmsTopicNotes,
    bmsTopicOpportunities,
    // actionItemsRaw expose en realite les items NUMEROTES (BACS-XXX) pour
    // que les tableaux de synthese puissent les afficher en forme finale.
    // Si on a besoin des bruts sans numerotation, ils sont reconstitubles
    // depuis numberedItems.
    actionItemsRaw: numberedItems,
    synthesisHtml: af.audit_synthesis_html || null,
    heatingCoolingBreakdown,
    heatingCoolingTotal: Math.round(heatingCoolingTotal * 10) / 10,
    // Vue récapitulative R175-2 (chaud retenu, froid retenu, max retenu).
    powerRecap,
    // Items 5 + 8 — cumul automatique des puissances chaud / froid.
    powerSummary,
    r175_6_applicable,
    complianceLabel: bms?.overall_compliance ? COMPLIANCE_LABEL[bms.overall_compliance] : null,
    applicabilityLabel: af.bacs_applicability_status ? APPLICABILITY_LABEL[af.bacs_applicability_status] : null,
    bacsArticles,
    methodology,
    disclaimers,
    justifications,
    authorName: user?.display_name || 'Buildy Docs',
    exportDate,
    version,
    logoDataUrl: loadAssetDataUrl('logo-buildy.svg'),
    // Charts (lot B2)
    sevDonutDataUrl,
    barUsagePowerDataUrl,
    barItems, // expose pour debug / fallback texte si chart manquant
  };
}

module.exports = { buildBacsAuditExportData };
