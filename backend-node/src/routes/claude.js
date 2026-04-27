'use strict';

const config = require('../config');
const db = require('../database');
const log = require('../lib/logger').system;
const { streamSection } = require('../lib/claude');

async function routes(fastify) {
  // GET /api/claude/health
  fastify.get('/claude/health', async () => ({
    enabled: !!config.anthropicApiKey,
    model: config.claudeModel,
  }));

  // POST /api/sections/:id/claude/draft  body: { instruction? }
  // Repond en SSE : data: {"text": "..."} pour chaque chunk, puis data: {"done": true}.
  fastify.post('/sections/:id/claude/draft', async (request, reply) => {
    if (!config.anthropicApiKey) {
      return reply.code(503).send({ detail: 'Assistant Claude non configuré (ANTHROPIC_API_KEY manquant)' });
    }
    const sectionId = parseInt(request.params.id, 10);
    const section = db.sections.getById(sectionId);
    if (!section) return reply.code(404).send({ detail: 'Section non trouvée' });

    const instruction = request.body?.instruction || null;

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const send = (obj) => reply.raw.write(`data: ${JSON.stringify(obj)}\n\n`);
    let totalLen = 0;
    let aborted = false;
    request.raw.on('close', () => { aborted = true; });

    await streamSection(sectionId, {
      instruction,
      onText: (text) => {
        if (aborted) return;
        totalLen += text.length;
        send({ text });
      },
      onError: (err) => {
        log.error(`Claude stream error (section #${sectionId}) : ${err.message}`);
        if (!aborted) send({ error: err.message });
        reply.raw.end();
      },
      onDone: (meta) => {
        db.auditLog.add({
          afId: section.af_id, sectionId, userId: request.authUser?.id,
          action: 'claude.draft',
          payload: { instruction, length: totalLen, usage: meta.usage },
        });
        if (!aborted) send({ done: true, length: totalLen, usage: meta.usage });
        reply.raw.end();
      },
    });
    return reply;
  });
}

module.exports = routes;
