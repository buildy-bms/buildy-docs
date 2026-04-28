'use strict';

const path = require('path');
const fs = require('fs');
const { z } = require('zod');
const config = require('../config');
const db = require('../database');
const log = require('../lib/logger').system;
// Helpers Handlebars (gt, eq) sont enregistres au require de pdf.js.
const Handlebars = require('handlebars');
const { renderPdf, loadAssetDataUrl, loadFileAsDataUrl } = require('../lib/pdf');
const gitLib = require('../lib/git');

// Filigrane Buildy (favicon) applique sur tous les exports PDF
const WATERMARK_PATH = path.resolve(__dirname, '../../templates/pdf/assets/watermark-buildy.png');
const BUILDY_WATERMARK = { imagePath: WATERMARK_PATH, widthRatio: 0.85, heightRatio: 0.85, opacity: 0.03 };

async function commitExportSilently(afId, message, tag, user) {
  try {
    await gitLib.commitAf(afId, message, {
      tag,
      author: user ? { name: user.display_name || 'Buildy AF', email: user.email || 'noreply@buildy.fr' } : undefined,
    });
  } catch (err) {
    log.warn(`Git commit skipped after export AF #${afId} : ${err.message}`);
  }
}

// Compile une fois le partial _synthesis-table pour le re-rendre dans le body
// d'une section kind='synthesis'.
const synthesisTablePath = path.resolve(__dirname, '../../templates/pdf/_synthesis-table.hbs');
const renderSynthesisTable = Handlebars.compile(fs.readFileSync(synthesisTablePath, 'utf-8'));
const { resolveSectionPoints } = require('../lib/points-resolver');
const { resolveAfLevel, formatLevelFull } = require('../lib/service-level-resolver');
const { BACS_ARTICLES, BACS_INTRO_HTML } = require('../seeds/bacs-articles');

// Lignes du tableau de synthese (matrice categorie x dimensions BACS)
// Source : page Notion plan AF chapitre 12
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

const SERVICE_LEVEL_LABELS = {
  E: 'Essentials',
  S: 'Smart',
  P: 'Premium',
};

const exportSchema = z.object({
  motif: z.string().min(1, 'Motif requis'),
  includeBacsAnnex: z.boolean().optional(),
  excluded_section_ids: z.array(z.number()).optional(),
});

async function routes(fastify) {
  // GET /api/afs/:afId/exports — historique des exports
  fastify.get('/afs/:afId/exports', async (request) => {
    const afId = parseInt(request.params.afId, 10);
    return db.db.prepare(`
      SELECT e.*, u.display_name AS exported_by_name
      FROM exports e
      LEFT JOIN users u ON u.id = e.exported_by
      WHERE af_id = ?
      ORDER BY exported_at DESC
    `).all(afId);
  });

  // GET /api/exports/:id/download — download d'un export
  fastify.get('/exports/:id/download', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const exp = db.db.prepare('SELECT * FROM exports WHERE id = ?').get(id);
    if (!exp || !fs.existsSync(exp.file_path)) {
      return reply.code(404).send({ detail: 'Export non trouvé' });
    }
    const filename = path.basename(exp.file_path);
    return reply
      .type('application/pdf')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .send(fs.createReadStream(exp.file_path));
  });

  // POST /api/afs/:afId/exports/points-list — generer la liste de points PDF A3
  fastify.post('/afs/:afId/exports/points-list', async (request, reply) => {
    const afId = parseInt(request.params.afId, 10);
    const af = db.afs.getById(afId);
    if (!af || af.deleted_at) return reply.code(404).send({ detail: 'AF non trouvée' });

    let body;
    try { body = exportSchema.parse(request.body); }
    catch (err) { return reply.code(400).send({ detail: err.errors?.[0]?.message || 'Motif requis' }); }

    const userId = request.authUser?.id;
    const user = userId ? db.users.getById(userId) : null;
    const authorName = user?.display_name || user?.email || 'Inconnu';

    // ── Construit le payload pour le template ──
    const allSections = db.sections.listByAf(afId);
    const excludedSet = new Set(body.excluded_section_ids || []);

    // Categories = sections kind='equipment' (peuvent etre directement dans le ch.2,
    // ou dans une sous-section comme 2.1.1 Chaudieres). On regroupe par section
    // equipment unique et on charge ses instances + points.
    const equipmentSections = allSections.filter(s =>
      s.kind === 'equipment' && s.included_in_export && !excludedSet.has(s.id)
    );

    // (Lot 19) On produit aussi une liste à plat `rows` pour le tableau global
    // A3 paysage : une ligne par (instance × point), avec marquage isFirstOfInstance
    // pour les separateurs visuels et l'affichage des cellules « catégorie / repère / loc » uniquement sur la 1re ligne.
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
        bacsArticles: sec.bacs_articles,
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

    // Version Git-like (pour l'instant simple incrément basé sur l'historique)
    const previousCount = db.db.prepare(`
      SELECT COUNT(*) AS c FROM exports WHERE af_id = ? AND kind = 'pdf-points-list'
    `).get(afId).c;
    const version = `lp-v0.${previousCount + 1}`;

    const exportDate = new Date().toLocaleDateString('fr-FR', {
      day: '2-digit', month: 'long', year: 'numeric',
    });

    const data = {
      af,
      authorName,
      exportDate,
      version,
      motif: body.motif,
      serviceLevelLabel: SERVICE_LEVEL_LABELS[af.service_level] || af.service_level || '—',
      logoDataUrl: loadAssetDataUrl('logo-buildy.svg'),
      categories,
      rows, // (Lot 19) liste à plat pour le tableau global A3 paysage
      totals,
    };

    // ── Genere le PDF ──
    const exportsDir = path.resolve(config.exportsDir);
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${af.slug}-points-list-${version}-${ts}.pdf`;
    const outputPath = path.join(exportsDir, String(afId), filename);

    let result;
    try {
      result = await renderPdf({
        template: 'points-list',
        styles: 'styles-points',
        data,
        outputPath,
        pageFormat: 'A3',
        pageOrientation: 'landscape',
        watermark: BUILDY_WATERMARK,
      });
    } catch (err) {
      log.error(`PDF render failed: ${err.message}`);
      return reply.code(500).send({ detail: `Echec generation PDF : ${err.message}` });
    }

    // ── Insert dans exports + audit ──
    const insertedRow = db.db.prepare(`
      INSERT INTO exports (af_id, kind, file_path, sections_snapshot, options, motif,
                           git_tag, exported_by, file_size_bytes)
      VALUES (?, 'pdf-points-list', ?, ?, ?, ?, ?, ?, ?)
    `).run(
      afId,
      result.path,
      JSON.stringify(categories.map(c => ({ name: c.name, instances: c.instancesCount, points: c.pointsTotal }))),
      JSON.stringify({ version }),
      body.motif,
      version,
      userId || null,
      result.sizeBytes
    );

    db.auditLog.add({
      afId, userId, action: 'export.points-list',
      payload: { version, motif: body.motif, instances: totals.instances, points: totals.points },
    });
    log.info(`PDF points-list exported: AF #${afId} → ${filename} (${(result.sizeBytes/1024).toFixed(1)} KB) by user #${userId}`);
    await commitExportSilently(afId, `${version} : ${body.motif}`, version, request.authUser);

    return {
      id: insertedRow.lastInsertRowid,
      version,
      file_size_bytes: result.sizeBytes,
      download_url: `/api/exports/${insertedRow.lastInsertRowid}/download`,
      categories_count: categories.length,
      total_lines: totals.points,
    };
  });

  // ═══════════════════════════════════════════════════════════════════
  // POST /api/afs/:afId/exports/synthesis — tableau de synthese A3 paysage
  // ═══════════════════════════════════════════════════════════════════
  fastify.post('/afs/:afId/exports/synthesis', async (request, reply) => {
    const afId = parseInt(request.params.afId, 10);
    const af = db.afs.getById(afId);
    if (!af || af.deleted_at) return reply.code(404).send({ detail: 'AF non trouvée' });

    let body;
    try { body = exportSchema.parse(request.body); }
    catch (err) { return reply.code(400).send({ detail: err.errors?.[0]?.message || 'Motif requis' }); }

    const userId = request.authUser?.id;
    const user = userId ? db.users.getById(userId) : null;
    const authorName = user?.display_name || user?.email || 'Inconnu';

    // ── Construit les lignes : tous les equipements (kind='equipment') ──
    const synthExcluded = new Set(body.excluded_section_ids || []);
    const equipmentSections = db.sections.listByAf(afId).filter(s =>
      s.kind === 'equipment' && s.included_in_export && !synthExcluded.has(s.id)
    );

    const FUNCTION_KEYWORDS = {
      hasProgramming: ['program', 'horaire', 'consigne', 'commande'],
      hasDrift: ['compteur', 'consommation', 'kwh', 'm3', 'energie'],
      hasNotif: ['alarme', 'defaut', 'panne'],
      hasDashboard: ['energie', 'cvc', 'eclairage', 'qualite', 'comptage'],
    };

    function matchesAny(text, keywords) {
      const t = (text || '').toLowerCase();
      return keywords.some(k => t.includes(k));
    }

    const rows = equipmentSections.map((sec) => {
      const points = resolveSectionPoints(sec.id);
      const instances = db.equipmentInstances.listBySection(sec.id);
      const counts = { Mesure: 0, 'État': 0, Alarme: 0, Commande: 0, Consigne: 0 };
      let reads = 0, writes = 0;
      for (const p of points) {
        if (counts[p.data_type] !== undefined) counts[p.data_type]++;
        if (p.direction === 'read') reads++;
        else if (p.direction === 'write') writes++;
      }
      const sl = sec.service_level;
      const levelClass = sl ? sl.replace(/[^A-Z]/g, '') : '';
      const sectionText = `${sec.title} ${(points.map(p => p.label).join(' '))}`;
      return {
        name: sec.title,
        bacs: sec.bacs_articles,
        levelLabel: formatLevelFull(sl),
        levelClass,
        instances: instances.length,
        mesures: counts.Mesure,
        etats: counts['État'],
        alarmes: counts.Alarme,
        commandes: counts.Commande,
        consignes: counts.Consigne,
        readsTotal: reads,
        writesTotal: writes,
        hasProgramming: counts.Commande > 0 || counts.Consigne > 0,
        hasDrift: matchesAny(sectionText, FUNCTION_KEYWORDS.hasDrift),
        hasNotif: counts.Alarme > 0,
        hasDashboard: matchesAny(sectionText, FUNCTION_KEYWORDS.hasDashboard),
      };
    });

    const totals = rows.reduce((acc, r) => ({
      instances: acc.instances + r.instances,
      mesures: acc.mesures + r.mesures,
      etats: acc.etats + r.etats,
      alarmes: acc.alarmes + r.alarmes,
      commandes: acc.commandes + r.commandes,
      consignes: acc.consignes + r.consignes,
      reads: acc.reads + r.readsTotal,
      writes: acc.writes + r.writesTotal,
    }), { instances: 0, mesures: 0, etats: 0, alarmes: 0, commandes: 0, consignes: 0, reads: 0, writes: 0 });

    const previousCount = db.db.prepare(`
      SELECT COUNT(*) AS c FROM exports WHERE af_id = ? AND kind = 'pdf-synthesis'
    `).get(afId).c;
    const version = `synth-v0.${previousCount + 1}`;

    const exportDate = new Date().toLocaleDateString('fr-FR', {
      day: '2-digit', month: 'long', year: 'numeric',
    });

    const data = {
      af, authorName, exportDate, version,
      motif: body.motif,
      logoDataUrl: loadAssetDataUrl('logo-buildy.svg'),
      rows, totals,
    };

    const exportsDir = path.resolve(config.exportsDir);
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${af.slug}-synthesis-${version}-${ts}.pdf`;
    const outputPath = path.join(exportsDir, String(afId), filename);

    let result;
    try {
      result = await renderPdf({
        template: 'synthesis',
        styles: 'styles-synthesis',
        data,
        outputPath,
        pageFormat: 'A3',
        pdfOptions: { landscape: true },
        watermark: BUILDY_WATERMARK,
      });
    } catch (err) {
      log.error(`PDF synthesis render failed: ${err.message}`);
      return reply.code(500).send({ detail: `Echec generation : ${err.message}` });
    }

    // Insert en base — kind 'pdf-synthesis' n'existe pas dans la contrainte
    // CHECK actuelle, on stocke comme 'pdf-af' avec un tag dedie pour V1.
    const insertedRow = db.db.prepare(`
      INSERT INTO exports (af_id, kind, file_path, sections_snapshot, options, motif,
                           git_tag, exported_by, file_size_bytes)
      VALUES (?, 'pdf-af', ?, ?, ?, ?, ?, ?, ?)
    `).run(
      afId, result.path,
      JSON.stringify({ rows: rows.length, totals }),
      JSON.stringify({ version, format: 'A3-landscape-synthesis' }),
      body.motif, version, userId || null, result.sizeBytes
    );

    db.auditLog.add({
      afId, userId, action: 'export.synthesis',
      payload: { version, motif: body.motif, rows: rows.length },
    });
    log.info(`PDF synthesis exported: AF #${afId} → ${filename} (${(result.sizeBytes/1024).toFixed(1)} KB)`);
    await commitExportSilently(afId, `${version} : ${body.motif}`, version, request.authUser);

    return {
      id: insertedRow.lastInsertRowid,
      version,
      file_size_bytes: result.sizeBytes,
      download_url: `/api/exports/${insertedRow.lastInsertRowid}/download`,
      rows_count: rows.length,
      totals,
    };
  });

  // ═══════════════════════════════════════════════════════════════════
  // POST /api/afs/:afId/exports/af — generer le PDF de l'AF complete
  // ═══════════════════════════════════════════════════════════════════
  fastify.post('/afs/:afId/exports/af', async (request, reply) => {
    const afId = parseInt(request.params.afId, 10);
    const af = db.afs.getById(afId);
    if (!af || af.deleted_at) return reply.code(404).send({ detail: 'AF non trouvée' });

    let body;
    try { body = exportSchema.parse(request.body); }
    catch (err) { return reply.code(400).send({ detail: err.errors?.[0]?.message || 'Motif requis' }); }

    const userId = request.authUser?.id;
    const user = userId ? db.users.getById(userId) : null;
    const authorName = user?.display_name || user?.email || 'Inconnu';

    // ── Charge toutes les sections incluses + construit l'arbre ──
    const afExcludedSet = new Set(body.excluded_section_ids || []);
    const allSections = db.sections.listByAf(afId).filter(s =>
      s.included_in_export && !afExcludedSet.has(s.id)
    );

    // Charge attachments + equipment data pour chaque section
    const sectionData = new Map();
    for (const sec of allSections) {
      const attachments = db.attachments.listBySection(sec.id).map((a) => ({
        ...a,
        dataUrl: loadFileAsDataUrl(path.join(config.attachmentsDir, String(afId), a.filename)),
      })).filter((a) => a.dataUrl);

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
          // Justification BACS du template (priorité au texte de la section, sinon hérite du template)
          bacs_justification: tpl?.bacs_justification || null,
        };
      }

      sectionData.set(sec.id, { attachments, equipment, zones });
    }

    // Construit l'arbre hierarchique avec depth + numero recompose
    function buildTree(parentId, depth) {
      return allSections
        .filter(s => s.parent_id === parentId)
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
        .map((s) => {
          const data = sectionData.get(s.id);
          const sl = s.service_level;
          const badgeClass = sl ? sl.replace(/[^A-Z]/g, '') : '';
          // Pour kind='synthesis' (ch.12), on rend le partial _synthesis-table
          const synthesisHtml = s.kind === 'synthesis'
            ? renderSynthesisTable({ rows: SYNTHESIS_ROWS })
            : null;
          return {
            id: s.id,
            number: s.number || '',
            title: s.title,
            service_level: sl, // brut pour CSS class
            service_level_label: formatLevelFull(sl), // libelle complet
            badgeClass: badgeClass || 'ESP',
            bacs_articles: s.bacs_articles,
            bacs_articles_label: s.bacs_articles
              ? `${s.kind === 'equipment' ? 'Système concerné par le décret BACS' : 'Exigé par le décret BACS'} · ${s.bacs_articles}`
              : null,
            // Justification BACS : priorité au texte de la section, sinon hérite du template équipement
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

    // Sommaire plat (jusqu'a depth 3)
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

    // Calcul du niveau service requis (depuis sections incluses)
    const serviceLevel = resolveAfLevel(allSections);

    // Version
    const previousCount = db.db.prepare(`
      SELECT COUNT(*) AS c FROM exports WHERE af_id = ? AND kind = 'pdf-af'
    `).get(afId).c;
    const version = `af-v0.${previousCount + 1}`;

    const exportDate = new Date().toLocaleDateString('fr-FR', {
      day: '2-digit', month: 'long', year: 'numeric',
    });

    const data = {
      af,
      authorName,
      exportDate,
      version,
      motif: body.motif,
      contractualLevelLabel: SERVICE_LEVEL_LABELS[af.service_level] || af.service_level || '—',
      logoDataUrl: loadAssetDataUrl('logo-buildy.svg'),
      serviceLevel,
      tree,
      tocFlat,
      includeBacsAnnex: !!body.includeBacsAnnex,
      bacsArticles: body.includeBacsAnnex ? BACS_ARTICLES : null,
      bacsIntroHtml: body.includeBacsAnnex ? BACS_INTRO_HTML : null,
    };

    // Genere le PDF
    const exportsDir = path.resolve(config.exportsDir);
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${af.slug}-af-${version}-${ts}.pdf`;
    const outputPath = path.join(exportsDir, String(afId), filename);

    let result;
    try {
      const logoSmall = loadAssetDataUrl('logo-buildy.svg');
      result = await renderPdf({
        template: 'af',
        styles: 'styles-af',
        data,
        outputPath,
        populateToc: true,
        pageFormat: 'A4',
        skipFirstPageHeaderFooter: true,
        watermark: { ...BUILDY_WATERMARK, skipFirstPage: true },
        pdfOptions: {
          displayHeaderFooter: true,
          margin: { top: '22mm', bottom: '20mm', left: '18mm', right: '18mm' },
          headerTemplate: `<div style="font-family:'Helvetica',sans-serif; font-size:8pt; color:#9ca3af; padding:0 18mm; width:100%; display:flex; justify-content:space-between;">
            <span>${af.client_name} — ${af.project_name}</span>
            <span>Analyse Fonctionnelle ${version}</span>
          </div>`,
          footerTemplate: `<div style="font-family:'Helvetica',sans-serif; font-size:8pt; color:#9ca3af; padding:0 18mm; width:100%; display:flex; align-items:center; gap:6mm;">
            <img src="${logoSmall}" style="height:5mm; opacity:0.6;" />
            <span style="flex:1;">Analyse fonctionnelle Buildy · confidentiel</span>
            <span>Page <span class="pageNumber"></span> / <span class="totalPages"></span></span>
          </div>`,
        },
      });
    } catch (err) {
      log.error(`PDF AF render failed: ${err.message}`);
      return reply.code(500).send({ detail: `Echec generation PDF : ${err.message}` });
    }

    const insertedRow = db.db.prepare(`
      INSERT INTO exports (af_id, kind, file_path, sections_snapshot, options, motif,
                           git_tag, exported_by, file_size_bytes)
      VALUES (?, 'pdf-af', ?, ?, ?, ?, ?, ?, ?)
    `).run(
      afId, result.path,
      JSON.stringify({ sections_total: allSections.length, service_level: serviceLevel.level }),
      JSON.stringify({ version }),
      body.motif, version, userId || null, result.sizeBytes
    );

    db.auditLog.add({
      afId, userId, action: 'export.af',
      payload: { version, motif: body.motif, sections: allSections.length, service_level: serviceLevel.level },
    });
    log.info(`PDF AF exported: AF #${afId} → ${filename} (${(result.sizeBytes/1024).toFixed(1)} KB) by user #${userId}`);
    await commitExportSilently(afId, `${version} : ${body.motif}`, version, request.authUser);

    return {
      id: insertedRow.lastInsertRowid,
      version,
      file_size_bytes: result.sizeBytes,
      download_url: `/api/exports/${insertedRow.lastInsertRowid}/download`,
      sections_total: allSections.length,
      service_level: serviceLevel,
    };
  });
}

module.exports = routes;
