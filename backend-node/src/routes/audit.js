'use strict';

const db = require('../database');

async function routes(fastify) {
  // GET /api/audit-log
  // Query : limit (default 100, max 500), offset, action (prefix), user_id, af_id
  fastify.get('/audit-log', async (request) => {
    const limit = Math.min(parseInt(request.query?.limit || '100', 10), 500);
    const offset = parseInt(request.query?.offset || '0', 10);
    const action = request.query?.action || null;
    const userId = request.query?.user_id ? parseInt(request.query.user_id, 10) : null;
    const afId = request.query?.af_id ? parseInt(request.query.af_id, 10) : null;
    return db.auditLog.listAll({ limit, offset, action, userId, afId });
  });

  // GET /api/audit-log/actions
  // Liste distincte des codes d'action presents en DB (pour les filtres UI)
  fastify.get('/audit-log/actions', async () => ({
    actions: db.auditLog.distinctActions(),
  }));
}

module.exports = routes;
