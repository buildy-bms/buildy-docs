#!/usr/bin/env node
/**
 * Scrape les 30 entrees de la FAQ ministerielle BACS depuis
 * rt-re-batiment.developpement-durable.gouv.fr et ecrit gov-faq.json.
 *
 * Usage : node scripts/bacs-knowledge/fetch-gov-faq.mjs
 */
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = 'https://rt-re-batiment.developpement-durable.gouv.fr';

// Liste exhaustive des 30 entrees FAQ (issue du sommaire des sections
// r464 a r471). Chaque entree : { slug, section }.
const FAQ_ENTRIES = [
  // Section r464 — Generalites
  { slug: 'faq-bacs-01-qu-est-ce-qu-un-bacs-a932.html', section: 'Généralités' },
  { slug: 'faq-bacs-02-quel-est-le-lien-entre-un-bacs-et-une-a933.html', section: 'Généralités' },
  { slug: 'faq-bacs-03-qu-impose-le-decret-bacs-a935.html', section: 'Généralités' },
  { slug: 'faq-bacs-04-qui-est-soumis-au-decret-bacs-a934.html', section: 'Généralités' },
  // Section r465 — Perimetre et responsabilite
  { slug: 'faq-bacs-05-a-qui-incombe-l-obligation-d-a961.html', section: 'Périmètre et responsabilité' },
  { slug: 'faq-bacs-06-les-batiments-a-usage-mixte-hebergeant-a936.html', section: 'Périmètre et responsabilité' },
  { slug: 'faq-bacs-07-quel-est-le-perimetre-de-mise-en-a937.html', section: 'Périmètre et responsabilité' },
  // Section r466 — Systemes techniques a prendre en compte
  { slug: 'faq-bacs-08-calcul-de-la-puissance-nominale-utile-a938.html', section: 'Systèmes techniques pour l\'assujettissement' },
  { slug: 'faq-bacs-09-puissance-electrique-des-pompes-de-a939.html', section: 'Systèmes techniques pour l\'assujettissement' },
  { slug: 'faq-bacs-10-cas-des-preparateurs-ecs-alimentes-de-a940.html', section: 'Systèmes techniques pour l\'assujettissement' },
  { slug: 'faq-bacs-11-pour-definir-l-assujettissement-d-un-a941.html', section: 'Systèmes techniques pour l\'assujettissement' },
  { slug: 'faq-bacs-12-cas-d-un-batiment-equipe-de-plusieurs-a942.html', section: 'Systèmes techniques pour l\'assujettissement' },
  { slug: 'faq-bacs-13-logiciel-permettant-la-conformite-avec-a943.html', section: 'Systèmes techniques pour l\'assujettissement' },
  // Section r468 — Fonctions reglementairement obligatoires
  { slug: 'faq-bacs-14-quelles-sont-les-fonctionnalites-a944.html', section: 'Fonctions règlementairement obligatoires' },
  { slug: 'faq-bacs-15-au-sens-du-decret-quelles-sont-les-a945.html', section: 'Fonctions règlementairement obligatoires' },
  { slug: 'faq-bacs-16-les-fonctions-de-la-norme-nf-en-iso-a947.html', section: 'Fonctions règlementairement obligatoires' },
  { slug: 'faq-bacs-17-comment-l-evaluation-de-la-fonction-de-a948.html', section: 'Fonctions règlementairement obligatoires' },
  { slug: 'faq-bacs-18-la-classe-c-sur-l-ensemble-des-a946.html', section: 'Fonctions règlementairement obligatoires' },
  { slug: 'faq-bacs-19-l-atteinte-des-classes-demandees-pour-a949.html', section: 'Fonctions règlementairement obligatoires' },
  // Section r469 — Regle de calcul du TRI
  { slug: 'faq-bacs-20-comment-le-tri-se-calcule-t-il-a953.html', section: 'Règle de calcul du TRI' },
  { slug: 'faq-bacs-21-cas-d-un-tri-10-ans-pour-le-systeme-a950.html', section: 'Règle de calcul du TRI' },
  { slug: 'faq-bacs-22-evaluation-du-gain-energetique-pour-a951.html', section: 'Règle de calcul du TRI' },
  { slug: 'faq-bacs-23-cas-des-equipements-obsoletes-a952.html', section: 'Règle de calcul du TRI' },
  { slug: 'faq-bacs-24-est-il-possible-de-moduler-la-valeur-a954.html', section: 'Règle de calcul du TRI' },
  // Section r470 — Echantillonnage des zones et des donnees
  { slug: 'faq-bacs-25-quelle-est-la-granulometrie-requise-a955.html', section: 'Échantillonnage des zones et des données' },
  { slug: 'faq-bacs-26-collecte-des-donnees-mesurees-par-zone-a956.html', section: 'Échantillonnage des zones et des données' },
  { slug: 'faq-bacs-27-mise-en-place-des-dispositifs-de-a957.html', section: 'Échantillonnage des zones et des données' },
  // Section r471 — Autres questions
  { slug: 'faq-bacs-28-cee-pour-les-devis-signes-avant-le-01-a958.html', section: 'Autres questions' },
  { slug: 'faq-bacs-29-cas-d-une-extension-de-batiment-a959.html', section: 'Autres questions' },
  { slug: 'faq-bacs-30-le-bacs-doit-il-faire-l-objet-d-une-a960.html', section: 'Autres questions' },
];

function extractR175Refs(text) {
  const refs = new Set();
  const matches = text.match(/R\.?\s*175-(\d(?:-\d)?)/gi) || [];
  for (const m of matches) {
    refs.add(m.replace(/R\.?\s*/i, 'R').replace(/\s+/g, ''));
  }
  return [...refs].join(',');
}

async function fetchOne(entry) {
  const url = `${BASE}/${entry.slug}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'BuildyDocs-BACS-Ingest/1.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} sur ${url}`);
  const html = await res.text();
  const $ = cheerio.load(html);
  // Le titre H1 contient « FAQ BACS NN - Question complete ».
  const h1 = $('h1').first().text().trim() || $('title').text().trim();
  // Le corps de la reponse est dans #contenu / .ouvrage / article — varie
  // selon la version du CMS SPIP. On prend le main puis on retire la nav.
  const main = $('main').length ? $('main') : $('#contenu').length ? $('#contenu') : $('body');
  main.find('nav, .navigation, .pagination, header, footer, .breadcrumb, script, style').remove();
  // Retire le H1 du body (on l'a deja dans title).
  main.find('h1').remove();
  const bodyText = main.text().replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]+/g, ' ').trim();
  const bodyHtml = main.html()?.trim() || null;
  // Code stable : FAQ-01..FAQ-30 selon le numero dans le titre.
  const numMatch = h1.match(/FAQ\s*BACS\s*(\d+)/i);
  const num = numMatch ? numMatch[1].padStart(2, '0') : entry.slug.match(/\d+/)?.[0]?.padStart(2, '0') || '??';
  return {
    code: `FAQ-${num}`,
    section: entry.section,
    title: h1,
    body_text: bodyText,
    body_html: bodyHtml,
    r175_refs: extractR175Refs(`${h1}\n${bodyText}`),
    source_url: url,
  };
}

async function main() {
  const out = [];
  for (const entry of FAQ_ENTRIES) {
    process.stderr.write(`Fetching ${entry.slug}... `);
    try {
      const item = await fetchOne(entry);
      out.push(item);
      process.stderr.write(`OK (${item.body_text.length} chars)\n`);
    } catch (e) {
      process.stderr.write(`FAIL: ${e.message}\n`);
      out.push({ code: `FAQ-ERR-${entry.slug}`, section: entry.section, title: entry.slug, body_text: '', body_html: '', r175_refs: '', source_url: `${BASE}/${entry.slug}`, error: e.message });
    }
    await new Promise(r => setTimeout(r, 250)); // courtoisie serveur
  }
  const dest = join(__dirname, 'gov-faq.json');
  await writeFile(dest, JSON.stringify(out, null, 2), 'utf-8');
  console.log(`\nWrote ${out.length} FAQ entries to ${dest}`);
  console.log(`Errors: ${out.filter(o => o.error).length}`);
}

main().catch(e => { console.error(e); process.exit(1); });
