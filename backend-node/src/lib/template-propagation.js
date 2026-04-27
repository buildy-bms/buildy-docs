'use strict';

const db = require('../database');

/**
 * Construit un snapshot {description_html, points[]} de l'etat courant d'un
 * template, pour figer une version dans equipment_template_versions.
 */
function buildSnapshot(templateId) {
  const tpl = db.equipmentTemplates.getById(templateId);
  if (!tpl) return null;
  const points = db.equipmentTemplatePoints.listByTemplate(templateId).map(p => ({
    slug: p.slug,
    position: p.position,
    label: p.label,
    data_type: p.data_type,
    direction: p.direction,
    unit: p.unit,
    notes: p.notes,
    is_optional: p.is_optional,
  }));
  return { description_html: tpl.description_html, points };
}

/**
 * Bumpe la version du template ET pose un snapshot de la nouvelle version.
 * Appele apres une modification publiee (ajout/retrait/edition de point ou
 * modification de la description).
 */
function snapshotAndBump(templateId, { changelog, authorId } = {}) {
  return db.db.transaction(() => {
    db.equipmentTemplates.bumpVersion(templateId);
    const tpl = db.equipmentTemplates.getById(templateId);
    const snapshot = buildSnapshot(templateId);
    db.equipmentTemplateVersions.create({
      templateId,
      version: tpl.current_version,
      snapshot,
      changelog,
      authorId,
    });
    return tpl.current_version;
  })();
}

/**
 * Renvoie le snapshot d'une version donnee, ou (fallback) l'etat courant si la
 * version est la version courante mais qu'aucun snapshot n'a ete pose.
 */
function getFrozenSnapshot(templateId, version) {
  if (version == null) return null;
  const row = db.equipmentTemplateVersions.getByTemplateAndVersion(templateId, version);
  if (row) {
    try { return JSON.parse(row.snapshot); }
    catch { return null; }
  }
  // Fallback : version manquante (par exemple une AF figee a v0 avant les
  // snapshots). On renvoie un snapshot vide pour que tout soit "ajoute".
  return { description_html: null, points: [] };
}

/**
 * Compare l'etat figé (section.equipment_template_version) avec l'etat courant
 * du template. Retourne la liste des changements humainement lisibles.
 */
function diffSectionVsTemplate(sectionId) {
  const section = db.sections.getById(sectionId);
  if (!section || section.kind !== 'equipment' || !section.equipment_template_id) return null;

  const template = db.equipmentTemplates.getById(section.equipment_template_id);
  if (!template) return null;

  const fromVersion = section.equipment_template_version;
  const toVersion = template.current_version;

  const frozen = getFrozenSnapshot(section.equipment_template_id, fromVersion);
  const current = buildSnapshot(section.equipment_template_id);

  // Index par slug pour matcher
  const frozenBySlug = new Map((frozen?.points || []).map(p => [p.slug, p]));
  const currentBySlug = new Map((current?.points || []).map(p => [p.slug, p]));

  const added = [];
  const removed = [];
  const modified = [];

  for (const [slug, p] of currentBySlug) {
    if (!frozenBySlug.has(slug)) {
      added.push(p);
    } else {
      const old = frozenBySlug.get(slug);
      const fields = ['label', 'data_type', 'direction', 'unit'];
      const changes = {};
      for (const f of fields) {
        if ((old[f] || null) !== (p[f] || null)) changes[f] = { from: old[f], to: p[f] };
      }
      if (Object.keys(changes).length > 0) {
        modified.push({ slug, label: p.label, changes });
      }
    }
  }
  for (const [slug, p] of frozenBySlug) {
    if (!currentBySlug.has(slug)) removed.push(p);
  }

  const descriptionChanged = (frozen?.description_html || null) !== (current?.description_html || null);

  const totalChanges = added.length + removed.length + modified.length + (descriptionChanged ? 1 : 0);

  return {
    section_id: section.id,
    section_number: section.number,
    section_title: section.title,
    template_id: template.id,
    template_name: template.name,
    template_slug: template.slug,
    from_version: fromVersion,
    to_version: toVersion,
    has_update: toVersion > (fromVersion || 0),
    added,
    removed,
    modified,
    description_changed: descriptionChanged,
    description_from: frozen?.description_html || null,
    description_to: current?.description_html || null,
    total_changes: totalChanges,
  };
}

module.exports = {
  buildSnapshot,
  snapshotAndBump,
  getFrozenSnapshot,
  diffSectionVsTemplate,
};
