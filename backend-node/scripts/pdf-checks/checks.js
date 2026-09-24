'use strict';

// Contrôles d'un lot d'audits, lancés par run.js sur la COPIE de la base.
// Chaque contrôle affiche ✓ ou ✗ ; code de sortie 1 au moindre écart.
// Le rapport est produit par le chemin d'export de production
// (routes/bacs-audit/exports.js) : mêmes données, mêmes options de rendu.

const path = require('path');
const { spawnSync } = require('child_process');

const copy = process.env.PDF_CHECKS_COPY;
const config = require('../../src/config');
if (!copy || path.resolve(config.databasePath) !== path.resolve(copy)) {
  console.error('ABANDON : lancer via « npm run check:pdf » (travaille sur une copie de la base).');
  process.exit(2);
}
const db = require('../../src/database');
db.init();
const { computeMeterPlanStatus } = require('../../src/lib/bacs-audit-action-generator');
const { axisOfArticle, isReserveAction } = require('../../src/routes/bacs-audit/_compliance-summary');
const { renderHtml, shutdown } = require('../../src/lib/pdf');
const {
  buildBacsAuditExportData, renderBacsAuditReport, renderBacsAuditTables,
} = require('../../src/routes/bacs-audit/exports');
const puppeteer = require('puppeteer');

const PX_PER_MM = 96 / 25.4;
const PAGE_BODY_MM = 263; // hauteur utile d'une page A4 du rapport
const A4_WIDTH_MM = 174;  // largeur utile A4
const A3_WIDTH_MM = 392;  // largeur utile A3 paysage (420 − 28)
// Aperçu HTML : neutralise la mise en page « feuille » (marges, ombre) pour
// mesurer dans la largeur utile réelle du PDF.
const PRINT_BODY_CSS = 'html,body{background:#fff!important} body{max-width:none!important;margin:0!important;padding:0!important;box-shadow:none!important}';

const ids = (process.argv[2] || '').split(',').map(Number).filter(Boolean);
const withTables = process.argv.includes('--tables');
let failures = 0;
let checks = 0;

function report(ok, label, detail = '') {
  checks++;
  if (!ok) failures++;
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
}

// ── Décomptes : L'essentiel = cartes du plan = page de clôture = tableau de
// bord (actions rattachées à une exigence) = actions numérotées.
function checkCounts(d) {
  const st = d.compliance.stats;
  const numbered = d.actionItemsRaw.length;
  const cards = (d.actionItemsByCard || []).reduce((n, c) => n + (c.count || 0), 0);
  const closing = (d.closingActionCount || 0) + (st.reserves || 0);
  const dash = (d.compliance.r175Dashboard || []).reduce((acc, r) => {
    acc.actions += (r.actionsBlocking || 0) + (r.actionsMajor || 0) + (r.actionsMinor || 0);
    acc.reserves += r.actionsReserves || 0;
    return acc;
  }, { actions: 0, reserves: 0 });
  const onAxis = d.actionItemsRaw.filter(a => axisOfArticle(a.r175_article));
  const expected = {
    actions: onAxis.filter(a => !isReserveAction(a)).length,
    reserves: onAxis.filter(a => isReserveAction(a)).length,
  };
  const ok = st.total === numbered && cards === numbered && closing === numbered
    && dash.actions === expected.actions && dash.reserves === expected.reserves;
  report(ok, 'Décomptes cohérents',
    `${numbered} numérotée(s) dont ${st.reserves} réserve(s) · L'essentiel ${st.total} · cartes ${cards}`
    + ` · clôture ${closing} · tableau de bord ${dash.actions}+${dash.reserves}`
    + ` (attendu ${expected.actions}+${expected.reserves})`);
}

// ── Compteurs : statut lu par l'onglet Compteurs (plan d'actions) = statut
// imprimé au chapitre 4.
function checkMeters(d, id) {
  const ps = computeMeterPlanStatus(id);
  const diffs = [];
  for (const m of d.meters || []) {
    if (m.meter_type === 'water') continue;
    const pdf = m.coveredByGroup ? `covered:${m.coveredByGroup}`
      : m.notRequiredReason ? `not_required:${m.notRequiredReason}`
        : m.mergedLeadGroup ? `lead:${m.mergedLeadGroup}` : '-';
    const s = ps[m.id];
    const reasonFr = s && s.reason === 'exempt_5pct'
      ? 'système exempté de raccordement (règle des 5 %)'
      : 'équipements déclarés non concernés par l\'intégration à la GTB';
    const ui = !s ? '-' : s.status === 'not_required' ? `not_required:${reasonFr}` : `${s.status}:${s.group}`;
    if (pdf !== ui) diffs.push(`compteur ${m.id} : PDF ${pdf} / écran ${ui}`);
  }
  report(!diffs.length, 'Compteurs : statuts identiques écran / PDF',
    diffs.length ? diffs.slice(0, 3).join(' ; ') : `${Object.keys(ps).length} statut(s)`);
}

// ── Mise en page A4 : pages de synthèse sur une page, aucun débordement
// horizontal (un seul élément trop large fait réduire tout le PDF).
async function checkLayoutA4(page, d) {
  const html = renderHtml({ template: 'bacs-audit', styles: 'styles-bacs-audit', data: d, fresh: true });
  await page.setContent(html, { waitUntil: 'load' });
  await page.addStyleTag({ content: PRINT_BODY_CSS });
  await page.evaluate(() => document.fonts.ready);
  const m = await page.evaluate((PX) => {
    const mm = (px) => Math.round(px / PX * 10) / 10;
    const height = (sel) => {
      const el = document.querySelector(sel);
      return el ? mm(el.getBoundingClientRect().height) : null;
    };
    const W = document.documentElement.clientWidth;
    const pills = [...document.querySelectorAll('section.r175-dashboard .r175-row')].map(r => {
      const st = r.querySelector('.r175-row-status');
      const v = r.querySelector('.r175-row-verdict');
      if (!st || !v) return null;
      const a = st.getBoundingClientRect();
      const b = v.getBoundingClientRect();
      return (b.left < a.left - 0.5 || b.right > a.right + 0.5 || v.scrollWidth > v.clientWidth + 1)
        ? `${r.querySelector('.r175-row-code')?.textContent.trim()} « ${v.textContent.trim()} »` : null;
    }).filter(Boolean);
    // Hors page de garde et page de clôture, imprimées bord à bord.
    const overflow = [...document.querySelectorAll('body *')].filter(el => {
      if (el.closest('section.cover, section.closing')) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.right > W + 1;
    }).slice(0, 5).map(el => `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}`
      + ` « ${(el.textContent || '').trim().slice(0, 30)} » +${mm(el.getBoundingClientRect().right - W)} mm`);
    return {
      essential: height('section.essential'),
      dashboard: height('section.r175-dashboard'),
      pills,
      overflow,
    };
  }, PX_PER_MM);
  report(m.essential != null && m.essential <= PAGE_BODY_MM, 'L\'essentiel tient sur une page',
    m.essential == null ? 'section introuvable' : `${m.essential} mm / ${PAGE_BODY_MM}`);
  report(m.dashboard != null && m.dashboard <= PAGE_BODY_MM, 'Tableau de bord R175 sur une page',
    m.dashboard == null ? 'section introuvable' : `${m.dashboard} mm / ${PAGE_BODY_MM}`);
  report(!m.pills.length, 'Pastilles du tableau de bord dans leur colonne', m.pills.join(' | '));
  report(!m.overflow.length, 'Aucun débordement horizontal (rapport A4)', m.overflow.join(' | '));
}

async function checkLayoutA3(page, d) {
  const html = renderHtml({
    template: 'bacs-audit-tables', styles: 'styles-bacs-audit-tables', data: d,
    pageFormat: 'A3', pageOrientation: 'landscape', fresh: true,
  });
  await page.setContent(html, { waitUntil: 'load' });
  await page.addStyleTag({ content: PRINT_BODY_CSS });
  await page.evaluate(() => document.fonts.ready);
  const overflow = await page.evaluate((PX) => {
    const W = document.documentElement.clientWidth;
    return [...document.querySelectorAll('body *')].filter(el => {
      if (el.closest('section.cover, section.closing, .cover')) return false;
      const b = el.getBoundingClientRect();
      return b.width > 0 && b.right > W + 1;
    }).slice(0, 5).map(el => `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}`
      + ` « ${(el.textContent || '').trim().slice(0, 30)} » +${Math.round((el.getBoundingClientRect().right - W) / PX * 10) / 10} mm`);
  }, PX_PER_MM);
  report(!overflow.length, 'Aucun débordement horizontal (tableaux A3)', overflow.join(' | '));
}

// ── Contrôles du PDF produit (poppler : pdftotext, pdfinfo).
const HAS_POPPLER = !spawnSync('pdftotext', ['-v']).error;
const pdftotext = (file, extra = []) =>
  spawnSync('pdftotext', [...extra, file, '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).stdout || '';
const pdfPages = (file) => {
  const m = /Pages:\s+(\d+)/.exec(spawnSync('pdfinfo', [file], { encoding: 'utf8' }).stdout || '');
  return m ? parseInt(m[1], 10) : 0;
};

// Caractères hors du sous-ensemble embarqué des polices du rapport : ils
// tomberaient sur une police de secours du poste.
const LATIN_EXTRA = new Set([...'ıŒœʻʼˆ˚˜€™↑↓−∕﻿�']);
function checkChars(file, label) {
  const counts = new Map();
  for (const ch of pdftotext(file)) {
    const o = ch.codePointAt(0);
    if (o <= 0xFF || LATIN_EXTRA.has(ch) || (o >= 0x2000 && o <= 0x206F) || /\s/.test(ch)) continue;
    counts.set(ch, (counts.get(ch) || 0) + 1);
  }
  const odd = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([ch, n]) => `${ch} U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')} ×${n}`);
  report(!odd.length, `Caractères couverts par les polices (${label})`, odd.join(', '));
}

// Sommaire (page 2) : chaque entrée renvoie à la page réelle de son titre.
function checkToc(file, pages) {
  const texts = [];
  for (let p = 1; p <= pages; p++) texts.push(pdftotext(file, ['-f', String(p), '-l', String(p), '-layout']));
  const toc = [];
  for (const line of (texts[1] || '').split('\n')) {
    const m = /^\s*(\d+|[A-Z])\s{2,}(.+?)\s{2,}(\d+)\s*$/.exec(line);
    if (m) toc.push({ num: m[1], title: m[2].trim(), page: parseInt(m[3], 10) });
  }
  const bad = [];
  for (const e of toc) {
    const matches = /^\d+$/.test(e.num)
      ? (l) => l.trim().startsWith(`${e.num}. `) && l.includes(e.title.slice(0, 12))
      : (l) => l.trim().startsWith(`Annexe ${e.num}`);
    const idx = texts.findIndex((t, i) => i > 1 && t.split('\n').filter(x => x.trim()).slice(0, 5).some(matches));
    if (idx < 0 || idx + 1 !== e.page) {
      bad.push(`${e.num} « ${e.title.slice(0, 28)} » : sommaire p. ${e.page}, réel ${idx < 0 ? '?' : `p. ${idx + 1}`}`);
    }
  }
  report(toc.length > 0 && !bad.length, 'Sommaire : numéros de page justes',
    bad.length ? bad.join(' | ') : `${toc.length} entrées`);
}

(async () => {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const pageA4 = await browser.newPage();
  await pageA4.setViewport({ width: Math.round(A4_WIDTH_MM * PX_PER_MM), height: 1200 });
  await pageA4.emulateMediaType('print');
  const pageA3 = await browser.newPage();
  await pageA3.setViewport({ width: Math.round(A3_WIDTH_MM * PX_PER_MM), height: 1200 });
  await pageA3.emulateMediaType('print');
  if (!HAS_POPPLER) console.log('⚠ poppler absent (pdftotext, pdfinfo) : contrôles du texte des PDF ignorés.');

  for (const id of ids) {
    const af = db.afs.getById(id);
    if (!af || af.kind !== 'bacs_audit' || af.deleted_at) {
      console.log(`\nAudit n° ${id} : introuvable`);
      failures++;
      continue;
    }
    console.log(`\nAudit n° ${id} — ${af.project_name}`);
    // Même préparation que l'export : plan régénéré, puissance recalculée.
    const d = await buildBacsAuditExportData(af, { user: null, previewMode: false });
    checkCounts(d);
    checkMeters(d, id);
    await checkLayoutA4(pageA4, d);
    await checkLayoutA3(pageA3, d);

    const out = await renderBacsAuditReport(db.afs.getById(id), d, null);
    const pages = HAS_POPPLER ? pdfPages(out.path) : 0;
    report(true, 'Rapport PDF produit', `${pages ? `${pages} pages · ` : ''}${out.path}`);
    if (HAS_POPPLER) {
      checkChars(out.path, 'rapport');
      checkToc(out.path, pages);
    }
    if (withTables) {
      const t = await renderBacsAuditTables(db.afs.getById(id), d, null);
      report(true, 'Tableaux A3 produits', t.path);
      if (HAS_POPPLER) checkChars(t.path, 'tableaux A3');
    }
  }

  await browser.close();
  await shutdown().catch(() => {});
  console.log(`\n${failures ? '✗' : '✓'} ${ids.length} audit(s), ${checks} contrôle(s), ${failures} écart(s)`);
  process.exit(failures ? 1 : 0);
})().catch(async (e) => {
  console.error(e);
  await shutdown().catch(() => {});
  process.exit(2);
});
