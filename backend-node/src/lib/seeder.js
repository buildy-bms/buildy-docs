'use strict';

const db = require('../database');
const log = require('./logger').system;

const ALL_TEMPLATES = require('../seeds/equipment-templates');
const { buildSnapshot, snapshotAndBump } = require('./template-propagation');
// HYPERVEEZ_PAGES n'est plus utilisé (Lot 22 — section 10 supprimée), conservé pour usage futur.
// eslint-disable-next-line no-unused-vars
const { PLAN_AF } = require('../seeds/plan-af');
const { HYPERVEEZ_PAGES } = require('../seeds/hyperveez-pages');
const { formatServiceLevel } = require('../seeds/service-levels');

// Slug d'une section dans la table section_templates :
// - sections numérotées : on prend le `number` du seed ('1.1', '6.3'…)
// - section sans number (ex. 'zones' top-level) : on prend le kind
function sectionTemplateSlug(node) {
  return node.number || node.kind;
}

// Construit le body_html canonique initial pour un node du plan-af.
// On garde le HTML wrappé italique gris pour reproduire l'ancien comportement,
// mais cette valeur est stockée en DB et donc directement éditable depuis l'UI.
function defaultCanonicalBody(node) {
  if (!node.body_placeholder) return null;
  return `<p><em class="text-gray-400">${escapeHtml(node.body_placeholder)}</em></p>`;
}

/**
 * Boot : cree les templates equipement de la bibliotheque s'ils n'existent
 * pas. Pour les templates deja crees mais "vides" (sans description ou sans
 * preferred_protocols), on les enrichit avec le contenu actuel du fichier
 * de seed (idempotent — n'écrase jamais une description que l'utilisateur a
 * éditée manuellement, on regarde uniquement les champs vides).
 *
 * Lot 20 : tous les 21 templates équipement (CTA + 20 autres) sont rédigés
 * dans backend-node/src/seeds/equipment-templates/<slug>.js suivant la
 * structure stricte CTA (mention BACS si applicable + description fonctionnelle
 * agnostique + points typiques Mesure/État/Alarme/Commande/Consigne).
 */
function seedLibraryOnBoot() {
  let createdCount = 0;
  let enrichedCount = 0;
  let pointsCreated = 0;

  for (const tpl of ALL_TEMPLATES) {
    const existing = db.equipmentTemplates.getBySlug(tpl.slug);
    if (!existing) {
      // Création complète
      const created = db.equipmentTemplates.create({
        slug: tpl.slug,
        name: tpl.name,
        category: tpl.category,
        bacsArticles: tpl.bacs_articles,
        bacsJustification: tpl.bacs_justification,
        descriptionHtml: tpl.description_html,
        iconKind: tpl.icon_kind,
        iconValue: tpl.icon_value,
        iconColor: tpl.icon_color,
        preferredProtocols: tpl.preferred_protocols,
      });
      for (const p of (tpl.points || [])) {
        db.equipmentTemplatePoints.create(created.id, {
          slug: p.slug, position: p.position, label: p.label,
          dataType: p.dataType, direction: p.direction, unit: p.unit,
          techName: p.techName, nature: p.nature,
        });
        pointsCreated++;
      }
      createdCount++;
    } else {
      // Enrichissement : on ne touche aux champs que s'ils sont VIDES en BDD.
      // On force aussi un nouveau snapshot si on enrichit (pour que la propagation
      // remonte les nouveautés aux AFs existantes, qui pourront décider d'appliquer).
      const updates = {};
      if (!existing.description_html && tpl.description_html) updates.descriptionHtml = tpl.description_html;
      if (!existing.bacs_articles && tpl.bacs_articles) updates.bacsArticles = tpl.bacs_articles;
      if (!existing.bacs_justification && tpl.bacs_justification) updates.bacsJustification = tpl.bacs_justification;
      if (!existing.preferred_protocols && tpl.preferred_protocols) updates.preferredProtocols = tpl.preferred_protocols;
      let changed = Object.keys(updates).length > 0;
      if (changed) db.equipmentTemplates.update(existing.id, { ...updates, updatedBy: null });

      // Points : on n'ajoute QUE ceux dont le slug n'existe pas déjà
      const existingSlugs = new Set(db.equipmentTemplatePoints.listByTemplate(existing.id).map(p => p.slug));
      for (const p of (tpl.points || [])) {
        if (existingSlugs.has(p.slug)) continue;
        try {
          db.equipmentTemplatePoints.create(existing.id, {
            slug: p.slug, position: p.position, label: p.label,
            dataType: p.dataType, direction: p.direction, unit: p.unit,
            techName: p.techName, nature: p.nature,
          });
          pointsCreated++;
          changed = true;
        } catch { /* ignore unique conflict */ }
      }

      if (changed) {
        snapshotAndBump(existing.id, { changelog: 'Enrichissement seed Lot 20', authorId: null });
        enrichedCount++;
      }
    }
  }

  if (createdCount > 0) log.info(`Seed library: ${createdCount} template(s) crees`);
  if (enrichedCount > 0) log.info(`Seed library: ${enrichedCount} template(s) enrichis (Lot 20)`);
  if (pointsCreated > 0) log.info(`Seed library: ${pointsCreated} point(s) seeds`);

  // Filet de securite : tout template doit avoir un snapshot pour sa version
  // courante (necessaire au diff de propagation Lot 9). Idempotent.
  const allTpls = db.equipmentTemplates.list();
  let snapshotsCreated = 0;
  for (const tpl of allTpls) {
    const exists = db.equipmentTemplateVersions.getByTemplateAndVersion(tpl.id, tpl.current_version);
    if (exists) continue;
    db.equipmentTemplateVersions.create({
      templateId: tpl.id,
      version: tpl.current_version,
      snapshot: buildSnapshot(tpl.id),
      changelog: 'Snapshot initial (seed)',
      authorId: null,
    });
    snapshotsCreated++;
  }
  if (snapshotsCreated > 0) {
    log.info(`Seed library: ${snapshotsCreated} snapshot(s) initial(aux) crees`);
  }
}

/**
 * Lot 30 — Boot : peuple section_templates depuis PLAN_AF pour les nodes
 * kind='standard' (et 'zones'). Idempotent : insère uniquement les slugs
 * absents de la table. Les éditions ultérieures vivent en DB.
 */
function seedSectionTemplatesOnBoot() {
  let createdCount = 0;

  function walk(node) {
    if (node.kind === 'standard' || node.kind === 'zones') {
      const slug = sectionTemplateSlug(node);
      if (slug && !db.sectionTemplates.getBySlug(slug)) {
        const serviceLevel = node.features
          ? formatServiceLevel(node.features)
          : (node.service_level || null);
        const serviceLevelSource = node.features ? 'pdf-offres-2026' : (node.service_level ? 'manual' : null);
        db.sectionTemplates.create({
          slug,
          number: node.number || null,
          title: node.title,
          kind: node.kind,
          bodyHtml: defaultCanonicalBody(node),
          bacsArticles: node.bacs_articles || null,
          serviceLevel,
          serviceLevelSource,
          features: node.features || null,
        });
        createdCount++;
      }
    }
    if (Array.isArray(node.children)) for (const c of node.children) walk(c);
  }

  for (const top of PLAN_AF) walk(top);
  if (createdCount > 0) log.info(`Seed section templates: ${createdCount} cree(s)`);
}

/**
 * Pour une AF nouvellement creee, applique le PLAN_AF et insère toutes les
 * sections. Pour les sections kind='equipment', associe le template de la
 * bibliotheque s'il existe (slug → template_id). Pour kind='standard'/'zones',
 * lookup section_templates pour récupérer le contenu canonique courant + version.
 */
function seedAfStructure(afId) {
  let total = 0;

  function insertNode(node, parentId) {
    // Resolution du niveau de service depuis features (si declare)
    const serviceLevel = node.features
      ? formatServiceLevel(node.features)
      : (node.service_level || null);
    const serviceLevelSource = node.features ? 'pdf-offres-2026' : (node.service_level ? 'manual' : null);

    // Resolution du template equipement (si declare)
    let equipmentTemplateId = null;
    let equipmentTemplateVersion = null;
    let equipmentTemplateBacs = null;
    if (node.kind === 'equipment' && node.equipment_template_slug) {
      const tpl = db.equipmentTemplates.getBySlug(node.equipment_template_slug);
      if (tpl) {
        equipmentTemplateId = tpl.id;
        equipmentTemplateVersion = tpl.current_version;
        equipmentTemplateBacs = tpl.bacs_articles;
      }
    }

    // Lot 30 — Resolution du template "section" pour les sections standard / zones
    let sectionTemplateId = null;
    let sectionTemplateVersion = null;
    let bodyHtml = node.body_placeholder ? `<p><em class="text-gray-400">${escapeHtml(node.body_placeholder)}</em></p>` : null;
    let bacsArticles = node.bacs_articles || equipmentTemplateBacs || null;
    if (node.kind === 'standard' || node.kind === 'zones') {
      const slug = sectionTemplateSlug(node);
      const tpl = slug ? db.sectionTemplates.getBySlug(slug) : null;
      if (tpl) {
        sectionTemplateId = tpl.id;
        sectionTemplateVersion = tpl.current_version;
        bodyHtml = tpl.body_html;       // contenu canonique courant
        bacsArticles = tpl.bacs_articles || bacsArticles;
      }
    }

    const section = db.sections.create({
      afId,
      parentId,
      position: total * 10, // pas de 10 pour permettre l'insertion future
      number: node.number,
      title: node.title,
      serviceLevel,
      serviceLevelSource,
      bacsArticles,
      bodyHtml,
      kind: node.kind,
      equipmentTemplateId,
      equipmentTemplateVersion,
      genericNote: node.generic_note || 0,
    });
    // Set section_template_id / version après création (champs hors signature publique)
    if (sectionTemplateId) {
      db.db.prepare('UPDATE sections SET section_template_id = ?, section_template_version = ? WHERE id = ?')
        .run(sectionTemplateId, sectionTemplateVersion, section.id);
    }
    total++;

    // (Lot 22) Le peuplement dynamique de la section 10.2 depuis HYPERVEEZ_PAGES
    // a été retiré ; le chapitre 10 entier n'existe plus dans le plan AF.

    // Recursion sur les enfants statiques
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        insertNode(child, section.id);
      }
    }
  }

  // Wrap tout dans une transaction pour garantir atomicite
  const tx = db.db.transaction(() => {
    for (const top of PLAN_AF) insertNode(top, null);
  });
  tx();

  log.info(`Seed AF #${afId} : ${total} sections inserted`);
  return total;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Lot 31 — Backfill : pour chaque nouvelle section ajoutee a PLAN_AF
 * apres la creation initiale d'une AF, on l'inserre dans toutes les
 * AFs existantes (a la position correspondant au plan canonique).
 *
 * Detecte les sections "manquantes" en comparant le set des `number`
 * du PLAN_AF aux `number` deja presents dans chaque AF.
 */
function backfillNewPlanSections() {
  // Collecte les nodes du PLAN_AF avec leur chemin (parent number, position)
  const planNodes = []; // { number, parent_number, position, node }
  function walk(node, parentNumber, idx) {
    planNodes.push({ number: node.number || node.kind, parent_number: parentNumber, position: idx * 10, node });
    if (Array.isArray(node.children)) {
      node.children.forEach((c, i) => walk(c, node.number || null, i));
    }
  }
  PLAN_AF.forEach((top, i) => walk(top, null, i));

  const allAfs = db.db.prepare('SELECT id FROM afs WHERE deleted_at IS NULL').all();
  let totalInserted = 0;

  for (const af of allAfs) {
    const existingNumbers = new Set(
      db.db.prepare('SELECT number FROM sections WHERE af_id = ?').all(af.id).map(r => r.number)
    );

    for (const { number, parent_number, position, node } of planNodes) {
      if (existingNumbers.has(number)) continue;
      if (!node.number) continue; // skip 'zones' top-level (deja gere)

      // Trouve le parent dans cette AF (par number)
      let parentId = null;
      if (parent_number) {
        const parent = db.db.prepare('SELECT id FROM sections WHERE af_id = ? AND number = ?').get(af.id, parent_number);
        if (!parent) continue; // parent absent → skip (cas theorique)
        parentId = parent.id;
      }

      // Lookup section_template
      const slug = sectionTemplateSlug(node);
      const tpl = slug ? db.sectionTemplates.getBySlug(slug) : null;
      const serviceLevel = node.features
        ? formatServiceLevel(node.features)
        : (node.service_level || null);
      const serviceLevelSource = node.features ? 'pdf-offres-2026' : (node.service_level ? 'manual' : null);
      const bodyHtml = tpl?.body_html || (node.body_placeholder
        ? `<p><em class="text-gray-400">${escapeHtml(node.body_placeholder)}</em></p>`
        : null);

      const created = db.sections.create({
        afId: af.id,
        parentId,
        position,
        number: node.number,
        title: node.title,
        serviceLevel,
        serviceLevelSource,
        bacsArticles: tpl?.bacs_articles || node.bacs_articles || null,
        bodyHtml,
        kind: node.kind,
        genericNote: node.generic_note || 0,
      });
      if (tpl) {
        db.db.prepare('UPDATE sections SET section_template_id = ?, section_template_version = ? WHERE id = ?')
          .run(tpl.id, tpl.current_version, created.id);
      }
      totalInserted++;
    }
  }
  if (totalInserted > 0) log.info(`Backfill nouvelles sections plan : ${totalInserted} section(s) inseree(s) dans les AFs existantes`);
}

/**
 * Lot 30 — Backfill : rattache les sections AF existantes (kind=standard/zones)
 * au section_template correspondant via le `number` (ou kind pour 'zones').
 * Ne touche pas le body_html : seulement section_template_id + version=1.
 * Idempotent : ignore les sections déjà rattachées.
 */
function backfillSectionTemplateLinks() {
  const orphans = db.db.prepare(`
    SELECT id, number, kind FROM sections
    WHERE section_template_id IS NULL
      AND kind IN ('standard', 'zones')
  `).all();
  if (!orphans.length) return;

  let linked = 0;
  for (const s of orphans) {
    const slug = s.number || s.kind;
    if (!slug) continue;
    const tpl = db.sectionTemplates.getBySlug(slug);
    if (!tpl) continue;
    db.db.prepare('UPDATE sections SET section_template_id = ?, section_template_version = ? WHERE id = ?')
      .run(tpl.id, tpl.current_version, s.id);
    linked++;
  }
  if (linked > 0) log.info(`Backfill section templates : ${linked} section(s) rattachee(s)`);
}

/**
 * Lot 32 — Seed des categories de systemes en DB depuis le catalogue par defaut.
 * Idempotent : insere uniquement les categories absentes par key.
 */
function seedSystemCategoriesOnBoot() {
  const { SYSTEM_CATEGORIES } = require('./system-categories');
  // Icones par defaut suggerees par categorie (FA Solid Pro)
  const ICONS = {
    chauffage:     { icon: 'fa-fire',          color: '#dc2626' },
    climatisation: { icon: 'fa-snowflake',     color: '#0ea5e9' },
    ventilation:   { icon: 'fa-fan',           color: '#3b82f6' },
    ecs:           { icon: 'fa-faucet-drip',   color: '#0284c7' },
    pv:            { icon: 'fa-solar-panel',   color: '#facc15' },
    eclairage_int: { icon: 'fa-lightbulb',     color: '#eab308' },
    eclairage_ext: { icon: 'fa-lightbulb',     color: '#a16207' },
    prises:        { icon: 'fa-plug',          color: '#a855f7' },
    comptage:      { icon: 'fa-gauge',         color: '#22c55e' },
    qai:           { icon: 'fa-leaf',          color: '#16a34a' },
    occultation:   { icon: 'fa-window-maximize', color: '#64748b' },
    process:       { icon: 'fa-industry',      color: '#475569' },
    autres:        { icon: 'fa-cube',          color: '#6b7280' },
  };
  let created = 0;
  for (let i = 0; i < SYSTEM_CATEGORIES.length; i++) {
    const c = SYSTEM_CATEGORIES[i];
    if (db.systemCategoriesDb.getByKey(c.key)) continue;
    const icon = ICONS[c.key] || { icon: 'fa-cube', color: '#6b7280' };
    db.systemCategoriesDb.create({
      key: c.key, label: c.label, bacs: c.bacs, slugs: c.slugs,
      iconValue: icon.icon, iconColor: icon.color, position: i * 10,
    });
    created++;
  }
  if (created > 0) log.info(`Seed system_categories_db : ${created} categorie(s) creee(s)`);
}

module.exports = { seedLibraryOnBoot, seedSectionTemplatesOnBoot, backfillSectionTemplateLinks, backfillNewPlanSections, seedSystemCategoriesOnBoot, seedAfStructure };
