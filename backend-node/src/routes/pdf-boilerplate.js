'use strict';

// Routes admin pour le boilerplate des PDFs (methodologie + disclaimers)
// editables via l'UI au lieu d'etre hardcodes en code.

const { z } = require('zod');
const db = require('../database');
const log = require('../lib/logger').system;

const KIND_VALUES = ['methodology', 'disclaimer'];

const itemCreateSchema = z.object({
  kind: z.enum(KIND_VALUES),
  position: z.number().int().optional(),
  title: z.string().nullable().optional(),
  body_html: z.string().min(1, 'Contenu requis'),
});

const itemUpdateSchema = z.object({
  position: z.number().int().optional(),
  title: z.string().nullable().optional(),
  body_html: z.string().min(1).optional(),
  is_active: z.boolean().optional(),
});

async function routes(fastify) {
  // GET /api/pdf-boilerplate?kind=methodology|disclaimer
  fastify.get('/pdf-boilerplate', async (request) => {
    const kind = request.query.kind || null;
    return db.pdfBoilerplate.list({ kind, includeInactive: true });
  });

  fastify.post('/pdf-boilerplate', async (request, reply) => {
    let body;
    try { body = itemCreateSchema.parse(request.body); }
    catch (e) { return reply.code(400).send({ detail: e.errors?.[0]?.message }); }
    const userId = request.authUser?.id || null;
    const item = db.pdfBoilerplate.create({
      kind: body.kind,
      position: body.position ?? 999,
      title: body.title ?? null,
      bodyHtml: body.body_html,
      updatedBy: userId,
    });
    db.auditLog.add({ userId, action: 'pdf_boilerplate.create',
      payload: { id: item.id, kind: item.kind } });
    return item;
  });

  fastify.patch('/pdf-boilerplate/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const existing = db.pdfBoilerplate.getById(id);
    if (!existing) return reply.code(404).send({ detail: 'Item non trouvé' });
    let body;
    try { body = itemUpdateSchema.parse(request.body); }
    catch (e) { return reply.code(400).send({ detail: e.errors?.[0]?.message }); }
    const userId = request.authUser?.id || null;
    const item = db.pdfBoilerplate.update(id, {
      position: body.position,
      title: body.title,
      bodyHtml: body.body_html,
      isActive: body.is_active,
      updatedBy: userId,
    });
    db.auditLog.add({ userId, action: 'pdf_boilerplate.update',
      payload: { id, kind: item.kind, fields: Object.keys(body) } });
    return item;
  });

  fastify.delete('/pdf-boilerplate/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const existing = db.pdfBoilerplate.getById(id);
    if (!existing) return reply.code(404).send({ detail: 'Item non trouvé' });
    db.pdfBoilerplate.remove(id);
    db.auditLog.add({ userId: request.authUser?.id, action: 'pdf_boilerplate.delete',
      payload: { id, kind: existing.kind } });
    return reply.code(204).send();
  });
}

module.exports = routes;
