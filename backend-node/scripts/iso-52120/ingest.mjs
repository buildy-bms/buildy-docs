#!/usr/bin/env node
/**
 * Ingestion des 47 fonctions BAC obligatoires NF EN ISO 52120-1.
 *
 * Source : scripts/iso-52120/functions.csv (CSV original compile par Kevin,
 * miroir de buildy-tools/docs/BACS_fonctions_obligatoires.csv).
 *
 * Cible 1 : table bacs_iso52120_functions (structuree, requetable par
 *   classe — sert au generateur d'actions quand compliance_mode != decree_strict).
 * Cible 2 : table bacs_knowledge (source='iso_52120', authority='normative',
 *   kind='iso_function') — accessible via les outils MCP bacs_knowledge_*
 *   et l'assistant Buildy Docs.
 *
 * Idempotent : `DELETE WHERE source='iso_52120'` puis INSERT integral.
 *
 * Usage : node scripts/iso-52120/ingest.mjs
 */
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const DATA = resolve(ROOT, '../data/buildy_af.db');
const CSV  = resolve(__dirname, 'functions.csv');

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const db = new Database(DATA);

/**
 * Parser de CSV minimaliste suffisant pour notre fichier (delimiter `;`,
 * guillemets doubles pour echapper des `;` ou retours-ligne dans une cellule).
 * Le CSV est ecrit a la main par Kevin et reste maitrisable — pas besoin
 * d'embarquer papaparse pour 47 lignes.
 */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else { inQ = false; }
      } else cell += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ';') { row.push(cell); cell = ''; }
      else if (c === '\n') {
        row.push(cell);
        if (row.some(v => v.trim() !== '')) rows.push(row);
        row = []; cell = '';
      } else if (c === '\r') { /* skip */ }
      else cell += c;
    }
  }
  if (cell || row.length) { row.push(cell); if (row.some(v => v.trim() !== '')) rows.push(row); }
  return rows;
}

function bool(v) { return (v || '').trim().toUpperCase() === 'OUI' ? 1 : 0; }

async function main() {
  const raw = await readFile(CSV, 'utf8');
  const rows = parseCsv(raw);
  const header = rows.shift(); // entete : Référence;Domaine;Sous-fonction;Intitulé;Description;Classe C;Classe B;Classe A
  if (!header || header[0] !== 'Référence') {
    throw new Error(`En-tete CSV inattendu : ${JSON.stringify(header)}`);
  }

  const entries = rows.map((r, i) => ({
    code: (r[0] || '').trim(),
    domain: (r[1] || '').trim(),
    sub_function: (r[2] || '').trim() || null,
    title: (r[3] || '').trim(),
    description: (r[4] || '').trim() || null,
    class_c: bool(r[5]),
    class_b: bool(r[6]),
    class_a: bool(r[7]),
    position: i + 1,
  })).filter(e => e.code);

  console.log(`Parse OK : ${entries.length} fonctions ISO 52120-1.`);

  const tx = db.transaction(() => {
    // ── Table fonctionnelle ──────────────────────────────────────────
    db.prepare('DELETE FROM bacs_iso52120_functions').run();
    const insFn = db.prepare(`
      INSERT INTO bacs_iso52120_functions
        (code, domain, sub_function, title, description, class_c, class_b, class_a, position)
      VALUES (@code, @domain, @sub_function, @title, @description, @class_c, @class_b, @class_a, @position)
    `);
    for (const e of entries) insFn.run(e);

    // ── Base de connaissance (bacs_knowledge) ────────────────────────
    db.prepare("DELETE FROM bacs_knowledge WHERE source = 'iso_52120'").run();
    const insK = db.prepare(`
      INSERT INTO bacs_knowledge
        (source, authority, kind, code, title, body_text, r175_refs, version_label, position, fetched_at)
      VALUES ('iso_52120', 'normative', 'iso_function', @code, @title, @body_text, @r175_refs, @version_label, @position, CURRENT_TIMESTAMP)
    `);
    for (const e of entries) {
      const classes = [];
      if (e.class_c) classes.push('Classe C (standard / minimum BACS)');
      if (e.class_b) classes.push('Classe B (advanced)');
      if (e.class_a) classes.push('Classe A (high performance)');
      const r175 = derivR175(e.domain);
      const body = [
        `Domaine : ${e.domain}`,
        e.sub_function ? `Sous-fonction : ${e.sub_function}` : null,
        `Intitulé : ${e.title}`,
        e.description ? `Description (Tableau 5) : ${e.description}` : null,
        classes.length ? `Niveau requis : ${classes.join(' · ')}` : 'Niveau requis : (non obligatoire)',
      ].filter(Boolean).join('\n');
      insK.run({
        code: `ISO-${e.code}`,
        title: `Fonction ${e.code} — ${e.title}`,
        body_text: body,
        r175_refs: r175,
        version_label: 'NF EN ISO 52120-1 — Tableau 5 (fonctions BAC obligatoires)',
        position: e.position,
      });
    }
  });
  tx();

  const fnCount = db.prepare('SELECT COUNT(*) AS n FROM bacs_iso52120_functions').get().n;
  const knCount = db.prepare("SELECT COUNT(*) AS n FROM bacs_knowledge WHERE source='iso_52120'").get().n;
  console.log(`OK : ${fnCount} lignes dans bacs_iso52120_functions, ${knCount} lignes dans bacs_knowledge.`);
}

/**
 * Mappe un domaine ISO 52120-1 vers les articles R175 pertinents (pour
 * la recherche croisee MCP "donne-moi les fonctions ISO liees a R175-6").
 */
function derivR175(domain) {
  if (/chauffage|refroidissement|ventilation|climatisation/i.test(domain)) return 'R175-3,R175-6';
  if (/eau chaude/i.test(domain))                                          return 'R175-3';
  if (/éclairage|eclairage/i.test(domain))                                 return 'R175-3';
  if (/gestion technique/i.test(domain))                                   return 'R175-3,R175-4';
  return 'R175-3';
}

main().catch(e => { console.error(e); process.exit(1); });
