'use strict';

// Rétention des exports PDF : on ne garde que le DERNIER export de chaque TYPE par
// document (les générations précédentes sont purgées, fichier + ligne DB). Le « type »
// est dérivé du nom de fichier (af / synthesis / points-list / bacs-audit / bacs-tables)
// car la colonne `kind` ne distingue pas rapport AF et synthèse (tous deux 'pdf-af').

const fs = require('fs');
const path = require('path');
const db = require('../database');
const log = require('../lib/logger').system;

const TYPES = ['points-list', 'bacs-audit', 'bacs-tables', 'synthesis', 'af'];

function exportType(filePath) {
  const b = path.basename(filePath || '');
  for (const t of TYPES) { if (b.includes(`-${t}-`)) return t; }
  return 'other';
}

// Supprime les exports du même (document, type) que `keepId`, sauf `keepId`.
function pruneOldExports(afId, keepId) {
  try {
    const rows = db.db.prepare('SELECT id, file_path FROM exports WHERE af_id = ?').all(afId);
    const keep = rows.find((r) => r.id === keepId);
    if (!keep) return 0;
    const keepType = exportType(keep.file_path);
    let removed = 0;
    for (const r of rows) {
      if (r.id === keepId || exportType(r.file_path) !== keepType) continue;
      try { if (r.file_path && fs.existsSync(r.file_path)) fs.unlinkSync(r.file_path); } catch { /* */ }
      db.db.prepare('DELETE FROM exports WHERE id = ?').run(r.id);
      removed++;
    }
    if (removed) log.info(`Exports purgés (AF #${afId}, type ${keepType}) : ${removed} ancien(s)`);
    return removed;
  } catch (e) { log.warn(`pruneOldExports AF#${afId}: ${e.message}`); return 0; }
}

// Nettoyage global (one-shot) : pour chaque (document, type), garde l'id max, purge le reste.
function pruneAllExports() {
  const rows = db.db.prepare('SELECT id, af_id, file_path FROM exports ORDER BY id DESC').all();
  const seen = new Set(); // `${af_id}:${type}`
  let removed = 0; let freed = 0;
  for (const r of rows) {
    const key = `${r.af_id}:${exportType(r.file_path)}`;
    if (!seen.has(key)) { seen.add(key); continue; } // le 1er (id max) est gardé
    try { if (r.file_path && fs.existsSync(r.file_path)) { freed += fs.statSync(r.file_path).size; fs.unlinkSync(r.file_path); } } catch { /* */ }
    db.db.prepare('DELETE FROM exports WHERE id = ?').run(r.id);
    removed++;
  }
  return { removed, freed };
}

module.exports = { exportType, pruneOldExports, pruneAllExports };
