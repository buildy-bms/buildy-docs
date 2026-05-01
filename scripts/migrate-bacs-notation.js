#!/usr/bin/env node
// Migration de la notation des sous-points R175 dans le contenu DB :
//   "R175-1 §1" -> "R175-1 1°"
//   "norme R175-X" -> "article R175-X"
//
// Usage : node scripts/migrate-bacs-notation.js
// Idempotent : les regex ne matchent plus rien apres premiere passe.
//
// IMPORTANT : faire un backup de la DB avant exécution. Recommande :
//   pm2 stop buildy-docs
//   cp data/buildy_af.db data/buildy_af.db.backup-pre-bacs-notation-$(date +%Y%m%d-%H%M%S)
//   node scripts/migrate-bacs-notation.js
//   pm2 start buildy-docs

'use strict';

const path = require('path');
const Database = require(path.resolve(__dirname, '..', 'backend-node', 'node_modules', 'better-sqlite3'));

const DB_PATH = process.env.DATABASE_PATH || path.resolve(__dirname, '..', 'data', 'buildy_af.db');
const db = new Database(DB_PATH, { fileMustExist: true });

function fix(s) {
  if (!s) return s;
  return s
    // "R175-X §N" -> "R175-X N°" (avec espace entre l'article et le sous-point)
    .replace(/(R175-\d+)\s*§\s*(\d+)/g, (_, art, n) => `${art} ${n}°`)
    // §N residuel (apres une enumeration ou au milieu d'un texte)
    .replace(/§\s*(\d+)/g, (_, n) => `${n}°`)
    // "norme R175-X" -> "article R175-X"
    .replace(/norme\s+(R175-\d+)/gi, 'article $1');
}

let stats = { sections: 0, equipments: 0 };

const txn = db.transaction(() => {
  // section_templates : body_html + bacs_articles
  const upSection = db.prepare(
    'UPDATE section_templates SET body_html = ?, bacs_articles = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  );
  for (const r of db.prepare('SELECT id, body_html, bacs_articles FROM section_templates').all()) {
    const newBody = fix(r.body_html);
    const newArticles = fix(r.bacs_articles);
    if (newBody !== r.body_html || newArticles !== r.bacs_articles) {
      upSection.run(newBody, newArticles, r.id);
      stats.sections++;
    }
  }
  // equipment_templates : description_html + bacs_justification + bacs_articles
  const upEquip = db.prepare(
    'UPDATE equipment_templates SET description_html = ?, bacs_justification = ?, bacs_articles = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  );
  for (const r of db.prepare(
    'SELECT id, description_html, bacs_justification, bacs_articles FROM equipment_templates'
  ).all()) {
    const newDesc = fix(r.description_html);
    const newJustif = fix(r.bacs_justification);
    const newArticles = fix(r.bacs_articles);
    if (newDesc !== r.description_html || newJustif !== r.bacs_justification || newArticles !== r.bacs_articles) {
      upEquip.run(newDesc, newJustif, newArticles, r.id);
      stats.equipments++;
    }
  }
});

txn();

console.log(`Migration terminée :`);
console.log(`  - sections corrigées  : ${stats.sections}`);
console.log(`  - équipements corrigés : ${stats.equipments}`);
db.close();
