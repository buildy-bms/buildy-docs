'use strict';

const { z } = require('zod');
const db = require('../database');
const log = require('../lib/logger').system;
const { encrypt, decrypt } = require('../lib/crypto');

const CREDENTIAL_TYPES = ['web','ssh','vpn','snmp','rdp','autre'];

function shapeWithoutPassword(row) {
  const { password_encrypted, ...rest } = row;
  return { ...rest, has_password: !!password_encrypted };
}

async function routes(fastify) {
  // GET /sites/:uuid/credentials — liste sans password en clair
  fastify.get('/sites/:uuid/credentials', async (request, reply) => {
    const site = db.sites.getByUuid(request.params.uuid);
    if (!site || site.deleted_at) return reply.code(404).send({ detail: 'Site non trouve' });
    const rows = db.db.prepare(`
      SELECT c.* FROM site_credentials c
      WHERE c.site_id = ?
      ORDER BY c.type, c.title
    `).all(site.site_id);
    return rows.map(shapeWithoutPassword);
  });

  // POST /sites/:uuid/credentials
  fastify.post('/sites/:uuid/credentials', async (request, reply) => {
    const site = db.sites.getByUuid(request.params.uuid);
    if (!site || site.deleted_at) return reply.code(404).send({ detail: 'Site non trouve' });
    const schema = z.object({
      title: z.string().min(1),
      type: z.enum(CREDENTIAL_TYPES),
      url: z.string().nullable().optional(),
      username: z.string().nullable().optional(),
      password: z.string().nullable().optional(),
      notes: z.string().nullable().optional(),
      bacs_audit_system_id: z.number().int().nullable().optional(),
      bacs_audit_bms_document_id: z.number().int().nullable().optional(),
    });
    let body;
    try { body = schema.parse(request.body); }
    catch (e) { return reply.code(400).send({ detail: e.errors?.[0]?.message }); }
    const userId = request.authUser?.id;
    const r = db.db.prepare(`
      INSERT INTO site_credentials
        (site_id, title, type, url, username, password_encrypted, notes,
         bacs_audit_system_id, bacs_audit_bms_document_id, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      site.site_id, body.title, body.type,
      body.url || null, body.username || null,
      body.password ? encrypt(body.password) : null,
      body.notes || null,
      body.bacs_audit_system_id || null, body.bacs_audit_bms_document_id || null,
      userId || null,
    );
    db.auditLog.add({ userId, action: 'site_credential.create',
      payload: { site_uuid: site.site_uuid, title: body.title, type: body.type } });
    return reply.code(201).send(shapeWithoutPassword(
      db.db.prepare('SELECT * FROM site_credentials WHERE id = ?').get(r.lastInsertRowid)
    ));
  });

  // PATCH /site-credentials/:id
  fastify.patch('/site-credentials/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const cred = db.db.prepare('SELECT * FROM site_credentials WHERE id = ?').get(id);
    if (!cred) return reply.code(404).send({ detail: 'Credential non trouve' });
    const schema = z.object({
      title: z.string().min(1).optional(),
      type: z.enum(CREDENTIAL_TYPES).optional(),
      url: z.string().nullable().optional(),
      username: z.string().nullable().optional(),
      password: z.string().nullable().optional(),
      notes: z.string().nullable().optional(),
      bacs_audit_system_id: z.number().int().nullable().optional(),
      bacs_audit_bms_document_id: z.number().int().nullable().optional(),
    });
    let body;
    try { body = schema.parse(request.body); }
    catch (e) { return reply.code(400).send({ detail: e.errors?.[0]?.message }); }
    const sets = [], args = [];
    for (const [k, v] of Object.entries(body)) {
      if (v === undefined) continue;
      if (k === 'password') {
        sets.push('password_encrypted = ?');
        args.push(v ? encrypt(v) : null);
      } else {
        sets.push(`${k} = ?`); args.push(v);
      }
    }
    if (sets.length) {
      sets.push('updated_at = CURRENT_TIMESTAMP');
      args.push(id);
      db.db.prepare(`UPDATE site_credentials SET ${sets.join(', ')} WHERE id = ?`).run(...args);
    }
    db.auditLog.add({ userId: request.authUser?.id, action: 'site_credential.update',
      payload: { id, fields: Object.keys(body) } });
    return shapeWithoutPassword(db.db.prepare('SELECT * FROM site_credentials WHERE id = ?').get(id));
  });

  // GET /site-credentials/:id/reveal — dechiffre password (audit log)
  fastify.get('/site-credentials/:id/reveal', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const cred = db.db.prepare('SELECT * FROM site_credentials WHERE id = ?').get(id);
    if (!cred) return reply.code(404).send({ detail: 'Credential non trouve' });
    if (!cred.password_encrypted) return { password: null };
    let password;
    try { password = decrypt(cred.password_encrypted); }
    catch (e) {
      log.error(`Dechiffrement credential #${id} echoue : ${e.message}`);
      return reply.code(500).send({ detail: 'Dechiffrement impossible' });
    }
    db.auditLog.add({ userId: request.authUser?.id, action: 'site_credential.reveal',
      payload: { credential_id: id, title: cred.title } });
    return { password };
  });

  // DELETE /site-credentials/:id
  fastify.delete('/site-credentials/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const cred = db.db.prepare('SELECT * FROM site_credentials WHERE id = ?').get(id);
    if (!cred) return reply.code(404).send({ detail: 'Credential non trouve' });
    db.db.prepare('DELETE FROM site_credentials WHERE id = ?').run(id);
    db.auditLog.add({ userId: request.authUser?.id, action: 'site_credential.delete',
      payload: { id, title: cred.title } });
    return reply.code(204).send();
  });
}

module.exports = routes;
