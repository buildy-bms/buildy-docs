#!/usr/bin/env node
/**
 * Fusion biblio : supprime le modèle générique « Radiateur » (slug:radiateur)
 * et bascule les devices d'audit qui l'utilisent vers « Radiateur à eau chaude »
 * (slug:radiateur-eau-chaude).
 *
 * Pourquoi : le modèle « Radiateur » est ambigu — un radiateur peut être à eau
 * chaude (ce que la doctrine traite comme émetteur passif sans énergie primaire)
 * ou électrique direct (production + émission). On garde uniquement les modèles
 * explicites (« Radiateur à eau chaude », « Radiateur électrique fil-pilote »,
 * « Radiateur électrique sans fil-pilote », « Convecteur électrique »).
 *
 * Le tombstone empêche le re-seed automatique au prochain boot du serveur.
 *
 * Usage :
 *   node scripts/migrate-radiateur-to-eau-chaude.mjs           # dry-run
 *   node scripts/migrate-radiateur-to-eau-chaude.mjs --apply   # applique
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const APPLY = process.argv.includes('--apply');
const dbPath = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : path.resolve(__dirname, '../../data/buildy_af.db');

console.log(`DB: ${dbPath}`);
console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
console.log('');

const db = new Database(dbPath, { readonly: !APPLY });

const src = db.prepare("SELECT id, name FROM equipment_templates WHERE slug = 'radiateur'").get();
const dst = db.prepare("SELECT id, name FROM equipment_templates WHERE slug = 'radiateur-eau-chaude'").get();

if (!src) {
  console.log('✓ Le modèle "radiateur" n\'existe plus — rien à faire.');
  db.close();
  process.exit(0);
}
if (!dst) {
  console.error('✗ Le modèle "radiateur-eau-chaude" est introuvable — impossible de basculer. Abort.');
  db.close();
  process.exit(1);
}

const devices = db.prepare(`
  SELECT d.id, d.name, d.energy_source, d.device_role, s.document_id
  FROM bacs_audit_system_devices d
  JOIN bacs_audit_systems s ON s.id = d.system_id
  WHERE d.equipment_template_id = ?
`).all(src.id);

console.log(`Source : "${src.name}" (id ${src.id}) — ${devices.length} device(s) à basculer`);
console.log(`Cible  : "${dst.name}" (id ${dst.id})`);
console.log('');

for (const d of devices) {
  console.log(`  · device #${d.id} (audit ${d.document_id}) "${d.name}" — role=${d.device_role} energy=${d.energy_source || '∅'}`);
}
console.log('');

const tombstone = db.prepare("SELECT 1 AS x FROM deleted_equipment_template_slugs WHERE slug = 'radiateur'").get();
console.log(`Tombstone "radiateur" existant : ${tombstone ? 'oui' : 'non, sera créé'}`);
console.log('');

if (!APPLY) {
  console.log('Dry-run terminé. Relancer avec --apply pour appliquer la transaction.');
  db.close();
  process.exit(0);
}

const tx = db.transaction(() => {
  const r1 = db.prepare(`
    UPDATE bacs_audit_system_devices
    SET equipment_template_id = ?, updated_at = CURRENT_TIMESTAMP
    WHERE equipment_template_id = ?
  `).run(dst.id, src.id);
  console.log(`✓ ${r1.changes} device(s) basculé(s) vers "radiateur-eau-chaude"`);

  const r2 = db.prepare(`
    INSERT OR IGNORE INTO deleted_equipment_template_slugs (slug)
    VALUES ('radiateur')
  `).run();
  console.log(`✓ Tombstone créé : ${r2.changes} ligne (0 = déjà présent)`);

  const r3 = db.prepare(`DELETE FROM equipment_templates WHERE id = ?`).run(src.id);
  console.log(`✓ Template "radiateur" supprimé : ${r3.changes} ligne`);
});

tx();
console.log('');
console.log('Migration appliquée.');
db.close();
