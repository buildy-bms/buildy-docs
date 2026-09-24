#!/usr/bin/env node
'use strict';

// Contrôles automatiques des rapports PDF d'audit BACS — toujours sur une
// COPIE de la base, jamais sur la base de dev ni de prod.
//
// Usage (depuis backend-node) :
//   npm run check:pdf -- 40,43,45,56,60,61 [--fake-photos] [--tables] [--db=chemin] [--out=dossier]
//     --fake-photos : image de remplacement pour chaque photo absente (la base
//                     de dev vient de la prod sans les fichiers joints)
//     --tables      : rend et contrôle aussi les tableaux de synthèse A3
//     --db          : base source (défaut : DATABASE_PATH du .env)
//     --out         : dossier de travail (défaut : dossier temporaire)
//
// Détail des contrôles : scripts/pdf-checks/README.md.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const args = process.argv.slice(2);
const opt = (name) => {
  const a = args.find(x => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : null;
};
const ids = (args.find(a => !a.startsWith('--')) || '')
  .split(',').map(s => parseInt(s, 10)).filter(Boolean);
if (!ids.length) {
  console.error('Usage : npm run check:pdf -- <n° d\'audits séparés par des virgules> [--fake-photos] [--tables]');
  process.exit(2);
}

const BACKEND = path.resolve(__dirname, '../..');
const config = require(path.join(BACKEND, 'src/config'));
const source = path.resolve(opt('db') || config.databasePath);
if (!fs.existsSync(source)) {
  console.error(`Base introuvable : ${source}`);
  process.exit(2);
}
const work = opt('out')
  ? path.resolve(opt('out'))
  : fs.mkdtempSync(path.join(os.tmpdir(), 'bd-pdf-checks-'));
fs.mkdirSync(work, { recursive: true });
const copy = path.join(work, 'buildy_af.db');
if (path.resolve(copy) === source) {
  console.error('ABANDON : le dossier de travail contient la base source.');
  process.exit(2);
}

// Dossiers où chercher les vrais fichiers joints (lecture seule).
const realDocsDirs = [
  path.resolve(config.attachmentsDir, '..', 'site-documents'),
  path.resolve(path.dirname(source), 'site-documents'),
];

async function placeholderImage(dest) {
  const sharp = require('sharp');
  const svg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900">'
    + '<rect width="100%" height="100%" fill="#cbd5e1"/>'
    + '<text x="50%" y="50%" font-size="64" font-family="sans-serif" fill="#475569" '
    + 'text-anchor="middle" dominant-baseline="middle">Photo de test</text></svg>');
  await sharp(svg).jpeg({ quality: 70 }).toFile(dest);
}

(async () => {
  const Database = require('better-sqlite3');
  // Sauvegarde SQLite : copie cohérente même base ouverte (WAL), sans rien
  // écrire dans la source.
  const src = new Database(source, { readonly: true, fileMustExist: true });
  await src.backup(copy);
  src.close();

  const db = new Database(copy);
  // Les anciens exports pointent vers de vrais fichiers : la purge des
  // exports (pruneOldExports) les supprimerait lors des rendus. Neutralisés
  // dans la copie.
  db.prepare("UPDATE exports SET file_path = ''").run();

  // Fichiers joints des audits contrôlés : copiés dans le dossier de travail
  // (le cache d'images s'écrit à côté), ou image factice avec --fake-photos.
  const rows = db.prepare(`
    SELECT d.filename, d.mime_type, s.site_uuid
    FROM site_documents d
    JOIN sites s ON s.id = d.site_id
    WHERE s.id IN (SELECT site_id FROM afs WHERE id IN (${ids.map(() => '?').join(',')}))
  `).all(...ids);
  db.close();

  const fakePhotos = args.includes('--fake-photos');
  let copied = 0, faked = 0, missing = 0;
  for (const r of rows) {
    const dest = path.join(work, 'site-documents', r.site_uuid, r.filename);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const real = realDocsDirs.map(d => path.join(d, r.site_uuid, r.filename)).find(p => fs.existsSync(p));
    if (real) { fs.copyFileSync(real, dest); copied++; continue; }
    if (fakePhotos && /^image\//.test(r.mime_type || '')) { await placeholderImage(dest); faked++; continue; }
    missing++;
  }
  fs.mkdirSync(path.join(work, 'attachments'), { recursive: true });

  console.log(`Base source : ${source} (lecture seule)`);
  console.log(`Dossier de travail : ${work}`);
  console.log(`Fichiers joints : ${copied} copiés, ${faked} images factices, ${missing} absents\n`);

  const env = {
    ...process.env,
    DATABASE_PATH: copy,
    PDF_CHECKS_COPY: copy,
    EXPORTS_DIR: path.join(work, 'exports'),
    ATTACHMENTS_DIR: path.join(work, 'attachments'),
    // Recharge les gabarits à chaque rendu (comme les exports de dev).
    DEV_BYPASS_AUTH: '1',
  };
  const child = spawnSync(process.execPath, [
    path.join(__dirname, 'checks.js'), ids.join(','),
    ...(args.includes('--tables') ? ['--tables'] : []),
  ], { env, stdio: 'inherit', cwd: BACKEND });
  process.exit(child.status ?? 1);
})().catch((e) => { console.error(e); process.exit(2); });
