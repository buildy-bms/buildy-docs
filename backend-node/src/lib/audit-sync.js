'use strict';

/**
 * Consolidation de l'audit trail Buildy Docs vers Fleet Manager.
 *
 * Push unidirectionnel cursor-based : a chaque tick, on prend les events
 * audit_log dont id > last_id (stocke dans audit_sync_state), on les
 * envoie en batch au FM via POST /api/fleet/docs-audit-batch (Bearer),
 * et on avance le curseur sur succes.
 *
 * Idempotence garantie cote FM par l'index unique partiel
 * (bt_audit_epoch, bt_audit_id) WHERE source='docs'. Rejeu sans
 * consequence : les events deja vus ont changes=0.
 *
 * Pas de queue de retry : les events ne sont jamais supprimes de
 * audit_log, donc un echec laisse simplement le curseur en place et le
 * prochain tick reessaie.
 */

const { Agent } = require('undici');
const config = require('../config');
const db = require('../database');
const log = require('./logger').system;

// FM utilise un cert auto-signe en prod (acces NetBird).
const INSECURE_DISPATCHER = new Agent({ connect: { rejectUnauthorized: false } });

const BATCH_SIZE = 500;
const TICK_INTERVAL_MS = 60_000;
const BOOT_DELAY_MS = 5_000;

function isConfigured() {
  return Boolean(config.fmSyncUrl && config.buildyDocsAuditToken);
}

function serializeEvent(row) {
  let payload = null;
  if (row.payload) {
    try { payload = JSON.parse(row.payload); }
    catch { payload = row.payload; }
  }
  return {
    id: row.id,
    created_at: row.created_at,
    action: row.action,
    username: row.username || null,
    af_id: row.af_id ?? null,
    section_id: row.section_id ?? null,
    template_id: row.template_id ?? null,
    site_uuid: row.site_uuid || null,
    payload,
  };
}

async function pushBatch(epoch, events) {
  const min_id = events[0].id;
  const max_id = events[events.length - 1].id;
  const body = {
    epoch,
    min_id,
    max_id,
    count: events.length,
    events: events.map(serializeEvent),
  };
  const url = `${config.fmSyncUrl.replace(/\/$/, '')}/api/fleet/docs-audit-batch`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.buildyDocsAuditToken}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
    dispatcher: INSECURE_DISPATCHER,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const result = await res.json().catch(() => ({}));
  return { min_id, max_id, ...result };
}

async function runOnce() {
  if (!isConfigured()) return;
  const state = db.auditSync.getOrInit();
  const rows = db.auditSync.fetchBatch(state.last_id, BATCH_SIZE);
  if (!rows.length) return;
  try {
    const { min_id, max_id, inserted, ignored } = await pushBatch(state.epoch, rows);
    db.auditSync.setLastId(max_id);
    log.info(`[audit-sync] pushed ${rows.length} events (id ${min_id}..${max_id}) inserted=${inserted} ignored=${ignored}`);
  } catch (e) {
    log.warn(`[audit-sync] push echoue (cursor ${state.last_id}, ${rows.length} events) : ${e.message}`);
    // Pas d'avancement du curseur : prochain tick retentera.
  }
}

function startSyncWorker() {
  if (!isConfigured()) {
    log.info('Consolidation audit trail vers FM desactivee (FM_SYNC_URL ou BUILDY_DOCS_AUDIT_TOKEN manquants)');
    return null;
  }
  setTimeout(() => runOnce().catch(e => log.warn(`[audit-sync] boot tick: ${e.message}`)), BOOT_DELAY_MS);
  const handle = setInterval(() => {
    runOnce().catch(e => log.warn(`[audit-sync] tick: ${e.message}`));
  }, TICK_INTERVAL_MS);
  log.info(`Consolidation audit trail vers FM active (tick ${TICK_INTERVAL_MS / 1000}s, batch ${BATCH_SIZE})`);
  return handle;
}

module.exports = {
  startSyncWorker,
  runOnce,
};
