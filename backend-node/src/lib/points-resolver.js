'use strict';

const db = require('../database');

/**
 * Resoud les points effectifs d'une section equipment.
 *
 * Algorithme :
 *   1. Charger les points du template référencé (figés à equipment_template_version)
 *   2. Appliquer les section_point_overrides dans l'ordre :
 *      - 'remove' → supprime un point base (ref base_point_id)
 *      - 'edit'   → modifie un point base (label/dataType/direction/unit)
 *      - 'add'    → ajoute un point local (pas de base_point_id)
 *
 * Retourne un tableau d'objets avec les meta utiles pour l'UI :
 *   { id, slug, label, data_type, direction, unit, is_optional,
 *     source: 'template' | 'local-add' | 'local-edit',
 *     base_point_id, override_id }
 */
function resolveSectionPoints(sectionId) {
  const section = db.sections.getById(sectionId);
  if (!section || section.kind !== 'equipment') return [];

  const overrides = db.sectionPointOverrides.listBySection(sectionId);
  const removed = new Set(overrides.filter(o => o.action === 'remove').map(o => o.base_point_id));
  const edits = new Map(overrides.filter(o => o.action === 'edit').map(o => [o.base_point_id, o]));

  // 1. Points du template (filtrés des 'remove')
  let basePoints = [];
  if (section.equipment_template_id) {
    basePoints = db.equipmentTemplatePoints
      .listByTemplate(section.equipment_template_id)
      .filter(p => !removed.has(p.id))
      .map(p => {
        const ed = edits.get(p.id);
        if (ed) {
          return {
            id: p.id, slug: p.slug,
            label: ed.label ?? p.label,
            data_type: ed.data_type ?? p.data_type,
            direction: ed.direction ?? p.direction,
            unit: ed.unit ?? p.unit,
            is_optional: ed.is_optional != null ? ed.is_optional : p.is_optional,
            source: 'local-edit', base_point_id: p.id, override_id: ed.id,
            position: ed.position ?? p.position,
          };
        }
        return {
          id: p.id, slug: p.slug, label: p.label,
          data_type: p.data_type, direction: p.direction, unit: p.unit,
          is_optional: p.is_optional,
          source: 'template', base_point_id: p.id, override_id: null,
          position: p.position,
        };
      });
  }

  // 2. Ajouts locaux (pas de base_point_id)
  const localAdds = overrides
    .filter(o => o.action === 'add')
    .map(o => ({
      id: null, slug: null,
      label: o.label, data_type: o.data_type, direction: o.direction, unit: o.unit,
      is_optional: o.is_optional,
      source: 'local-add', base_point_id: null, override_id: o.id,
      position: o.position,
    }));

  return [...basePoints, ...localAdds].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}

module.exports = { resolveSectionPoints };
