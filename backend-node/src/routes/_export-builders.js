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

/**
 * Calcule le verdict "niveau requis vs niveau visé" pour une AF.
 * Retourne { kind, text } — `kind` pilote la couleur de la barre à
 * gauche de l'encart cover (vert ok, jaune no-contract, rouge
 * shortfall, bleu over). `text` est un message court QUI NE REPETE PAS
 * les niveaux required/visé (déjà affichés dans le header du bandeau).
 * Utilisé par Synthèse, AF, Liste de points (encart cover cohérent).
 */
function buildLevelVerdict({ requiredLevel, contractLevel }) {
  const RANK = { E: 0, S: 1, P: 2 };
  if (!requiredLevel) return { kind: 'none', text: 'Aucun calcul possible.' };
  if (!contractLevel) return {
    kind: 'no-contract',
    text: 'Aucun niveau contractuel fixé — à arbitrer au bon de commande.',
  };
  if (RANK[requiredLevel] > RANK[contractLevel]) return {
    kind: 'shortfall',
    text: 'Le contrat actuel ne couvre pas l\'intégralité du périmètre décrit.',
  };
  if (RANK[requiredLevel] < RANK[contractLevel]) return {
    kind: 'over',
    text: 'Le contrat dépasse les besoins — marge disponible pour activer d\'autres fonctionnalités.',
  };
  return { kind: 'ok', text: 'Le contrat couvre exactement le périmètre décrit.' };
}

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
const contractualSummaryPath = path.resolve(__dirname, '../../templates/pdf/_contractual-summary.hbs');
const renderContractualSummary = Handlebars.compile(fs.readFileSync(contractualSummaryPath, 'utf-8'));

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
    includeOfferingsAnnex = false,
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

  // Construit dynamiquement les rows du tableau de synthese (systemes +
  // instances) qui remplace l'ancien tableau hardcode SYNTHESIS_ROWS.
  // Style : tableau des offres -> hierarchie via parent_id (depth visuelle),
  // chaque section equipment incluse devient une "system row" suivie de
  // ses "instance rows" (reference + location + qty).
  function buildSynthesisRows() {
    const rows = [];
    function walk(parentId, depth) {
      const children = allSections
        .filter(s => s.parent_id === parentId)
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
      for (const sec of children) {
        if (!sec.included_in_export || sec.opted_out_by_moa) {
          // Skip mais explore quand meme les enfants au cas ou ils sont
          // inclus (cas rare mais possible).
          walk(sec.id, depth + 1);
          continue;
        }
        if (sec.kind === 'equipment') {
          const tpl = sec.equipment_template_id
            ? db.equipmentTemplates.getById(sec.equipment_template_id) : null;
          const points = resolveSectionPoints(sec.id);
          const instances = db.equipmentInstances.listBySection(sec.id);
          const totalQty = instances.reduce((s, i) => s + (i.qty || 1), 0);
          rows.push({
            kind: 'system',
            depth,
            title: sec.title,
            template_slug: tpl?.slug || null,
            instances_count: instances.length,
            total_qty: totalQty,
            points_total: points.length,
            service_level: sec.service_level || null,
            service_level_label: formatLevelFull(sec.service_level),
          });
          for (const inst of instances) {
            rows.push({
              kind: 'instance',
              depth: depth + 1,
              reference: inst.reference || '—',
              location: inst.location || '',
              qty: inst.qty || 1,
            });
          }
          // Recurse pour les eventuels enfants d'une section equipment
          walk(sec.id, depth + 1);
        } else {
          // Categorie de regroupement : on recurse, mais on n'emet une
          // row category que si on a des descendants equipment.
          const before = rows.length;
          walk(sec.id, depth + 1);
          const after = rows.length;
          if (after > before) {
            // Insert la row category AVANT les rows enfants ajoutees
            rows.splice(before, 0, {
              kind: 'category',
              depth,
              title: sec.title,
            });
          }
        }
      }
    }
    walk(null, 0);
    return rows;
  }
  const synthesisRows = buildSynthesisRows();
  const contractualSummary = buildContractualSummaryForAf(af);
  const contractualSummaryHtml = renderContractualSummary(contractualSummary);

  function buildTree(parentId, depth) {
    return allSections
      .filter(s => s.parent_id === parentId)
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map((s) => {
        const data = sectionData.get(s.id);
        const sl = s.service_level;
        const badgeClass = sl ? sl.replace(/[^A-Z]/g, '') : '';
        const synthesisHtml = s.kind === 'synthesis'
          ? renderSynthesisTable({ rows: synthesisRows })
          : null;
        // Le chapitre 13 "Engagement contractuel" reçoit la synthese
        // calculee (offre recommandee + options à souscrire). On la prepend
        // au body_html existant pour que le texte canonique reste editable.
        const isContractualChapter = s.number === '13';
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
          contractual_summary_html: isContractualChapter ? contractualSummaryHtml : null,
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

  // Annexe "Tableau des offres Buildy" optionnelle. Filtre les
  // fonctionnalites refusees par le MOA (sections opt_out_by_moa) et
  // met en avant le niveau cible de l'AF (af.service_level) plutot
  // que le decoy admin global.
  const offeringsAnnex = includeOfferingsAnnex
    ? buildOfferingsAnnexForAf(af)
    : null;

  // contractualSummary deja calcule plus haut (utilise dans le tree pour
  // le chapitre 13). Reutilise-le tel quel pour le bundle data.

  // KPIs niveau requis vs niveau visé — alimentent le bandeau cover unifié
  // (mêmes couleurs et même verdict que la Synthèse).
  const requiredLevel = serviceLevel?.level || null;
  const contractLevel = af.service_level || null;
  const kpis = {
    requiredLevel,
    requiredLevelLabel: requiredLevel ? SERVICE_LEVEL_LABELS[requiredLevel] : null,
    contractLevel,
    contractLevelLabel: contractLevel ? SERVICE_LEVEL_LABELS[contractLevel] : null,
    verdict: buildLevelVerdict({ requiredLevel, contractLevel }),
  };

  const data = {
    af,
    authorName,
    exportDate,
    version,
    motif,
    contractualLevelLabel: SERVICE_LEVEL_LABELS[af.service_level] || af.service_level || '—',
    logoDataUrl: loadAssetDataUrl('logo-buildy.svg'),
    serviceLevel,
    kpis,
    tree,
    tocFlat,
    includeBacsAnnex,
    bacsArticles: includeBacsAnnex ? BACS_ARTICLES : null,
    bacsIntroHtml: includeBacsAnnex ? BACS_INTRO_HTML : null,
    offeringsAnnex,
    contractualSummary,
  };

  return { data, version, allSectionsCount: allSections.length, serviceLevel };
}

/**
 * Construit les donnees du tableau des offres adaptees au contexte d'une AF :
 *  - Filtre les fonctionnalites dont la section template parente correspond
 *    a une section de l'AF marquee opt_out_by_moa = 1 (refusee par le MOA).
 *  - Override le decoy admin (offering_levels.is_highlighted) par le niveau
 *    de service cible de l'AF (af.service_level). Le niveau ainsi mis en
 *    valeur est l'engagement contractuel reel.
 */
function buildOfferingsAnnexForAf(af) {
  // Recupere les section_template_id des sections de l'AF refusees par le MOA
  const optedOutTemplateIds = new Set(
    db.db.prepare(`
      SELECT DISTINCT section_template_id
      FROM sections
      WHERE af_id = ?
        AND opted_out_by_moa = 1
        AND section_template_id IS NOT NULL
    `).all(af.id).map(r => r.section_template_id)
  );
  // Sections explicitement demandees par le MOA (symetrique de opted_out).
  const demandedTemplateIds = new Set(
    db.db.prepare(`
      SELECT DISTINCT section_template_id
      FROM sections
      WHERE af_id = ?
        AND demanded_by_moa = 1
        AND section_template_id IS NOT NULL
    `).all(af.id).map(r => r.section_template_id)
  );

  // Recupere tous les section_templates pour construire l'arbre
  const allTemplates = db.db.prepare(`
    SELECT id, title, parent_template_id, position, is_functionality,
           avail_e, avail_s, avail_p
    FROM section_templates
    ORDER BY position, id
  `).all();
  const byId = new Map(allTemplates.map(t => [t.id, { ...t, children: [] }]));
  const roots = [];
  for (const node of byId.values()) {
    const parentNode = node.parent_template_id ? byId.get(node.parent_template_id) : null;
    if (parentNode) parentNode.children.push(node);
    else roots.push(node);
  }
  function sortChildren(node) {
    node.children.sort((a, b) => (a.position ?? 9999) - (b.position ?? 9999) || a.id - b.id);
    for (const c of node.children) sortChildren(c);
  }
  roots.sort((a, b) => (a.position ?? 9999) - (b.position ?? 9999) || a.id - b.id);
  for (const r of roots) sortChildren(r);

  function hasFeatureDescendant(node) {
    if (node.is_functionality) return true;
    return node.children.some(hasFeatureDescendant);
  }

  let optedOutCount = 0;
  let demandedCount = 0;
  const rows = [];
  function emit(node, visualDepth) {
    if (!hasFeatureDescendant(node)) return;
    if (node.is_functionality) {
      const refused = optedOutTemplateIds.has(node.id);
      const demanded = demandedTemplateIds.has(node.id);
      if (refused) optedOutCount++;
      if (demanded) demandedCount++;
      const ae = node.avail_e || 'unavailable';
      const as = node.avail_s || 'unavailable';
      const ap = node.avail_p || 'unavailable';
      const allOption = ae === 'paid_option' && as === 'paid_option' && ap === 'paid_option';
      rows.push({
        kind: 'feature',
        depth: visualDepth,
        title: node.title,
        avail_e: ae,
        avail_s: as,
        avail_p: ap,
        all_option: allOption,
        refused,
        demanded,
      });
      for (const child of node.children) emit(child, visualDepth + 1);
    } else {
      rows.push({ kind: 'category', depth: visualDepth, title: node.title });
      for (const child of node.children) emit(child, visualDepth + 1);
    }
  }
  for (const r of roots) emit(r, 0);

  // Niveaux d'offre :
  //  - is_target  → niveau cible AF (engagement contractuel actuel)
  //  - is_required → niveau Buildy requis pour le perimetre AF.
  //                  Calcule via resolveAfLevel() sur TOUTES les sections
  //                  actives (non opt-out), pour rester aligne avec le calcul
  //                  utilise par la cover (kpis.requiredLevelLabel) et eviter
  //                  qu'un meme AF affiche 2 niveaux requis differents (bug
  //                  isole 2026-05-04 : cover disait Premium, page 3 disait
  //                  Essentiel parce qu'elle ne regardait que les sections
  //                  demanded par la MOA via buildContractualSummaryForAf).
  //  Le template gere le cas where target == required en n'affichant que
  //  le badge or (Niveau cible) pour eviter les doublons visuels.
  const allLevels = db.offeringLevels.list();
  const targetSlug = (af.service_level || '').toUpperCase();
  const summary = buildContractualSummaryForAf(af);
  const sectionsForLevel = db.sections.listByAf(af.id);
  const requiredAfLevel = resolveAfLevel(sectionsForLevel.filter(s => !s.opted_out_by_moa));
  const requiredSlug = requiredAfLevel?.level || null;
  const levels = allLevels.map(l => ({
    ...l,
    is_target: l.slug === targetSlug,
    is_required: requiredSlug ? l.slug === requiredSlug : false,
    is_highlighted: false, // override : on n'utilise pas le decoy global
  }));
  const targetLevel = levels.find(l => l.is_target);
  const requiredLevel = levels.find(l => l.is_required);

  return {
    rows,
    levels,
    colspan: levels.length + 2, // Fonctionnalité + Engagement MOA + N niveaux
    targetLevelLabel: targetLevel?.name || null,
    requiredLevelLabel: requiredLevel?.name || null,
    optedOutCount,
    demandedCount,
  };
}

/**
 * Synthese "engagement contractuel" : a partir des fonctionnalites demandees
 * par le MOA, deduit le niveau d'offre minimum a souscrire (E/S/P) et la
 * liste des options payantes a inclure dans l'avenant.
 *
 * Algorithme :
 *   1. Pour chaque fonctionnalite demandee, on regarde sa disponibilite a
 *      chaque niveau (avail_e/s/p). On retient le niveau MINIMUM ou elle est
 *      'included' OU 'paid_option'.
 *   2. L'offre recommandee = max() de ces niveaux (E < S < P).
 *   3. Au niveau recommande, les fonctionnalites demandees qui sont
 *      'paid_option' sont listees comme "options a souscrire" dans l'avenant.
 *      Celles 'included' sont deja couvertes.
 */
const LEVEL_RANK = { E: 0, S: 1, P: 2 };
const LEVEL_NAMES = { E: 'Essentiel', S: 'Smart', P: 'Premium' };
function buildContractualSummaryForAf(af) {
  // Recupere toutes les sections demandees + refusees pour l'AF.
  const demandedSections = db.db.prepare(`
    SELECT s.id, s.title, s.section_template_id
    FROM sections s
    WHERE s.af_id = ?
      AND s.demanded_by_moa = 1
      AND s.section_template_id IS NOT NULL
  `).all(af.id);

  const targetSlug = (af.service_level || 'E').toUpperCase();
  const targetRank = LEVEL_RANK[targetSlug] ?? 0;

  if (demandedSections.length === 0) {
    return {
      hasDemands: false,
      currentLevel: targetSlug,
      currentLevelName: LEVEL_NAMES[targetSlug] || targetSlug,
      recommendedLevel: targetSlug,
      recommendedLevelName: LEVEL_NAMES[targetSlug] || targetSlug,
      upgradeNeeded: false,
      requiredOptions: [],
      coveredFeatures: [],
    };
  }

  // Lookup des template_id demandes pour chercher leurs availabilities.
  const tplIds = demandedSections.map(s => s.section_template_id);
  const placeholders = tplIds.map(() => '?').join(',');
  const tpls = db.db.prepare(`
    SELECT id, title, avail_e, avail_s, avail_p
    FROM section_templates WHERE id IN (${placeholders})
  `).all(...tplIds);
  const byTplId = new Map(tpls.map(t => [t.id, t]));

  // Pour chaque demande : trouve le niveau min ou la feature est dispo.
  const features = []; // { title, avails, minLevel, unavailable }
  let maxRank = targetRank;
  for (const s of demandedSections) {
    const tpl = byTplId.get(s.section_template_id);
    if (!tpl) continue;
    const avails = { E: tpl.avail_e, S: tpl.avail_s, P: tpl.avail_p };
    let minLevel = null;
    for (const lvl of ['E', 'S', 'P']) {
      const v = avails[lvl];
      if (v === 'included' || v === 'paid_option') { minLevel = lvl; break; }
    }
    if (!minLevel) {
      features.push({ title: tpl.title, avails, minLevel: null, unavailable: true });
      continue;
    }
    const rank = LEVEL_RANK[minLevel];
    if (rank > maxRank) maxRank = rank;
    features.push({ title: tpl.title, avails, minLevel, unavailable: false });
  }

  // Resolve le niveau recommande
  const recommendedSlug = Object.entries(LEVEL_RANK).find(([, r]) => r === maxRank)?.[0] || 'E';
  const upgradeNeeded = maxRank > targetRank;

  // A ce niveau recommande, distingue les features 'included' des 'paid_option'
  const requiredOptions = [];
  const coveredFeatures = [];
  for (const f of features) {
    if (f.unavailable) continue;
    const availAtRec = f.avails[recommendedSlug];
    if (availAtRec === 'paid_option') requiredOptions.push({ title: f.title });
    else if (availAtRec === 'included') coveredFeatures.push({ title: f.title });
  }

  return {
    hasDemands: true,
    currentLevel: targetSlug,
    currentLevelName: LEVEL_NAMES[targetSlug] || targetSlug,
    recommendedLevel: recommendedSlug,
    recommendedLevelName: LEVEL_NAMES[recommendedSlug] || recommendedSlug,
    upgradeNeeded,
    requiredOptions,
    coveredFeatures,
    unavailableFeatures: features.filter(f => f.unavailable).map(f => ({ title: f.title })),
  };
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

  // KPIs niveau requis vs niveau visé — pour piloter la couleur de la
  // barre à gauche de l'encart cover (cohérence avec Synthèse + AF).
  const requiredAfLevel = resolveAfLevel(allSections.filter(s => !s.opted_out_by_moa));
  const requiredLevel = requiredAfLevel?.level || null;
  const contractLevel = af.service_level || null;
  const kpis = {
    requiredLevel,
    requiredLevelLabel: requiredLevel ? SERVICE_LEVEL_LABELS[requiredLevel] : null,
    contractLevel,
    contractLevelLabel: contractLevel ? SERVICE_LEVEL_LABELS[contractLevel] : null,
    verdict: buildLevelVerdict({ requiredLevel, contractLevel }),
  };

  const data = {
    af,
    authorName,
    exportDate,
    version,
    motif,
    serviceLevelLabel: SERVICE_LEVEL_LABELS[af.service_level] || af.service_level || '—',
    logoDataUrl: loadAssetDataUrl('logo-buildy.svg'),
    kpis,
    serviceLevel: requiredAfLevel,    // .justifications consomme par _cover-level-band.hbs
    categories,
    rows,
    totals,
  };

  return { data, version, categories, totals };
}

module.exports = {
  buildAfExportData,
  buildPointsListExportData,
  buildOfferingsAnnexForAf,
  buildLevelVerdict,
  // Re-exporte pour que export.js puisse les utiliser sans dupliquer
  buildLiveBacsResolver,
  SYNTHESIS_ROWS,
  renderSynthesisTable,
  SERVICE_LEVEL_LABELS,
};
