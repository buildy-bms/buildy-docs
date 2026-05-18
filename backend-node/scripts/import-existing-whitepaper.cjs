#!/usr/bin/env node
/**
 * Import one-shot du livre blanc « Méthode audit BACS » existant
 * (marketing/lead-magnet-bacs/pdf-export/methode-audit-bacs.html) vers la
 * table afs (kind='whitepaper') + sections (chapitres).
 *
 * Lancer DEPUIS LA RACINE du repo buildy-docs :
 *   node backend-node/scripts/import-existing-whitepaper.cjs
 *
 * Idempotent : si slug='methode-audit-bacs' existe deja, le script s'arrete.
 * Le supprimer d'abord pour reimporter.
 *
 * Parsing : node-html-parser (vrai DOM, balises toujours equilibrees). Les
 * pages structurelles (cover, pivot, back, sommaire) sont ignorees — elles
 * sont rendues par le template PDF. Les encadres .callout deviennent des
 * <blockquote class="callout-*"> ; les divs decoratives sont deballees.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { parse } = require('node-html-parser');

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'marketing/lead-magnet-bacs/pdf-export/methode-audit-bacs.html');
const SLUG = 'methode-audit-bacs';
const TITLE = "La méthode interne d'audit BACS de Buildy";

if (!fs.existsSync(SRC)) {
  console.error(`✗ Fichier source introuvable : ${SRC}`);
  console.error('  Lance le script depuis la racine du repo buildy-docs.');
  process.exit(1);
}

const db = require(path.join(ROOT, 'backend-node/src/database'));
db.init();

if (db.afs.getBySlug(SLUG)) {
  console.error(`✗ Un document slug='${SLUG}' existe deja. Supprime-le d'abord pour reimporter.`);
  process.exit(1);
}

const html = fs.readFileSync(SRC, 'utf-8');
const root = parse(html, { blockTextElements: { script: false, style: false } });

// ── Nettoyage d'une section .page → HTML compatible Tiptap ──────────
function cleanSection(sec) {
  // 1. Retirer le decoratif
  sec.querySelectorAll(
    '.page-header, .page-foot, .chap-eyebrow, .chap-rule, .pill-row, h1.chapter-title'
  ).forEach((el) => el.remove());

  // 2. Retirer les icones FontAwesome inline
  sec.querySelectorAll('i').forEach((el) => el.remove());

  // 3. callout-label -> <p><strong>…</strong></p>  (avant conversion callout)
  sec.querySelectorAll('.callout-label').forEach((el) => {
    el.replaceWith(parse(`<p><strong>${el.innerHTML.trim()}</strong></p>`));
  });

  // 4. .callout[.warn|.tip|.r175] -> <blockquote class="callout-*">
  sec.querySelectorAll('div.callout').forEach((el) => {
    let variant = 'callout-info';
    if (el.classList.contains('warn')) variant = 'callout-warning';
    else if (el.classList.contains('tip')) variant = 'callout-tip';
    el.replaceWith(parse(`<blockquote class="${variant}">${el.innerHTML}</blockquote>`));
  });

  // 5. .quote-pull -> <blockquote>
  sec.querySelectorAll('div.quote-pull').forEach((el) => {
    el.replaceWith(parse(`<blockquote>${el.innerHTML}</blockquote>`));
  });

  // 6. Deballer toutes les <div> restantes (decoratives : icon-chip,
  //    dashboard, recap…) en conservant leur contenu. Iteratif car
  //    certaines divs sont imbriquees.
  for (let guard = 0; guard < 20; guard++) {
    const divs = sec.querySelectorAll('div');
    if (!divs.length) break;
    for (const d of divs) d.replaceWith(parse(d.innerHTML));
  }

  return sec.innerHTML.replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function headChap(sec) {
  const el = sec.querySelector('.head-chap');
  return el ? el.text.trim() : null;
}
function chapterTitle(sec) {
  const el = sec.querySelector('h1.chapter-title');
  return el ? el.text.replace(/\s+/g, ' ').trim() : null;
}

// ── Grouper les sections .page par chapitre ─────────────────────────
const pages = root.querySelectorAll('section.page');
const groups = [];
let currentKey = null;
for (const sec of pages) {
  const key = headChap(sec);
  if (!key || /^Sommaire/i.test(key)) continue;
  const ct = chapterTitle(sec);              // lu AVANT cleanSection
  const body = cleanSection(sec);
  if (!body) continue;
  if (key !== currentKey) {
    let title = key;
    if (/^Chapitre/i.test(key)) {
      const num = (key.match(/Chapitre (\d+)/) || [])[1] || '';
      title = ct ? `${num}. ${ct}` : key;
    } else if (/^Préambule/i.test(key)) {
      title = 'Préambule';
    }
    groups.push({ title, bodies: [] });
    currentKey = key;
  }
  groups[groups.length - 1].bodies.push(body);
}

// Fusionner les pages successives « Préambule »
const merged = [];
for (const g of groups) {
  const last = merged[merged.length - 1];
  if (last && last.title === 'Préambule' && g.title === 'Préambule') {
    last.bodies.push(...g.bodies);
  } else {
    merged.push(g);
  }
}

console.log(`› ${merged.length} chapitres detectes :`);
merged.forEach((g, i) => console.log(`  ${i + 1}. ${g.title}`));

// Controle d'equilibre des balises blockquote
let totalImbalance = 0;
for (const g of merged) {
  const h = g.bodies.join('\n');
  const o = (h.match(/<blockquote/g) || []).length;
  const c = (h.match(/<\/blockquote>/g) || []).length;
  if (o !== c) { totalImbalance++; console.warn(`  ⚠ ${g.title} : blockquote ${o}/${c}`); }
}
if (totalImbalance) {
  console.error(`✗ ${totalImbalance} chapitre(s) avec balises desequilibrees — import avorte.`);
  process.exit(1);
}
console.log('✓ Balises blockquote equilibrees sur tous les chapitres');

// ── Creation en base ────────────────────────────────────────────────
const owner = db.db.prepare('SELECT id FROM users ORDER BY id ASC LIMIT 1').get();
if (!owner) {
  console.error("✗ Aucun utilisateur en base — impossible d'assigner un proprietaire.");
  process.exit(1);
}

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
    subtitle: "La checklist qu'on utilise sur tous nos chantiers — livrée telle quelle.",
  }),
});

let position = 0;
for (const g of merged) {
  db.sections.create({
    afId: wp.id,
    parentId: null,
    position: position++,
    title: g.title,
    bodyHtml: g.bodies.join('\n'),
    kind: 'standard',
  });
}

// Asset d'equipe : grant 'write' a tous les autres utilisateurs.
const others = db.db.prepare('SELECT id FROM users WHERE id != ?').all(owner.id);
for (const u of others) db.afPermissions.grant(wp.id, u.id, 'write', owner.id);

console.log(`\n✓ Livre blanc importe : afs #${wp.id} (slug='${SLUG}'), ${merged.length} chapitres.`);
console.log(`  Proprietaire : user #${owner.id} · acces equipe : ${others.length} collegue(s).`);
console.log('  Ouvrir : /marketing/whitepapers');
process.exit(0);
