'use strict';

// Transcripts Plaud Pro + suggestions Claude (B3 du plan virtual-karp).
// Upload du transcript -> genere des suggestions Claude -> l'auditeur les
// valide (apply) ou les rejette. apply = ecrit la valeur dans la DB.

const path = require('path');
const fs = require('fs');
const config = require('../../config');
const db = require('../../database');
const log = require('../../lib/logger').system;
const { assistTranscriptMapping } = require('../../lib/claude');
const { assertBacsAuditExists, loadRefsInputs, buildAuditRefs } = require('./_shared');

async function routes(fastify) {
  fastify.get('/bacs-audit/:documentId/transcripts', async (request, reply) => {
    const id = parseInt(request.params.documentId, 10);
    if (!assertBacsAuditExists(id, reply)) return;
    return db.db.prepare(
      'SELECT id, document_id, original_name, size_bytes, uploaded_at, suggestions_generated_at, suggestions_usage_input_tokens, suggestions_usage_output_tokens FROM bacs_audit_transcripts WHERE document_id = ? ORDER BY uploaded_at DESC'
    ).all(id);
  });

  fastify.post('/bacs-audit/:documentId/transcripts', async (request, reply) => {
    const documentId = parseInt(request.params.documentId, 10);
    if (!assertBacsAuditExists(documentId, reply)) return;
    const file = await request.file({ limits: { fileSize: 5 * 1024 * 1024 } });
    if (!file) return reply.code(400).send({ detail: 'Aucun fichier recu' });
    const buffer = await file.toBuffer();
    if (file.file.truncated) return reply.code(413).send({ detail: 'Transcript > 5 MB' });
    const text = buffer.toString('utf-8').slice(0, 200_000);
    const transcriptDir = path.resolve(config.attachmentsDir, '..', 'transcripts', String(documentId));
    fs.mkdirSync(transcriptDir, { recursive: true });
    const filename = `${Date.now()}-${(file.filename || 'transcript.txt').replace(/[^\w.-]/g, '_')}`;
    fs.writeFileSync(path.join(transcriptDir, filename), buffer);
    const r = db.db.prepare(`
      INSERT INTO bacs_audit_transcripts
        (document_id, filename, original_name, size_bytes, text_content, uploaded_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(documentId, filename, file.filename || null, buffer.length, text, request.authUser?.id || null);
    return reply.code(201).send(
      db.db.prepare('SELECT id, document_id, original_name, size_bytes, uploaded_at FROM bacs_audit_transcripts WHERE id = ?').get(r.lastInsertRowid)
    );
  });

  fastify.post('/bacs-audit/transcripts/:id/suggestions', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const tr = db.db.prepare('SELECT * FROM bacs_audit_transcripts WHERE id = ?').get(id);
    if (!tr) return reply.code(404).send({ detail: 'Transcript non trouve' });

    const inputs = loadRefsInputs(tr.document_id);
    const refs = buildAuditRefs(inputs);
    const skeleton = {
      zones: inputs.zones.map(z => ({ ref: refs.zones.get(z.zone_id)?.ref, name: z.name, nature: z.nature })),
      systems: inputs.systems.map(s => ({ ref: refs.systems.get(s.id)?.ref, category: s.system_category, zone_ref: refs.zones.get(s.zone_id)?.ref })),
      devices: inputs.devices.map(d => ({ ref: refs.devices.get(d.id)?.ref, name: d.name, brand: d.brand, model_reference: d.model_reference })),
      meters: inputs.meters.map(m => ({ ref: refs.meters.get(m.id)?.ref, usage: m.usage, type: m.meter_type })),
      thermal: inputs.thermal.map(t => ({ ref: refs.thermal.get(t.id)?.ref, zone_ref: refs.zones.get(t.zone_id)?.ref })),
    };

    let result;
    try { result = await assistTranscriptMapping({ skeleton, transcript: tr.text_content || '' }); }
    catch (e) {
      log.warn(`assistTranscriptMapping failed: ${e.message}`);
      return reply.code(502).send({ detail: 'Echec generation suggestions Claude' });
    }

    const refLookup = new Map();
    for (const k of ['zones','systems','devices','meters','thermal']) {
      for (const [rowId, info] of refs[k]) refLookup.set(info.ref, { kind: k.replace(/s$/, ''), id: rowId });
    }
    const insert = db.db.prepare(`
      INSERT INTO bacs_audit_suggestions
        (transcript_id, document_id, target_kind, target_id, target_ref,
         field_name, suggested_value, confidence, source_quote)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    let count = 0;
    const tx = db.db.transaction((items) => {
      for (const s of items) {
        const matched = s.target_ref ? refLookup.get(s.target_ref) : null;
        insert.run(
          tr.id, tr.document_id,
          matched?.kind || s.target_kind || 'unknown',
          matched?.id || null,
          s.target_ref || null,
          s.field_name || '',
          typeof s.suggested_value === 'string' ? s.suggested_value : JSON.stringify(s.suggested_value ?? null),
          typeof s.confidence === 'number' ? s.confidence : null,
          s.source_quote || null,
        );
        count++;
      }
    });
    tx(result.suggestions || []);

    db.db.prepare(`
      UPDATE bacs_audit_transcripts
      SET suggestions_generated_at = CURRENT_TIMESTAMP,
          suggestions_usage_input_tokens = ?,
          suggestions_usage_output_tokens = ?
      WHERE id = ?
    `).run(result.usage?.input_tokens || null, result.usage?.output_tokens || null, tr.id);

    return reply.code(201).send({ count, usage: result.usage });
  });

  fastify.get('/bacs-audit/:documentId/suggestions', async (request, reply) => {
    const id = parseInt(request.params.documentId, 10);
    if (!assertBacsAuditExists(id, reply)) return;
    const status = request.query.status;
    const sql = `SELECT * FROM bacs_audit_suggestions WHERE document_id = ?` +
                (status ? ` AND status = ?` : ``) +
                ` ORDER BY created_at DESC`;
    return db.db.prepare(sql).all(...(status ? [id, status] : [id]));
  });

  // Applique une suggestion -> ecrit la valeur dans la table cible.
  fastify.post('/bacs-audit/suggestions/:id/apply', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const sug = db.db.prepare('SELECT * FROM bacs_audit_suggestions WHERE id = ?').get(id);
    if (!sug) return reply.code(404).send({ detail: 'Suggestion non trouvee' });
    if (sug.status === 'applied') return reply.send(sug);
    const TABLE_OF_KIND = {
      system: 'bacs_audit_systems',
      device: 'bacs_audit_system_devices',
      meter: 'bacs_audit_meters',
      thermal: 'bacs_audit_thermal_regulation',
      zone: 'zones',
    };
    const table = TABLE_OF_KIND[sug.target_kind];
    if (!table || !sug.target_id || !sug.field_name) {
      return reply.code(400).send({ detail: 'Suggestion non applicable automatiquement' });
    }
    const cols = db.db.prepare(`PRAGMA table_info(${table})`).all().map(r => r.name);
    if (!cols.includes(sug.field_name)) {
      return reply.code(400).send({ detail: `Colonne ${sug.field_name} absente de ${table}` });
    }
    const pkCol = table === 'zones' ? 'zone_id' : 'id';
    db.db.prepare(`UPDATE ${table} SET ${sug.field_name} = ? WHERE ${pkCol} = ?`)
      .run(sug.suggested_value, sug.target_id);
    db.db.prepare(`UPDATE bacs_audit_suggestions SET status = 'applied', decided_at = CURRENT_TIMESTAMP, decided_by = ? WHERE id = ?`)
      .run(request.authUser?.id || null, id);
    return db.db.prepare('SELECT * FROM bacs_audit_suggestions WHERE id = ?').get(id);
  });

  fastify.post('/bacs-audit/suggestions/:id/reject', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const sug = db.db.prepare('SELECT id FROM bacs_audit_suggestions WHERE id = ?').get(id);
    if (!sug) return reply.code(404).send({ detail: 'Suggestion non trouvee' });
    db.db.prepare(`UPDATE bacs_audit_suggestions SET status = 'rejected', decided_at = CURRENT_TIMESTAMP, decided_by = ? WHERE id = ?`)
      .run(request.authUser?.id || null, id);
    return db.db.prepare('SELECT * FROM bacs_audit_suggestions WHERE id = ?').get(id);
  });
}

module.exports = routes;
