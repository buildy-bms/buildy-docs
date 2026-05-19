#!/usr/bin/env node
/**
 * Import one-shot du livre blanc « Méthode audit BACS » existant vers
 * Buildy Docs, en mode « HTML brut » (coffre) : le HTML/CSS d'origine est
 * stocké tel quel et rendu fidèle au pixel à l'export PDF.
 *
 * Lancer DEPUIS LA RACINE du repo buildy-docs :
 *   node backend-node/scripts/import-existing-whitepaper.cjs
 *
 * Idempotent : si slug='methode-audit-bacs' existe deja, le script s'arrete.
 *
 * Effet :
 *  - cree un document afs (kind='whitepaper', wp_meta_json.mode='html')
 *  - copie methode-audit-bacs.html + assets/ vers
 *    data/whitepaper-sources/<id>/{source.html,assets/}
 *  - l'edition du HTML se fait hors-app (IDE) ; Buildy Docs versionne + exporte.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const SRC_DIR = path.join(ROOT, 'marketing/lead-magnet-bacs/pdf-export');
const SRC_HTML = path.join(SRC_DIR, 'methode-audit-bacs.html');
const SRC_ASSETS = path.join(SRC_DIR, 'assets');
const SLUG = 'methode-audit-bacs';
const TITLE = "La méthode interne d'audit BACS de Buildy";

if (!fs.existsSync(SRC_HTML)) {
  console.error(`✗ Fichier source introuvable : ${SRC_HTML}`);
  console.error('  Lance le script depuis la racine du repo buildy-docs.');
  process.exit(1);
}

const config = require(path.join(ROOT, 'backend-node/src/config'));
const db = require(path.join(ROOT, 'backend-node/src/database'));
db.init();

if (db.afs.getBySlug(SLUG)) {
  console.error(`✗ Un document slug='${SLUG}' existe deja. Supprime-le d'abord pour reimporter.`);
  process.exit(1);
}

const owner = db.db.prepare('SELECT id FROM users ORDER BY id ASC LIMIT 1').get();
if (!owner) {
  console.error("✗ Aucun utilisateur en base — impossible d'assigner un proprietaire.");
  process.exit(1);
}

// ── 1. Creation du document ─────────────────────────────────────────
const wp = db.afs.create({
  slug: SLUG,
  clientName: 'Buildy',
  projectName: TITLE,
  kind: 'whitepaper',
  title: TITLE,
  createdBy: owner.id,
});
db.afs.update(wp.id, {
  status: 'published',
  wp_layout: 'book',
  wp_audience: 'property_manager',
  wp_version: '1.0',
  wp_meta_json: JSON.stringify({
    mode: 'html',
    subtitle: "La checklist qu'on utilise sur tous nos chantiers — livrée telle quelle.",
  }),
});

// ── 2. Copie du HTML + assets vers data/whitepaper-sources/<id>/ ────
const dataRoot = path.dirname(path.resolve(config.exportsDir));
const destDir = path.join(dataRoot, 'whitepaper-sources', String(wp.id));
fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(SRC_HTML, path.join(destDir, 'source.html'));
if (fs.existsSync(SRC_ASSETS)) {
  fs.cpSync(SRC_ASSETS, path.join(destDir, 'assets'), { recursive: true });
}

// ── 3. Acces equipe (grant 'write' aux autres utilisateurs) ─────────
const others = db.db.prepare('SELECT id FROM users WHERE id != ?').all(owner.id);
for (const u of others) db.afPermissions.grant(wp.id, u.id, 'write', owner.id);

const htmlSize = fs.statSync(path.join(destDir, 'source.html')).size;
console.log(`✓ Livre blanc importe (mode HTML brut) : afs #${wp.id} (slug='${SLUG}')`);
console.log(`  HTML source : ${destDir}/source.html (${(htmlSize / 1024).toFixed(0)} Ko)`);
console.log(`  Proprietaire : user #${owner.id} · acces equipe : ${others.length} collegue(s).`);
console.log('  Ouvrir : /marketing/whitepapers');
process.exit(0);
