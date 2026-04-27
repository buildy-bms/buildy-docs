'use strict';

const { z } = require('zod');
const db = require('../database');
const log = require('../lib/logger').system;

const inspectionSchema = z.object({
  inspector_name: z.string().min(1, 'Nom de l\'inspecteur requis'),
  notes: z.string().optional(),
});

async function routes(fastify) {
  // GET /api/afs/:afId/inspections — historique des inspections
  fastify.get('/afs/:afId/inspections', async (request) => {
    const afId = parseInt(request.params.afId, 10);
    return db.afInspections.listByAf(afId);
  });

  // POST /api/afs/:afId/inspections — declenche une inspection
  // (genere un PDF AF horodate via le route export, puis insert dans af_inspections)
  fastify.post('/afs/:afId/inspections', async (request, reply) => {
    const afId = parseInt(request.params.afId, 10);
    const af = db.afs.getById(afId);
    if (!af || af.deleted_at) return reply.code(404).send({ detail: 'AF non trouvée' });
    if (!['livree', 'revision'].includes(af.status)) {
      return reply.code(400).send({ detail: 'L\'AF doit être livrée pour préparer une inspection' });
    }

    let body;
    try { body = inspectionSchema.parse(request.body); }
    catch (err) { return reply.code(400).send({ detail: err.errors?.[0]?.message || 'Validation' }); }

    const userId = request.authUser?.id;

    // 1. Genere le PDF AF en interne via require de la route export (pour reuser
    //    toute la logique). On appelle l'instance Fastify pour faire un sous-call.
    const inspectionDate = new Date().toISOString().slice(0, 10);
    const motif = `Inspection BACS du ${inspectionDate} — Inspecteur : ${body.inspector_name}`;

    // Re-injecte les headers d'auth (cookies) MAIS retire content-length
    // qui ne correspond plus au nouveau payload (FST_ERR_CTP_INVALID_CONTENT_LENGTH).
    const headers = { ...request.headers };
    delete headers['content-length'];
    delete headers['content-type']; // sera defini par fastify.inject avec le bon JSON
    const exportRes = await fastify.inject({
      method: 'POST',
      url: `/api/afs/${afId}/exports/af`,
      payload: { motif, includeBacsAnnex: true },
      headers,
    });

    if (exportRes.statusCode !== 200) {
      log.error(`Inspection : echec generation PDF (${exportRes.statusCode}): ${exportRes.body}`);
      return reply.code(500).send({ detail: 'Echec de la generation du PDF d\'inspection' });
    }
    const exportData = JSON.parse(exportRes.body);

    // 2. Insert dans af_inspections
    const gitTag = `inspection-${inspectionDate}-${body.inspector_name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30)}`;
    const inspection = db.afInspections.create(afId, {
      inspectorName: body.inspector_name,
      gitTag,
      pdfExportId: exportData.id,
      notes: body.notes,
      createdBy: userId,
    });

    // 3. Stamp last_inspection_at sur l'AF
    db.db.prepare("UPDATE afs SET last_inspection_at = CURRENT_TIMESTAMP WHERE id = ?").run(afId);

    db.auditLog.add({
      afId, userId, action: 'inspection.create',
      payload: { inspector_name: body.inspector_name, git_tag: gitTag, pdf_export_id: exportData.id },
    });
    log.info(`Inspection BACS #${inspection.id} pour AF #${afId} par ${body.inspector_name} (PDF #${exportData.id})`);

    return {
      inspection,
      pdf_export_id: exportData.id,
      pdf_download_url: `/api/exports/${exportData.id}/download`,
      service_level: exportData.service_level,
      sections_total: exportData.sections_total,
    };
  });
}

module.exports = routes;
