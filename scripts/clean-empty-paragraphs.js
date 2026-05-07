#!/usr/bin/env node
/**
 * Nettoie les paragraphes vides (artefacts d'export Word ou de pull/push Crisp)
 * dans le content_html d'un article FAQ : <p>&nbsp;</p>, <p><span>&nbsp;</span></p>,
 * <p><br></p>, <p>&#160;</p>, etc.
 *
 * Sécurité :
 *   - Dry-run par défaut (--apply pour écrire)
 *   - Snapshot pré-modification (reason='before_cleanup')
 *   - Ne push PAS sur Crisp — marque seulement dirty=1
 *
 * Usage :
 *   node scripts/clean-empty-paragraphs.js --article-id=3
 *   node scripts/clean-empty-paragraphs.js --article-id=3 --apply
 *   node scripts/clean-empty-paragraphs.js --title-like="CGV"
 */

const path = require('path');
const Database = require('better-sqlite3');

const args = process.argv.slice(2).reduce((acc, a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  acc[k] = v === undefined ? true : v;
  return acc;
}, {});

const APPLY = !!args.apply;
const DB_PATH = path.resolve(__dirname, '..', 'data', 'buildy_af.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

function findArticles() {
  if (args['article-id']) {
    return db.prepare('SELECT id, title, content_html, dirty FROM faq_articles WHERE id = ?')
      .all(parseInt(args['article-id'], 10));
  }
  if (args['title-like']) {
    return db.prepare('SELECT id, title, content_html, dirty FROM faq_articles WHERE title LIKE ?')
      .all(`%${args['title-like']}%`);
  }
  console.error('Usage : --article-id=<N> ou --title-like="<text>"');
  process.exit(1);
}

/**
 * Strip les patterns de paragraphes "vides" générés par Crisp / Tiptap / exports Word.
 * Ne touche PAS aux paragraphes contenant du contenu réel.
 */
function stripEmptyParagraphs(html) {
  if (!html) return { cleaned: html, removed: 0 };
  let removed = 0;
  let out = html;

  // Pattern global : <p ...>X</p> où X ne contient que <br>, &nbsp;, &#160;, espaces, ou un <span>...</span> avec idem dedans
  const re = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
  out = out.replace(re, (m, inner) => {
    // Strip toutes balises pour voir s'il reste du texte significatif
    const stripped = inner
      .replace(/<br\s*\/?>/gi, '')
      .replace(/<span\b[^>]*>([\s\S]*?)<\/span>/gi, '$1')
      .replace(/&nbsp;|&#160;|&#xa0;/gi, '')
      .replace(/[\s  ​]/g, ''); // espaces, U+00A0, U+202F, U+200B
    if (stripped === '') {
      removed++;
      return '';
    }
    return m;
  });

  // Compacte les sauts de ligne consécutifs résiduels
  out = out.replace(/(\r?\n){3,}/g, '\n\n');

  return { cleaned: out, removed };
}

function snapshot(articleId, reason) {
  const a = db.prepare('SELECT title, content_html, status FROM faq_articles WHERE id = ?').get(articleId);
  if (!a) return null;
  const r = db.prepare(`
    INSERT INTO faq_article_versions (article_id, title, content_html, status, reason, created_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(articleId, a.title, a.content_html || '', a.status || 'draft', reason, null);
  return r.lastInsertRowid;
}

const articles = findArticles();
if (!articles.length) {
  console.log('Aucun article trouvé.');
  process.exit(0);
}

console.log(`Mode : ${APPLY ? '\x1b[31mAPPLY (écriture)\x1b[0m' : '\x1b[33mDRY-RUN (pas d\'écriture)\x1b[0m'}`);
console.log(`Articles trouvés : ${articles.length}\n`);

let totalRemoved = 0;
for (const a of articles) {
  const beforeLen = (a.content_html || '').length;
  const { cleaned, removed } = stripEmptyParagraphs(a.content_html || '');
  const afterLen = cleaned.length;
  const delta = beforeLen - afterLen;

  console.log(`📄 [#${a.id}] ${a.title}`);
  console.log(`   ${beforeLen} → ${afterLen} chars (-${delta}) · ${removed} paragraphe(s) vide(s) supprimé(s)`);

  if (removed === 0) {
    console.log(`   ✅ rien à nettoyer\n`);
    continue;
  }

  totalRemoved += removed;

  if (APPLY) {
    const versionId = snapshot(a.id, 'before_cleanup');
    db.prepare('UPDATE faq_articles SET content_html = ?, dirty = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(cleaned, a.id);
    console.log(`   💾 snapshot v${versionId} créé · article mis à jour · dirty=1\n`);
  } else {
    console.log(`   (dry-run — ré-exécute avec --apply pour écrire)\n`);
  }
}

console.log(`Total : ${totalRemoved} paragraphe(s) vide(s) ${APPLY ? 'supprimé(s)' : 'détecté(s)'}.`);
if (APPLY && totalRemoved > 0) {
  console.log(`\n✅ Articles marqués dirty=1 — pousse via l'UI Buildy Docs (bouton "Publier vers Crisp").`);
}

db.close();
