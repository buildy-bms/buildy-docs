'use strict';

// Helpers de construction du bundle de donnees pour les PDFs / previews
// AF + Liste de points. Extraits de export.js pour pouvoir alimenter aussi
// les routes /preview (rendu HTML in-browser sans Puppeteer).
//
// Note : la generation PDF synthesis (Lot 32) reste inline dans export.js
// pour l'instant — elle fait ~590 lignes de logique tres specifique et
// n'a pas un usage frequent qui justifie la preview.

const path = require('path');
const fs = require('fs');
const Handlebars = require('handlebars');
const config = require('../config');
const db = require('../database');
const { loadAssetDataUrl, loadFileAsDataUrl } = require('../lib/pdf');
const { resolveSectionPoints } = require('../lib/points-resolver');
const { resolveAfLevel, formatLevelFull } = require('../lib/service-level-resolver');
const { BACS_ARTICLES, BACS_INTRO_HTML } = require('../seeds/bacs-articles');

const SERVICE_LEVEL_LABELS = { E: 'Essentials', S: 'Smart', P: 'Premium' };

const SYNTHESIS_ROWS = [
  { name: 'Chauffage & Climatisation', bacs: '§1 §2', monitoring: true, commande: true, alarmes: true, reporting: true, levelLabel: 'Essentials' },
  { name: 'Ventilation', bacs: '§3', monitoring: true, commande: true, alarmes: true, reporting: true, levelLabel: 'Essentials' },
  { name: 'Production ECS', bacs: '§4', monitoring: true, commande: true, alarmes: true, reporting: false, levelLabel: 'Essentials' },
  { name: 'Éclairage et prises', bacs: '§4 (éclairage)', monitoring: true, commande: true, alarmes: true, reporting: false, levelLabel: 'Essentials' },
  { name: 'Production électricité', bacs: '§4', monitoring: true, commande: false, alarmes: true, reporting: true, levelLabel: 'Essentials' },
  { name: 'Comptage énergétique', bacs: null, monitoring: true, commande: false, alarmes: true, reporting: true, levelLabel: 'Essentials' },
  { name: 'Qualité de l\'air', bacs: null, monitoring: true, commande: false, alarmes: true, reporting: true, levelLabel: 'Smart et Premium' },
  { name: 'Occultation', bacs: null, monitoring: true, commande: true, alarmes: true, reporting: false, levelLabel: 'Essentials' },
  { name: 'Process industriel', bacs: null, monitoring: true, commande: true, alarmes: true, reporting: false, levelLabel: 'Essentials' },
  { name: 'Équipements génériques', bacs: null, monitoring: true, commande: false, alarmes: true, reporting: false, levelLabel: 'Essentials' },
];

const synthesisTablePath = path.resolve(__dirname, '../../templates/pdf/_synthesis-table.hbs');
const renderSynthesisTable = Handlebars.compile(fs.readFileSync(synthesisTablePath, 'utf-8'));

function buildLiveBacsResolver() {
  const cats = db.systemCategoriesDb.list();
  const slugToBacs = new Map();
  for (const cat of cats) {
    const bacs = (cat.bacs || '').trim() || null;
    for (const slug of cat.slugs || []) {
      if (!slugToBacs.has(slug)) slugToBacs.set(slug, bacs);
    }
  }
  const tplCache = new Map();
  function tplOf(id) {
    if (tplCache.has(id)) return tplCache.get(id);
    const t = id ? db.equipmentTemplates.getById(id) : null;
    tplCache.set(id, t);
    return t;
  }
  return function resolveLiveBacs(sec) {
    if (sec.equipment_template_id) {
      const tpl = tplOf(sec.equipment_template_id);
      if (tpl?.slug && slugToBacs.has(tpl.slug)) {
        return slugToBacs.get(tpl.slug) || sec.bacs_articles || null;
      }
    }
    return sec.bacs_articles || null;
  };
}

/**
 * Construit le bundle de donnees pour le template `af.hbs`.
 *
 * @param {object} af — la ligne `documents` (kind='af')
 * @param {object} opts
 * @param {object|null} opts.user — user courant (pour authorName)
 * @param {string} opts.motif — texte motif export (preview = 'Apercu')
 * @param {Array<number>} opts.excludedSectionIds — sections a exclure
 * @param {boolean} opts.includeBacsAnnex — inclure annexe R175 du decret
 * @param {boolean} opts.previewMode — true pour mocker la version (sans incrementer le compteur)
 */
async function buildAfExportData(af, opts = {}) {
  const afId = af.id;
  const {
    user = null,
    motif = 'Apercu',
    excludedSectionIds = [],
    includeBacsAnnex = false,
    previewMode = false,
  } = opts;
  const authorName = user?.display_name || user?.email || 'Inconnu';

  const afExcludedSet = new Set(excludedSectionIds);
  const allSections = db.sections.listByAf(afId).filter(s =>
    s.included_in_export && !afExcludedSet.has(s.id)
  );
  const resolveLiveBacs = buildLiveBacsResolver();

  const sectionData = new Map();
  for (const sec of allSections) {
    const attachmentRows = db.attachments.listEffectiveForSection(sec.id);
    const attachments = (await Promise.all(attachmentRows.map(async (a) => {
      let diskPath;
      if (a.source === 'section_template') {
        diskPath = path.join(config.attachmentsDir, '_tpl', 'section', a.filename);
      } else if (a.source === 'equipment_template') {
        diskPath = path.join(config.attachmentsDir, '_tpl', 'equipment', a.filename);
      } else {
        diskPath = path.join(config.attachmentsDir, String(afId), a.filename);
      }
      return { ...a, dataUrl: await loadFileAsDataUrl(diskPath) };
    }))).filter((a) => a.dataUrl);

    let zones = [];
    if (sec.kind === 'zones') {
      zones = db.afZones.listBySection(sec.id);
    }

    let equipment = null;
    if (sec.kind === 'equipment') {
      const tpl = sec.equipment_template_id ? db.equipmentTemplates.getById(sec.equipment_template_id) : null;
      const points = resolveSectionPoints(sec.id);
      const protocols = tpl?.preferred_protocols
        ? tpl.preferred_protocols.split(',').map(s => s.trim()).filter(Boolean)
        : [];
      equipment = {
        description_html: tpl?.description_html || null,
        points_read: points.filter(p => p.direction === 'read'),
        points_write: points.filter(p => p.direction === 'write'),
        preferred_protocols: protocols,
        bacs_justification: tpl?.bacs_justification || null,
      };
    }

    sectionData.set(sec.id, { attachments, equipment, zones });
  }

  function buildTree(parentId, depth) {
    return allSections
      .filter(s => s.parent_id === parentId)
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map((s) => {
        const data = sectionData.get(s.id);
        const sl = s.service_level;
        const badgeClass = sl ? sl.replace(/[^A-Z]/g, '') : '';
        const synthesisHtml = s.kind === 'synthesis'
          ? renderSynthesisTable({ rows: SYNTHESIS_ROWS })
          : null;
        const liveBacs = resolveLiveBacs(s);
        return {
          id: s.id,
          number: s.number || '',
          title: s.title,
          service_level: sl,
          service_level_label: formatLevelFull(sl),
          badgeClass: badgeClass || 'ESP',
          bacs_articles: liveBacs,
          bacs_articles_label: liveBacs
            ? `${s.kind === 'equipment' ? 'Système concerné par le décret BACS' : 'Exigé par le décret BACS'} · ${liveBacs}`
            : null,
          bacs_justification: s.bacs_justification || data.equipment?.bacs_justification || null,
          synthesis_table_html: synthesisHtml,
          body_html: s.body_html,
          generic_note: s.generic_note,
          opted_out_by_moa: s.opted_out_by_moa === 1,
          kind: s.kind,
          depth,
          attachments: data.attachments,
          equipment: data.equipment,
          zones: data.zones || [],
          children: buildTree(s.id, depth + 1),
        };
      });
  }
  const tree = buildTree(null, 0);

  function flattenForToc(nodes, acc = []) {
    for (const n of nodes) {
      if (n.depth <= 2) {
        acc.push({
          id: n.id,
          number: n.number,
          title: n.title,
          depth: n.depth,
          depthOneBased: n.depth + 1,
        });
        flattenForToc(n.children, acc);
      }
    }
    return acc;
  }
  const tocFlat = flattenForToc(tree);

  const serviceLevel = resolveAfLevel(allSections.filter(s => !s.opted_out_by_moa));

  let version;
  if (previewMode) {
    version = 'af-vAPERCU';
  } else {
    const previousCount = db.db.prepare(`
      SELECT COUNT(*) AS c FROM exports WHERE af_id = ? AND kind = 'pdf-af'
    `).get(afId).c;
    version = `af-v0.${previousCount + 1}`;
  }

  const exportDate = new Date().toLocaleDateString('fr-FR', {
    day: '2-digit', month: 'long', year: 'numeric',
  });

  const data = {
    af,
    authorName,
    exportDate,
    version,
    motif,
    contractualLevelLabel: SERVICE_LEVEL_LABELS[af.service_level] || af.service_level || '—',
    logoDataUrl: loadAssetDataUrl('logo-buildy.svg'),
    serviceLevel,
    tree,
    tocFlat,
    includeBacsAnnex,
    bacsArticles: includeBacsAnnex ? BACS_ARTICLES : null,
    bacsIntroHtml: includeBacsAnnex ? BACS_INTRO_HTML : null,
  };

  return { data, version, allSectionsCount: allSections.length, serviceLevel };
}

/**
 * Construit le bundle de donnees pour le template `points-list.hbs`
 * (A3 paysage, table des points par equipement).
 */
function buildPointsListExportData(af, opts = {}) {
  const afId = af.id;
  const {
    user = null,
    motif = 'Apercu',
    excludedSectionIds = [],
    previewMode = false,
  } = opts;
  const authorName = user?.display_name || user?.email || 'Inconnu';

  const allSections = db.sections.listByAf(afId);
  const excludedSet = new Set(excludedSectionIds);
  const equipmentSections = allSections.filter(s =>
    s.kind === 'equipment' && s.included_in_export && !excludedSet.has(s.id)
  );

  const resolveLiveBacs = buildLiveBacsResolver();
  const rows = [];
  const categories = equipmentSections.map((sec) => {
    const instances = db.equipmentInstances.listBySection(sec.id);
    const points = resolveSectionPoints(sec.id);
    const instancesWithPoints = instances.map((inst) => ({
      reference: inst.reference,
      location: inst.location,
      qty: inst.qty,
      points: points.map((p) => ({
        label: p.label,
        data_type: p.data_type,
        unit: p.unit,
        tech_name: p.tech_name,
        nature: p.nature,
        dirLabel: p.direction === 'read' ? 'R' : 'W',
      })),
    }));

    for (const inst of instancesWithPoints) {
      let first = true;
      for (const p of inst.points) {
        rows.push({
          categoryName: sec.title,
          instanceRef: inst.reference,
          instanceLocation: inst.location || '',
          isFirstOfInstance: first,
          label: p.label,
          data_type: p.data_type,
          unit: p.unit,
          tech_name: p.tech_name,
          nature: p.nature,
          dirLabel: p.dirLabel,
        });
        first = false;
      }
    }

    return {
      name: sec.title,
      bacsArticles: resolveLiveBacs(sec),
      instances: instancesWithPoints,
      instancesCount: instances.length,
      pointsPerInstance: points.length,
      pointsTotal: instances.length * points.length,
    };
  }).filter((c) => c.instancesCount > 0 || c.pointsPerInstance > 0);

  const totals = {
    instances: categories.reduce((acc, c) => acc + c.instancesCount, 0),
    points: categories.reduce((acc, c) => acc + c.pointsTotal, 0),
  };

  let version;
  if (previewMode) {
    version = 'lp-vAPERCU';
  } else {
    const previousCount = db.db.prepare(`
      SELECT COUNT(*) AS c FROM exports WHERE af_id = ? AND kind = 'pdf-points-list'
    `).get(afId).c;
    version = `lp-v0.${previousCount + 1}`;
  }

  const exportDate = new Date().toLocaleDateString('fr-FR', {
    day: '2-digit', month: 'long', year: 'numeric',
  });

  const data = {
    af,
    authorName,
    exportDate,
    version,
    motif,
    serviceLevelLabel: SERVICE_LEVEL_LABELS[af.service_level] || af.service_level || '—',
    logoDataUrl: loadAssetDataUrl('logo-buildy.svg'),
    categories,
    rows,
    totals,
  };

  return { data, version, categories, totals };
}

module.exports = {
  buildAfExportData,
  buildPointsListExportData,
  // Re-exporte pour que export.js puisse les utiliser sans dupliquer
  buildLiveBacsResolver,
  SYNTHESIS_ROWS,
  renderSynthesisTable,
  SERVICE_LEVEL_LABELS,
};
