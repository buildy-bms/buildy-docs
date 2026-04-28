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
 * Pour une AF nouvellement creee, applique le PLAN_AF et insère toutes les
 * sections. Pour les sections kind='equipment', associe le template de la
 * bibliotheque s'il existe (slug → template_id).
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
    if (node.kind === 'equipment' && node.equipment_template_slug) {
      const tpl = db.equipmentTemplates.getBySlug(node.equipment_template_slug);
      if (tpl) {
        equipmentTemplateId = tpl.id;
        equipmentTemplateVersion = tpl.current_version;
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
      bacsArticles: node.bacs_articles || null,
      bodyHtml: node.body_placeholder ? `<p><em class="text-gray-400">${escapeHtml(node.body_placeholder)}</em></p>` : null,
      kind: node.kind,
      equipmentTemplateId,
      equipmentTemplateVersion,
      genericNote: node.generic_note || 0,
    });
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

module.exports = { seedLibraryOnBoot, seedAfStructure };
