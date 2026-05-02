'use strict';

// Inspections periodiques R175-5-1 — trace les inspections officielles
// realisees par un tiers (rapport conserve 10 ans). Distinct de l'audit
// Buildy (qui est interne).

const { z } = require('zod');
const db = require('../../database');
const { regenerateActionItems } = require('../../lib/bacs-audit-action-generator');
const { assertBacsAuditExists } = require('./_shared');

const inspectionFields = z.object({
  last_inspection_date: z.string().nullable().optional(),
  last_inspection_inspector: z.string().nullable().optional(),
  last_inspection_report_filename: z.string().nullable().optional(),
  last_inspection_anomalies_html: z.string().nullable().optional(),
  last_inspection_recommendations_html: z.string().nullable().optional(),
  next_inspection_due_date: z.string().nullable().optional(),
  retained_until_date: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

async function routes(fastify) {
  fastify.get('/bacs-audit/:documentId/inspections', async (request, reply) => {
    const id = parseInt(request.params.documentId, 10);
    if (!assertBacsAuditExists(id, reply)) return;
    return db.db.prepare(`
      SELECT * FROM bacs_audit_inspections
      WHERE document_id = ?
      ORDER BY COALESCE(last_inspection_date, '1970') DESC
    `).all(id);
  });

  fastify.post('/bacs-audit/:documentId/inspections', async (request, reply) => {
    const documentId = parseInt(request.params.documentId, 10);
    if (!assertBacsAuditExists(documentId, reply)) return;
    let body;
    try { body = inspectionFields.parse(request.body || {}); }
    catch (e) { return reply.code(400).send({ detail: e.errors?.[0]?.message }); }
    const cols = Object.keys(body);
    const r = db.db.prepare(`
      INSERT INTO bacs_audit_inspections (document_id${cols.length ? ', ' + cols.join(', ') : ''})
      VALUES (?${cols.length ? ', ' + cols.map(() => '?').join(', ') : ''})
    `).run(documentId, ...cols.map(k => body[k]));
    regenerateActionItems(documentId);
    return reply.code(201).send(db.db.prepare('SELECT * FROM bacs_audit_inspections WHERE id = ?').get(r.lastInsertRowid));
  });

  fastify.patch('/bacs-audit/inspections/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const row = db.db.prepare('SELECT document_id FROM bacs_audit_inspections WHERE id = ?').get(id);
    if (!row) return reply.code(404).send({ detail: 'Inspection non trouvee' });
    let body;
    try { body = inspectionFields.parse(request.body); }
    catch (e) { return reply.code(400).send({ detail: e.errors?.[0]?.message }); }
    const sets = [], args = [];
    for (const [k, v] of Object.entries(body)) { sets.push(`${k} = ?`); args.push(v); }
    if (sets.length) {
      sets.push('updated_at = CURRENT_TIMESTAMP');
      args.push(id);
      db.db.prepare(`UPDATE bacs_audit_inspections SET ${sets.join(', ')} WHERE id = ?`).run(...args);
    }
    regenerateActionItems(row.document_id);
    return db.db.prepare('SELECT * FROM bacs_audit_inspections WHERE id = ?').get(id);
  });

  fastify.delete('/bacs-audit/inspections/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const row = db.db.prepare('SELECT document_id FROM bacs_audit_inspections WHERE id = ?').get(id);
    if (!row) return reply.code(404).send({ detail: 'Inspection non trouvee' });
    db.db.prepare('DELETE FROM bacs_audit_inspections WHERE id = ?').run(id);
    regenerateActionItems(row.document_id);
    return reply.code(204).send();
  });
}

module.exports = routes;
