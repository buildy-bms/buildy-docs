'use strict';

const db = require('../database');

// Echappe une chaine pour FTS5 : tokens unicode61, on quote chaque mot puis
// on prefixe avec * pour autoriser le matching partiel ("filtr" -> "filtre").
function buildMatchExpr(q) {
  return q
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(t => t.replace(/["']/g, ''))
    .filter(Boolean)
    .map(t => `"${t}"*`)
    .join(' ');
}

async function routes(fastify) {
  // GET /api/search?q=foo[&afId=N&limit=20]
  fastify.get('/search', async (request, reply) => {
    const q = (request.query.q || '').trim();
    if (q.length < 2) return { items: [], count: 0 };
    const limit = Math.min(parseInt(request.query.limit || '20', 10), 50);
    const matchExpr = buildMatchExpr(q);
    if (!matchExpr) return { items: [], count: 0 };

    let rows;
    try {
      const sql = `
        SELECT f.section_id, f.af_id, f.title,
               snippet(sections_fts, 3, '<mark>', '</mark>', '…', 16) AS snippet,
               bm25(sections_fts) AS rank,
               s.number, s.kind,
               a.client_name, a.project_name, a.slug AS af_slug
        FROM sections_fts f
        JOIN sections s ON s.id = f.section_id
        JOIN afs a ON a.id = f.af_id
        WHERE sections_fts MATCH ?
          AND a.deleted_at IS NULL
          ${request.query.afId ? 'AND f.af_id = ?' : ''}
        ORDER BY rank
        LIMIT ?
      `;
      const params = request.query.afId
        ? [matchExpr, parseInt(request.query.afId, 10), limit]
        : [matchExpr, limit];
      rows = db.db.prepare(sql).all(...params);
    } catch (e) {
      return reply.code(400).send({ detail: `Requête invalide : ${e.message}` });
    }

    // Regroupe par AF
    const byAf = new Map();
    for (const r of rows) {
      if (!byAf.has(r.af_id)) {
        byAf.set(r.af_id, {
          af_id: r.af_id, af_slug: r.af_slug,
          client_name: r.client_name, project_name: r.project_name,
          sections: [],
        });
      }
      byAf.get(r.af_id).sections.push({
        section_id: r.section_id, number: r.number, title: r.title, kind: r.kind,
        snippet: r.snippet, rank: r.rank,
      });
    }
    return { items: Array.from(byAf.values()), count: rows.length };
  });
}

module.exports = routes;
