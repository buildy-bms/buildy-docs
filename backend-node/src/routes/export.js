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
        watermark: { ...BUILDY_WATERMARK, skipFirstPage: true },
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
  // POST /api/afs/:afId/exports/synthesis — synthese 3 pages
  //   1. Bilan projet (KPIs + niveau requis vs contracte + ecartes MOA)
  //   2. Conformite BACS (4 exigences R175-3 → couverture par sections AF)
  //   3. Matrice systemes (1 ligne par equipement supervise ou ecarte)
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

    // ── Charge toutes les sections de l'AF ──
    const synthExcluded = new Set(body.excluded_section_ids || []);
    const allSections = db.sections.listByAf(afId);

    function isSectionLive(s) {
      // Une section est consideree "active" pour le calcul si elle est incluse
      // dans l'export, non ecartee MOA, et non explicitement exclue de la synthese.
      return s.included_in_export && !s.opted_out_by_moa && !synthExcluded.has(s.id);
    }
    const liveSections = allSections.filter(isSectionLive);
    function findByNumber(num) { return allSections.find(s => s.number === num) || null; }
    function isLiveByNumber(num) { const s = findByNumber(num); return s ? isSectionLive(s) : false; }

    // ── PAGE 1 : KPIs & verdict niveau ──
    const equipmentSections = allSections.filter(s => s.kind === 'equipment');
    const equipmentLive = equipmentSections.filter(isSectionLive);
    const equipmentOptedOut = equipmentSections.filter(s => s.opted_out_by_moa === 1);

    let instancesTotal = 0;
    let pointsTotal = 0;
    const equipmentEnriched = equipmentSections.map(sec => {
      const points = resolveSectionPoints(sec.id);
      const instances = db.equipmentInstances.listBySection(sec.id).reduce((a, i) => a + (i.qty || 1), 0);
      if (isSectionLive(sec)) { instancesTotal += instances; pointsTotal += points.length * instances; }
      const reads = points.filter(p => p.direction === 'read').length;
      const writes = points.filter(p => p.direction === 'write').length;
      const alarms = points.filter(p => p.data_type === 'Alarme').length;
      const commands = points.filter(p => p.data_type === 'Commande').length;
      const consignes = points.filter(p => p.data_type === 'Consigne').length;
      return { sec, points, instances, reads, writes, alarms, commands, consignes };
    });

    // Detection comptage (utilise par P2 BACS et P4 matrice)
    const COMPTEUR_SLUGS_SET = new Set(['compteur-electrique', 'compteur-gaz', 'compteur-eau', 'compteur-calories']);
    function isMeteringSystem(sec) {
      if (!sec.equipment_template_id) return false;
      const tpl = db.equipmentTemplates.getById(sec.equipment_template_id);
      return tpl ? COMPTEUR_SLUGS_SET.has(tpl.slug) : false;
    }

    const { resolveAfLevel } = require('../lib/service-level-resolver');
    const required = resolveAfLevel(liveSections);
    const RANK = { E: 0, S: 1, P: 2 };
    const LEVEL_LABELS = { E: 'Essentials', S: 'Smart', P: 'Premium' };

    const contractLevel = af.service_level || null;
    const requiredLevel = required.level || null;
    let levelVerdict;
    if (!requiredLevel) {
      levelVerdict = { kind: 'none', text: 'Aucun calcul possible.' };
    } else if (!contractLevel) {
      levelVerdict = { kind: 'no-contract', text: `Niveau de contrat requis : ${LEVEL_LABELS[requiredLevel]}. Aucun niveau contractuel fixé — à arbitrer au bon de commande.` };
    } else if (RANK[requiredLevel] > RANK[contractLevel]) {
      levelVerdict = { kind: 'shortfall', text: `Le contrat actuel (${LEVEL_LABELS[contractLevel]}) ne couvre pas le périmètre décrit dans cette AF, qui requiert un niveau ${LEVEL_LABELS[requiredLevel]}.` };
    } else if (RANK[requiredLevel] < RANK[contractLevel]) {
      levelVerdict = { kind: 'over', text: `Le contrat actuel (${LEVEL_LABELS[contractLevel]}) couvre largement le périmètre décrit (qui requiert seulement ${LEVEL_LABELS[requiredLevel]}). Marge disponible pour activer d'autres fonctionnalités.` };
    } else {
      levelVerdict = { kind: 'ok', text: `Le contrat ${LEVEL_LABELS[contractLevel]} couvre exactement le périmètre décrit dans cette AF.` };
    }

    const kpis = {
      systemsCovered: equipmentLive.filter(s => {
        const en = equipmentEnriched.find(e => e.sec.id === s.id);
        return en && en.instances > 0;
      }).length,
      systemsCatalog: equipmentSections.length,
      instancesTotal,
      pointsTotal,
      contractLevel,
      contractLevelLabel: contractLevel ? LEVEL_LABELS[contractLevel] : null,
      requiredLevel,
      requiredLevelLabel: requiredLevel ? LEVEL_LABELS[requiredLevel] : null,
      verdict: levelVerdict,
    };

    const optedOutList = equipmentOptedOut.map(s => ({
      number: s.number, title: s.title,
      requiredContract: s.service_level === 'P' ? 'Premium' : (s.service_level === 'S' ? 'Smart' : 'Smart ou Premium'),
    }));

    // ── PAGE 2 : Conformite BACS R175-3 (4 exigences) ──
    // Mapping de chaque exigence aux sections de l'AF qui y répondent.
    const BACS_REQUIREMENTS = [
      {
        code: '§1', title: 'Suivi continu et historisation',
        text: 'Suivi, enregistrement et analyse en continu des données énergétiques par zone fonctionnelle, à pas horaire, conservées 5 ans à l\'échelle mensuelle.',
        coverNumbers: ['3.1', '3.2', '6.2'],
        buildyAnswer: 'Acquisition temps réel, historisation longue durée, tableaux de bord énergie. Conformité 5 ans satisfaite à partir du contrat Smart.',
      },
      {
        code: '§2', title: 'Détection des dérives énergétiques',
        text: 'Comparaison aux valeurs de référence, détection des pertes d\'efficacité, information de l\'exploitant sur les améliorations possibles.',
        coverNumbers: ['6.3', '5.1', '5.2'],
        buildyAnswer: 'Seuils paramétrables par compteur (occupation/inoccupation/global) avec alarmes et notifications.',
      },
      {
        code: '§3', title: 'Interopérabilité multi-systèmes',
        text: 'Capacité d\'interagir avec les différents systèmes techniques du bâtiment, indépendamment du fabricant et du protocole.',
        coverNumbers: ['1.2', '2'],
        buildyAnswer: 'Compatibilité multi-protocoles (BACnet, Modbus, KNX, M-Bus, MQTT, LoRaWAN…) et multi-fabricants par conception.',
      },
      {
        code: '§4', title: 'Arrêt manuel et gestion autonome',
        text: 'Possibilité d\'arrêter manuellement les systèmes techniques et de leur appliquer une gestion autonome (programmations, scénarios).',
        coverNumbers: ['4.1', '4.2'],
        buildyAnswer: 'Commandes manuelles depuis Hyperveez (marche/arrêt, consignes) + programmations horaires centralisées.',
      },
    ];
    // Mapping § R175-3 → quels systemes du projet sont concernes
    function systemsConcernedBy(reqCode) {
      // §1 (suivi conso/prod energetique) : tous systemes consommateurs ou producteurs d'energie
      //    + compteurs (contribuent meme s'ils ne sont pas dans R175-1)
      // §2 (detection derives) : memes systemes que §1
      // §3 (interoperabilite) : tous systemes instancies (le simple fait d'etre integres = preuve)
      // §4 (arret manuel + gestion autonome) : systemes pilotables (avec points d'ecriture)
      const instanced = equipmentEnriched.filter(e => e.instances > 0 && isSectionLive(e.sec));
      function bacsHasParagraph(bacs, p) {
        if (!bacs) return false;
        return bacs.includes(`§${p}`);
      }
      if (reqCode === '§1' || reqCode === '§2') {
        return instanced.filter(e => {
          const isMet = isMeteringSystem(e.sec);
          const hasEnergyBacs = bacsHasParagraph(e.sec.bacs_articles, '1') ||
                                 bacsHasParagraph(e.sec.bacs_articles, '2') ||
                                 bacsHasParagraph(e.sec.bacs_articles, '4');
          return isMet || hasEnergyBacs;
        });
      }
      if (reqCode === '§3') return instanced; // tout systeme integre prouve l'interop
      if (reqCode === '§4') return instanced.filter(e => e.writes > 0); // pilotable
      return instanced;
    }

    const bacsConformity = BACS_REQUIREMENTS.map(req => {
      const coverSections = req.coverNumbers
        .map(n => allSections.find(s => s.number === n))
        .filter(Boolean);
      const liveCover = coverSections.filter(isSectionLive);
      const concerned = systemsConcernedBy(req.code);

      let status;
      if (coverSections.length === 0) status = 'non-applicable';
      else if (concerned.length === 0 && req.code !== '§3') {
        // Aucun systeme du projet concerne : la conformite est non-applicable a ce projet
        // (sauf §3 interoperabilite qui est une propriete de la solution Buildy elle-meme)
        status = 'non-applicable-project';
      }
      else if (liveCover.length === coverSections.length) status = 'covered';
      else if (liveCover.length > 0) status = 'partial';
      else status = 'not-covered';

      return {
        ...req,
        sections: coverSections.map(s => ({
          number: s.number,
          title: s.title,
          live: isSectionLive(s),
          opted_out: !!s.opted_out_by_moa,
          excluded: !s.included_in_export,
        })),
        systemsConcerned: concerned.map(e => ({
          number: e.sec.number, title: e.sec.title, instances: e.instances,
        })),
        status,
        statusLabel: {
          covered: 'Couvert',
          partial: 'Partiellement couvert',
          'not-covered': 'Non couvert',
          'non-applicable': 'Non applicable',
          'non-applicable-project': 'Aucun système concerné',
        }[status],
      };
    });

    // ── PAGE 3 : Couverture fonctionnelle Buildy ──
    // Regroupe les sous-sections fonctionnelles par chapitre (hors equipements ch.2 et synthese ch.12).
    // Un chapitre = nombre courant d'integer ou code (ex '7', '11.x', '1.5').
    const FEATURE_CHAPTERS = [
      { code: '1.5', title: 'Connectivité du site', match: n => n === '1.5' },
      { code: '3', title: 'Monitoring', match: n => n === '3' || /^3\./.test(n) },
      { code: '4', title: 'Contrôle & commande', match: n => n === '4' || /^4\./.test(n) },
      { code: '5', title: 'Gestion des alarmes', match: n => n === '5' || /^5\./.test(n) },
      { code: '6', title: 'Reporting & analyse', match: n => n === '6' || /^6\./.test(n) },
      { code: '7', title: 'Traçabilité interne', match: n => n === '7' },
      { code: '8', title: 'API Buildy Connect', match: n => n === '8' },
      { code: '9', title: 'Support utilisateur', match: n => n === '9' },
      { code: '11', title: 'Application Gojee', match: n => n === '11' || /^11\./.test(n) },
    ];
    function excerpt(html, maxLen = 130) {
      if (!html) return '';
      // Strip placeholder italic
      const stripped = String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      // Si c'est un placeholder "À rédiger…" on retourne vide
      if (/^À rédiger/i.test(stripped)) return '';
      if (stripped.length <= maxLen) return stripped;
      return stripped.slice(0, maxLen).replace(/\s\S*$/, '') + '…';
    }
    const featuresByChapter = FEATURE_CHAPTERS.map(ch => {
      const sections = allSections
        .filter(s => s.kind === 'standard' && s.number && ch.match(s.number))
        // On exclut les "containers" (parents purs) qui n'ont pas de body utile
        .filter(s => s.number === ch.code || s.number.split('.').length >= 2);
      const items = sections.map(s => {
        let statusKey, statusLabel;
        if (s.opted_out_by_moa) { statusKey = 'opted-out'; statusLabel = 'Écartée par la MOA'; }
        else if (!s.included_in_export) { statusKey = 'excluded'; statusLabel = 'Exclue de l\'export'; }
        else { statusKey = 'active'; statusLabel = 'Active'; }
        const sl = s.service_level;
        const requiredContract = s.opted_out_by_moa
          ? (sl === 'P' ? 'Premium' : (sl === 'S' ? 'Smart' : 'Smart ou Premium'))
          : null;
        return {
          number: s.number, title: s.title, statusKey, statusLabel,
          serviceLevel: sl, levelClass: sl ? sl.replace(/[^A-Z]/g, '') : '',
          excerpt: excerpt(s.body_html),
          requiredContract,
        };
      });
      const counts = items.reduce((a, i) => ({
        active: a.active + (i.statusKey === 'active' ? 1 : 0),
        optedOut: a.optedOut + (i.statusKey === 'opted-out' ? 1 : 0),
        excluded: a.excluded + (i.statusKey === 'excluded' ? 1 : 0),
        total: a.total + 1,
      }), { active: 0, optedOut: 0, excluded: 0, total: 0 });
      return { ...ch, items, counts };
    }).filter(ch => ch.items.length > 0);

    // KPI couverture global
    const coverageTotals = featuresByChapter.reduce((a, ch) => ({
      active: a.active + ch.counts.active,
      optedOut: a.optedOut + ch.counts.optedOut,
      excluded: a.excluded + ch.counts.excluded,
      total: a.total + ch.counts.total,
    }), { active: 0, optedOut: 0, excluded: 0, total: 0 });
    coverageTotals.activePercent = coverageTotals.total > 0
      ? Math.round((coverageTotals.active / coverageTotals.total) * 100)
      : 0;
    kpis.coverage = coverageTotals;

    // ── PAGE 4 : Matrice systemes (filtree strict) ──
    const relevantEquipment = equipmentEnriched.filter(({ sec, instances }) =>
      instances > 0 || sec.opted_out_by_moa
    );
    const offCatalogCount = equipmentSections.length - relevantEquipment.length;
    const systemsMatrix = relevantEquipment.map(({ sec, points, instances }) => {
      const isOptedOut = sec.opted_out_by_moa === 1;
      const isExcluded = !sec.included_in_export;
      let status, statusClass;
      if (isOptedOut) { status = 'Écartée par la MOA'; statusClass = 'opted-out'; }
      else if (isExcluded) { status = 'Exclue de l\'export'; statusClass = 'excluded'; }
      else if (instances === 0) { status = 'Non instanciée'; statusClass = 'not-instanced'; }
      else { status = 'Couverte'; statusClass = 'covered'; }

      const totalPoints = (isOptedOut || isExcluded) ? 0 : points.length * instances;

      return {
        number: sec.number,
        title: sec.title,
        bacs: sec.bacs_articles || null,
        isMetering: isMeteringSystem(sec),
        instances,
        pointsPerInstance: points.length,
        totalPoints,
        status, statusClass,
        isOptedOut, isExcluded,
      };
    });

    const totalsMatrix = systemsMatrix.reduce((acc, r) => ({
      instances: acc.instances + (r.isOptedOut || r.isExcluded ? 0 : r.instances),
      points: acc.points + r.totalPoints,
    }), { instances: 0, points: 0 });

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
      kpis, optedOutList, bacsConformity, systemsMatrix, totalsMatrix,
      featuresByChapter, offCatalogCount,
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
        pageFormat: 'A4',
        pdfOptions: { landscape: true, margin: { top: '14mm', bottom: '12mm', left: '14mm', right: '14mm' } },
        watermark: { ...BUILDY_WATERMARK, skipFirstPage: false, opacity: 0.025 },
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
      JSON.stringify({ systems: systemsMatrix.length, totals: totalsMatrix, requiredLevel, contractLevel }),
      JSON.stringify({ version, format: 'A4-landscape-synthesis-3p' }),
      body.motif, version, userId || null, result.sizeBytes
    );

    db.auditLog.add({
      afId, userId, action: 'export.synthesis',
      payload: { version, motif: body.motif, systems: systemsMatrix.length, requiredLevel, contractLevel },
    });
    log.info(`PDF synthesis exported: AF #${afId} → ${filename} (${(result.sizeBytes/1024).toFixed(1)} KB)`);
    await commitExportSilently(afId, `${version} : ${body.motif}`, version, request.authUser);

    return {
      id: insertedRow.lastInsertRowid,
      version,
      file_size_bytes: result.sizeBytes,
      download_url: `/api/exports/${insertedRow.lastInsertRowid}/download`,
      systems_count: systemsMatrix.length,
      totals: totalsMatrix,
      kpis,
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

    // Calcul du niveau service requis (depuis sections incluses non ecartees)
    const serviceLevel = resolveAfLevel(allSections.filter(s => !s.opted_out_by_moa));

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
