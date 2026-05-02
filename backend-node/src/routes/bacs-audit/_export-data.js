'use strict';

// Construction du bundle de donnees pour le PDF / preview audit BACS.
// Extraite de exports.js pour pouvoir alimenter aussi la route /preview
// (rendu HTML in-browser sans Puppeteer).

const path = require('path');
const config = require('../../config');
const db = require('../../database');
const { loadAssetDataUrl } = require('../../lib/pdf');
const { optimizeFileToDataUrl } = require('../../lib/image-optimizer');
const bacsArticlesData = require('../../seeds/bacs-articles');
const bacsAuditMethodology = require('../../lib/bacs-audit-methodology');
const bacsAuditDisclaimers = require('../../lib/bacs-audit-disclaimers');

// pdf-charts charge chartjs-node-canvas qui pollue require.cache (entry
// undefined apres chargement → bug Fastify getPluginName quand il itere
// sur le cache pour resoudre le nom d'un plugin enregistre apres). Lazy
// require pour ne charger qu'a la 1re generation PDF, apres le boot.
let _charts = null;
function getCharts() {
  if (!_charts) _charts = require('../../lib/pdf-charts');
  return _charts;
}

// Labels d'enums (pour eviter les codes anglais bruts dans le PDF)
const SYSTEM_LABEL = { heating:'Chauffage', cooling:'Refroidissement', ventilation:'Ventilation',
  dhw:'Eau chaude sanitaire', lighting_indoor:'Éclairage intérieur',
  lighting_outdoor:'Éclairage extérieur', electricity_production:'Production photovoltaïque' };
const SYSTEM_NEGATIVE_LABEL = { heating:'Pas de chauffage', cooling:'Pas de refroidissement',
  ventilation:'Pas de ventilation', dhw:'Pas d\'ECS',
  lighting_indoor:'Pas d\'éclairage intérieur', lighting_outdoor:'Pas d\'éclairage extérieur',
  electricity_production:'Pas de production photovoltaïque' };
const COMM_LABEL = { modbus_tcp:'Modbus TCP', modbus_rtu:'Modbus RTU', bacnet_ip:'BACnet IP',
  bacnet_mstp:'BACnet MS/TP', knx:'KNX', mbus:'M-Bus', mqtt:'MQTT', lorawan:'LoRaWAN',
  autre:'Autre', non_communicant:'Non communicant', absent:'Absent' };
const ENERGY_LABEL = { gas:'Gaz', electric:'Électrique', wood:'Bois', heat_pump:'PAC',
  district_heating:'Réseau de chaleur', fuel_oil:'Fioul', solar:'Solaire',
  biomass:'Biomasse', autre:'Autre' };
const ROLE_LABEL = { production:'Production', distribution:'Distribution',
  emission:'Émission', regulation:'Régulation', autre:'Autre' };
const METER_TYPE_LABEL = { electric:'Électrique', electric_production:'Électrique de production',
  gas:'Gaz', water:'Eau', thermal:'Thermique', other:'Autre' };
const METER_USAGE_LABEL = { heating:'Chauffage', cooling:'Refroidissement',
  dhw:'ECS', pv:'Production PV', lighting:'Éclairage', other:'Général' };
const REGULATION_LABEL = { per_room:'Par pièce', per_zone:'Par zone',
  central_only:'Centrale uniquement', none:'Aucune' };
const GENERATOR_LABEL = { gas:'Gaz', electric:'Effet Joule', heat_pump:'Pompe à chaleur',
  wood_appliance:'Appareil bois (exempté R175-6)', district_heating:'Réseau de chaleur', other:'Autre' };
const APPLICABILITY_LABEL = {
  subject_immediate: 'Immédiate (bâtiment > 290 kW déjà existant)',
  subject_2025: '1er janvier 2025 (puissance > 290 kW)',
  subject_2027: '1er janvier 2027 (puissance > 70 kW)',
  not_subject: 'Non assujetti (puissance < 70 kW)',
};
const COMPLIANCE_LABEL = { compliant:'Conforme', partial:'Partiellement conforme', non_compliant:'Non conforme' };

/**
 * Construit le bundle de donnees a passer au template bacs-audit.hbs.
 *
 * @param {object} af — la ligne `documents` (deja fetchee, kind='bacs_audit' ou 'site_audit')
 * @param {object} opts
 * @param {object|null} opts.user — user courant (pour authorName)
 * @param {boolean} opts.previewMode — true pour preview HTML (skip generation chemin sortie + version mock)
 */
async function buildBacsAuditExportData(af, opts = {}) {
  const documentId = af.id;
  const { user = null, previewMode = false } = opts;

  // Donnees principales
  const site = af.site_id ? db.sites.getById(af.site_id) : null;
  const zones = site ? db.zones.listBySite(site.site_id) : [];
  const systems = db.db.prepare(`
    SELECT s.*, z.name AS zone_name, z.nature AS zone_nature
    FROM bacs_audit_systems s LEFT JOIN zones z ON z.zone_id = s.zone_id
    WHERE s.document_id = ?
    ORDER BY z.position, z.name, s.system_category
  `).all(documentId);
  const meters = db.db.prepare(`
    SELECT m.*, z.name AS zone_name FROM bacs_audit_meters m
    LEFT JOIN zones z ON z.zone_id = m.zone_id
    WHERE m.document_id = ?
    ORDER BY z.position NULLS LAST, m.usage
  `).all(documentId);
  const bms = db.db.prepare('SELECT * FROM bacs_audit_bms WHERE document_id = ?').get(documentId) || null;
  const thermalRaw = db.db.prepare(`
    SELECT t.*, z.name AS zone_name FROM bacs_audit_thermal_regulation t
    LEFT JOIN zones z ON z.zone_id = t.zone_id
    WHERE t.document_id = ?
    ORDER BY z.position, z.name
  `).all(documentId);
  // On filtre done + declined : ces actions ne doivent pas apparaitre
  // dans le PDF livre aux integrateurs GTB.
  const actionItemsRaw = db.db.prepare(`
    SELECT a.*, z.name AS zone_name FROM bacs_audit_action_items a
    LEFT JOIN zones z ON z.zone_id = a.zone_id
    WHERE a.document_id = ? AND a.status NOT IN ('done', 'declined')
    ORDER BY a.position, a.id
  `).all(documentId);

  // Charge tous les devices du document (joints au systeme parent)
  const devices = db.db.prepare(`
    SELECT d.*, s.system_category, s.zone_id, z.name AS zone_name
    FROM bacs_audit_system_devices d
    JOIN bacs_audit_systems s ON s.id = d.system_id
    LEFT JOIN zones z ON z.zone_id = s.zone_id
    WHERE s.document_id = ?
    ORDER BY z.position, z.name, s.system_category, d.position, d.id
  `).all(documentId);
  const devicesBySystem = new Map();
  for (const d of devices) {
    d.energyLabel = d.energy_source ? (ENERGY_LABEL[d.energy_source] || d.energy_source) : '—';
    d.roleLabel = d.device_role ? (ROLE_LABEL[d.device_role] || d.device_role) : '—';
    d.commLabel = d.communication_protocol
      ? (COMM_LABEL[d.communication_protocol] || d.communication_protocol)
      : 'Non communicant';
    if (!devicesBySystem.has(d.system_id)) devicesBySystem.set(d.system_id, []);
    devicesBySystem.get(d.system_id).push(d);
  }

  // Enrichit systems avec devices + sums et group par zone
  const enrichedSystems = systems.map(s => {
    const devs = devicesBySystem.get(s.id) || [];
    const totalKw = devs.reduce((sum, d) => sum + (Number(d.power_kw) || 0), 0);
    return {
      ...s,
      categoryLabel: SYSTEM_LABEL[s.system_category] || s.system_category,
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

  // Enrichit meters
  const enrichedMeters = meters.map(m => ({
    ...m,
    typeLabel: METER_TYPE_LABEL[m.meter_type] || m.meter_type,
    usageLabel: METER_USAGE_LABEL[m.usage] || m.usage,
    zoneLabel: m.zone_name || 'Général bâtiment',
  }));

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

  // Listes GTB integration : devices + meters integres
  const bmsManagedDevices = devices.filter(d => d.managed_by_bms);
  const bmsManagedMeters = enrichedMeters.filter(m => m.managed_by_bms);

  const thermal = thermalRaw.map(t => ({
    ...t,
    regulationLabel: t.regulation_type ? (REGULATION_LABEL[t.regulation_type] || t.regulation_type) : '—',
    generatorLabel: t.generator_type ? (GENERATOR_LABEL[t.generator_type] || t.generator_type) : '—',
  }));

  // Plan de mise en conformite groupe par severite
  const numberedItems = [
    ...actionItemsRaw.filter(a => a.severity === 'blocking'),
    ...actionItemsRaw.filter(a => a.severity === 'major'),
    ...actionItemsRaw.filter(a => a.severity === 'minor'),
  ].map((a, idx) => ({
    ...a,
    display_number: 'BACS-' + String(idx + 1).padStart(3, '0'),
  }));
  const actionItems = { blocking: [], major: [], minor: [] };
  for (const a of numberedItems) actionItems[a.severity]?.push(a);
  const actionStats = {
    blocking: actionItems.blocking.length,
    major: actionItems.major.length,
    minor: actionItems.minor.length,
  };

  // Justifications (Annexe C)
  const justifications = actionItemsRaw.map(a => ({
    title: a.title,
    article: a.r175_article || '—',
    source: a.source_table ? `${a.source_table} (#${a.source_id})` : 'Item manuel',
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
  const r175_6_applicable = pcAfter || worksAfter
    ? { applies: true, reason: pcAfter && worksAfter
          ? 'permis de construire postérieur au 21/07/2021 et travaux générateur récents'
          : (pcAfter ? 'permis de construire postérieur au 21/07/2021' : 'travaux d\'installation/remplacement de générateur postérieurs au 21/07/2021') }
    : { applies: false, reason: 'aucun déclencheur (permis de construire et travaux générateur antérieurs ou égaux au 21/07/2021)' };

  // Detail du calcul auto chauffage + clim
  const heatingCoolingBreakdown = devices
    .filter(d => ['heating','cooling'].includes(d.system_category) && d.power_kw != null)
    .map(d => ({
      name: d.name, brand: d.brand, model_reference: d.model_reference,
      power_kw: d.power_kw, zone_name: d.zone_name,
      category: d.system_category,
      categoryLabel: SYSTEM_LABEL[d.system_category] || d.system_category,
    }));
  const heatingCoolingTotal = heatingCoolingBreakdown.reduce((s, d) => s + (Number(d.power_kw) || 0), 0);

  const isBacs = af.kind === 'bacs_audit';

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
  const radarAxes = isBacs ? [
    { label: 'R175-3 §1\nSuivi', score: scoreForAxis(a => /R175-3 1°|R175-3 §1/.test(a.r175_article || '')) },
    { label: 'R175-3 §2\nDerives', score: scoreForAxis(a => /R175-3 2°|R175-3 §2/.test(a.r175_article || '')) },
    { label: 'R175-3 §3\nInterop', score: scoreForAxis(a => /R175-3 3°|R175-3 §3/.test(a.r175_article || '')) },
    { label: 'R175-3 §4\nArret/auto', score: scoreForAxis(a => /R175-3 4°|R175-3 §4/.test(a.r175_article || '')) },
    { label: 'R175-4\nVerifs', score: scoreForAxis(a => /R175-4/.test(a.r175_article || '')) },
    { label: 'R175-5\nFormation', score: scoreForAxis(a => /R175-5(?!-1)/.test(a.r175_article || '')) },
    { label: 'R175-6\nRegulation', score: scoreForAxis(a => /R175-6/.test(a.r175_article || '')) },
  ] : [];
  const radarComplianceDataUrl = isBacs ? await getCharts().radarCompliance({ axes: radarAxes }) : null;

  // Bar usage power : agrege devices par system_category
  const powerByUsage = new Map();
  for (const d of devices) {
    if (d.power_kw == null) continue;
    const cat = d.system_category || 'autre';
    powerByUsage.set(cat, (powerByUsage.get(cat) || 0) + Number(d.power_kw));
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

  return {
    document: af,
    isBacs,
    isSiteAudit: !isBacs,
    site,
    zones,
    systemsByZone,
    meters: enrichedMeters,
    thermal,
    bms,
    bmsManagedDevices,
    bmsManagedMeters,
    buildySolution,
    actionItems,
    actionStats,
    actionItemsRaw, // utile pour audit log et stats
    synthesisHtml: af.audit_synthesis_html || null,
    heatingCoolingBreakdown,
    heatingCoolingTotal: Math.round(heatingCoolingTotal * 10) / 10,
    r175_6_applicable,
    complianceLabel: bms?.overall_compliance ? COMPLIANCE_LABEL[bms.overall_compliance] : null,
    applicabilityLabel: af.bacs_applicability_status ? APPLICABILITY_LABEL[af.bacs_applicability_status] : null,
    bacsArticles,
    methodology: bacsAuditMethodology,
    disclaimers: bacsAuditDisclaimers,
    justifications,
    authorName: user?.display_name || 'Buildy Docs',
    exportDate,
    version,
    logoDataUrl: loadAssetDataUrl('logo-buildy.svg'),
    // Charts (lot B2)
    sevDonutDataUrl,
    radarComplianceDataUrl,
    barUsagePowerDataUrl,
    barItems, // expose pour debug / fallback texte si chart manquant
  };
}

module.exports = { buildBacsAuditExportData };
