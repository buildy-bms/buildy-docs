'use strict';

const db = require('../database');

async function routes(fastify) {
  // GET /api/users — liste des utilisateurs (pour autocomplete partage AF)
  fastify.get('/users', async (request) => {
    const search = (request.query.q || '').trim().toLowerCase();
    let rows = db.db.prepare(`
      SELECT id, email, display_name, first_name, last_name, last_seen_at
      FROM users
      ORDER BY display_name, email
    `).all();
    if (search.length >= 2) {
      rows = rows.filter(u =>
        (u.display_name || '').toLowerCase().includes(search) ||
        (u.email || '').toLowerCase().includes(search)
      );
    }
    return rows.slice(0, 50);
  });
}

module.exports = routes;
