'use strict';

const db = require('../database');

/**
 * API de la base de connaissance BACS (decret + FAQ ministere + guide
 * ministere + guide PROFEEL). Lue par le serveur MCP de FM via le client
 * « act-as-user » — chaque entree porte sa source et son niveau d'autorite
 * pour que Claude puisse citer correctement.
 *
 * Authorite : opposable (decret) > officiel (FAQ / guide ministere) >
 * professionnel (PROFEEL) > interne.
 */

// Echappe une requete FTS5 en transformant les mots utilisateur en
// recherche prefixe (ex: "puissance 70 kW" -> "puissance* 70* kW*").
function ftsQuery(q) {
  if (!q) return '';
  return q.trim()
    .split(/\s+/)
    .map(t => t.replace(/[^\wÀ-ſ-]/g, ''))
    .filter(Boolean)
    .map(t => `${t}*`)
    .join(' ');
}

function summarize(row, snippetLen = 400) {
  return {
    id: row.id,
    source: row.source,
    authority: row.authority,
    kind: row.kind,
    code: row.code,
    title: row.title,
    version_label: row.version_label,
    source_url: row.source_url,
    source_page: row.source_page,
    r175_refs: row.r175_refs ? row.r175_refs.split(',').map(s => s.trim()).filter(Boolean) : [],
    excerpt: (row.body_text || '').slice(0, snippetLen),
  };
}

function expand(row) {
  return {
    ...summarize(row, 0),
    body_text: row.body_text,
    body_html: row.body_html || null,
  };
}

async function routes(fastify) {

  // GET /bacs-knowledge/search?q=...&source=...&kind=...&limit=20
  // Recherche plein-texte sur tous les corpus (decret, FAQ gouv, guide
  // ministere, PROFEEL). Renvoie les extraits ranks par pertinence FTS.
  fastify.get('/bacs-knowledge/search', async (request) => {
    const { q, source, kind, limit } = request.query;
    const lim = Math.min(parseInt(limit, 10) || 15, 50);
    if (!q || !q.trim()) return { count: 0, results: [] };
    const fts = ftsQuery(q);
    if (!fts) return { count: 0, results: [] };
    const conds = [], params = [fts];
    if (source) { conds.push('k.source = ?'); params.push(source); }
    if (kind) { conds.push('k.kind = ?'); params.push(kind); }
    const where = conds.length ? `AND ${conds.join(' AND ')}` : '';
    const rows = db.db.prepare(`
      SELECT k.*, bm25(bacs_knowledge_fts) AS score
      FROM bacs_knowledge_fts
      JOIN bacs_knowledge k ON k.id = bacs_knowledge_fts.rowid
      WHERE bacs_knowledge_fts MATCH ?
      ${where}
      ORDER BY score ASC
      LIMIT ?
    `).all(...params, lim);
    return { count: rows.length, results: rows.map(r => summarize(r)) };
  });

  // GET /bacs-knowledge/by-source/:source?kind=...&limit=...
  // Liste les entrees d'une source (utile pour parcourir le decret ou le
  // sommaire du guide).
  fastify.get('/bacs-knowledge/by-source/:source', async (request) => {
    const { source } = request.params;
    const { kind, limit } = request.query;
    const lim = Math.min(parseInt(limit, 10) || 200, 500);
    const conds = ['source = ?'], params = [source];
    if (kind) { conds.push('kind = ?'); params.push(kind); }
    const rows = db.db.prepare(`
      SELECT * FROM bacs_knowledge
      WHERE ${conds.join(' AND ')}
      ORDER BY position, id
      LIMIT ?
    `).all(...params, lim);
    return { count: rows.length, items: rows.map(r => summarize(r, 600)) };
  });

  // GET /bacs-knowledge/by-code/:code
  // Renvoie le texte INTEGRAL d'une entree precise (article R175-3,
  // FAQ-Q12, GUIDE-1.1...). Utile pour citer un article complet.
  fastify.get('/bacs-knowledge/by-code/:code', async (request, reply) => {
    const row = db.db.prepare('SELECT * FROM bacs_knowledge WHERE code = ? LIMIT 1').get(request.params.code);
    if (!row) return reply.code(404).send({ detail: 'Entree introuvable' });
    return expand(row);
  });

  // GET /bacs-knowledge/authoritative-lookup?q=...&r175=R175-3
  // Recherche hierarchique multi-sources : retourne les meilleurs extraits
  // de chaque corpus, dans l'ordre d'autorite. Permet a Claude de produire
  // une reponse sourcee avec la bonne hierarchie d'opposabilite.
  fastify.get('/bacs-knowledge/authoritative-lookup', async (request) => {
    const { q, r175 } = request.query;
    const fts = q ? ftsQuery(q) : null;
    const out = { decree: [], gov_faq: [], gov_guide: [], profeel: [] };
    for (const src of Object.keys(out)) {
      const conds = ['k.source = ?'], params = [src];
      if (fts) {
        conds.unshift('bacs_knowledge_fts MATCH ?');
        params.unshift(fts);
      }
      if (r175) {
        conds.push('(k.code = ? OR k.r175_refs LIKE ?)');
        params.push(r175, `%${r175}%`);
      }
      const sql = fts ? `
        SELECT k.*, bm25(bacs_knowledge_fts) AS score
        FROM bacs_knowledge_fts
        JOIN bacs_knowledge k ON k.id = bacs_knowledge_fts.rowid
        WHERE ${conds.join(' AND ')}
        ORDER BY score ASC LIMIT 5
      ` : `
        SELECT k.*, 0 AS score FROM bacs_knowledge k
        WHERE ${conds.join(' AND ')}
        ORDER BY position, id LIMIT 5
      `;
      out[src] = db.db.prepare(sql).all(...params).map(r => summarize(r, 500));
    }
    return out;
  });

  // GET /bacs-knowledge/glossary
  // Glossaire des termes (BACS, GTB, R175-2, P1..P4, assujettissement...).
  fastify.get('/bacs-knowledge/glossary', async () => {
    const rows = db.db.prepare(`
      SELECT * FROM bacs_knowledge
      WHERE kind = 'glossary_term'
      ORDER BY title COLLATE NOCASE
    `).all();
    return { count: rows.length, terms: rows.map(r => expand(r)) };
  });
}

module.exports = routes;
