'use strict';

/**
 * Synchro bidirectionnelle sites <-> Fleet Manager.
 *
 * - `pushSite(site)` : envoie un site vers FM. En cas d'echec reseau, place
 *   en queue et le worker `runSyncWorker()` retentera plus tard.
 * - `applyIncomingSync(payload)` : applique localement un changement recu de
 *   FM (last-write-wins basé sur updated_at).
 * - `serializeSite(site)` : forme du payload sur le wire.
 */

const config = require('../config');
const db = require('../database');
const log = require('./logger').system;

function serializeSite(site) {
  return {
    site_uuid: site.site_uuid,
    name: site.name,
    customer_name: site.customer_name,
    address: site.address,
    notes: site.notes,
    updated_at: site.updated_at,
    deleted_at: site.deleted_at,
  };
}

/**
 * Pousse un site vers FM. Si FM_SYNC_URL ou token non configure, no-op.
 * En cas d'erreur reseau / non-2xx, ajoute a la queue de retry.
 */
async function pushSite(site) {
  if (!config.fmSyncUrl || !config.buildySitesSyncToken) return { skipped: true };
  const payload = serializeSite(site);
  try {
    const res = await fetch(`${config.fmSyncUrl.replace(/\/$/, '')}/api/sites/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.buildySitesSyncToken}`,
        'Idempotency-Key': `${payload.site_uuid}:${payload.updated_at || ''}`,
      },
      body: JSON.stringify(payload),
      // Timeout court : on prefere requeue plutot que bloquer la requete user
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`FM sync HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    db.sites.update(site.site_id, { syncedAt: new Date().toISOString() });
    return { ok: true };
  } catch (e) {
    log.warn(`Sync FM differe pour site ${site.site_uuid} : ${e.message}`);
    db.sitesSyncQueue.enqueue(site.site_uuid, payload);
    return { ok: false, queued: true, error: e.message };
  }
}

/**
 * Applique un payload recu de FM. Last-write-wins :
 * - site inexistant -> create
 * - site existe + updated_at recu >= local -> update
 * - sinon -> ignore
 */
function applyIncomingSync(payload) {
  if (!payload?.site_uuid || !payload?.name) {
    return { error: 'site_uuid et name requis' };
  }
  const existing = db.sites.getByUuid(payload.site_uuid);
  if (!existing) {
    const created = db.sites.create({
      siteUuid: payload.site_uuid,
      name: payload.name,
      customerName: payload.customer_name || null,
      address: payload.address || null,
      notes: payload.notes || null,
      syncedAt: new Date().toISOString(),
    });
    if (payload.deleted_at) db.sites.softDelete(created.site_id);
    return { action: 'created', site_id: created.site_id };
  }
  // Last-write-wins : compare updated_at
  const incomingTs = payload.updated_at ? Date.parse(payload.updated_at) : 0;
  const localTs = existing.updated_at ? Date.parse(existing.updated_at) : 0;
  if (incomingTs < localTs) {
    return { action: 'ignored', reason: 'local_newer' };
  }
  db.sites.update(existing.site_id, {
    name: payload.name,
    customerName: payload.customer_name ?? null,
    address: payload.address ?? null,
    notes: payload.notes ?? null,
    syncedAt: new Date().toISOString(),
    deletedAt: payload.deleted_at || null,
  });
  return { action: 'updated', site_id: existing.site_id };
}

/**
 * Worker : retente les syncs en queue. Backoff exponentiel via reschedule.
 */
async function runSyncWorker() {
  if (!config.fmSyncUrl || !config.buildySitesSyncToken) return;
  const items = db.sitesSyncQueue.dueNow(20);
  if (!items.length) return;
  for (const item of items) {
    try {
      const res = await fetch(`${config.fmSyncUrl.replace(/\/$/, '')}/api/sites/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.buildySitesSyncToken}`,
          'Idempotency-Key': `${item.payload.site_uuid}:${item.payload.updated_at || ''}`,
        },
        body: JSON.stringify(item.payload),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      db.sitesSyncQueue.remove(item.id);
      const site = db.sites.getByUuid(item.payload.site_uuid);
      if (site) db.sites.update(site.site_id, { syncedAt: new Date().toISOString() });
    } catch (e) {
      // Backoff : 1min, 5min, 30min, 2h, capped 6h
      const delays = [60, 300, 1800, 7200, 21600];
      const delay = delays[Math.min(item.attempts, delays.length - 1)];
      db.sitesSyncQueue.reschedule(item.id, { error: e.message, delaySeconds: delay });
      log.warn(`Sync FM retry ${item.attempts + 1} echoue pour ${item.payload.site_uuid} : ${e.message}`);
    }
  }
}

function startSyncWorker() {
  if (!config.fmSyncUrl || !config.buildySitesSyncToken) {
    log.info('Synchro sites FM desactivee (FM_SYNC_URL ou BUILDY_SITES_SYNC_TOKEN manquants)');
    return null;
  }
  // Tick rapide au boot puis toutes les minutes
  setTimeout(() => runSyncWorker().catch(e => log.warn(`Sync worker boot tick: ${e.message}`)), 5000);
  return setInterval(() => {
    runSyncWorker().catch(e => log.warn(`Sync worker tick: ${e.message}`));
  }, 60_000);
}

module.exports = {
  serializeSite,
  pushSite,
  applyIncomingSync,
  runSyncWorker,
  startSyncWorker,
};
