'use strict';

const crypto = require('crypto');
const { z } = require('zod');
const config = require('../config');
const db = require('../database');
const log = require('../lib/logger').system;
const sitesSync = require('../lib/sites-sync');

const createSiteSchema = z.object({
  name: z.string().min(1, 'Nom requis'),
  customer_name: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  // Cas exceptionnel : si FM cree un site et nous le pousse, il fournit son uuid
  site_uuid: z.string().uuid().optional(),
});

const updateSiteSchema = z.object({
  name: z.string().min(1).optional(),
  customer_name: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

const incomingSyncSchema = z.object({
  site_uuid: z.string().uuid(),
  name: z.string().min(1),
  customer_name: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  updated_at: z.string().optional(),
  deleted_at: z.string().nullable().optional(),
});

function verifyServiceToken(request, reply) {
  if (!config.buildySitesSyncToken) {
    return reply.code(503).send({ detail: 'Synchro sites desactivee (token non configure)' });
  }
  const auth = request.headers.authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(auth);
  if (!match || match[1] !== config.buildySitesSyncToken) {
    return reply.code(401).send({ detail: 'Token de service invalide' });
  }
  return null;
}

async function routes(fastify) {
  // GET /api/sites — liste (filtre recherche)
  fastify.get('/sites', async (request) => {
    const { search, includeDeleted } = request.query;
    return db.sites.list({
      search: search || undefined,
      includeDeleted: includeDeleted === 'true',
    });
  });

  // GET /api/sites/:uuid — detail
  fastify.get('/sites/:uuid', async (request, reply) => {
    const site = db.sites.getByUuid(request.params.uuid);
    if (!site || site.deleted_at) return reply.code(404).send({ detail: 'Site non trouve' });
    return site;
  });

  // POST /api/sites — creation locale + push vers FM (best-effort)
  fastify.post('/sites', async (request, reply) => {
    let body;
    try { body = createSiteSchema.parse(request.body); }
    catch (err) {
      return reply.code(400).send({ detail: err.errors?.[0]?.message || 'Validation echouee' });
    }
    const userId = request.authUser?.id;
    const siteUuid = body.site_uuid || crypto.randomUUID();
    if (db.sites.getByUuid(siteUuid)) {
      return reply.code(409).send({ detail: 'site_uuid deja existant' });
    }
    const site = db.sites.create({
      siteUuid,
      name: body.name,
      customerName: body.customer_name || null,
      address: body.address || null,
      notes: body.notes || null,
      createdBy: userId,
    });
    db.auditLog.add({ userId, action: 'site.create', payload: { site_uuid: siteUuid, name: body.name } });
    // Push asynchrone (ne bloque pas la reponse)
    sitesSync.pushSite(site).catch(e => log.warn(`pushSite post-create: ${e.message}`));
    return reply.code(201).send(site);
  });

  // PATCH /api/sites/:uuid — modification locale + push
  fastify.patch('/sites/:uuid', async (request, reply) => {
    const site = db.sites.getByUuid(request.params.uuid);
    if (!site || site.deleted_at) return reply.code(404).send({ detail: 'Site non trouve' });
    let body;
    try { body = updateSiteSchema.parse(request.body); }
    catch (err) {
      return reply.code(400).send({ detail: err.errors?.[0]?.message || 'Validation echouee' });
    }
    const userId = request.authUser?.id;
    const updated = db.sites.update(site.site_id, {
      name: body.name,
      customerName: body.customer_name,
      address: body.address,
      notes: body.notes,
      updatedBy: userId,
    });
    db.auditLog.add({ userId, action: 'site.update', payload: { site_uuid: site.site_uuid, fields: Object.keys(body) } });
    sitesSync.pushSite(updated).catch(e => log.warn(`pushSite post-update: ${e.message}`));
    return updated;
  });

  // DELETE /api/sites/:uuid — soft delete + push
  fastify.delete('/sites/:uuid', async (request, reply) => {
    const site = db.sites.getByUuid(request.params.uuid);
    if (!site) return reply.code(404).send({ detail: 'Site non trouve' });
    if (site.deleted_at) return reply.code(204).send();
    const userId = request.authUser?.id;
    db.sites.softDelete(site.site_id);
    const fresh = db.sites.getById(site.site_id);
    db.auditLog.add({ userId, action: 'site.delete', payload: { site_uuid: site.site_uuid } });
    sitesSync.pushSite(fresh).catch(e => log.warn(`pushSite post-delete: ${e.message}`));
    return reply.code(204).send();
  });

  // POST /api/sites/sync — endpoint reciproque pour Fleet Manager
  // Auth Bearer (BUILDY_SITES_SYNC_TOKEN), bypassee dans le hook global
  fastify.post('/sites/sync', async (request, reply) => {
    const tokenError = verifyServiceToken(request, reply);
    if (tokenError) return tokenError;
    let body;
    try { body = incomingSyncSchema.parse(request.body); }
    catch (err) {
      return reply.code(400).send({ detail: err.errors?.[0]?.message || 'Validation echouee' });
    }
    const result = sitesSync.applyIncomingSync(body);
    if (result.error) return reply.code(400).send({ detail: result.error });
    log.info(`Sync entrante (FM) site ${body.site_uuid} : ${result.action}`);
    return result;
  });
}

module.exports = routes;
