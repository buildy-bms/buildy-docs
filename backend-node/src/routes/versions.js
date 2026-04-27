'use strict';

const db = require('../database');
const gitLib = require('../lib/git');

async function routes(fastify) {
  // GET /api/afs/:id/versions — historique des commits Git de l'AF
  fastify.get('/afs/:id/versions', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const af = db.afs.getById(id);
    if (!af) return reply.code(404).send({ detail: 'AF non trouvée' });
    const commits = await gitLib.listCommits(id);
    return { count: commits.length, commits };
  });

  // GET /api/afs/:id/versions/diff?from=<sha>&to=<sha>
  fastify.get('/afs/:id/versions/diff', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const { from, to } = request.query;
    if (!from || !to) return reply.code(400).send({ detail: 'from + to requis' });
    const diff = await gitLib.diffCommits(id, from, to);
    if (!diff) return reply.code(404).send({ detail: 'Commit(s) introuvable(s)' });
    return diff;
  });

  // POST /api/afs/:id/versions/restore { sha }
  fastify.post('/afs/:id/versions/restore', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const af = db.afs.getById(id);
    if (!af) return reply.code(404).send({ detail: 'AF non trouvée' });
    const { sha } = request.body || {};
    if (!sha) return reply.code(400).send({ detail: 'sha requis' });
    try {
      const result = await gitLib.restoreCommit(id, sha, { userId: request.authUser?.id });
      return { ok: true, ...result };
    } catch (e) {
      return reply.code(400).send({ detail: e.message });
    }
  });

  // POST /api/afs/:id/versions/checkpoint — commit manuel "checkpoint"
  fastify.post('/afs/:id/versions/checkpoint', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const af = db.afs.getById(id);
    if (!af) return reply.code(404).send({ detail: 'AF non trouvée' });
    const { message, tag } = request.body || {};
    try {
      const sha = await gitLib.commitAf(id, message || 'Checkpoint manuel', {
        tag: tag || null,
        author: request.authUser ? { name: request.authUser.display_name, email: request.authUser.email } : undefined,
      });
      if (!sha) return { ok: true, sha: null, message: 'Aucun changement à commiter' };
      db.auditLog.add({ afId: id, userId: request.authUser?.id, action: 'af.checkpoint', payload: { sha, message, tag } });
      return { ok: true, sha, sha_short: sha.slice(0, 7) };
    } catch (e) {
      return reply.code(500).send({ detail: e.message });
    }
  });
}

module.exports = routes;
