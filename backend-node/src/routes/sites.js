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
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
  // Cas exceptionnel : si FM cree un site et nous le pousse, il fournit son uuid
  site_uuid: z.string().uuid().optional(),
});

// Item 4a — structure juridique du site. Enum FERMÉ, synchro avec :
//   - le CHECK constraint de la migration 160 (database.js)
//   - OWNERSHIP_STRUCTURE_LABEL dans lib/bacs-liability.js (libellés FR)
//   - OWNERSHIP_STRUCTURES dans frontend/src/lib/audit-options.js
const OWNERSHIP_STRUCTURES = [
  'single_owner_occupant', 'condominium', 'owner_with_tenants',
  'multiple_independent_tenants', 'mixed',
];

// Item 4b — genres de partie prenante. Enum FERMÉ, synchro avec :
//   - le CHECK constraint de la migration 161 (database.js)
//   - PARTY_KIND_LABEL dans lib/bacs-liability.js (libellés FR)
//   - PARTY_KINDS dans frontend/src/lib/audit-options.js
const PARTY_KINDS = ['owner_occupant', 'co_owner', 'tenant', 'syndicate', 'network_operator'];

// Partie prenante par défaut proposée selon la structure juridique du site
// (item 4b — « au minimum 1 partie par défaut »).
const DEFAULT_PARTY_BY_STRUCTURE = {
  single_owner_occupant: { name: 'Propriétaire occupant', kind: 'owner_occupant' },
  condominium: { name: 'Syndicat de copropriété', kind: 'syndicate' },
  owner_with_tenants: { name: 'Propriétaire bailleur', kind: 'owner_occupant' },
  multiple_independent_tenants: { name: 'Propriétaire bailleur', kind: 'owner_occupant' },
  mixed: { name: 'Propriétaire', kind: 'owner_occupant' },
};

const updateSiteSchema = z.object({
  name: z.string().min(1).optional(),
  customer_name: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
  // Niveau de zoom satellite persisté par l'auditeur depuis le picker
  // (mig 188). Sert ensuite à cadrer la vue satellite du chap 1 du PDF.
  map_zoom: z.number().int().min(1).max(21).nullable().optional(),
  // Item 4a — structure juridique. PAS synchronisé avec Fleet Manager
  // (cf. lib/sites-sync.js serializeSite qui n'expose pas ces champs).
  ownership_structure: z.enum(OWNERSHIP_STRUCTURES).nullable().optional(),
  ownership_notes: z.string().nullable().optional(),
});

const createPartySchema = z.object({
  name: z.string().trim().min(1, 'Nom requis').max(160),
  kind: z.enum(PARTY_KINDS).optional(),
  contact_email: z.string().trim().max(200).nullable().optional(),
  notes: z.string().nullable().optional(),
  position: z.number().int().optional(),
});

const updatePartySchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  kind: z.enum(PARTY_KINDS).optional(),
  contact_email: z.string().trim().max(200).nullable().optional(),
  notes: z.string().nullable().optional(),
  position: z.number().int().optional(),
});

// Item 13 — types d'énergie de l'historique de consommation. Enum FERMÉ,
// synchro avec :
//   - le CHECK constraint de la migration 165 (database.js)
//   - ENERGY_HISTORY_TYPE_LABEL dans routes/bacs-audit/_labels.js (libellés FR)
//   - ENERGY_HISTORY_TYPES dans frontend/src/lib/audit-options.js
const ENERGY_HISTORY_TYPES = ['electricity', 'gas', 'fuel_oil', 'district_heating', 'other'];

// Une ligne mensuelle de consommation (saisie directe ou import bulk).
const energyHistoryRowSchema = z.object({
  energy_type: z.enum(ENERGY_HISTORY_TYPES),
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
  quantity: z.number().nullable().optional(),
  unit: z.string().trim().min(1).max(16).optional(),
  cost_eur: z.number().nullable().optional(),
  tenant_id: z.number().int().nullable().optional(),
  contract_label: z.string().trim().max(160).optional(),
  invoice_attachment_id: z.number().int().nullable().optional(),
});

const updateEnergyHistorySchema = z.object({
  energy_type: z.enum(ENERGY_HISTORY_TYPES).optional(),
  year: z.number().int().min(2000).max(2100).optional(),
  month: z.number().int().min(1).max(12).optional(),
  quantity: z.number().nullable().optional(),
  unit: z.string().trim().min(1).max(16).optional(),
  cost_eur: z.number().nullable().optional(),
  tenant_id: z.number().int().nullable().optional(),
  contract_label: z.string().trim().max(160).optional(),
  invoice_attachment_id: z.number().int().nullable().optional(),
});

// Import en lot : un tableau de lignes mensuelles (l'UI parse le collage
// Excel / le CSV côté client puis envoie les lignes structurées). L'upsert
// dédoublonne sur (site + energy_type + contract_label + year + month).
const bulkEnergyHistorySchema = z.object({
  rows: z.array(energyHistoryRowSchema).min(1).max(600),
});

const incomingSyncSchema = z.object({
  site_uuid: z.string().uuid(),
  name: z.string().min(1),
  customer_name: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
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

  // GET /api/sites/:uuid/overview — vue d'ensemble (hub de site) :
  // site + documents rattaches + zones + compteurs.
  fastify.get('/sites/:uuid/overview', async (request, reply) => {
    const site = db.sites.getByUuid(request.params.uuid);
    if (!site || site.deleted_at) return reply.code(404).send({ detail: 'Site non trouve' });
    const sid = site.site_id;
    const documents = db.db.prepare(`
      SELECT id, kind, project_name, client_name, status, updated_at, delivered_at
      FROM afs WHERE site_id = ? AND deleted_at IS NULL
      ORDER BY updated_at DESC
    `).all(sid);
    const zones = db.zones.listBySite(sid);
    const count = (sql) => db.db.prepare(sql).get(sid).c;
    return {
      site,
      documents,
      zones,
      counts: {
        af: documents.filter(d => d.kind === 'af').length,
        audit: documents.filter(d => d.kind === 'bacs_audit' || d.kind === 'site_audit').length,
        zones: zones.length,
        equipments: count(`SELECT COUNT(*) c FROM equipments e JOIN zones z ON z.id = e.zone_id
                           WHERE z.site_id = ? AND e.deleted_at IS NULL AND z.deleted_at IS NULL`),
        documents: count(`SELECT COUNT(*) c FROM site_documents WHERE site_id = ?`),
        photos: count(`SELECT COUNT(*) c FROM site_documents WHERE site_id = ? AND category = 'photo'`),
        voiceNotes: count(`SELECT COUNT(*) c FROM site_documents WHERE site_id = ? AND media_type = 'audio'`),
        credentials: count(`SELECT COUNT(*) c FROM site_credentials WHERE site_id = ?`),
      },
    };
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
      latitude: body.latitude ?? null,
      longitude: body.longitude ?? null,
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
      latitude: body.latitude,
      longitude: body.longitude,
      // Item 4a — colonnes locales Buildy Docs, non poussées vers FM.
      ownership_structure: body.ownership_structure,
      ownership_notes: body.ownership_notes,
      // Mig 188 — zoom satellite persisté (utilisé pour cadrer la vue du PDF).
      map_zoom: body.map_zoom,
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

  // ─── Parties prenantes du site (item 4b) ─────────────────────────
  // GET /api/sites/:uuid/parties — liste les parties prenantes.
  // Si le site n'a aucune partie, propose (sans persister) une partie
  // par défaut cohérente avec sa structure juridique.
  fastify.get('/sites/:uuid/parties', async (request, reply) => {
    const site = db.sites.getByUuid(request.params.uuid);
    if (!site || site.deleted_at) return reply.code(404).send({ detail: 'Site non trouve' });
    const parties = db.siteParties.listBySite(site.site_id);
    // Affectations zone × partie (item 5) — exposées par partie pour le
    // multi-select « affecter un occupant à plusieurs zones ».
    const zoneLinks = db.zoneParties.listBySite(site.site_id);
    const zonesByParty = {};
    for (const l of zoneLinks) {
      (zonesByParty[l.party_id] || (zonesByParty[l.party_id] = [])).push(l.zone_id);
    }
    for (const p of parties) p.zone_ids = zonesByParty[p.id] || [];
    let suggestion = null;
    if (!parties.length) {
      suggestion = DEFAULT_PARTY_BY_STRUCTURE[site.ownership_structure]
        || { name: 'Propriétaire', kind: 'owner_occupant' };
    }
    return { parties, suggestion };
  });

  // POST /api/sites/:uuid/parties — crée une partie prenante.
  fastify.post('/sites/:uuid/parties', async (request, reply) => {
    const site = db.sites.getByUuid(request.params.uuid);
    if (!site || site.deleted_at) return reply.code(404).send({ detail: 'Site non trouve' });
    let body;
    try { body = createPartySchema.parse(request.body); }
    catch (err) {
      return reply.code(400).send({ detail: err.errors?.[0]?.message || 'Validation echouee' });
    }
    const party = db.siteParties.create({
      siteId: site.site_id,
      name: body.name,
      kind: body.kind || 'owner_occupant',
      contactEmail: body.contact_email || null,
      notes: body.notes || null,
      position: body.position,
    });
    db.auditLog.add({
      userId: request.authUser?.id,
      action: 'site.party.create',
      payload: { site_uuid: site.site_uuid, party_id: party.id, name: party.name },
    });
    return reply.code(201).send(party);
  });

  // PATCH /api/site-parties/:id — modifie une partie prenante.
  fastify.patch('/site-parties/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const party = db.siteParties.getById(id);
    if (!party || party.deleted_at) return reply.code(404).send({ detail: 'Partie non trouvee' });
    let body;
    try { body = updatePartySchema.parse(request.body); }
    catch (err) {
      return reply.code(400).send({ detail: err.errors?.[0]?.message || 'Validation echouee' });
    }
    const updated = db.siteParties.update(id, body);
    db.auditLog.add({
      userId: request.authUser?.id,
      action: 'site.party.update',
      payload: { party_id: id, fields: Object.keys(body) },
    });
    return updated;
  });

  // DELETE /api/site-parties/:id — soft-delete d'une partie prenante.
  fastify.delete('/site-parties/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const party = db.siteParties.getById(id);
    if (!party) return reply.code(404).send({ detail: 'Partie non trouvee' });
    if (!party.deleted_at) {
      db.siteParties.softDelete(id);
      db.auditLog.add({
        userId: request.authUser?.id,
        action: 'site.party.delete',
        payload: { party_id: id },
      });
    }
    return reply.code(204).send();
  });

  // GET /api/site-parties/:id/zones — zones auxquelles la partie est affectée.
  fastify.get('/site-parties/:id/zones', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const party = db.siteParties.getById(id);
    if (!party || party.deleted_at) return reply.code(404).send({ detail: 'Partie non trouvee' });
    return db.zoneParties.listByParty(id);
  });

  // PUT /api/site-parties/:id/zones — remplace l'ensemble des zones d'une
  // partie prenante (item 5 — affecter un occupant à plusieurs zones d'un coup).
  fastify.put('/site-parties/:id/zones', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const party = db.siteParties.getById(id);
    if (!party || party.deleted_at) return reply.code(404).send({ detail: 'Partie non trouvee' });
    const schema = z.object({ zone_ids: z.array(z.number().int().positive()).default([]) });
    let body;
    try { body = schema.parse(request.body); }
    catch (err) {
      return reply.code(400).send({ detail: err.errors?.[0]?.message || 'Validation echouee' });
    }
    const links = db.zoneParties.setForParty(id, body.zone_ids);
    db.auditLog.add({
      userId: request.authUser?.id,
      action: 'site.party.zones.set',
      payload: { party_id: id, zone_ids: body.zone_ids },
    });
    return links;
  });

  // ─── Historique de consommation de référence (item 13) ───────────
  // GET /api/sites/:uuid/energy-history — liste les lignes mensuelles.
  fastify.get('/sites/:uuid/energy-history', async (request, reply) => {
    const site = db.sites.getByUuid(request.params.uuid);
    if (!site || site.deleted_at) return reply.code(404).send({ detail: 'Site non trouve' });
    return db.siteEnergyHistory.listBySite(site.site_id);
  });

  // POST /api/sites/:uuid/energy-history — crée une ligne mensuelle.
  fastify.post('/sites/:uuid/energy-history', async (request, reply) => {
    const site = db.sites.getByUuid(request.params.uuid);
    if (!site || site.deleted_at) return reply.code(404).send({ detail: 'Site non trouve' });
    let body;
    try { body = energyHistoryRowSchema.parse(request.body); }
    catch (err) {
      return reply.code(400).send({ detail: err.errors?.[0]?.message || 'Validation echouee' });
    }
    let row;
    try {
      row = db.siteEnergyHistory.create({
        siteId: site.site_id,
        energyType: body.energy_type,
        year: body.year, month: body.month,
        quantity: body.quantity ?? null,
        unit: body.unit || 'kWh',
        costEur: body.cost_eur ?? null,
        tenantId: body.tenant_id ?? null,
        contractLabel: body.contract_label || '',
        invoiceAttachmentId: body.invoice_attachment_id ?? null,
      });
    } catch (err) {
      // Violation de l'index d'unicité (ligne déjà saisie pour ce mois).
      if (/UNIQUE/i.test(err.message)) {
        return reply.code(409).send({ detail: 'Une consommation existe déjà pour ce contrat et ce mois.' });
      }
      throw err;
    }
    db.auditLog.add({
      userId: request.authUser?.id,
      action: 'site.energy_history.create',
      payload: { site_uuid: site.site_uuid, row_id: row.id },
    });
    return reply.code(201).send(row);
  });

  // POST /api/sites/:uuid/energy-history/bulk — import en lot (CSV / collage
  // Excel). Upsert par ligne sur la clé d'unicité : pas de doublons.
  fastify.post('/sites/:uuid/energy-history/bulk', async (request, reply) => {
    const site = db.sites.getByUuid(request.params.uuid);
    if (!site || site.deleted_at) return reply.code(404).send({ detail: 'Site non trouve' });
    let body;
    try { body = bulkEnergyHistorySchema.parse(request.body); }
    catch (err) {
      return reply.code(400).send({ detail: err.errors?.[0]?.message || 'Validation echouee' });
    }
    const tx = db.db.transaction(() => {
      let created = 0, updated = 0;
      for (const r of body.rows) {
        const existing = db.db.prepare(`
          SELECT id FROM site_energy_history
          WHERE site_id = ? AND energy_type = ? AND contract_label = ?
            AND year = ? AND month = ? AND deleted_at IS NULL
        `).get(site.site_id, r.energy_type, r.contract_label || '', r.year, r.month);
        db.siteEnergyHistory.upsert({
          siteId: site.site_id,
          energyType: r.energy_type,
          year: r.year, month: r.month,
          quantity: r.quantity ?? null,
          unit: r.unit || 'kWh',
          costEur: r.cost_eur ?? null,
          tenantId: r.tenant_id ?? null,
          contractLabel: r.contract_label || '',
          invoiceAttachmentId: r.invoice_attachment_id ?? null,
        });
        if (existing) updated++; else created++;
      }
      return { created, updated };
    });
    const result = tx();
    db.auditLog.add({
      userId: request.authUser?.id,
      action: 'site.energy_history.bulk_import',
      payload: { site_uuid: site.site_uuid, ...result, total: body.rows.length },
    });
    return { ...result, total: body.rows.length, rows: db.siteEnergyHistory.listBySite(site.site_id) };
  });

  // PATCH /api/site-energy-history/:id — modifie une ligne.
  fastify.patch('/site-energy-history/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const row = db.siteEnergyHistory.getById(id);
    if (!row || row.deleted_at) return reply.code(404).send({ detail: 'Consommation non trouvee' });
    let body;
    try { body = updateEnergyHistorySchema.parse(request.body); }
    catch (err) {
      return reply.code(400).send({ detail: err.errors?.[0]?.message || 'Validation echouee' });
    }
    let updated;
    try {
      updated = db.siteEnergyHistory.update(id, body);
    } catch (err) {
      if (/UNIQUE/i.test(err.message)) {
        return reply.code(409).send({ detail: 'Une consommation existe déjà pour ce contrat et ce mois.' });
      }
      throw err;
    }
    db.auditLog.add({
      userId: request.authUser?.id,
      action: 'site.energy_history.update',
      payload: { row_id: id, fields: Object.keys(body) },
    });
    return updated;
  });

  // DELETE /api/site-energy-history/:id — soft-delete d'une ligne.
  fastify.delete('/site-energy-history/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const row = db.siteEnergyHistory.getById(id);
    if (!row) return reply.code(404).send({ detail: 'Consommation non trouvee' });
    if (!row.deleted_at) {
      db.siteEnergyHistory.softDelete(id);
      db.auditLog.add({
        userId: request.authUser?.id,
        action: 'site.energy_history.delete',
        payload: { row_id: id },
      });
    }
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
module.exports.OWNERSHIP_STRUCTURES = OWNERSHIP_STRUCTURES;
module.exports.PARTY_KINDS = PARTY_KINDS;
module.exports.ENERGY_HISTORY_TYPES = ENERGY_HISTORY_TYPES;
