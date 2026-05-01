#!/usr/bin/env node
// Régénère en masse les contenus de la bibliothèque (sections types,
// fonctionnalités, descriptions et justifications BACS d'équipements)
// avec le prompt système courant.
//
// Usage :
//   node scripts/bulk-regenerate.js                       # tout, sans corpus
//   node scripts/bulk-regenerate.js --kind=narrative_section
//   node scripts/bulk-regenerate.js --kind=functionality
//   node scripts/bulk-regenerate.js --kind=equipment_description
//   node scripts/bulk-regenerate.js --kind=equipment_bacs_justification
//   node scripts/bulk-regenerate.js --category=comptage
//   node scripts/bulk-regenerate.js --corpus --corpus-strategy=neighbors
//   node scripts/bulk-regenerate.js --limit=5            # n'en traite que 5
//   node scripts/bulk-regenerate.js --dry-run             # liste sans régénérer
//   node scripts/bulk-regenerate.js --ids=14,18,19        # uniquement ces IDs
//
// Sécurité : faire un backup de la DB avant exécution (pm2 stop + cp).
// Le script logge le coût total en €.

'use strict';

const path = require('path');

// Configure DB path avant le require de claude/database
process.env.DATABASE_PATH = process.env.DATABASE_PATH ||
  path.resolve(__dirname, '..', 'data', 'buildy_af.db');

const { assistLibrary } = require(path.resolve(__dirname, '..', 'backend-node', 'src', 'lib', 'claude'));
const db = require(path.resolve(__dirname, '..', 'backend-node', 'src', 'database'));
db.init(); // initialise la connexion better-sqlite3 + migrations

// ---- Parsing des arguments ----
const args = process.argv.slice(2).reduce((acc, a) => {
  const m = a.match(/^--([\w-]+)(?:=(.+))?$/);
  if (m) acc[m[1]] = m[2] === undefined ? true : m[2];
  return acc;
}, {});

const dryRun = !!args['dry-run'];
const kindFilter = args.kind || null;
const categoryFilter = args.category || null;
const limit = args.limit ? parseInt(args.limit, 10) : Infinity;
const useCorpus = args.corpus !== undefined && args.corpus !== 'false';
const corpusStrategy = args['corpus-strategy'] || 'neighbors';
const idsFilter = args.ids ? new Set(String(args.ids).split(',').map(s => parseInt(s.trim(), 10))) : null;
const sleepMs = args.sleep ? parseInt(args.sleep, 10) : 400;

// Tarifs Sonnet 4.6 (USD/MTok) — alignés sur routes/claude.js
const USD_EUR = 0.92;
function computeCostEur(usage = {}) {
  const inp = (usage.input_tokens || 0) / 1e6;
  const cw  = (usage.cache_creation_input_tokens || 0) / 1e6;
  const cr  = (usage.cache_read_input_tokens || 0) / 1e6;
  const out = (usage.output_tokens || 0) / 1e6;
  return (inp * 3 + cw * 3.75 + cr * 0.30 + out * 15) * USD_EUR;
}

function buildTasks() {
  const tasks = [];

  // Sections (narrative + functionality)
  if (!kindFilter || kindFilter === 'narrative_section' || kindFilter === 'functionality') {
    const rows = db.sectionTemplates.list();
    for (const r of rows) {
      // Skip non-redigeable kinds (zones, equipment, synthesis)
      if (r.kind !== 'standard') continue;
      const isFn = !!r.is_functionality;
      const kind = isFn ? 'functionality' : 'narrative_section';
      if (kindFilter && kindFilter !== kind) continue;
      if (idsFilter && !idsFilter.has(r.id)) continue;
      if (!(r.body_html || '').trim()) continue;
      tasks.push({
        scope: 'section', id: r.id, label: `[${kind}] #${r.id} "${r.title}"`,
        payload: {
          mode: 'reformulate',
          kind,
          title: r.title,
          html: r.body_html,
          bacs_articles: r.bacs_articles,
          avail_e: r.avail_e, avail_s: r.avail_s, avail_p: r.avail_p,
          current_template_id: r.id,
          parent_template_id: r.parent_template_id,
        },
      });
    }
  }

  // Equipment descriptions
  if (!kindFilter || kindFilter === 'equipment_description') {
    const rows = db.equipmentTemplates.list(categoryFilter ? { category: categoryFilter } : {});
    for (const r of rows) {
      if (idsFilter && !idsFilter.has(r.id)) continue;
      if (!(r.description_html || '').trim()) continue;
      tasks.push({
        scope: 'equipment_desc', id: r.id, label: `[equipment_description] #${r.id} "${r.name}"`,
        payload: {
          mode: 'reformulate',
          kind: 'equipment_description',
          title: r.name,
          html: r.description_html,
          category_label: r.category,
          category: r.category,
          bacs_articles: r.bacs_articles,
          current_template_id: r.id,
        },
      });
    }
  }

  // Equipment BACS justifications
  if (!kindFilter || kindFilter === 'equipment_bacs_justification') {
    const rows = db.equipmentTemplates.list(categoryFilter ? { category: categoryFilter } : {});
    for (const r of rows) {
      if (idsFilter && !idsFilter.has(r.id)) continue;
      if (!(r.bacs_justification || '').trim()) continue;
      tasks.push({
        scope: 'equipment_justif', id: r.id, label: `[equipment_bacs_justification] #${r.id} "${r.name}"`,
        payload: {
          mode: 'reformulate',
          kind: 'equipment_bacs_justification',
          title: r.name,
          html: r.bacs_justification,
          category_label: r.category,
          category: r.category,
          bacs_articles: r.bacs_articles,
          current_template_id: r.id,
        },
      });
    }
  }

  return tasks;
}

function applyResult(task, html) {
  if (task.scope === 'section') {
    db.db.prepare(
      `UPDATE section_templates
         SET body_html = ?, current_version = current_version + 1, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(html, task.id);
  } else if (task.scope === 'equipment_desc') {
    db.db.prepare(
      `UPDATE equipment_templates
         SET description_html = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(html, task.id);
  } else if (task.scope === 'equipment_justif') {
    db.db.prepare(
      `UPDATE equipment_templates
         SET bacs_justification = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(html, task.id);
  }
}

async function main() {
  const allTasks = buildTasks();
  const tasks = allTasks.slice(0, limit);
  const total = tasks.length;

  console.log(`\n=== Bulk regenerate ===`);
  console.log(`Filtres : kind=${kindFilter || 'tous'}, category=${categoryFilter || 'toutes'}, ids=${idsFilter ? [...idsFilter].join(',') : 'tous'}`);
  console.log(`Corpus  : ${useCorpus ? `oui (strategie=${corpusStrategy})` : 'non'}`);
  console.log(`Mode    : ${dryRun ? 'DRY-RUN' : 'EXECUTE'}`);
  console.log(`Tâches  : ${total}${total < allTasks.length ? ` (limite, total disponible : ${allTasks.length})` : ''}\n`);

  if (!total) { console.log('Rien à régénérer.'); process.exit(0); }

  let ok = 0, fail = 0, totalCost = 0;
  for (let i = 0; i < total; i++) {
    const t = tasks[i];
    process.stdout.write(`[${i + 1}/${total}] ${t.label} ... `);
    if (dryRun) { console.log('(dry-run)'); continue; }
    try {
      const result = await assistLibrary({
        ...t.payload,
        library_context: useCorpus ? { enabled: true, strategy: corpusStrategy } : undefined,
      });
      const newHtml = (result.html || '').trim();
      if (!newHtml) {
        console.log('VIDE (skip)');
        fail++;
      } else {
        applyResult(t, newHtml);
        const cost = computeCostEur(result.usage);
        totalCost += cost;
        ok++;
        console.log(`OK ≈${cost.toFixed(4)}€`);
      }
    } catch (e) {
      fail++;
      console.log(`FAIL: ${e.message}`);
    }
    if (i < total - 1) await new Promise(r => setTimeout(r, sleepMs));
  }

  console.log(`\nTerminé : ${ok} OK · ${fail} échec(s) · coût total ≈ ${totalCost.toFixed(2)} €`);
  process.exit(0);
}

main().catch(e => { console.error('Erreur fatale :', e); process.exit(1); });
