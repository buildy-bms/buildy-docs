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
    text: 'Le niveau visé est insuffisant — certaines fonctionnalités de l\'AF ne seront pas disponibles à la livraison du projet. Un avenant est nécessaire.',
  };
  if (RANK[requiredLevel] < RANK[contractLevel]) return {
    kind: 'over',
    text: 'Le niveau visé dépasse les besoins — marge disponible pour activer d\'autres fonctionnalités.',
  };
  return { kind: 'ok', text: 'Le niveau visé couvre exactement les fonctionnalités décrites dans l\'AF.' };
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
// Lot 91 — meme rendu offerings que la synthese pour les sections
// kind='synthesis' du PDF AF (rendu unifié + cohérence visuelle).
const offeringsAnnexPath = path.resolve(__dirname, '../../templates/pdf/_offerings-annex.hbs');
const renderOfferingsAnnex = Handlebars.compile(fs.readFileSync(offeringsAnnexPath, 'utf-8'));

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
    previewMode = false,
  } = opts;
  const authorName = user?.display_name || user?.email || 'Inconnu';

  const afExcludedSet = new Set(excludedSectionIds);
  const allSections = db.sections.listByAf(afId).filter(s =>
    s.included_in_export && !afExcludedSet.has(s.id)
  );
  const resolveLiveBacs = buildLiveBacsResolver();

  // Catalogue des categories de systeme (cle -> {icon_value, icon_color})
  // pour propager dans le PDF les icones colorees des sections « categorie »
  // qui regroupent des equipements (ex : Chauffage, Ventilation, Comptage…).
  // Une section parent est consideree comme categorie si tous ses descendants
  // de kind='equipment' partagent la meme `eqt.category`.
  const categoriesByKey = new Map();
  for (const c of db.systemCategoriesDb.list()) {
    categoriesByKey.set(c.key, c);
    if (Array.isArray(c.slugs)) for (const slug of c.slugs) categoriesByKey.set(slug, c);
  }
  // Pour chaque section, agreger les categories distinctes des descendants
  // equipment. Si UNE seule categorie -> on l'attribue a la section.
  const sectionCategoryKey = new Map();
  {
    const childrenByParent = new Map();
    for (const s of allSections) {
      const k = s.parent_id || null;
      if (!childrenByParent.has(k)) childrenByParent.set(k, []);
      childrenByParent.get(k).push(s);
    }
    function gatherCategories(sectionId) {
      const set = new Set();
      const stack = [sectionId];
      while (stack.length) {
        const cur = stack.pop();
        const kids = childrenByParent.get(cur) || [];
        for (const k of kids) {
          if (k.kind === 'equipment' && k.eq_category) set.add(k.eq_category);
          stack.push(k.id);
        }
      }
      return set;
    }
    for (const s of allSections) {
      if (s.kind === 'equipment') continue; // resolu directement via eq_*
      const cats = gatherCategories(s.id);
      if (cats.size === 1) sectionCategoryKey.set(s.id, [...cats][0]);
    }
  }
  function resolveSectionIcon(s) {
    // 1. Equipement : icone du template equipement
    if (s.kind === 'equipment' && s.eq_icon_value) {
      return {
        icon_kind: s.eq_icon_kind || 'fa',
        icon_value: s.eq_icon_value,
        icon_color: s.eq_icon_color || null,
      };
    }
    // 2. Section categorie : icone de la system_category correspondante
    const catKey = sectionCategoryKey.get(s.id);
    if (catKey) {
      const cat = categoriesByKey.get(catKey);
      if (cat) {
        return {
          icon_kind: 'fa',
          icon_value: cat.icon_value || null,
          icon_color: cat.icon_color || null,
        };
      }
    }
    // 3. Section_template avec icon_name (sans couleur — fallback gris fonce)
    if (s.tpl_icon_name) {
      return { icon_kind: 'fa', icon_value: s.tpl_icon_name, icon_color: null };
    }
    return { icon_kind: null, icon_value: null, icon_color: null };
  }

  // Numérotation live : recalculée depuis les positions courantes dans
  // l'arbre, identique à la logique frontend (`stores/af.js`). Le `number`
  // figé en DB devient stale dès qu'une section est déplacée ou exclue,
  // ce qui produisait des sommaires incohérents type « 1, 3, 4, 5, 2 ».
  // On numérote sur la liste DEJA filtree (allSections) — les sections
  // exclues sont déjà absentes, donc pas besoin du skip côté frontend.
  const liveNumbering = (() => {
    const map = new Map();
    const byParent = new Map();
    for (const s of allSections) {
      const k = s.parent_id || 'root';
      if (!byParent.has(k)) byParent.set(k, []);
      byParent.get(k).push(s);
    }
    for (const arr of byParent.values()) {
      arr.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    }
    function walk(parentKey, prefix) {
      const arr = byParent.get(parentKey) || [];
      arr.forEach((s, idx) => {
        const num = prefix ? `${prefix}.${idx + 1}` : String(idx + 1);
        map.set(s.id, num);
        walk(s.id, num);
      });
    }
    walk('root', '');
    return map;
  })();

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
      // Override AF a la priorite sur la description biblio (mig 111).
      const description_html = (sec.description_html_override != null && sec.description_html_override !== '')
        ? sec.description_html_override
        : (tpl?.description_html || null);
      // Override AF a la priorite sur la justification biblio (cascade
      // identique a la description : section.bacs_justification > biblio).
      const bacs_justification = (sec.bacs_justification && sec.bacs_justification.trim())
        ? sec.bacs_justification
        : (tpl?.bacs_justification || null);
      equipment = {
        description_html,
        points_read: points.filter(p => p.direction === 'read'),
        points_write: points.filter(p => p.direction === 'write'),
        preferred_protocols: protocols,
        bacs_justification,
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
  // Lot 91 — sections kind='synthesis' affichent EXACTEMENT le meme tableau
  // que la Synthese AF (partial _offerings-annex). Pre-render avec les memes
  // donnees offeringsAnnex pour aligner les 2 documents.
  const synthesisOfferingsHtml = renderOfferingsAnnex({
    offeringsAnnex: buildOfferingsAnnexForAf(af),
  });

  function buildTree(parentId, depth) {
    return allSections
      .filter(s => s.parent_id === parentId)
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map((s) => {
        const data = sectionData.get(s.id);
        const sl = s.service_level;
        const badgeClass = sl ? sl.replace(/[^A-Z]/g, '') : '';
        const synthesisHtml = s.kind === 'synthesis'
          ? synthesisOfferingsHtml
          : null;
        // Le chapitre 13 "Engagement contractuel" reçoit la synthese
        // calculee (offre recommandee + options à souscrire). On la prepend
        // au body_html existant pour que le texte canonique reste editable.
        const liveNumber = liveNumbering.get(s.id) || '';
        // Chapitre « Engagement contractuel » : on cible le slug du template
        // plutot que le number figé (qui peut diverger de la position).
        const isContractualChapter = s.section_template_id != null &&
          (db.sectionTemplates.getById(s.section_template_id)?.slug === '13' ||
           s.number === '13');
        const liveBacs = resolveLiveBacs(s);
        const ico = resolveSectionIcon(s);
        return {
          id: s.id,
          number: liveNumber,
          title: s.title,
          icon_name: ico.icon_value || s.tpl_icon_name || null,
          icon_color: ico.icon_color || null,
          icon_kind: ico.icon_kind || null,
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
          optin_paid_option: s.optin_paid_option === 1,
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

  // Niveau de service AF : on calcule TOUJOURS le niveau requis via
  // resolveAfLevel sur les sections incluses, jamais juste af.service_level
  // (qui est le niveau VISÉ, pas le niveau requis). Bug isole 2026-05-11 :
  // sans ce calcul, la cover AF affichait "requis: Essentials" meme quand
  // l'AF contenait des fonctions Smart obligatoires (cf. bandeau UI qui
  // signale "Dépasse le contrat").
  //
  // Filtres exclusifs (alignés sur le calcul de la Synthèse) :
  //   - opted_out_by_moa : refusee MOA, hors perimetre
  //   - optin_paid_option : option payante deja souscrite, n'impose pas
  //     d'upgrade global (c'est un add-on facture en sus)
  //   - paid_option au niveau cible : meme logique, dispo en option sans
  //     forcer d'upgrade du contrat
  const contractTargetSlug = (af.service_level || '').toUpperCase();
  function _availAtContractTarget(s) {
    if (!contractTargetSlug) return null;
    if (contractTargetSlug === 'E') return s.tpl_avail_e;
    if (contractTargetSlug === 'S') return s.tpl_avail_s;
    if (contractTargetSlug === 'P') return s.tpl_avail_p;
    return null;
  }
  const sectionsForLevelCalc = allSections.filter(s =>
    !s.opted_out_by_moa
    && !s.optin_paid_option
    && _availAtContractTarget(s) !== 'paid_option'
  );
  const serviceLevel = resolveAfLevel(sectionsForLevelCalc);
  // Compteur d'options payantes a la carte (mig 92) pour affichage cover :
  // "Niveau cible : Essentials + 3 options payantes".
  const optinPaidOptionCount = allSections.filter(s => !!s.optin_paid_option).length;

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

  // L'annexe "Tableau des offres" en fin de document a ete retiree : la
  // section kind='synthesis' deja presente dans l'arborescence rend le meme
  // tableau (cf. synthesisOfferingsHtml ci-dessus). On evitait un doublon en
  // gardant l'option, c'etait une regression UX confuse.
  const offeringsAnnex = null;

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
    optinPaidOptionCount,
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
  // Lot 91 — Sections ajoutees comme option payante a la carte.
  const optinPaidOptionTemplateIds = new Set(
    db.db.prepare(`
      SELECT DISTINCT section_template_id
      FROM sections
      WHERE af_id = ?
        AND optin_paid_option = 1
        AND section_template_id IS NOT NULL
    `).all(af.id).map(r => r.section_template_id)
  );

  // Recupere tous les section_templates pour construire l'arbre
  const allTemplates = db.db.prepare(`
    SELECT id, title, icon_name, parent_template_id, position, is_functionality,
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
      // Priorite : demanded > optin > refused (au cas ou un etat herite
      // aurait les 2 flags actifs, on privilegie l'inclusion volontaire).
      const optinPaid = optinPaidOptionTemplateIds.has(node.id);
      const demanded = demandedTemplateIds.has(node.id);
      const refused = !demanded && !optinPaid && optedOutTemplateIds.has(node.id);
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
        icon_name: node.icon_name || null,
        avail_e: ae,
        avail_s: as,
        avail_p: ap,
        all_option: allOption,
        refused,
        demanded,
        optin_paid_option: optinPaid,
      });
      for (const child of node.children) emit(child, visualDepth + 1);
    } else {
      rows.push({ kind: 'category', depth: visualDepth, title: node.title });
      for (const child of node.children) emit(child, visualDepth + 1);
    }
  }
  for (const r of roots) emit(r, 0);

  // Niveaux d'offre :
  //  - is_target  → niveau cible AF (engagement contractuel choisi par MOA)
  //  - is_required → niveau Buildy requis (calcul depuis le contenu de l'AF) :
  //      Toujours calcule via resolveAfLevel (peut etre superieur, egal ou
  //      inferieur au target). Quand target < required, le tableau de
  //      synthese met en avant la colonne required pour que le MOA voit
  //      clairement qu'un upgrade est necessaire.
  //  Le template masque le badge required quand target == required.
  const allLevels = db.offeringLevels.list();
  const targetSlug = (af.service_level || '').toUpperCase();
  const summary = buildContractualSummaryForAf(af);
  const sectionsForLevel = db.sections.listByAf(af.id);
  // Exclut les sections refusees MOA (opted_out) ET celles en option payante
  // souscrite (optin_paid_option) : un paid option pris ne force pas
  // d'upgrade du niveau, c'est un add-on facture en sus.
  const sectionsForCalc = sectionsForLevel.filter(s =>
    !s.opted_out_by_moa && !s.optin_paid_option
  );
  const requiredAfLevel = resolveAfLevel(sectionsForCalc);
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
  // Lot — Options payantes a la carte (mig 92).
  // af.service_level est un INPUT (le niveau choisi par le MOA), pas un
  // calcul. On classifie chaque feature {demanded OR optin_paid_option}
  // selon avail_<niveau choisi> :
  //   - 'included'    -> coveredFeatures   (deja couvertes par le contrat)
  //   - 'paid_option' -> requiredOptions   (a inclure dans l'avenant)
  //   - NULL          -> unavailableFeatures (warning : indisponible a ce niveau)
  // upgradeNeeded n'est leve QUE par les sections demanded indisponibles
  // au niveau choisi (pas par les optin_paid_option indisponibles).
  const flagged = db.db.prepare(`
    SELECT s.id, s.title, s.section_template_id, s.demanded_by_moa, s.optin_paid_option
    FROM sections s
    WHERE s.af_id = ?
      AND (s.demanded_by_moa = 1 OR s.optin_paid_option = 1)
      AND s.section_template_id IS NOT NULL
  `).all(af.id);

  const targetSlug = (af.service_level || 'E').toUpperCase();
  const targetName = LEVEL_NAMES[targetSlug] || targetSlug;

  if (flagged.length === 0) {
    return {
      hasDemands: false,
      currentLevel: targetSlug,
      currentLevelName: targetName,
      recommendedLevel: targetSlug,        // conserve pour compat hbs
      recommendedLevelName: targetName,
      upgradeNeeded: false,
      requiredOptions: [],
      coveredFeatures: [],
      unavailableFeatures: [],
    };
  }

  const tplIds = flagged.map(s => s.section_template_id);
  const placeholders = tplIds.map(() => '?').join(',');
  const tpls = db.db.prepare(`
    SELECT id, title, avail_e, avail_s, avail_p
    FROM section_templates WHERE id IN (${placeholders})
  `).all(...tplIds);
  const byTplId = new Map(tpls.map(t => [t.id, t]));

  const requiredOptions = [];
  const coveredFeatures = [];
  const unavailableFeatures = [];
  let upgradeNeeded = false;

  for (const s of flagged) {
    const tpl = byTplId.get(s.section_template_id);
    if (!tpl) continue;
    const availAtTarget = tpl[`avail_${targetSlug.toLowerCase()}`];
    const isDemanded = !!s.demanded_by_moa;
    const isOptin = !!s.optin_paid_option;
    if (availAtTarget === 'included') {
      coveredFeatures.push({ title: tpl.title, demanded: isDemanded, optin: isOptin });
    } else if (availAtTarget === 'paid_option') {
      requiredOptions.push({ title: tpl.title, demanded: isDemanded, optin: isOptin });
    } else {
      unavailableFeatures.push({ title: tpl.title, demanded: isDemanded, optin: isOptin });
      // Seules les sections demanded (= socle exige) imposent un upgrade.
      // Les optin sur indispo sont juste affichees comme "non eligibles a ce niveau".
      if (isDemanded) upgradeNeeded = true;
    }
  }

  return {
    hasDemands: true,
    currentLevel: targetSlug,
    currentLevelName: targetName,
    recommendedLevel: targetSlug,        // = currentLevel (plus de calcul auto)
    recommendedLevelName: targetName,
    upgradeNeeded,
    requiredOptions,
    coveredFeatures,
    unavailableFeatures,
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
        is_optional: !!p.is_optional,
        dirLabel: p.direction === 'read' ? 'R' : 'W',
      })),
    }));

    for (const inst of instancesWithPoints) {
      let first = true;
      for (const p of inst.points) {
        rows.push({
          categoryName: sec.title,
          instanceRef: inst.reference,
          instanceQty: inst.qty || 1,
          instanceLocation: inst.location || '',
          isFirstOfInstance: first,
          label: p.label,
          data_type: p.data_type,
          unit: p.unit,
          tech_name: p.tech_name,
          nature: p.nature,
          is_optional: p.is_optional,
          dirLabel: p.dirLabel,
        });
        first = false;
      }
    }

    // Bug fix : `equipment_instances` peut avoir qty>1 (ex : 46 unités intérieures
    // sur une seule entrée). Le compteur d'instances et le total de points doivent
    // refléter la quantité réelle de devices, pas le nombre de rows. Le rendu
    // visuel du tableau (rows.push) reste 1 ligne par entrée × point.
    const totalDevices = instances.reduce((acc, i) => acc + (i.qty || 1), 0);
    return {
      name: sec.title,
      bacsArticles: resolveLiveBacs(sec),
      instances: instancesWithPoints,
      instancesCount: totalDevices,
      pointsPerInstance: points.length,
      pointsTotal: totalDevices * points.length,
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
  // Le niveau "requis" est TOUJOURS calculé via resolveAfLevel (jamais
  // forcé à af.service_level qui est le niveau VISÉ). Filtres identiques
  // au builder AF.
  const _contractTargetSlug = (af.service_level || '').toUpperCase();
  function _availAtTarget(s) {
    if (!_contractTargetSlug) return null;
    if (_contractTargetSlug === 'E') return s.tpl_avail_e;
    if (_contractTargetSlug === 'S') return s.tpl_avail_s;
    if (_contractTargetSlug === 'P') return s.tpl_avail_p;
    return null;
  }
  const serviceLevel = resolveAfLevel(allSections.filter(s =>
    !s.opted_out_by_moa
    && !s.optin_paid_option
    && _availAtTarget(s) !== 'paid_option'
  ));
  const requiredLevel = serviceLevel?.level || null;
  const contractLevel = af.service_level || null;
  const kpis = {
    requiredLevel,
    requiredLevelLabel: requiredLevel ? SERVICE_LEVEL_LABELS[requiredLevel] : null,
    contractLevel,
    contractLevelLabel: contractLevel ? SERVICE_LEVEL_LABELS[contractLevel] : null,
    verdict: buildLevelVerdict({ requiredLevel, contractLevel }),
  };
  const optinPaidOptionCount = allSections.filter(s => !!s.optin_paid_option).length;

  const data = {
    af,
    authorName,
    exportDate,
    version,
    motif,
    serviceLevelLabel: SERVICE_LEVEL_LABELS[af.service_level] || af.service_level || '—',
    logoDataUrl: loadAssetDataUrl('logo-buildy.svg'),
    kpis,
    optinPaidOptionCount,
    serviceLevel,    // .justifications consomme par _cover-level-band.hbs
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
  buildContractualSummaryForAf,
  renderContractualSummary,
  buildLevelVerdict,
  // Re-exporte pour que export.js puisse les utiliser sans dupliquer
  buildLiveBacsResolver,
  SYNTHESIS_ROWS,
  renderSynthesisTable,
  SERVICE_LEVEL_LABELS,
};
