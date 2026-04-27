'use strict';

const db = require('../database');
const log = require('./logger').system;

const ctaTemplate = require('../seeds/equipment-templates/cta');
const { PLAN_AF } = require('../seeds/plan-af');
const { HYPERVEEZ_PAGES } = require('../seeds/hyperveez-pages');
const { formatServiceLevel } = require('../seeds/service-levels');

// ── Templates equipement par defaut ───────────────────────────────────
// Liste des slugs reconnus par le plan AF. Pour la V1, seul CTA a un contenu
// complet. Les autres sont crees comme squelettes vides (a remplir au fil de
// l'eau via la bibliotheque + promotion depuis les AFs).
const EMPTY_TEMPLATES = [
  { slug: 'chaudiere', name: 'Chaudière / générateur de chaleur', category: 'chauffage', icon_kind: 'fa', icon_value: 'fa-fire', icon_color: '#ef4444' },
  { slug: 'aerotherme', name: 'Aérotherme', category: 'chauffage', icon_kind: 'fa', icon_value: 'fa-temperature-arrow-up', icon_color: '#f97316' },
  { slug: 'destratificateur', name: 'Destratificateur', category: 'chauffage', icon_kind: 'fa', icon_value: 'fa-fan', icon_color: '#fb923c' },
  { slug: 'drv', name: 'Système DRV / VRV / VRF', category: 'climatisation', icon_kind: 'fa', icon_value: 'fa-snowflake', icon_color: '#06b6d4' },
  { slug: 'rooftop', name: 'Rooftop', category: 'climatisation', icon_kind: 'fa', icon_value: 'fa-building', icon_color: '#0ea5e9' },
  { slug: 'ventilation-generique', name: 'Système de ventilation (autre que CTA)', category: 'ventilation', icon_kind: 'fa', icon_value: 'fa-wind', icon_color: '#3b82f6' },
  { slug: 'ecs', name: 'Production d\'eau chaude sanitaire', category: 'ecs', icon_kind: 'fa', icon_value: 'fa-droplet', icon_color: '#0ea5e9' },
  { slug: 'eclairage-interieur', name: 'Éclairage intérieur', category: 'eclairage', icon_kind: 'fa', icon_value: 'fa-lightbulb', icon_color: '#facc15' },
  { slug: 'eclairage-exterieur', name: 'Éclairage extérieur', category: 'eclairage', icon_kind: 'fa', icon_value: 'fa-lightbulb', icon_color: '#eab308' },
  { slug: 'prises-pilotees', name: 'Prises de courant pilotées', category: 'electricite', icon_kind: 'fa', icon_value: 'fa-plug', icon_color: '#a855f7' },
  { slug: 'production-electricite', name: 'Production d\'électricité sur site', category: 'electricite', icon_kind: 'fa', icon_value: 'fa-solar-panel', icon_color: '#eab308' },
  { slug: 'compteur-electrique', name: 'Compteur électrique', category: 'comptage', icon_kind: 'fa', icon_value: 'fa-bolt', icon_color: '#facc15' },
  { slug: 'compteur-gaz', name: 'Compteur gaz', category: 'comptage', icon_kind: 'fa', icon_value: 'fa-fire-flame-simple', icon_color: '#fb923c' },
  { slug: 'compteur-eau', name: 'Compteur eau', category: 'comptage', icon_kind: 'fa', icon_value: 'fa-droplet', icon_color: '#0ea5e9' },
  { slug: 'compteur-calories', name: 'Compteur calories', category: 'comptage', icon_kind: 'fa', icon_value: 'fa-temperature-half', icon_color: '#f97316' },
  { slug: 'qai', name: 'Capteur qualité de l\'air intérieur', category: 'qai', icon_kind: 'fa', icon_value: 'fa-leaf', icon_color: '#10b981' },
  { slug: 'volets', name: 'Volets motorisés', category: 'occultation', icon_kind: 'fa', icon_value: 'fa-blinds', icon_color: '#64748b' },
  { slug: 'stores', name: 'Stores motorisés', category: 'occultation', icon_kind: 'fa', icon_value: 'fa-blinds-raised', icon_color: '#64748b' },
  { slug: 'process-industriel', name: 'Équipement de process industriel', category: 'process', icon_kind: 'fa', icon_value: 'fa-industry', icon_color: '#475569' },
  { slug: 'equipement-generique', name: 'Équipement générique', category: 'autres', icon_kind: 'fa', icon_value: 'fa-cube', icon_color: '#6b7280' },
];

/**
 * Boot : cree les templates equipement de la bibliotheque s'ils n'existent
 * pas. Ne touche pas aux templates deja edites.
 */
function seedLibraryOnBoot() {
  let createdCount = 0;
  let updatedPointsCount = 0;

  // Template CTA complet (avec ses points)
  let cta = db.equipmentTemplates.getBySlug(ctaTemplate.slug);
  if (!cta) {
    cta = db.equipmentTemplates.create({
      slug: ctaTemplate.slug,
      name: ctaTemplate.name,
      category: ctaTemplate.category,
      bacsArticles: ctaTemplate.bacs_articles,
      descriptionHtml: ctaTemplate.description_html,
      iconKind: ctaTemplate.icon_kind,
      iconValue: ctaTemplate.icon_value,
      iconColor: ctaTemplate.icon_color,
    });
    for (const p of ctaTemplate.points) {
      db.equipmentTemplatePoints.create(cta.id, {
        slug: p.slug, position: p.position, label: p.label,
        dataType: p.dataType, direction: p.direction, unit: p.unit,
      });
      updatedPointsCount++;
    }
    createdCount++;
    log.info(`Seed library: created template "${ctaTemplate.name}" with ${ctaTemplate.points.length} points`);
  }

  // Squelettes vides
  for (const t of EMPTY_TEMPLATES) {
    if (db.equipmentTemplates.getBySlug(t.slug)) continue;
    db.equipmentTemplates.create({
      slug: t.slug,
      name: t.name,
      category: t.category,
      iconKind: t.icon_kind,
      iconValue: t.icon_value,
      iconColor: t.icon_color,
    });
    createdCount++;
  }

  if (createdCount > 0) {
    log.info(`Seed library: ${createdCount} template(s) created, ${updatedPointsCount} point(s) seeded`);
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

    // Cas special : 10.2 Pages Hyperveez → enfants peuples depuis HYPERVEEZ_PAGES
    if (node.number === '10.2') {
      let posOffset = 0;
      for (const [slug, page] of Object.entries(HYPERVEEZ_PAGES)) {
        const pageServiceLevel = page.features ? formatServiceLevel(page.features) : null;
        db.sections.create({
          afId,
          parentId: section.id,
          position: posOffset++,
          number: null, // numero auto-calcule a l'export
          title: page.name,
          serviceLevel: pageServiceLevel,
          serviceLevelSource: 'pdf-offres-2026',
          bodyHtml: `<p>${escapeHtml(page.description)}</p>${page.note ? `<p><em>${escapeHtml(page.note)}</em></p>` : ''}`,
          kind: 'hyperveez_page',
          hyperveezPageSlug: slug,
        });
        total++;
      }
    }

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
