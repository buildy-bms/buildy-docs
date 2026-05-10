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
  APPLICABILITY_LABEL, COMPLIANCE_LABEL, ZONE_NATURE_LABEL,
} = require('./_labels');
const { buildComplianceSummary } = require('./_compliance-summary');

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
  const zones = (site ? db.zones.listBySite(site.site_id) : []).map(z => ({
    ...z,
    natureLabel: z.nature ? (ZONE_NATURE_LABEL[z.nature] || z.nature) : '—',
  }));
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

  // Notes par sujet de la carte GTB (mig 108 + 109).
  // Map { topic_key -> note_html } pour lookup direct dans le template
  // PDF sous chaque sous-section du chapitre 6 GTB.
  const bmsTopicNotes = db.bacsAuditGtbObservations.notesByTopic(documentId);

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
    // Multi-rôle (mig 117) : array → labels FR jointsavec ' / '.
    const roles = parseRoles(d.device_role);
    d.device_role = roles; // expose array (utile si template Hbs y accède directement)
    d.roleLabel = roles.length ? roles.map(r => ROLE_LABEL[r] || r).join(' / ') : '—';
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
  // Compteurs avec notes ou photos : pour le sous-bloc "Notes terrain"
  // de la section 4 (sinon on n'affiche rien, plutot que des cards vides).
  const metersWithDetails = enrichedMeters.filter(m => m.notes_html || m.notes || (m.photos && m.photos.length));

  const thermal = thermalRaw.map(t => ({
    ...t,
    category: t.category || 'heating',
    categoryLabel: SYSTEM_LABEL[t.category || 'heating'] || (t.category || 'heating'),
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

  // Recap chiffre pour le PDF tableaux de synthese (4 tuiles d'en-tete)
  const recapStats = {
    devicesTotal: devices.length,
    devicesPresent: devices.filter(d => !d.out_of_service).length,
    devicesIntegrated: devices.filter(d => d.managed_by_bms).length,
    devicesHs: devices.filter(d => d.out_of_service).length,
    metersRequired: enrichedMeters.filter(m => m.required).length,
    metersPresent: enrichedMeters.filter(m => m.present_actual && !m.out_of_service).length,
    metersIntegrated: enrichedMeters.filter(m => m.managed_by_bms).length,
    metersMissing: enrichedMeters.filter(m => m.required && !m.present_actual).length,
  };

  // Synthese de conformite (cover + page L'essentiel + tableau de bord R175)
  const applicabilityLabelForSummary = af.bacs_applicability_status ? APPLICABILITY_LABEL[af.bacs_applicability_status] : null;
  const compliance = buildComplianceSummary({
    document: af,
    actionItems,
    actionItemsRaw: numberedItems,
    bms,
    r175_6_applicable,
    applicabilityLabel: applicabilityLabelForSummary,
  });

  return {
    document: af,
    isBacs,
    isSiteAudit: !isBacs,
    site,
    zones,
    systemsByZone,
    compliance,
    meters: enrichedMeters,
    metersWithDetails,
    thermal,
    bms,
    bmsManagedDevices,
    bmsUnmanagedDevices,
    bmsManagedMeters,
    bmsUnmanagedMeters,
    metersByZone,
    recapStats,
    buildySolution,
    actionItems,
    actionStats,
    bmsTopicNotes,
    // actionItemsRaw expose en realite les items NUMEROTES (BACS-XXX) pour
    // que les tableaux de synthese puissent les afficher en forme finale.
    // Si on a besoin des bruts sans numerotation, ils sont reconstitubles
    // depuis numberedItems.
    actionItemsRaw: numberedItems,
    synthesisHtml: af.audit_synthesis_html || null,
    heatingCoolingBreakdown,
    heatingCoolingTotal: Math.round(heatingCoolingTotal * 10) / 10,
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
