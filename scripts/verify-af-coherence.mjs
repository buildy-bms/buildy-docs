#!/usr/bin/env node
/**
 * Vérifie l'intégrité structurelle des AF (analyses fonctionnelles) en base.
 *
 * Détecte le profil de corruption observé lors de l'incident clones AF de
 * juin 2026 (cf. memory project_incident_af_clone_corruption_2026-06) : clones
 * faits avant le fix v0.1.128 qui perdaient `section_template_id` /
 * `system_category_key`, puis backfill qui dupliquait les chapitres.
 *
 * Pour chaque AF non supprimée, il calcule :
 *   - dupGroups    : groupes (parent_id, title) en double          [ERREUR]
 *   - orphanSecFK  : section_template_id pointant dans le vide      [ERREUR]
 *   - orphanEqFK   : equipment_template_id pointant dans le vide    [ERREUR]
 *   - adhoc        : nœuds isAdHoc (cf. SectionTreeNode.vue)        [ALERTE]
 *   - nullStdTpl   : sections standard/synthesis sans tpl ni cat    [ALERTE]
 *   - outdated     : pins de version < current (bandeau « à revoir »)[INFO]
 *
 * Échoue (exit 1) s'il existe au moins une ERREUR. Les ALERTES/INFO sont
 * rapportées sans faire échouer (un AF peut légitimement avoir des sections
 * ad-hoc créées à la main, ou des templates biblio mis à jour après coup).
 *
 * Usage :
 *   node scripts/verify-af-coherence.mjs
 *   DB=/opt/buildy-docs/data/buildy_af.db node scripts/verify-af-coherence.mjs
 *   node scripts/verify-af-coherence.mjs --af 50,51   # restreindre à des ids
 *
 * À lancer après un déploiement touchant le plan AF, le clonage, ou le
 * backfill des sections, et en cas de doute sur une AF (chapitres en double,
 * badges « AF » inattendus, bandeau « à revoir » gonflé).
 */
'use strict';

import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);

// better-sqlite3 vit dans backend-node/node_modules ; on le résout depuis là.
let Database;
for (const p of ['better-sqlite3', resolve(process.cwd(), 'backend-node/node_modules/better-sqlite3'), resolve(import.meta.dirname, '../backend-node/node_modules/better-sqlite3')]) {
  try { Database = require(p); break; } catch { /* try next */ }
}
if (!Database) {
  console.error('Erreur : module better-sqlite3 introuvable (lancer depuis la racine buildy-docs).');
  process.exit(2);
}

const DB_PATH = process.env.DB || resolve(process.cwd(), 'data/buildy_af.db');
if (!existsSync(DB_PATH)) {
  console.error(`Erreur : base introuvable : ${DB_PATH} (variable DB=… pour surcharger).`);
  process.exit(2);
}

const args = process.argv.slice(2);
const afArg = args.find(a => a === '--af') ? args[args.indexOf('--af') + 1] : (args.find(a => a.startsWith('--af='))?.split('=')[1]);
const onlyIds = afArg ? afArg.split(',').map(s => Number(s.trim())).filter(Boolean) : null;

const db = new Database(DB_PATH, { readonly: true });

const afs = db.prepare(
  `SELECT id, client_name, project_name FROM afs
   WHERE kind = 'af' AND deleted_at IS NULL
   ${onlyIds ? `AND id IN (${onlyIds.join(',')})` : ''}
   ORDER BY id`
).all();

const Q = {
  dupGroups: db.prepare(
    `SELECT COUNT(*) n FROM (SELECT 1 FROM sections WHERE af_id = ? GROUP BY parent_id, title HAVING COUNT(*) > 1)`),
  orphanSecFK: db.prepare(
    `SELECT COUNT(*) n FROM sections s LEFT JOIN section_templates t ON t.id = s.section_template_id
     WHERE s.af_id = ? AND s.section_template_id IS NOT NULL AND t.id IS NULL`),
  orphanEqFK: db.prepare(
    `SELECT COUNT(*) n FROM sections s LEFT JOIN equipment_templates t ON t.id = s.equipment_template_id
     WHERE s.af_id = ? AND s.equipment_template_id IS NOT NULL AND t.id IS NULL`),
  adhoc: db.prepare(
    `SELECT COUNT(*) n FROM sections WHERE af_id = ? AND section_template_id IS NULL
     AND equipment_template_id IS NULL AND (system_category_key IS NULL OR system_category_key = '')
     AND kind = 'standard'`),
  nullStdTpl: db.prepare(
    `SELECT COUNT(*) n FROM sections WHERE af_id = ? AND kind IN ('standard','synthesis')
     AND section_template_id IS NULL AND (system_category_key IS NULL OR system_category_key = '')`),
  outdated: db.prepare(
    `SELECT COUNT(*) n FROM sections s JOIN section_templates st ON st.id = s.section_template_id
     WHERE s.af_id = ? AND (s.section_template_version IS NULL OR s.section_template_version < st.current_version)`),
};

const rows = [];
let errorCount = 0;
for (const af of afs) {
  const m = Object.fromEntries(Object.entries(Q).map(([k, stmt]) => [k, stmt.get(af.id).n]));
  const errs = m.dupGroups + m.orphanSecFK + m.orphanEqFK;
  if (errs > 0) errorCount++;
  rows.push({ af, m, hasError: errs > 0 });
}

const pad = (v, w) => String(v).padEnd(w);
console.log(`Intégrité AF — ${DB_PATH}`);
console.log(`${pad('AF', 6)}${pad('dupGrp', 8)}${pad('orphSec', 9)}${pad('orphEq', 8)}${pad('adhoc', 7)}${pad('nullTpl', 9)}${pad('outdated', 10)} état`);
for (const { af, m, hasError } of rows) {
  const state = hasError ? '✗ ERREUR' : (m.adhoc || m.nullStdTpl ? '⚠ alerte' : '✓ sain');
  console.log(
    `${pad(af.id, 6)}${pad(m.dupGroups, 8)}${pad(m.orphanSecFK, 9)}${pad(m.orphanEqFK, 8)}${pad(m.adhoc, 7)}${pad(m.nullStdTpl, 9)}${pad(m.outdated, 10)} ${state}  ${(af.client_name || '')} / ${(af.project_name || '').slice(0, 24)}`
  );
}

console.log('');
if (errorCount > 0) {
  console.error(`✗ ${errorCount} AF en ERREUR (doublons ou FK orphelines). Voir routine de réparation : memory project_incident_af_clone_corruption_2026-06.`);
  process.exit(1);
}
console.log(`✓ ${rows.length} AF vérifiées, aucune erreur structurelle.`);
db.close();
