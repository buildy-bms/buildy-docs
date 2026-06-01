'use strict';

const db = require('../database');
const log = require('./logger').system;

const ALL_TEMPLATES = require('../seeds/equipment-templates');
const { buildSnapshot, snapshotAndBump } = require('./template-propagation');
const { parseRoles, serializeRoles } = require('./device-roles');
const regulationDefaults = require('./regulation-defaults');

// Mig 184 — résout la liste de régulation à utiliser pour un seed :
//   1. valeur explicite dans le seed (`tpl.regulation_*_types`)
//   2. sinon défaut par catégorie (`regulation-defaults.js`)
//   3. sinon null
// Renvoie un JSON string ou null (format colonne DB).
function resolveRegulationList(tpl, level) {
  const fromSeed = tpl[`regulation_${level}_types`];
  if (Array.isArray(fromSeed)) return fromSeed.length ? JSON.stringify(fromSeed) : null;
  const d = regulationDefaults.defaultsForLibraryCategory(tpl.category);
  const list = d[level];
  return list && list.length ? JSON.stringify(list) : null;
}
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

  // Tombstones : si l'utilisateur a explicitement supprime un equipement de
  // la bibliotheque via l'UI, on ne le recree pas au boot suivant. Symetrique
  // de deleted_section_template_slugs (cf. lib/seeder.js section_templates).
  const tombstonedSlugs = new Set(
    db.db.prepare('SELECT slug FROM deleted_equipment_template_slugs').all().map(r => r.slug)
  );

  for (const tpl of ALL_TEMPLATES) {
    if (tombstonedSlugs.has(tpl.slug)) continue;
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
        defaultEnergySource: tpl.default_energy_source,
        // Multi-rôle (mig 117) : serialize en JSON array string. Le seed
        // peut declarer un array (recommandé) ou un scalaire legacy.
        defaultDeviceRole: serializeRoles(parseRoles(tpl.default_device_role)),
        // Mig 184 — listes de régulation : valeur du seed > défaut de catégorie.
        regulationProductionTypes:   resolveRegulationList(tpl, 'production'),
        regulationDistributionTypes: resolveRegulationList(tpl, 'distribution'),
        regulationEmissionTypes:     resolveRegulationList(tpl, 'emission'),
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
      // Enrichissement non destructif : ne touche pas si l'admin a déjà saisi
      // une valeur (idempotent même après edit manuel — cf. memoire seeder).
      if (!existing.default_energy_source && tpl.default_energy_source) updates.defaultEnergySource = tpl.default_energy_source;
      if (!existing.default_device_role && tpl.default_device_role) {
        updates.defaultDeviceRole = serializeRoles(parseRoles(tpl.default_device_role));
      }
      // Mig 184 — pré-remplit les listes de régulation si la colonne est NULL
      // en DB ET qu'on a une valeur (seed ou défaut de catégorie). Respect du
      // contrat seeder : on n'écrase JAMAIS une liste déjà saisie côté admin.
      if (!existing.regulation_production_types) {
        const resolved = resolveRegulationList(tpl, 'production');
        if (resolved) updates.regulationProductionTypes = resolved;
      }
      if (!existing.regulation_distribution_types) {
        const resolved = resolveRegulationList(tpl, 'distribution');
        if (resolved) updates.regulationDistributionTypes = resolved;
      }
      if (!existing.regulation_emission_types) {
        const resolved = resolveRegulationList(tpl, 'emission');
        if (resolved) updates.regulationEmissionTypes = resolved;
      }
      let changed = Object.keys(updates).length > 0;
      if (changed) db.equipmentTemplates.update(existing.id, { ...updates, updatedBy: null });

      // Points : on n'ajoute QUE ceux dont le slug n'existe pas déjà
      // ET dont le slug n'a pas été tombstone par l'utilisateur (mig 136).
      // Sinon : un point supprime depuis l'UI revenait au prochain
      // boot/restart, ce qui annulait silencieusement l'action user
      // (bug isole 2026-05-11).
      const existingPoints = db.equipmentTemplatePoints.listByTemplate(existing.id);
      const existingBySlug = new Map(existingPoints.map(p => [p.slug, p]));
      const tombstonedPointSlugs = new Set(
        db.db.prepare(
          'SELECT slug FROM deleted_equipment_template_point_slugs WHERE template_id = ?'
        ).all(existing.id).map(r => r.slug)
      );
      for (const p of (tpl.points || [])) {
        if (tombstonedPointSlugs.has(p.slug)) continue; // user a supprime, on respecte
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
      // Lot — Migration 78 : tagging document_kinds depuis le node du seed
      // (defaut ['af'] si non specifie). Pas de cascade ici : chaque enfant
      // se taggue lui-meme via son propre document_kinds.
      const docKinds = Array.isArray(node.document_kinds) && node.document_kinds.length
        ? node.document_kinds
        : ['af'];
      db.sectionTemplates.setDocumentKinds(id, docKinds, { cascade: false });
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
  // Lot — Migration 78 : filtre sur document_kinds contient 'af'. Les sections
  // marquees brochure-only ou bacs_audit-only ne sont PAS instanciees dans
  // l'AF (ex: ch.14.4 Buildy Box reserve a la brochure commerciale).
  // Lot — Bibliotheque source de verite : on saute les section_templates
  // kind='equipment' dont le equipment_template_id est null (l'equipement a
  // ete supprime de la biblio). Cela evite les sections fantomes type
  // « Systemes DRV » sans pendant biblio. Apres l'insert canonique du plan,
  // on enrichit en ajoutant TOUS les equipments de la biblio dont la
  // categorie est deja representee dans une section parent (cf libraryExtendAf).
  const allTemplates = db.sectionTemplates.list({}).filter(t =>
    Array.isArray(t.document_kinds) && t.document_kinds.includes('af')
    && !(t.kind === 'equipment' && !t.equipment_template_id)
  );
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
    let equipmentTemplateName = null;
    if (tpl.kind === 'equipment' && tpl.equipment_template_id) {
      const eq = db.equipmentTemplates.getById(tpl.equipment_template_id);
      if (eq) {
        equipmentTemplateId = eq.id;
        equipmentTemplateVersion = eq.current_version;
        equipmentTemplateBacs = eq.bacs_articles;
        equipmentTemplateName = eq.name;
      }
    }

    const section = db.sections.create({
      afId,
      parentId: parentSectionId,
      position: total * 10,
      number: computedNumber,
      // Pour les sections kind='equipment' rattachees a un template biblio,
      // le titre suit le nom du template (source de verite). Le titre fige
      // dans section_templates.title etait celui du seed plan-af initial,
      // qui peut differer du nom actuel si l'utilisateur a renomme depuis.
      title: equipmentTemplateName || tpl.title,
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

  // Extension biblio : ajoute les equipments du catalogue dont la categorie
  // est deja representee dans un parent du plan (categorie deduite des enfants
  // equipment deja inseres). Evite que la biblio soit "muette" quand un site
  // a des equipements specifiques (ex : unite-interieure-drv en plus / a la
  // place de l'ancien drv) qui ne sont pas codes en dur dans plan-af.
  const extendAdded = libraryExtendAf(afId);

  log.info(`Seed AF #${afId} : ${total} sections du plan + ${extendAdded} sections biblio (categorie deduite)`);
  return total + extendAdded;
}

/**
 * Pour une AF qui vient d'etre seedee : pour chaque section parent dont les
 * enfants equipment couvrent une ou plusieurs categories systeme, ajoute en
 * fratrie tous les equipment_templates de la biblio appartenant a ces
 * categories qui ne sont pas encore representes. Idempotent dans le sens ou
 * un eq_template deja present (par equipment_template_id) n'est jamais
 * duplique. Numerotation continue (suit la derniere fratrie inseree).
 */
function libraryExtendAf(afId) {
  // Refactor categories : la categorie systeme est le parent direct des
  // equipements. Cette fonction :
  //   1) Trouve le chapitre 2 ("Perimetre des equipements supervises") de l'AF.
  //   2) Cree (idempotent) les noeuds categorie sous chap 2 depuis system_categories_db.
  //   3) Pour chaque equipment_template de la biblio : si pas deja present dans
  //      l'AF, l'instancie sous le noeud categorie correspondant (via
  //      equipment_templates.category).
  // Plus de double indirection via section_templates.library_categories. Plus
  // de doublons possibles structurellement (cat node = unique par AF).
  const allLib = db.equipmentTemplates.list();
  if (!allLib.length) return 0;

  // Trouver chap 2
  const chap2 = db.db.prepare(`
    SELECT s.id FROM sections s
    LEFT JOIN section_templates t ON t.id = s.section_template_id
    WHERE s.af_id = ? AND s.parent_id IS NULL AND (
      t.slug = '2' OR s.title LIKE 'Périmètre des équipements%'
    )
    LIMIT 1
  `).get(afId);
  if (!chap2) return 0;

  // Etat actuel : cat nodes existants + tous les equipment_template_id presents
  const existingCatNodes = db.db.prepare(`
    SELECT id, system_category_key FROM sections
    WHERE af_id = ? AND parent_id = ? AND system_category_key IS NOT NULL
  `).all(afId, chap2.id);
  const catNodeByKey = new Map(existingCatNodes.map(r => [r.system_category_key, r.id]));
  const globallyExistingTplIds = new Set(
    db.db.prepare('SELECT equipment_template_id FROM sections WHERE af_id = ? AND equipment_template_id IS NOT NULL').all(afId).map(r => r.equipment_template_id)
  );

  let added = 0;

  // 1) Cree les cat nodes manquants
  const cats = db.systemCategoriesDb.list();
  let basePosCat = (db.db.prepare(
    'SELECT COALESCE(MAX(position), 0) AS m FROM sections WHERE af_id = ? AND parent_id = ?'
  ).get(afId, chap2.id)).m;
  const insertCat = db.db.prepare(`
    INSERT INTO sections (af_id, parent_id, position, number, title, kind, system_category_key, included_in_export)
    VALUES (?, ?, ?, NULL, ?, 'standard', ?, 1)
  `);
  for (const c of cats) {
    if (catNodeByKey.has(c.key)) continue;
    basePosCat += 10;
    const r = insertCat.run(afId, chap2.id, basePosCat, c.label, c.key);
    catNodeByKey.set(c.key, r.lastInsertRowid);
  }

  // 2) Materialise les equipments manquants sous leur cat node
  for (const lib of allLib) {
    if (!lib.category) continue;
    const catNodeId = catNodeByKey.get(lib.category);
    if (!catNodeId) continue; // categorie inexistante en biblio (orpheline) — skip
    if (globallyExistingTplIds.has(lib.id)) continue;
    const maxP = (db.db.prepare(
      'SELECT COALESCE(MAX(position), 0) AS m FROM sections WHERE af_id = ? AND parent_id = ?'
    ).get(afId, catNodeId)).m;
    db.sections.create({
      afId, parentId: catNodeId, position: maxP + 10, number: null,
      title: lib.name, kind: 'equipment',
      equipmentTemplateId: lib.id, equipmentTemplateVersion: lib.current_version,
      bacsArticles: null, bodyHtml: null, genericNote: 0,
    });
    globallyExistingTplIds.add(lib.id);
    added++;
  }
  return added;
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

  // Uniquement les vraies AF : le plan AF n'a pas de sens pour les audits
  // BACS (tables bacs_audit_*), brochures (brochure_items) ni livres blancs
  // (chapitres libres). Sans ce filtre, ces documents recevaient les ~54
  // sections du plan AF a chaque boot.
  const allAfs = db.db.prepare("SELECT id FROM afs WHERE deleted_at IS NULL AND kind = 'af'").all();
  let totalInserted = 0;

  for (const af of allAfs) {
    // Dedup par section_template_id (stable) au lieu de number (instable :
    // a chaque renumerotation du PLAN_AF, des chapitres existants se voyaient
    // re-inseres car leur nouveau number ne matchait plus l'ancien). Bug
    // isole 2026-05-04 : AF #25 avait 13 sections en doublon car le plan a
    // renomme "Maintenance et exploitation" de ch.6 a ch.10, idem ch.8/12,
    // ch.9/13, etc. — backfill recreait tous ces chapitres a chaque boot.
    const existingTemplateIds = new Set(
      db.db.prepare('SELECT section_template_id FROM sections WHERE af_id = ? AND section_template_id IS NOT NULL').all(af.id).map(r => r.section_template_id)
    );
    // Fallback par title (pour les sections orphelines sans section_template_id).
    const existingTitles = new Set(
      db.db.prepare('SELECT title FROM sections WHERE af_id = ?').all(af.id).map(r => r.title)
    );

    for (const { number, parent_number, position, node } of planNodes) {
      if (!node.number) continue; // skip 'zones' top-level (deja gere)

      // Lookup section_template d'abord (sert au dedup)
      const slug = sectionTemplateSlug(node);
      const tpl = slug ? db.sectionTemplates.getBySlug(slug) : null;

      // Pas de template → on ne backfill PAS la section. Sinon on créerait
      // une section "fantôme" sans pendant biblio (impossible à retrouver
      // depuis l'UI bibliothèque). Les templates manquants viennent en
      // général d'une suppression utilisateur (tombstone) — il a fait un
      // choix conscient de ne pas avoir cette section.
      if (!tpl) continue;

      // Lot — Migration 78 : filtre sur document_kinds contient 'af'. Les
      // sections marquees brochure-only ou bacs_audit-only ne sont pas
      // backfilees dans les AFs (ex: ch.14.4 Buildy Box).
      if (Array.isArray(tpl.document_kinds) && !tpl.document_kinds.includes('af')) continue;

      // Dedup principal : section_template_id deja present pour cette AF
      if (existingTemplateIds.has(tpl.id)) continue;
      // Dedup secondaire : fallback par title (couvre les sections heritees
      // sans link vers un template, ex: AFs creees avant Lot 33).
      if (existingTitles.has(node.title)) continue;

      // Trouve le parent dans cette AF (par number)
      let parentId = null;
      if (parent_number) {
        const parent = db.db.prepare('SELECT id FROM sections WHERE af_id = ? AND number = ?').get(af.id, parent_number);
        if (!parent) continue; // parent absent → skip (cas theorique)
        parentId = parent.id;
      }
      const serviceLevel = node.features
        ? formatServiceLevel(node.features)
        : (node.service_level || null);
      const serviceLevelSource = node.features ? 'pdf-offres-2026' : (node.service_level ? 'manual' : null);
      const bodyHtml = tpl.body_html || (node.body_placeholder
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
        bacsArticles: tpl.bacs_articles || node.bacs_articles || null,
        bodyHtml,
        kind: node.kind,
        genericNote: node.generic_note || 0,
      });
      db.db.prepare('UPDATE sections SET section_template_id = ?, section_template_version = ? WHERE id = ?')
        .run(tpl.id, tpl.current_version, created.id);
      existingTemplateIds.add(tpl.id);
      existingTitles.add(node.title);
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
    chauffage:       { icon: 'fa-fire',             color: '#dc2626' },
    climatisation:   { icon: 'fa-snowflake',        color: '#0ea5e9' },
    thermique_mixte: { icon: 'fa-temperature-half', color: '#a855f7' },
    ventilation:     { icon: 'fa-fan',              color: '#3b82f6' },
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
  // Tombstones (mig 137) : si l'utilisateur a explicitement supprime une
  // categorie via l'UI biblio, on ne la recree pas au boot suivant.
  const tombstonedKeys = new Set(
    db.db.prepare('SELECT key FROM deleted_system_category_keys').all().map(r => r.key)
  );
  let created = 0;
  for (let i = 0; i < SYSTEM_CATEGORIES.length; i++) {
    const c = SYSTEM_CATEGORIES[i];
    if (tombstonedKeys.has(c.key)) continue;
    if (db.systemCategoriesDb.getByKey(c.key)) continue;
    const icon = ICONS[c.key] || { icon: 'fa-cube', color: '#6b7280' };
    // Mig 121 : `slugs` n'existe plus en colonne. Le rattachement
    // template <-> categorie est porte par equipment_templates.category
    // (seede separement par les fichiers seeds/equipment-templates/*.js).
    db.systemCategoriesDb.create({
      key: c.key, label: c.label, bacs: c.bacs,
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
  // Seules les zones « fonctionnelles » alimentent l'auto-creation des
  // systemes / regulations / compteurs. Les zones « techniques » (local
  // technique, TGBT, local compteurs…) sont hors perimetre BACS : elles
  // sont inventoriees dans leur propre card mais ne generent rien ici.
  const functionalZones = zones.filter(z => (z.kind || 'functional') !== 'technical');

  const reqByNature = {};
  for (const r of db.db.prepare('SELECT zone_nature, required_categories FROM bacs_requirements_by_zone_nature').all()) {
    try { reqByNature[r.zone_nature] = JSON.parse(r.required_categories); }
    catch { reqByNature[r.zone_nature] = []; }
  }

  // Mig 182 (2026-05-27) : la contrainte UNIQUE(document_id, zone_id,
  // system_category) a été retirée pour permettre N systèmes par
  // catégorie dans une même zone. Côté resync, on ne peut donc plus
  // s'appuyer sur INSERT OR IGNORE — il faut vérifier explicitement
  // l'existence pour rester idempotent. Sans ce check, chaque resync
  // dupliquait l'ensemble du jeu de systèmes (incident 2026-05-27).
  const systemExists = db.db.prepare(
    'SELECT 1 FROM bacs_audit_systems WHERE document_id = ? AND zone_id = ? AND system_category = ? LIMIT 1'
  );
  const insertSystem = db.db.prepare(`
    INSERT INTO bacs_audit_systems (document_id, zone_id, system_category, present)
    VALUES (?, ?, ?, 0)
  `);
  let systemsCount = 0;
  for (const z of functionalZones) {
    const cats = z.nature ? (reqByNature[z.nature] || []) : [];
    for (const cat of cats) {
      if (systemExists.get(documentId, z.zone_id, cat)) continue;
      insertSystem.run(documentId, z.zone_id, cat);
      systemsCount++;
    }
  }

  // Thermal regulation : 1 ligne par (zone, categorie) pour chaque
  // categorie thermique (heating ou cooling) qui s'applique a la zone.
  // S'applique = soit la nature de zone l'implique (matrice
  // requirements_by_zone_nature), soit un systeme de cette categorie est
  // marque present sur cette zone (cas ou l'auditeur a force la presence
  // d'un chauffage sur une zone qui ne le requiert pas).
  const presentSystems = db.db.prepare(`
    SELECT DISTINCT zone_id, system_category FROM bacs_audit_systems
    WHERE document_id = ? AND present = 1
      AND system_category IN ('heating', 'cooling')
  `).all(documentId);
  const presentByZone = new Map();
  for (const s of presentSystems) {
    if (!presentByZone.has(s.zone_id)) presentByZone.set(s.zone_id, new Set());
    presentByZone.get(s.zone_id).add(s.system_category);
  }
  // Depuis la migration 170, la contrainte UNIQUE(document_id, zone_id,
  // category) a été retirée (une zone peut avoir plusieurs systèmes de
  // chauffage/refroidissement). Le resync ne peut donc plus s'appuyer sur
  // INSERT OR IGNORE pour rester idempotent : on vérifie explicitement
  // l'existence d'au moins une entrée pour (zone, catégorie) et on ne crée
  // que l'entrée de base manquante — les entrées ajoutées manuellement par
  // l'auditeur ne sont jamais dupliquées.
  const thermalExists = db.db.prepare(`
    SELECT 1 FROM bacs_audit_thermal_regulation
    WHERE document_id = ? AND zone_id = ? AND category = ? LIMIT 1
  `);
  const insertThermal = db.db.prepare(`
    INSERT INTO bacs_audit_thermal_regulation
      (document_id, zone_id, category, has_automatic_regulation)
    VALUES (?, ?, ?, 0)
  `);
  let thermalCount = 0;
  for (const z of functionalZones) {
    const fromNature = z.nature ? (reqByNature[z.nature] || []) : [];
    const fromSystems = presentByZone.get(z.zone_id) || new Set();
    for (const cat of ['heating', 'cooling']) {
      if (!fromNature.includes(cat) && !fromSystems.has(cat)) continue;
      if (thermalExists.get(documentId, z.zone_id, cat)) continue;
      insertThermal.run(documentId, z.zone_id, cat);
      thermalCount++;
    }
  }

  // Ligne 1-1 vide dans bacs_audit_bms (sera editee dans le formulaire GTB)
  db.db.prepare(`
    INSERT OR IGNORE INTO bacs_audit_bms (document_id) VALUES (?)
  `).run(documentId);

  // Compteurs auto (R175-3 §1) — zones fonctionnelles uniquement
  const metersCount = resyncBacsAuditMetersForZones(documentId, functionalZones);

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
  // Note : 'other' n'est PAS un meter_type valide (CHECK bacs_audit_meters
  // = electric/electric_production/gas/water/thermal). Les énergies sans
  // compteur dédié (bois, biomasse, fioul) se sous-comptent via un compteur
  // d'énergie thermique sur le circuit.
  const ENERGY_TO_METER_TYPE = {
    gas: 'gas',
    electric: 'electric',
    heat_pump: 'electric',
    wood: 'thermal',
    biomass: 'thermal',
    fuel_oil: 'thermal',
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
    fuel_oil: { meter_type: 'thermal', notes: 'Compteur général fioul du bâtiment' },
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

  // Recupere tous les devices avec leur zone parent. is_bacs = 1 : les
  // usages manuels hors decret ne generent PAS de compteur reglementaire.
  // device_role est ajoute pour pouvoir filtrer les devices non producteurs
  // sur les usages thermiques (cf. plus bas).
  const devices = db.db.prepare(`
    SELECT d.id, d.energy_source, d.device_role, s.zone_id, s.system_category, z.name AS zone_name
    FROM bacs_audit_system_devices d
    JOIN bacs_audit_systems s ON s.id = d.system_id
    LEFT JOIN zones z ON z.id = s.zone_id
    WHERE s.document_id = ? AND s.is_bacs = 1 AND d.energy_source IS NOT NULL
  `).all(documentId);

  // Pour les usages thermiques (chauffage / refroidissement / ECS), seul
  // l'equipement de PRODUCTION (chaudiere, PAC, sous-station…) consomme
  // l'energie primaire. Les emetteurs (radiateurs, ventilo-convecteurs) et
  // la distribution sont passifs — la chaleur leur arrive par le circuit
  // de production. Compter l'energy_source d'un radiateur cree un compteur
  // doublon faux. Pour les autres usages (eclairage, ventilation, PV),
  // tous les devices sont actifs : pas de filtre.
  const REQUIRES_PRODUCTION_ROLE = new Set(['heating', 'cooling', 'dhw']);
  function rolesOf(d) {
    const raw = d.device_role;
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
        if (typeof parsed === 'string' && parsed) return [parsed];
      } catch { /* not JSON */ }
      return raw.split(',').map(s => s.trim()).filter(Boolean);
    }
    return [];
  }
  function isMeterEligible(d) {
    if (!REQUIRES_PRODUCTION_ROLE.has(d.system_category)) return true;
    const roles = rolesOf(d);
    // Tolerance : si l'auditeur n'a pas qualifie le role, on garde le
    // device (pas de regression sur les saisies historiques). Si un role
    // est present, il doit inclure 'production' ou 'generator'.
    if (!roles.length) return true;
    return roles.some(r => /production|generator/i.test(r));
  }

  // Ensemble canonique des compteurs reellement requis. Sert ensuite a
  // remettre `required=0` sur les compteurs devenus orphelins (energie
  // changee/supprimee) sans les supprimer (tracabilite + saisies terrain).
  const targetKeys = new Set();
  const keyZonal = (zoneId, usage, type) => `z${zoneId}:${usage}:${type}`;
  const keyGeneral = (usage, type) => `g:${usage}:${type}`;

  // Devices retenus pour generer des compteurs (cf. isMeterEligible).
  const eligibleDevices = devices.filter(isMeterEligible);

  // 1. Compteurs zonaux : 1 par (zone, meter_type, usage) selon les devices
  const zonalSeen = new Set();
  for (const d of eligibleDevices) {
    const meterType = ENERGY_TO_METER_TYPE[d.energy_source];
    if (!meterType || !d.zone_id) continue;
    // L'usage est porte par la categorie du systeme parent du device
    const usage = CATEGORY_TO_USAGE[d.system_category] || 'other';
    const key = `${d.zone_id}:${usage}:${meterType}`;
    targetKeys.add(keyZonal(d.zone_id, usage, meterType));
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
  const generalEnergies = new Set(eligibleDevices.map(d => d.energy_source));
  // Compteur general electrique : si AU MOINS 1 device electrique/PAC/solar
  // (ou si AU MOINS 1 device tout court pour respecter la regle "compteur
  // general electrique toujours obligatoire des qu'il y a un audit serieux")
  if (devices.length > 0) {
    targetKeys.add(keyGeneral('other', 'electric'));
    if (!findExistingGeneral.get(documentId, 'other', 'electric')) {
      insGeneral.run(documentId, 'electric', 'Compteur général électrique du bâtiment');
      inserted++;
    }
  }
  for (const energy of generalEnergies) {
    const map = ENERGY_TO_GENERAL[energy];
    if (!map) continue;
    targetKeys.add(keyGeneral('other', map.meter_type));
    if (findExistingGeneral.get(documentId, 'other', map.meter_type)) continue;
    insGeneral.run(documentId, map.meter_type, map.notes);
    inserted++;
  }

  // 3. Synchronise le flag `required` : un compteur encore dans la cible
  //    reste requis ; un compteur orphelin (energie changee/supprimee, usage
  //    hors BACS) repasse a required=0 — sans suppression (tracabilite +
  //    saisies present_actual/photos conservees). Evite les actions
  //    bloquantes fantomes sur des compteurs qui n'ont plus lieu d'etre.
  const allMeters = db.db.prepare(
    'SELECT id, zone_id, usage, meter_type, required FROM bacs_audit_meters WHERE document_id = ?'
  ).all(documentId);
  const setRequired = db.db.prepare('UPDATE bacs_audit_meters SET required = ? WHERE id = ?');
  for (const m of allMeters) {
    const k = m.zone_id != null
      ? keyZonal(m.zone_id, m.usage, m.meter_type)
      : keyGeneral(m.usage, m.meter_type);
    const wanted = targetKeys.has(k) ? 1 : 0;
    if ((m.required ? 1 : 0) !== wanted) setRequired.run(wanted, m.id);
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
  libraryExtendAf,
  seedBacsRequirementsOnBoot, seedBacsMeterRequirementsOnBoot,
  seedBacsAuditStructure, resyncBacsAuditWithSiteZones,
  seedIso52120OnBoot,
};

// ── ISO 52120-1 : fonctions BAC obligatoires (47 lignes) ───────────────
// Idempotent : on (re-)ingere a chaque boot pour garantir que le CSV est
// la source de verite. Aucun cout perceptible (47 INSERT dans une
// transaction).
function seedIso52120OnBoot() {
  const fs = require('fs');
  const path = require('path');
  const csvPath = path.resolve(__dirname, '../../scripts/iso-52120/functions.csv');
  if (!fs.existsSync(csvPath)) {
    log.warn('Seed ISO 52120-1 skip : CSV introuvable a ' + csvPath);
    return;
  }
  // Retire BOM UTF-8 eventuel + verifie l'en-tete attendu.
  const raw = fs.readFileSync(csvPath, 'utf8').replace(/^﻿/, '');
  const rows = parseCsvSemicolon(raw);
  const header = rows.shift();
  if (!header || !/^R.f.rence$/i.test((header[0] || '').trim())) {
    log.warn('Seed ISO 52120-1 skip : en-tete CSV inattendu (' + JSON.stringify(header?.[0]) + ')');
    return;
  }
  const bool = (v) => (v || '').trim().toUpperCase() === 'OUI' ? 1 : 0;
  const entries = rows.map((r, i) => ({
    code: (r[0] || '').trim(),
    domain: (r[1] || '').trim(),
    sub_function: (r[2] || '').trim() || null,
    title: (r[3] || '').trim(),
    description: (r[4] || '').trim() || null,
    class_c: bool(r[5]),
    class_b: bool(r[6]),
    class_a: bool(r[7]),
    position: i + 1,
  })).filter(e => e.code);

  if (!entries.length) {
    log.warn('Seed ISO 52120-1 skip : 0 ligne extraite');
    return;
  }

  const derivR175 = (domain) => {
    if (/chauffage|refroidissement|ventilation|climatisation/i.test(domain)) return 'R175-3,R175-6';
    if (/eau chaude/i.test(domain)) return 'R175-3';
    if (/éclairage|eclairage/i.test(domain)) return 'R175-3';
    if (/gestion technique/i.test(domain)) return 'R175-3,R175-4';
    return 'R175-3';
  };

  const tx = db.db.transaction(() => {
    db.db.prepare('DELETE FROM bacs_iso52120_functions').run();
    const insFn = db.db.prepare(`
      INSERT INTO bacs_iso52120_functions
        (code, domain, sub_function, title, description, class_c, class_b, class_a, position)
      VALUES (@code, @domain, @sub_function, @title, @description, @class_c, @class_b, @class_a, @position)
    `);
    for (const e of entries) insFn.run(e);

    db.db.prepare("DELETE FROM bacs_knowledge WHERE source = 'iso_52120'").run();
    const insK = db.db.prepare(`
      INSERT INTO bacs_knowledge
        (source, authority, kind, code, title, body_text, r175_refs, version_label, position, fetched_at)
      VALUES ('iso_52120', 'normative', 'iso_function', @code, @title, @body_text, @r175_refs, @version_label, @position, CURRENT_TIMESTAMP)
    `);
    for (const e of entries) {
      const classes = [];
      if (e.class_c) classes.push('Classe C (standard / minimum BACS)');
      if (e.class_b) classes.push('Classe B (advanced)');
      if (e.class_a) classes.push('Classe A (high performance)');
      const body = [
        `Domaine : ${e.domain}`,
        e.sub_function ? `Sous-fonction : ${e.sub_function}` : null,
        `Intitulé : ${e.title}`,
        e.description ? `Description (Tableau 5) : ${e.description}` : null,
        classes.length ? `Niveau requis : ${classes.join(' · ')}` : 'Niveau requis : (non obligatoire)',
      ].filter(Boolean).join('\n');
      insK.run({
        code: `ISO-${e.code}`,
        title: `Fonction ${e.code} — ${e.title}`,
        body_text: body,
        r175_refs: derivR175(e.domain),
        version_label: 'NF EN ISO 52120-1 — Tableau 5 (fonctions BAC obligatoires)',
        position: e.position,
      });
    }
  });
  tx();
  log.info(`Seed ISO 52120-1 : ${entries.length} fonctions (table + bacs_knowledge)`);
}

// CSV parser minimal (delimiter `;`, cellules entre guillemets supportees).
function parseCsvSemicolon(text) {
  const rows = [];
  let row = []; let cell = ''; let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else { inQ = false; } }
      else cell += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ';') { row.push(cell); cell = ''; }
      else if (c === '\n') { row.push(cell); if (row.some(v => v.trim() !== '')) rows.push(row); row = []; cell = ''; }
      else if (c === '\r') { /* skip */ }
      else cell += c;
    }
  }
  if (cell || row.length) { row.push(cell); if (row.some(v => v.trim() !== '')) rows.push(row); }
  return rows;
}
