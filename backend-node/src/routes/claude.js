'use strict';

const config = require('../config');
const db = require('../database');
const log = require('../lib/logger').system;
const { streamSection, assistLibrary } = require('../lib/claude');

async function routes(fastify) {
  // GET /api/claude/health
  fastify.get('/claude/health', async () => ({
    enabled: !!config.anthropicApiKey,
    model: config.claudeModel,
  }));

  // GET /api/claude/usage — agrege depuis audit_log les tokens consommes
  // par les actions Claude (30 derniers jours). Couts estimes Sonnet 4.6 :
  // 3$/MTok input + 15$/MTok output, conversion USD/EUR ~0.92.
  fastify.get('/claude/usage', async () => {
    const rows = db.db.prepare(`
      SELECT payload FROM audit_log
      WHERE (action LIKE 'claude.%' OR action LIKE 'bacs_audit.synthesis%'
             OR action LIKE 'bacs_audit.action_alternatives%')
        AND created_at >= date('now', '-30 days')
    `).all();
    let inputTokens = 0, outputTokens = 0, requests = 0;
    for (const r of rows) {
      try {
        const p = JSON.parse(r.payload || '{}');
        const u = p.usage || {};
        inputTokens += (u.input_tokens || 0) + (u.cache_read_input_tokens || 0);
        outputTokens += u.output_tokens || 0;
        if (u.input_tokens || u.output_tokens) requests++;
      } catch { /* ignore parse */ }
    }
    const costUsd = (inputTokens / 1_000_000) * 3 + (outputTokens / 1_000_000) * 15;
    const costEur = costUsd * 0.92;
    const avgCostEur = requests > 0 ? costEur / requests : 0;
    return {
      window_days: 30,
      requests,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cost_eur: Math.round(costEur * 100) / 100,
      avg_cost_eur: Math.round(avgCostEur * 1000) / 1000,
    };
  });

  // POST /api/claude/library-assist
  // body: {
  //   mode: 'generate' | 'reformulate',
  //   kind: 'narrative_section' | 'functionality' | 'equipment_description' | 'equipment_bacs_justification',
  //   title?, html?, parent_path?, category_label?, bacs_articles?,
  //   avail_e?, avail_s?, avail_p?
  // }
  // Renvoie { html, usage }. Couvre les editeurs de la bibliotheque uniquement
  // (sections types narratives, fonctionnalites, modeles d'equipement).
  fastify.post('/claude/library-assist', async (request, reply) => {
    if (!config.anthropicApiKey) {
      return reply.code(503).send({ detail: 'Assistant Claude non configuré (ANTHROPIC_API_KEY manquant)' });
    }
    const body = request.body || {};
    if (!['generate', 'reformulate'].includes(body.mode)) {
      return reply.code(400).send({ detail: 'mode requis : generate ou reformulate' });
    }
    if (body.mode === 'reformulate' && !(body.html || '').trim()) {
      return reply.code(400).send({ detail: 'Aucun texte à reformuler' });
    }

    try {
      const { html: out, usage } = await assistLibrary(body);
      db.auditLog.add({
        userId: request.authUser?.id,
        action: 'claude.library-assist',
        payload: {
          mode: body.mode, kind: body.kind, title: body.title,
          length_in: (body.html || '').length, length_out: out.length, usage,
        },
      });
      return { html: out, usage };
    } catch (err) {
      log.error(`Claude library-assist error: ${err.message}`);
      return reply.code(500).send({ detail: err.message || 'Échec de la requête Claude' });
    }
  });

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
