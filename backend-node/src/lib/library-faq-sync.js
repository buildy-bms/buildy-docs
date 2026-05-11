'use strict';

// Synchronisation bibliothèque de fonctionnalités -> FAQ Crisp (Lot 138).
//
// Orchestre :
// 1) lecture de la fonctionnalité (section_template avec is_functionality=1)
// 2) publication FTP des captures attachées (cache via library_attachment_publications)
// 3) appel IA (assistFaqGenerateFromFunctionality) avec contexte enrichi
// 4) persistance dans faq_articles avec source_section_template_id + version
//
// Le service ne pousse PAS l'article vers Crisp (admin valide d'abord côté
// éditeur FAQ et clique « Publier vers Crisp » manuellement).

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const db = require('../database');
const config = require('../config');
const log = require('./logger').system;
const { uploadImage } = require('./faq-image-upload');

// ── Captures biblio -> FTP public ─────────────────────────────────────

function _attachmentDiskPath(att) {
  // Cf. routes/attachments.js : les captures section_template sont dans
  // <attachmentsDir>/_tpl/section/<filename>. On supporte aussi le pattern
  // equipment_template au cas où on étendrait le périmètre plus tard.
  if (att.section_template_id) {
    return path.join(config.attachmentsDir, '_tpl', 'section', att.filename);
  }
  if (att.equipment_template_id) {
    return path.join(config.attachmentsDir, '_tpl', 'equipment', att.filename);
  }
  return null;
}

function _mimeFromExt(filename) {
  const ext = (path.extname(filename) || '').toLowerCase().replace('.', '');
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  return 'application/octet-stream';
}

function _sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

// Publie une seule capture (idempotent : si file_hash inchangé, on réutilise
// l'URL FTP existante, pas de re-upload).
async function _ensurePublished(att) {
  const diskPath = _attachmentDiskPath(att);
  if (!diskPath || !fs.existsSync(diskPath)) {
    log.warn(`library-faq-sync : capture introuvable sur disque (attachment=${att.id}, path=${diskPath})`);
    return null;
  }
  const buffer = fs.readFileSync(diskPath);
  const hash = _sha256(buffer);

  const existing = db.libraryAttachmentPublications.get(att.id);
  if (existing && existing.file_hash === hash) {
    return { url: existing.ftp_url, caption: att.caption || '', position: att.position, attachmentId: att.id };
  }

  // Upload (re-upload si hash différent).
  const mime = _mimeFromExt(att.filename);
  let result;
  try {
    result = await uploadImage(buffer, mime);
  } catch (e) {
    log.warn(`library-faq-sync : upload FTP échec (attachment=${att.id}) : ${e.message}`);
    return null;
  }
  db.libraryAttachmentPublications.upsert({
    attachmentId: att.id,
    ftpUrl: result.url,
    fileHash: hash,
  });
  return { url: result.url, caption: att.caption || '', position: att.position, attachmentId: att.id };
}

// Liste + publie toutes les captures d'une fonctionnalité. Retourne un tableau
// trié par position avec { url, caption, position }.
async function publishFunctionalityAttachments(sectionTemplateId) {
  const atts = db.attachments.listBySectionTemplate(sectionTemplateId);
  const out = [];
  for (const att of atts) {
    const pub = await _ensurePublished(att);
    if (pub) out.push(pub);
  }
  out.sort((a, b) => (a.position || 0) - (b.position || 0));
  return out;
}

// ── Statut de divergence biblio <-> article FAQ ───────────────────────

function getFaqStatusForFunctionality(sectionTemplateId) {
  const tpl = db.sectionTemplates.getById(sectionTemplateId);
  if (!tpl) return { exists_template: false };

  const article = db.faqArticles.getBySectionTemplateId(sectionTemplateId);
  if (!article) {
    return {
      exists_template: true,
      faq_publishable: tpl.faq_publishable !== 0,
      article: null,
      diverged: false,
      overridden: false,
    };
  }
  const diverged = (tpl.current_version || 0) > (article.source_synced_version || 0);
  return {
    exists_template: true,
    faq_publishable: tpl.faq_publishable !== 0,
    article: {
      id: article.id,
      title: article.title,
      status: article.status,
      dirty: article.dirty,
      crisp_id: article.crisp_id,
      crisp_url: article.crisp_url,
      source_synced_at: article.source_synced_at,
      source_synced_version: article.source_synced_version,
      source_overridden: article.source_overridden,
    },
    diverged,
    overridden: article.source_overridden === 1,
  };
}

// ── Génération / regénération d'article FAQ depuis une fonctionnalité ─

// Génère un nouvel article FAQ depuis une fonctionnalité. L'IA + l'upload des
// captures sont parallélisés autant que possible. Retourne l'article créé.
async function generateFaqFromFunctionality({ sectionTemplateId, categoryId = null, locale = 'fr', userId = null }) {
  const tpl = db.sectionTemplates.getById(sectionTemplateId);
  if (!tpl) {
    const e = new Error('Fonctionnalité introuvable'); e.status = 404; throw e;
  }
  if (tpl.is_functionality !== 1) {
    const e = new Error('Cette section type n\'est pas une fonctionnalité'); e.status = 400; throw e;
  }
  if (tpl.faq_publishable === 0) {
    const e = new Error('Fonctionnalité marquée confidentielle — publication FAQ désactivée'); e.status = 403; throw e;
  }

  // 1) Publier les captures (FTP) en // de la préparation contexte.
  const [attachments] = await Promise.all([
    publishFunctionalityAttachments(sectionTemplateId),
  ]);

  // 2) Maillage interne BACS : liste des articles BACS publiés qui couvrent
  //    les codes mentionnés sur la fonctionnalité.
  const bacsCodes = _parseBacsCodes(tpl.bacs_articles);
  const bacsCoverage = bacsCodes.length > 0 ? db.faqArticles.listBacsCoverage(bacsCodes) : [];

  // 3) Appel IA — lazy require pour éviter l'init Anthropic SDK en boot.
  const { assistFaqGenerateFromFunctionality } = require('./claude');
  const result = await assistFaqGenerateFromFunctionality({
    functionality: tpl,
    attachments,
    bacsCoverage,
    locale,
  });

  // 4) Persistance.
  const article = db.faqArticles.create({
    title: result.title || tpl.title || 'Article FAQ',
    description: result.description || null,
    contentHtml: result.html || '',
    categoryId,
    status: 'draft',
    visibility: 'public',
    locale,
    dirty: 1,
    createdBy: userId,
    sourceSectionTemplateId: sectionTemplateId,
    sourceSyncedVersion: tpl.current_version || 1,
    sourceSyncedAt: new Date().toISOString(),
    sourceOverridden: 0,
    bacsArticles: tpl.bacs_articles || null,
  });

  // Score SEO recalculé après création (boucle déjà incluse côté assistFaqGen)
  try {
    const { scoreArticle } = require('./seo-scorer');
    const s = scoreArticle({
      title: article.title,
      description: article.description,
      contentHtml: article.content_html,
    });
    db.faqArticles.setSeoScore(article.id, { score: s.score, checks: s.checks });
  } catch (e) { log.warn(`SEO score recompute échec : ${e.message}`); }

  db.auditLog.add({
    userId,
    action: 'faq.article.generated_from_functionality',
    payload: { article_id: article.id, section_template_id: sectionTemplateId, attachments: attachments.length },
  });
  return db.faqArticles.getById(article.id);
}

// Regénère un article FAQ existant à partir de sa fonctionnalité source.
// Si l'article a été édité manuellement (source_overridden=1) et que force=false,
// rejette avec 409. Snapshot before_library_resync posé avant écrasement pour
// permettre un rollback via l'historique.
async function regenerateFaqFromFunctionality({ articleId, force = false, userId = null }) {
  const article = db.faqArticles.getById(articleId);
  if (!article) { const e = new Error('Article introuvable'); e.status = 404; throw e; }
  if (!article.source_section_template_id) {
    const e = new Error('Cet article n\'a pas de fonctionnalité source'); e.status = 400; throw e;
  }
  if (article.source_overridden === 1 && !force) {
    const e = new Error('Article édité manuellement depuis la dernière génération — force=true requis pour écraser');
    e.status = 409;
    throw e;
  }

  const tpl = db.sectionTemplates.getById(article.source_section_template_id);
  if (!tpl) {
    const e = new Error('Fonctionnalité source supprimée'); e.status = 410; throw e;
  }
  if (tpl.faq_publishable === 0) {
    const e = new Error('Fonctionnalité marquée confidentielle — regénération désactivée'); e.status = 403; throw e;
  }

  // Snapshot pré-écrasement (mécanique d'historique existante).
  try { db.faqArticles.snapshot(articleId, { reason: 'before_library_resync', userId }); }
  catch (e) { log.warn(`Snapshot before_library_resync ${articleId} échec : ${e.message}`); }

  const attachments = await publishFunctionalityAttachments(tpl.id);
  const bacsCodes = _parseBacsCodes(tpl.bacs_articles);
  const bacsCoverage = bacsCodes.length > 0 ? db.faqArticles.listBacsCoverage(bacsCodes) : [];

  const { assistFaqGenerateFromFunctionality } = require('./claude');
  const result = await assistFaqGenerateFromFunctionality({
    functionality: tpl,
    attachments,
    bacsCoverage,
    locale: article.locale || 'fr',
  });

  db.faqArticles.update(articleId, {
    title: result.title || article.title,
    description: result.description || null,
    contentHtml: result.html || '',
    dirty: 1,
    sourceSyncedVersion: tpl.current_version || 1,
    sourceSyncedAt: new Date().toISOString(),
    sourceOverridden: 0, // reset après resync
    bacsArticles: tpl.bacs_articles || null,
  }, userId);

  try {
    const { scoreArticle } = require('./seo-scorer');
    const s = scoreArticle({
      title: result.title || article.title,
      description: result.description || null,
      contentHtml: result.html || '',
    });
    db.faqArticles.setSeoScore(articleId, { score: s.score, checks: s.checks });
  } catch (e) { log.warn(`SEO score recompute échec : ${e.message}`); }

  db.auditLog.add({
    userId,
    action: 'faq.article.regenerated_from_functionality',
    payload: { article_id: articleId, section_template_id: tpl.id, forced: !!force },
  });
  return db.faqArticles.getById(articleId);
}

// ── Helpers ───────────────────────────────────────────────────────────

function _parseBacsCodes(text) {
  if (!text) return [];
  return String(text).split(/[,;]/).map(s => s.trim()).filter(Boolean);
}

module.exports = {
  publishFunctionalityAttachments,
  getFaqStatusForFunctionality,
  generateFaqFromFunctionality,
  regenerateFaqFromFunctionality,
};
