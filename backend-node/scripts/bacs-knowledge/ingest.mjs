#!/usr/bin/env node
/**
 * Ingestion de la base de connaissance BACS dans la table bacs_knowledge.
 *
 * Charge :
 *  - decree-articles.json (decret R175-1 a 6 + analyses) — niveau « opposable »
 *  - gov-faq.json (FAQ ministerielle scrappee) — niveau « official »
 *  - docs/guide_bacs_janvier_2026.pdf (guide ministere V2 jan 2026) — « official »
 *  - docs/guide-bacs-profeel.pdf (guide PROFEEL v1.1 nov 2025) — « professional »
 *
 * Insertion idempotente : on vide d'abord la table par source pour eviter
 * les doublons a chaque relance.
 *
 * Usage : node scripts/bacs-knowledge/ingest.mjs
 */
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const DATA = resolve(ROOT, '../data/buildy_af.db');
const DOCS_DIR = resolve(ROOT, '../docs');

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const { PDFParse } = require('pdf-parse');

const db = new Database(DATA);

function extractR175Refs(text) {
  const refs = new Set();
  const matches = text.match(/R\.?\s*175-(\d(?:-\d)?)/gi) || [];
  for (const m of matches) refs.add(m.replace(/R\.?\s*/i, 'R').replace(/\s+/g, ''));
  return [...refs].join(',');
}

// ─── Decoupe d'un PDF en sections (heuristique sur les titres numerotes) ───
//
// Detecte les lignes type :
//   "1. Introduction" / "1.1 Sous-section" / "1.1.1 Plus fin"
// Sert pour les 2 PDF (PROFEEL + guide ministere).
function chunkByHeadings(rawText, sourcePages = 1) {
  const lines = rawText.split('\n');
  // Deux conventions de titres acceptees :
  //  (a) "1.", "1.1.", "2.1.2." + titre Capitale -> guide ministere (le point
  //      est obligatoire, sinon on attrape les numeros de page).
  //  (b) "1", "2", "3.1.1" + TITRE ALL CAPS -> guide PROFEEL (sans point,
  //      mais titre forcement majuscules).
  const HEAD_RE_DOTTED = /^\s*(\d+(?:\.\d+){0,3}\.)\s+([A-ZÀ-Ÿa-zà-ÿ][\S\s]{2,160})$/;
  const HEAD_RE_CAPS = /^\s*(\d+(?:\.\d+){0,3})\s+([A-ZÀ-Ÿ][A-ZÀ-Ÿ\s'’,()&’À-ſ-]{4,160})$/;
  // Lignes a ignorer (pieds/entetes de page recurrents).
  const NOISE_RE = /^(\s*--\s*\d+\s+of\s+\d+\s*--|\s*\d+\s*\t.*Guide pratique.*|\s*\d+\s+Guide d.application.*)$/i;
  const sections = [];
  let current = { code: 'INTRO', title: 'Introduction', body: [] };
  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (NOISE_RE.test(line)) continue;
    const md = line.match(HEAD_RE_DOTTED);
    const mc = !md && line.match(HEAD_RE_CAPS);
    const m = md || mc;
    const looksLikeHeading = m && line.length < 160;
    if (looksLikeHeading) {
      const code = (m[1] || '').replace(/\.$/, '');
      const title = (m[2] || '').trim();
      if (current.body.length) sections.push(current);
      current = { code, title, body: [] };
    } else if (line.trim()) {
      current.body.push(line);
    }
  }
  if (current.body.length) sections.push(current);

  // Fusion des en-tetes de page : un titre qui apparait >= 3 fois dans le
  // doc est un header recurrent, pas une vraie section. On rapatrie son
  // body dans la section reelle precedente.
  const titleFreq = new Map();
  for (const s of sections) titleFreq.set(s.title, (titleFreq.get(s.title) || 0) + 1);
  const merged = [];
  for (const s of sections) {
    const isRecurring = titleFreq.get(s.title) >= 3;
    if (isRecurring && merged.length) {
      merged[merged.length - 1].body.push(...s.body);
    } else {
      merged.push(s);
    }
  }

  return merged
    .map(s => ({
      code: s.code,
      title: s.title.length > 200 ? s.title.slice(0, 200) : s.title,
      body_text: s.body.join('\n').replace(/\s+\n/g, '\n').replace(/[ \t]+/g, ' ').trim(),
    }))
    .filter(s => s.body_text.length > 80);
}

async function ingestDecree() {
  const items = JSON.parse(await readFile(join(__dirname, 'decree-articles.json'), 'utf-8'));
  db.prepare("DELETE FROM bacs_knowledge WHERE source = 'decree'").run();
  const ins = db.prepare(`
    INSERT INTO bacs_knowledge
      (source, authority, kind, code, title, body_text, r175_refs, version_label, source_url, position)
    VALUES ('decree','opposable','article',?,?,?,?,?,?,?)
  `);
  const tx = db.transaction((rows) => {
    rows.forEach((row, i) => ins.run(
      row.code, row.title, row.body_text,
      row.r175_refs || extractR175Refs(row.body_text),
      row.version_label || null,
      'https://www.legifrance.gouv.fr/codes/section_lc/LEGITEXT000006074096/LEGISCTA000043819533/',
      i,
    ));
  });
  tx(items);
  return items.length;
}

async function ingestGovFaq() {
  const items = JSON.parse(await readFile(join(__dirname, 'gov-faq.json'), 'utf-8')).filter(i => !i.error);
  db.prepare("DELETE FROM bacs_knowledge WHERE source = 'gov_faq'").run();
  const ins = db.prepare(`
    INSERT INTO bacs_knowledge
      (source, authority, kind, code, title, body_text, body_html, r175_refs, version_label, source_url, position)
    VALUES ('gov_faq','official','faq_qa',?,?,?,?,?,?,?,?)
  `);
  const tx = db.transaction((rows) => {
    rows.forEach((row, i) => ins.run(
      row.code, row.title, row.body_text, row.body_html || null,
      row.r175_refs || extractR175Refs(`${row.title}\n${row.body_text}`),
      'FAQ ministere — juin 2025',
      row.source_url, i,
    ));
  });
  tx(items);
  return items.length;
}

async function ingestPdf({ path, source, authority, versionLabel, urlPrefix }) {
  const buf = await readFile(path);
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  const parsed = await parser.getText();
  await parser.destroy();
  // pdf-parse v2 renvoie { pages: [{ text, ... }], text } selon les versions.
  const fullText = parsed.text || (parsed.pages || []).map(p => p.text).join('\n');
  const sections = chunkByHeadings(fullText, (parsed.pages || []).length || 1);
  db.prepare('DELETE FROM bacs_knowledge WHERE source = ?').run(source);
  const ins = db.prepare(`
    INSERT INTO bacs_knowledge
      (source, authority, kind, code, title, body_text, r175_refs, version_label, source_url, position)
    VALUES (?,?,'guide_section',?,?,?,?,?,?,?)
  `);
  const tx = db.transaction((rows) => {
    rows.forEach((row, i) => ins.run(
      source, authority,
      `${urlPrefix}-${row.code}`,
      row.title, row.body_text,
      extractR175Refs(`${row.title}\n${row.body_text}`),
      versionLabel, null, i,
    ));
  });
  tx(sections);
  return sections.length;
}

(async () => {
  const n1 = await ingestDecree();
  console.log(`Decret : ${n1} entrees`);
  const n2 = await ingestGovFaq();
  console.log(`FAQ gouv : ${n2} entrees`);
  const n3 = await ingestPdf({
    path: join(DOCS_DIR, 'guide_bacs_janvier_2026.pdf'),
    source: 'gov_guide', authority: 'official',
    versionLabel: 'Guide ministere V2 — Janvier 2026',
    urlPrefix: 'GUIDE',
  });
  console.log(`Guide ministere : ${n3} sections`);
  const n4 = await ingestPdf({
    path: join(DOCS_DIR, 'guide-bacs-profeel.pdf'),
    source: 'profeel', authority: 'professional',
    versionLabel: 'Guide PROFEEL v1.1 — Novembre 2025',
    urlPrefix: 'PROFEEL',
  });
  console.log(`Guide PROFEEL : ${n4} sections`);

  const total = db.prepare('SELECT COUNT(*) AS c FROM bacs_knowledge').get().c;
  console.log(`\nTotal en base : ${total} entrees`);
  console.log('Repartition :');
  for (const r of db.prepare('SELECT source, authority, COUNT(*) AS n FROM bacs_knowledge GROUP BY source, authority ORDER BY authority, source').all()) {
    console.log(`  ${r.source.padEnd(12)} (${r.authority.padEnd(13)}) : ${r.n}`);
  }
  db.close();
})().catch(e => { console.error(e); process.exit(1); });
