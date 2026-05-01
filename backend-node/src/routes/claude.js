'use strict';

const config = require('../config');
const db = require('../database');
const log = require('../lib/logger').system;
const { streamSection, assistLibrary } = require('../lib/claude');

// Tarifs Sonnet 4.6 (USD/MTok) :
//   - input            : 3.00
//   - cache write 5min : 3.75 (1.25x input)
//   - cache read       : 0.30 (0.10x input)
//   - output           : 15.00
// Conversion USD -> EUR utilisee partout : 0.92.
const USD_EUR = 0.92;
function costEurFromUsage(u = {}) {
  const inp = (u.input_tokens || 0) / 1_000_000;
  const cw  = (u.cache_creation_input_tokens || 0) / 1_000_000;
  const cr  = (u.cache_read_input_tokens || 0) / 1_000_000;
  const out = (u.output_tokens || 0) / 1_000_000;
  const usd = inp * 3 + cw * 3.75 + cr * 0.30 + out * 15;
  return usd * USD_EUR;
}

async function routes(fastify) {
  // GET /api/claude/health
  fastify.get('/claude/health', async () => ({
    enabled: !!config.anthropicApiKey,
    model: config.claudeModel,
  }));

  // GET /api/claude/usage — agrege depuis audit_log les tokens consommes
  // par les actions Claude. Renvoie aussi le cumul mensuel (mois en cours)
  // et le credit restant si CLAUDE_MONTHLY_BUDGET_EUR est configure.
  fastify.get('/claude/usage', async () => {
    const rows30 = db.db.prepare(`
      SELECT payload, created_at FROM audit_log
      WHERE (action LIKE 'claude.%' OR action LIKE 'bacs_audit.synthesis%'
             OR action LIKE 'bacs_audit.action_alternatives%')
        AND created_at >= date('now', '-30 days')
    `).all();
    let inputTokens = 0, outputTokens = 0, requests = 0;
    let costEur30 = 0, costEurMonth = 0;
    const monthStart = new Date();
    monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    for (const r of rows30) {
      try {
        const p = JSON.parse(r.payload || '{}');
        const u = p.usage || {};
        if (!(u.input_tokens || u.output_tokens)) continue;
        inputTokens += (u.input_tokens || 0) + (u.cache_read_input_tokens || 0);
        outputTokens += u.output_tokens || 0;
        requests++;
        const c = costEurFromUsage(u);
        costEur30 += c;
        if (new Date(r.created_at) >= monthStart) costEurMonth += c;
      } catch { /* ignore parse */ }
    }
    const avgCostEur = requests > 0 ? costEur30 / requests : 0;
    const budget = config.claudeMonthlyBudgetEur || 0;
    const remainingEur = budget > 0 ? Math.max(0, budget - costEurMonth) : null;
    return {
      window_days: 30,
      requests,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cost_eur: Math.round(costEur30 * 100) / 100,
      avg_cost_eur: Math.round(avgCostEur * 1000) / 1000,
      month_cost_eur: Math.round(costEurMonth * 100) / 100,
      monthly_budget_eur: budget || null,
      remaining_eur: remainingEur !== null ? Math.round(remainingEur * 100) / 100 : null,
    };
  });

  // POST /api/claude/library-assist
  // body: {
  //   mode: 'generate' | 'reformulate',
  //   kind: 'narrative_section' | 'functionality' | 'equipment_description' | 'equipment_bacs_justification',
  //   title?, html?, parent_path?, category_label?, bacs_articles?,
  //   avail_e?, avail_s?, avail_p?,
  //   current_template_id?, parent_template_id?, category?,
  //   library_context?: { enabled: boolean, strategy: 'neighbors'|'summary'|'full' }
  // }
  // Renvoie { html, usage, library_context }. Couvre les editeurs de la
  // bibliotheque uniquement (sections types narratives, fonctionnalites,
  // modeles d'equipement). Quand library_context.enabled est vrai, un bloc
  // system supplementaire est injecte avec le corpus existant pour ameliorer
  // la coherence cross-features.
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
    if (body.library_context && body.library_context.enabled) {
      const s = body.library_context.strategy;
      if (!['neighbors', 'summary', 'full'].includes(s)) {
        return reply.code(400).send({ detail: 'library_context.strategy invalide' });
      }
    }

    try {
      const { html: out, usage, library_context } = await assistLibrary(body);
      const requestCostEur = Math.round(costEurFromUsage(usage) * 10000) / 10000;
      db.auditLog.add({
        userId: request.authUser?.id,
        action: 'claude.library-assist',
        payload: {
          mode: body.mode, kind: body.kind, title: body.title,
          length_in: (body.html || '').length, length_out: out.length, usage,
          library_context, cost_eur: requestCostEur,
        },
      });
      return { html: out, usage, library_context, cost_eur: requestCostEur };
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
