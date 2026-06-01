#!/usr/bin/env node
/**
 * Cleanup one-shot des FK incohérentes sur bacs_audit_thermal_regulation.
 *
 * 2 cas traités :
 *   1. Un device pointé par {generator,distribution,emission}_device_id
 *      qui appartient à un système d'autre zone ou d'autre catégorie
 *      que la régulation : FK reset à null.
 *   2. Un device pointé par *_regulation_device_id qui a
 *      regulation_integrated=1 (= autonome) : FK reset à null
 *      (contradiction sémantique avec « régulateur déporté »).
 *
 * Sécurité :
 *   - Pas de DELETE, uniquement des UPDATE qui mettent à null.
 *   - Mode dry-run par défaut. Passer --apply pour effectuer les UPDATEs.
 *   - Affiche un récap par audit avant/après.
 *
 * Usage :
 *   node scripts/cleanup-thermal-fk-coherence.mjs            # dry-run
 *   node scripts/cleanup-thermal-fk-coherence.mjs --apply    # exécution
 *
 * Doit tourner sur dev d'abord, puis sur prod après deploy.
 */

import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, '..', '..', 'data', 'buildy_af.db');
const apply = process.argv.includes('--apply');

const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');

console.log(`DB: ${DB_PATH}`);
console.log(`Mode: ${apply ? 'APPLY (UPDATEs effectifs)' : 'DRY-RUN (lecture seule)'}`);
console.log();

// ── Cas 1 : FK device pointant un autre système (zone ou catégorie) ─────
const wrongLinks = db.prepare(`
  SELECT t.id AS thermal_id,
         t.document_id, t.zone_id AS t_zone, t.category AS t_cat,
         t.generator_device_id, t.distribution_device_id, t.emission_device_id
  FROM bacs_audit_thermal_regulation t
`).all();

const DEVICE_COLS = ['generator_device_id', 'distribution_device_id', 'emission_device_id'];
const cas1Updates = [];

for (const t of wrongLinks) {
  for (const col of DEVICE_COLS) {
    const deviceId = t[col];
    if (deviceId == null) continue;
    const d = db.prepare(`
      SELECT s.zone_id, s.system_category, s.document_id, d.name AS device_name
      FROM bacs_audit_system_devices d
      JOIN bacs_audit_systems s ON s.id = d.system_id
      WHERE d.id = ?
    `).get(deviceId);
    if (!d) continue;
    const mismatchZone = d.zone_id !== t.t_zone;
    const mismatchCat = d.system_category !== t.t_cat;
    if (mismatchZone || mismatchCat) {
      cas1Updates.push({
        thermal_id: t.thermal_id,
        document_id: t.document_id,
        col,
        device_id: deviceId,
        device_name: d.device_name,
        t_zone: t.t_zone, t_cat: t.t_cat,
        d_zone: d.zone_id, d_cat: d.system_category,
        reason: mismatchZone && mismatchCat ? 'zone+catégorie'
              : mismatchZone ? 'zone'
              : 'catégorie',
      });
    }
  }
}

console.log('━'.repeat(70));
console.log(`Cas 1 — FK device hors zone × catégorie : ${cas1Updates.length} cas`);
console.log('━'.repeat(70));
const byDoc1 = new Map();
for (const u of cas1Updates) {
  byDoc1.set(u.document_id, (byDoc1.get(u.document_id) || 0) + 1);
}
for (const [docId, n] of byDoc1) console.log(`  audit ${docId}: ${n} FK à null`);
if (cas1Updates.length && cas1Updates.length <= 10) {
  console.log('\n  Détail :');
  for (const u of cas1Updates) {
    console.log(`    thermal ${u.thermal_id} (audit ${u.document_id}) col=${u.col} device=${u.device_id} "${u.device_name}" : t(zone=${u.t_zone},cat=${u.t_cat}) ≠ d(zone=${u.d_zone},cat=${u.d_cat}) [${u.reason}]`);
  }
}

// ── Cas 2 : *_regulation_device_id pointant un device regulation_integrated=1 ──
const REGULATION_COLS = [
  'production_regulation_device_id',
  'distribution_regulation_device_id',
  'emission_regulation_device_id',
];
const cas2Updates = [];

const allThermals = db.prepare(`SELECT id, document_id, production_regulation_device_id, distribution_regulation_device_id, emission_regulation_device_id FROM bacs_audit_thermal_regulation`).all();

for (const t of allThermals) {
  for (const col of REGULATION_COLS) {
    const deviceId = t[col];
    if (deviceId == null) continue;
    const d = db.prepare(`SELECT id, name, regulation_integrated FROM bacs_audit_system_devices WHERE id = ?`).get(deviceId);
    if (!d) continue;
    if (d.regulation_integrated === 1) {
      cas2Updates.push({
        thermal_id: t.id,
        document_id: t.document_id,
        col,
        device_id: deviceId,
        device_name: d.name,
      });
    }
  }
}

console.log('\n' + '━'.repeat(70));
console.log(`Cas 2 — *_regulation_device_id sur device autonome : ${cas2Updates.length} cas`);
console.log('━'.repeat(70));
const byDoc2 = new Map();
for (const u of cas2Updates) byDoc2.set(u.document_id, (byDoc2.get(u.document_id) || 0) + 1);
for (const [docId, n] of byDoc2) console.log(`  audit ${docId}: ${n} FK à null`);
if (cas2Updates.length && cas2Updates.length <= 10) {
  console.log('\n  Détail :');
  for (const u of cas2Updates) {
    console.log(`    thermal ${u.thermal_id} (audit ${u.document_id}) col=${u.col} device=${u.device_id} "${u.device_name}"`);
  }
}

// ── Application ─────────────────────────────────────────────────────────
if (apply && (cas1Updates.length || cas2Updates.length)) {
  console.log('\n' + '━'.repeat(70));
  console.log('Application des UPDATEs...');
  console.log('━'.repeat(70));
  const tx = db.transaction(() => {
    for (const u of cas1Updates) {
      db.prepare(`UPDATE bacs_audit_thermal_regulation SET ${u.col} = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(u.thermal_id);
    }
    for (const u of cas2Updates) {
      db.prepare(`UPDATE bacs_audit_thermal_regulation SET ${u.col} = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(u.thermal_id);
    }
  });
  tx();
  console.log(`✓ ${cas1Updates.length + cas2Updates.length} UPDATEs appliqués`);
} else if (!apply) {
  console.log('\n(dry-run — relancer avec --apply pour effectuer les UPDATEs)');
} else {
  console.log('\nRien à appliquer.');
}

db.close();
