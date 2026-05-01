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
  let pointsEnriched = 0;

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

      // Points : on n'ajoute QUE ceux dont le slug n'existe pas déjà.
      // Pour les points existants, on enrichit uniquement les meta absentes
      // (tech_name, nature) sans toucher au reste : preserve les modifs user
      // tout en remontant les valeurs canoniques absentes (cas typique :
      // points seedes avant l'introduction de tech_name/nature).
      const existingPoints = db.equipmentTemplatePoints.listByTemplate(existing.id);
      const existingBySlug = new Map(existingPoints.map(p => [p.slug, p]));
      for (const p of (tpl.points || [])) {
        const existingPt = existingBySlug.get(p.slug);
        if (!existingPt) {
          try {
            db.equipmentTemplatePoints.create(existing.id, {
              slug: p.slug, position: p.position, label: p.label,
              dataType: p.dataType, direction: p.direction, unit: p.unit,
              techName: p.techName, nature: p.nature, isOptional: p.isOptional,
            });
            pointsCreated++;
            changed = true;
          } catch { /* ignore unique conflict */ }
        } else {
          // Enrichissement non-destructif : on remplit techName / nature
          // SI ils sont vides en DB ET qu'on en a une valeur dans le seed.
          const updates = [];
          const params = [];
          if (!existingPt.tech_name && p.techName) {
            updates.push('tech_name = ?'); params.push(p.techName);
          }
          if (!existingPt.nature && p.nature) {
            updates.push('nature = ?'); params.push(p.nature);
          }
          if (updates.length) {
            params.push(existingPt.id);
            db.db.prepare(`UPDATE equipment_template_points SET ${updates.join(', ')} WHERE id = ?`).run(...params);
            pointsEnriched++;
            changed = true;
          }
        }
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
  if (pointsEnriched > 0) log.info(`Seed library: ${pointsEnriched} point(s) enrichis (techName/nature)`);

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
// Liste figee des numeros de section consideres comme "fonctionnalites"
// (cf. migration 25). Utilisee pour marquer is_functionality au seed initial
// d'une fresh DB sans depender de la migration.
const FUNCTIONALITY_NUMBERS = new Set([
  '1.5', '3.1', '3.2', '3.3', '4.1', '4.2', '4.3',
  '5.1', '5.2', '5.3', '6.1', '6.2', '6.3', '6.4', '6.5', '6.6',
  '7', '8', '9', '10.1', '11.1', '11.2', '11.3',
]);

function seedSectionTemplatesOnBoot() {
  let createdCount = 0;

  // Resolve les equipment_templates par slug (pour set equipment_template_id).
  const equipmentSlugToId = new Map();
  for (const eq of db.db.prepare('SELECT id, slug FROM equipment_templates').all()) {
    equipmentSlugToId.set(eq.slug, eq.id);
  }

  // Walk recursif. Pour fresh DB, inserts standard + zones + equipment + synthesis,
  // avec parent_template_id resolu via le slug du parent (deja insere).
  function walk(node, parentTemplateId) {
    const slug = sectionTemplateSlug(node);
    let id = null;
    const existing = slug ? db.sectionTemplates.getBySlug(slug) : null;
    // Anti-reseed : si l'utilisateur a explicitement supprime ce slug, on
    // ne le recree pas. Le tombstone le protege a travers les redeploys.
    const tombstoned = slug ? db.deletedSectionTemplateSlugs.has(slug) : false;
    if (existing) {
      id = existing.id;
    } else if (slug && !tombstoned) {
      const serviceLevel = node.features
        ? formatServiceLevel(node.features)
        : (node.service_level || null);
      const serviceLevelSource = node.features ? 'pdf-offres-2026' : (node.service_level ? 'manual' : null);
      const equipmentTemplateId = node.equipment_template_slug
        ? equipmentSlugToId.get(node.equipment_template_slug) || null
        : null;
      const created = db.sectionTemplates.create({
        slug,
        number: node.number || null,
        title: node.title,
        kind: node.kind,
        bodyHtml: defaultCanonicalBody(node),
        bacsArticles: node.bacs_articles || null,
        serviceLevel,
        serviceLevelSource,
        features: node.features || null,
        isFunctionality: node.number ? FUNCTIONALITY_NUMBERS.has(node.number) : false,
        parentTemplateId: parentTemplateId || null,
        equipmentTemplateId,
        availE: node.avail_e || null,
        availS: node.avail_s || null,
        availP: node.avail_p || null,
      });
      id = created.id;
      createdCount++;
    }
    if (Array.isArray(node.children)) {
      for (const c of node.children) walk(c, id || parentTemplateId);
    }
  }

  for (const top of PLAN_AF) walk(top, null);
  if (createdCount > 0) log.info(`Seed section templates: ${createdCount} cree(s)`);
}

/**
 * Pour une AF nouvellement creee, applique le PLAN_AF et insère toutes les
 * sections. Pour les sections kind='equipment', associe le template de la
 * bibliotheque s'il existe (slug → template_id). Pour kind='standard'/'zones',
 * lookup section_templates pour récupérer le contenu canonique courant + version.
 */
function seedAfStructure(afId) {
  // Lot 33 — Ne lit plus PLAN_AF mais la table section_templates qui est
  // devenue la source de verite (parent_template_id + equipment_template_id +
  // position). La numerotation est calculee a la volee depuis la position
  // dans la fratrie (1, 1.1, 1.2, 2…).
  const allTemplates = db.sectionTemplates.list({});
  const byParentTpl = new Map();
  for (const t of allTemplates) {
    const k = t.parent_template_id || 0;
    if (!byParentTpl.has(k)) byParentTpl.set(k, []);
    byParentTpl.get(k).push(t);
  }
  for (const arr of byParentTpl.values()) {
    arr.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  }

  let total = 0;

  function insertNode(tpl, parentSectionId, numberPrefix, indexInSiblings) {
    const computedNumber = tpl.kind === 'zones'
      ? null // les zones (preliminaire) n'ont pas de numero
      : (numberPrefix ? `${numberPrefix}.${indexInSiblings + 1}` : String(indexInSiblings + 1));

    // Resolution du template equipement (depuis section_templates.equipment_template_id)
    let equipmentTemplateId = null;
    let equipmentTemplateVersion = null;
    let equipmentTemplateBacs = null;
    if (tpl.kind === 'equipment' && tpl.equipment_template_id) {
      const eq = db.equipmentTemplates.getById(tpl.equipment_template_id);
      if (eq) {
        equipmentTemplateId = eq.id;
        equipmentTemplateVersion = eq.current_version;
        equipmentTemplateBacs = eq.bacs_articles;
      }
    }

    const section = db.sections.create({
      afId,
      parentId: parentSectionId,
      position: total * 10,
      number: computedNumber,
      title: tpl.title,
      serviceLevel: tpl.service_level || null,
      serviceLevelSource: tpl.service_level_source || null,
      bacsArticles: tpl.bacs_articles || equipmentTemplateBacs || null,
      bodyHtml: tpl.body_html,
      kind: tpl.kind,
      equipmentTemplateId,
      equipmentTemplateVersion,
      genericNote: 0,
    });
    // Lien section_template_id / version (toujours, pour permettre la propagation)
    db.db.prepare('UPDATE sections SET section_template_id = ?, section_template_version = ? WHERE id = ?')
      .run(tpl.id, tpl.current_version, section.id);
    total++;

    const children = byParentTpl.get(tpl.id) || [];
    children.forEach((child, i) => {
      // Pour les enfants directs des "zones" (top-level sans number), le prefix
      // est "" (les zones n'ont pas de descendants dans le plan actuel ; safe).
      const childPrefix = computedNumber || '';
      insertNode(child, section.id, childPrefix, i);
    });
  }

  // Walk les top-level (parent_template_id = 0/null), ordonnes par position.
  const tx = db.db.transaction(() => {
    const tops = byParentTpl.get(0) || [];
    tops.forEach((top, i) => {
      // Numerotation top-level : on saute les "zones" (kind='zones' = preliminaire)
      // pour que "Preambule" reste "1" comme aujourd'hui.
      // Approche : compte uniquement les top-level numerotes pour le compteur.
    });
    // Compteur dedie aux top-level numerotes.
    let topCounter = 0;
    tops.forEach(top => {
      if (top.kind === 'zones') {
        // zones inserees mais sans number et sans incremenenter le compteur
        insertNode(top, null, '', 0); // index ignore (zones n'a pas de number)
      } else {
        insertNode(top, null, '', topCounter);
        topCounter++;
      }
    });
  });
  tx();

  log.info(`Seed AF #${afId} : ${total} sections inserted (depuis section_templates)`);
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

// ── Seed referentiel BACS : matrice nature_zone -> categories attendues ──
// Idempotent : ne touche pas les lignes deja presentes (l'utilisateur a peut-etre
// affine la matrice). Pour forcer un refresh, supprimer la ligne avant boot.
function seedBacsRequirementsOnBoot() {
  const matrix = require('../seeds/bacs-requirements');
  const get = db.db.prepare('SELECT 1 FROM bacs_requirements_by_zone_nature WHERE zone_nature = ?');
  const ins = db.db.prepare(`
    INSERT INTO bacs_requirements_by_zone_nature (zone_nature, required_categories)
    VALUES (?, ?)
  `);
  let created = 0;
  for (const row of matrix) {
    if (get.get(row.zone_nature)) continue;
    ins.run(row.zone_nature, JSON.stringify(row.required_categories));
    created++;
  }
  if (created > 0) log.info(`Seed bacs_requirements_by_zone_nature : ${created} ligne(s) creee(s)`);
}

// ── (m38-m40) Matrice usage x nature_zone -> meter_type ──
// Note : depuis m40 cette matrice est desactivee. Les compteurs sont
// derives uniquement des devices saisis (energy_source). On garde la
// fonction comme no-op pour ne pas casser l'appel dans index.js.
function seedBacsMeterRequirementsOnBoot() {
  // No-op depuis m40 — cf bacs-audit-action-generator.js + seeder
  // resyncBacsAuditMetersFromDevices.
}

// ── Seed structure d'un audit BACS pour un site donne ──
// Cree les sections de plan (1. Identification, 2. Zones, 3. Systemes par
// zone, 4. Compteurs, 5. Regulation thermique, 6. GTB, 7. Synthese, 8. Plan
// d'action), pre-remplit bacs_audit_systems pour chaque (zone × categorie
// requise selon zone.nature), pre-remplit bacs_audit_thermal_regulation par
// zone, et insere une ligne 1-1 vide dans bacs_audit_bms.
//
// Retourne { sections_count, systems_count, thermal_count } pour audit.
function seedBacsAuditStructure(documentId, siteId) {
  const af = db.afs.getById(documentId);
  if (!af || af.kind !== 'bacs_audit') {
    throw new Error(`Document #${documentId} introuvable ou n'est pas un audit BACS`);
  }
  const site = db.sites.getById(siteId);
  if (!site) throw new Error(`Site #${siteId} introuvable`);

  const zones = db.zones.listBySite(siteId);

  // 1) Plan canonique : 8 chapitres + sous-sections principales
  const PLAN = [
    { number: '1', title: 'Identification du site', kind: 'standard',
      body_html: '<p>Donnees generales du site (nom, client, adresse, occupation), societe de maintenance, applicabilite BACS R175-2 (date butoir et puissance cumulee chauffage+clim).</p>' },
    { number: '2', title: 'Zones fonctionnelles (R175-1 §6)', kind: 'standard',
      body_html: '<p>Decoupage zonal du site selon usage homogene. Chaque zone porte ses categories BACS attendues selon sa nature.</p>' },
    { number: '3', title: 'Systemes techniques par zone (R175-1 §4)', kind: 'standard',
      body_html: '<p>Pour chaque zone, presence et communication des systemes BACS attendus (chauffage, refroidissement, ventilation, ECS, eclairage, production electrique).</p>' },
    { number: '4', title: 'Compteurs et mesurage (R175-3 §1)', kind: 'standard',
      body_html: '<p>Matrice usage × zone : compteurs requis vs presents vs communicants. Retention 5 ans minimum exigee par R175-3 §1.</p>' },
    { number: '5', title: 'Regulation thermique automatique (R175-6)', kind: 'standard',
      body_html: '<p>Pour chaque zone : presence d\'une regulation par piece ou par zone. Type de generateur. Exemption explicite des appareils independants de chauffage au bois.</p>' },
    { number: '6', title: 'Solution GTB / GTC (R175-3, R175-4, R175-5)', kind: 'standard',
      body_html: '<p>Evaluation de la solution de supervision en place : 4 criteres R175-3 (suivi 5 ans, detection derives, interoperabilite, arret manuel), consignes maintenance R175-4, formation exploitant R175-5.</p>' },
    { number: '7', title: 'Synthese de conformite', kind: 'standard',
      body_html: '<p>Etat global compliant / partial / non_compliant, sommaire des ecarts par article R175.</p>' },
    { number: '8', title: 'Plan de mise en conformite', kind: 'standard',
      body_html: '<p>Liste consolidee des actions correctives auto-generees + items manuels. Triable par severite (blocking / major / minor) et par categorie. Base de devis pour l\'equipe commerciale.</p>' },
  ];

  let sectionsCount = 0;
  for (let i = 0; i < PLAN.length; i++) {
    const p = PLAN[i];
    db.sections.create({
      afId: documentId,
      parentId: null,
      position: (i + 1) * 100,
      number: p.number,
      title: p.title,
      kind: p.kind,
      bodyHtml: p.body_html,
    });
    sectionsCount++;
  }

  // 2 + 3 + 4 : pre-remplit les donnees d'audit (systems + thermal + bms 1-1)
  const dataResult = resyncBacsAuditDataForZones(documentId, zones);

  log.info(`Seed audit BACS #${documentId} (site #${siteId}) : ${sectionsCount} sections, ${dataResult.systems_count} systems, ${dataResult.thermal_count} thermal_regulation`);
  return { sections_count: sectionsCount, systems_count: dataResult.systems_count, thermal_count: dataResult.thermal_count };
}

/**
 * Pre-remplit / re-synchronise les donnees d'audit (systems + thermal + bms
 * 1-1) pour les zones donnees. Idempotent (INSERT OR IGNORE) : peut etre
 * appele plusieurs fois sans creer de doublons. Utile :
 *   1. Au seed initial (depuis seedBacsAuditStructure)
 *   2. Apres ajout/modification d'une zone (le UI declenche un POST resync)
 *
 * Pour une zone dont la nature change : les rows existantes restent (les
 * categories deja saisies par l'auditeur ne sont pas effacees), seules
 * les nouvelles categories implied par la nouvelle nature sont ajoutees.
 */
function resyncBacsAuditDataForZones(documentId, zones) {
  const reqByNature = {};
  for (const r of db.db.prepare('SELECT zone_nature, required_categories FROM bacs_requirements_by_zone_nature').all()) {
    try { reqByNature[r.zone_nature] = JSON.parse(r.required_categories); }
    catch { reqByNature[r.zone_nature] = []; }
  }

  const insertSystem = db.db.prepare(`
    INSERT OR IGNORE INTO bacs_audit_systems (document_id, zone_id, system_category, present)
    VALUES (?, ?, ?, 0)
  `);
  let systemsCount = 0;
  for (const z of zones) {
    const cats = z.nature ? (reqByNature[z.nature] || []) : [];
    for (const cat of cats) {
      const r = insertSystem.run(documentId, z.zone_id, cat);
      if (r.changes) systemsCount++;
    }
  }

  const insertThermal = db.db.prepare(`
    INSERT OR IGNORE INTO bacs_audit_thermal_regulation (document_id, zone_id, has_automatic_regulation)
    VALUES (?, ?, 0)
  `);
  let thermalCount = 0;
  for (const z of zones) {
    const r = insertThermal.run(documentId, z.zone_id);
    if (r.changes) thermalCount++;
  }

  // Ligne 1-1 vide dans bacs_audit_bms (sera editee dans le formulaire GTB)
  db.db.prepare(`
    INSERT OR IGNORE INTO bacs_audit_bms (document_id) VALUES (?)
  `).run(documentId);

  // Compteurs auto (R175-3 §1)
  const metersCount = resyncBacsAuditMetersForZones(documentId, zones);

  return { systems_count: systemsCount, thermal_count: thermalCount, meters_count: metersCount };
}

/**
 * Pre-remplit les compteurs auto-generes a partir des devices saisis.
 * Logique (cf retour terrain Kevin) :
 *  - Tant qu'aucun device n'est saisi pour un systeme, AUCUN compteur
 *    n'est cree pour cette zone+categorie (eviter le bruit).
 *  - Pour chaque device avec energy_source : on derive le meter_type
 *    correspondant (gas->gas, electric/heat_pump->electric, district_heating
 *    ->thermal, fuel_oil/wood/biomass->other, solar->electric_production).
 *  - Compteur zonal : pose dans la zone du systeme parent du device.
 *  - Compteur general (zone_id NULL) : 1 par energie globale du batiment
 *    (electrique, gaz, fioul, thermique reseau).
 *  - Idempotent : INSERT OR IGNORE via SELECT existence sur tuple
 *    (document, zone, usage, meter_type).
 *  - Si un device change d'energie : ancien compteur "orphelin" est laisse
 *    en place avec required=0 (audit log conserve), nouveau compteur ajoute.
 *    Les compteurs auto-generes n'ont pas de marqueur DB pour eviter de
 *    purger des saisies utilisateur. Pour purger les orphelins, l'auditeur
 *    supprime manuellement (DELETE /bacs-audit/meters/:id).
 *
 * Retourne le nombre de compteurs nouvellement inseres.
 */
function resyncBacsAuditMetersForZones(documentId, zones) {
  let inserted = 0;

  // Mapping energie -> meter_type (le type physique du compteur)
  const ENERGY_TO_METER_TYPE = {
    gas: 'gas',
    electric: 'electric',
    heat_pump: 'electric',
    wood: 'other',
    biomass: 'other',
    fuel_oil: 'other',
    district_heating: 'thermal',
    solar: 'electric_production',
  };
  // Mapping system_category -> usage du compteur (l'usage est porte par la
  // categorie, pas par l'energie). Couvre toutes les valeurs possibles.
  const CATEGORY_TO_USAGE = {
    heating: 'heating',
    cooling: 'cooling',
    ventilation: 'other',
    dhw: 'dhw',
    lighting_indoor: 'lighting',
    lighting_outdoor: 'lighting',
    electricity_production: 'pv',
  };
  // Mapping general (compteur energie primaire au niveau batiment) — libelles FR
  const ENERGY_TO_GENERAL = {
    gas: { meter_type: 'gas', notes: 'Compteur général gaz du bâtiment' },
    fuel_oil: { meter_type: 'other', notes: 'Compteur général fioul du bâtiment' },
    district_heating: { meter_type: 'thermal', notes: 'Compteur général thermique (réseau de chaleur)' },
  };
  // Labels FR pour les notes auto-generes
  const METER_TYPE_FR = {
    electric: 'électrique', electric_production: 'électrique de production',
    gas: 'gaz', water: 'eau', thermal: 'thermique', other: 'autre',
  };
  const USAGE_FR = {
    heating: 'chauffage', cooling: 'refroidissement', dhw: 'ECS',
    pv: 'production PV', lighting: 'éclairage', other: 'général',
  };

  const findExistingZonal = db.db.prepare(`
    SELECT 1 FROM bacs_audit_meters
    WHERE document_id = ? AND zone_id = ? AND usage = ? AND meter_type = ?
  `);
  const findExistingGeneral = db.db.prepare(`
    SELECT 1 FROM bacs_audit_meters
    WHERE document_id = ? AND zone_id IS NULL AND usage = ? AND meter_type = ?
  `);
  const insZonal = db.db.prepare(`
    INSERT INTO bacs_audit_meters
      (document_id, zone_id, usage, meter_type, required, present_actual, communicating, notes)
    VALUES (?, ?, ?, ?, 1, 0, 0, ?)
  `);
  const insGeneral = db.db.prepare(`
    INSERT INTO bacs_audit_meters
      (document_id, zone_id, usage, meter_type, required, present_actual, communicating, notes)
    VALUES (?, NULL, 'other', ?, 1, 0, 0, ?)
  `);

  // Recupere tous les devices avec leur zone parent
  const devices = db.db.prepare(`
    SELECT d.id, d.energy_source, s.zone_id, s.system_category, z.name AS zone_name
    FROM bacs_audit_system_devices d
    JOIN bacs_audit_systems s ON s.id = d.system_id
    LEFT JOIN zones z ON z.zone_id = s.zone_id
    WHERE s.document_id = ? AND d.energy_source IS NOT NULL
  `).all(documentId);

  // 1. Compteurs zonaux : 1 par (zone, meter_type, usage) selon les devices
  const zonalSeen = new Set();
  for (const d of devices) {
    const meterType = ENERGY_TO_METER_TYPE[d.energy_source];
    if (!meterType || !d.zone_id) continue;
    // L'usage est porte par la categorie du systeme parent du device
    const usage = CATEGORY_TO_USAGE[d.system_category] || 'other';
    const key = `${d.zone_id}:${usage}:${meterType}`;
    if (zonalSeen.has(key)) continue;
    zonalSeen.add(key);
    if (findExistingZonal.get(documentId, d.zone_id, usage, meterType)) continue;
    const typeFr = METER_TYPE_FR[meterType] || meterType;
    const usageFr = USAGE_FR[usage] || usage;
    insZonal.run(
      documentId, d.zone_id, usage, meterType,
      `Compteur ${typeFr} en zone « ${d.zone_name || '?'} » (${usageFr})`,
    );
    inserted++;
  }

  // 2. Compteurs generaux du batiment : 1 par energie primaire
  const generalEnergies = new Set(devices.map(d => d.energy_source));
  // Compteur general electrique : si AU MOINS 1 device electrique/PAC/solar
  // (ou si AU MOINS 1 device tout court pour respecter la regle "compteur
  // general electrique toujours obligatoire des qu'il y a un audit serieux")
  if (devices.length > 0 && !findExistingGeneral.get(documentId, 'other', 'electric')) {
    insGeneral.run(documentId, 'electric', 'Compteur général électrique du bâtiment');
    inserted++;
  }
  for (const energy of generalEnergies) {
    const map = ENERGY_TO_GENERAL[energy];
    if (!map) continue;
    if (findExistingGeneral.get(documentId, 'other', map.meter_type)) continue;
    insGeneral.run(documentId, map.meter_type, map.notes);
    inserted++;
  }

  return inserted;
}

/**
 * Wrapper public : resync les donnees d'un audit BACS avec les zones
 * actuelles du site rattache. Utilise par l'endpoint POST /bacs-audit/
 * :id/resync apres ajout d'une zone dans la UI.
 */
function resyncBacsAuditWithSiteZones(documentId) {
  const af = db.afs.getById(documentId);
  if (!af || af.kind !== 'bacs_audit' || !af.site_id) {
    throw new Error(`Document #${documentId} introuvable, pas un audit BACS, ou sans site rattache`);
  }
  const zones = db.zones.listBySite(af.site_id);
  return resyncBacsAuditDataForZones(documentId, zones);
}

module.exports = {
  seedLibraryOnBoot, seedSectionTemplatesOnBoot, backfillSectionTemplateLinks,
  backfillNewPlanSections, seedSystemCategoriesOnBoot, seedAfStructure,
  seedBacsRequirementsOnBoot, seedBacsMeterRequirementsOnBoot,
  seedBacsAuditStructure, resyncBacsAuditWithSiteZones,
};
