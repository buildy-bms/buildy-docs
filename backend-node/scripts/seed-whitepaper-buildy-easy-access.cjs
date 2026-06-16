#!/usr/bin/env node
/**
 * Brochure marketing « Buildy Easy Access » (4 pages : cover + 2 pages
 * contenu + back-cover CTA). Mode chapitres (Tiptap + template
 * whitepaper-book.hbs). Idempotent : si slug existe, le script affiche
 * l'URL et sort. Mode --update : aligne en place le whitepaper existant.
 *
 * Lancer DEPUIS LA RACINE du repo buildy-docs :
 *   node backend-node/scripts/seed-whitepaper-buildy-easy-access.cjs
 *   node backend-node/scripts/seed-whitepaper-buildy-easy-access.cjs --update
 *
 * Charte voix Buildy (stricte) :
 *  - Voix directe, sobre, humaine. Phrases courtes.
 *  - AUCUN tiret long. Aucun emoji. Aucun jargon (credentials, proxy,
 *    révocation, etc.).
 *  - Le lecteur est déjà chaud : on confirme, on rend tangible, on
 *    enlève le risque, on facilite le passage à l'action.
 */
'use strict';

const path = require('path');

const ROOT = process.cwd();
const SLUG = 'buildy-easy-access';
const TITLE = 'Buildy Easy Access';
const SUBTITLE = 'Tous vos bâtiments sur une carte. Un clic, vous êtes dans la GTB du site. Quelle que soit la marque.';

const db = require(path.join(ROOT, 'backend-node/src/database'));
const { renderFaIconSvg, loadAssetDataUrl } = require(path.join(ROOT, 'backend-node/src/lib/pdf'));
db.init();

// Logos clients embed data URL (mini-bandeau preuve sociale page 3).
// Mêmes 15 logos que le whitepaper #41 « Méthode interne d'audit BACS ».
const CLIENT_LOGOS = [
  'logo-cbre.png', 'logo-eiffage.png', 'logo-spie.png',
  'logo-vinted.png', 'logo-id-logistics-1.png', 'logo-gse.png',
  'logo-ceva.png', 'logo-itron.png', 'logo-rexel.png',
  'logo-dimo.png', 'logo-cpmo.png', 'logo-virtuo.png',
  'logo-jmg-partners.png', 'logo-roiret.png', 'logo-demouselle.png',
];
const CLIENT_LOGOS_HTML = `
<div class="clients-strip">
  <div class="clients-eyebrow">Ils nous font confiance</div>
  <div class="clients-grid">
    ${CLIENT_LOGOS.map(f => `<div class="client-cell"><img src="${loadAssetDataUrl('client-logos/' + f)}" alt="" /></div>`).join('\n    ')}
  </div>
</div>
`.trim();

// Icônes FA Solid embed SVG (vert menthe pour pain cards, navy pour
// les autres). Taille interne ajustée via le CSS .pain-card .pain-icon
// qui set width/height directement sur le <svg>.
const ICON_USER_SHIELD = renderFaIconSvg('user-shield', '#00cd92', '32');
const ICON_LOCK_OPEN   = renderFaIconSvg('lock-open',   '#00cd92', '32');
const ICON_BOLT        = renderFaIconSvg('bolt',        '#00cd92', '32');

// Illustration de couverture : carte stylisée portant plusieurs pastilles
// d'état (vert menthe / orange / rouge) — esprit Hyperveez. Vert menthe
// dominant. SVG ratio 16:10 pour s'intégrer sous le titre + sous-titre.
// Régions abstraites (mint translucide), routes en pointillés blancs,
// 4 pastilles vertes, 1 orange, 1 rouge — chacune avec un halo de couleur.
const COVER_MAP_ILLUSTRATION = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200" fill="none" aria-label="Carte des bâtiments avec pastilles d'état">
  <defs>
    <linearGradient id="cover-map-bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.10"/>
      <stop offset="1" stop-color="#00cd92" stop-opacity="0.10"/>
    </linearGradient>
  </defs>
  <rect x="3" y="3" width="314" height="194" rx="14" fill="url(#cover-map-bg)" stroke="#00cd92" stroke-width="1.4"/>
  <path d="M20 50 Q 80 32 145 50 T 290 38 L 298 110 Q 220 130 160 112 T 28 122 Z" fill="#00cd92" fill-opacity="0.08" stroke="#00cd92" stroke-width="0.9" stroke-opacity="0.30"/>
  <path d="M28 130 Q 100 120 180 138 L 202 178 Q 110 188 22 168 Z" fill="#00cd92" fill-opacity="0.08" stroke="#00cd92" stroke-width="0.9" stroke-opacity="0.30"/>
  <path d="M0 78 Q 80 56 160 80 T 320 92" stroke="#ffffff" stroke-width="0.8" stroke-opacity="0.35" stroke-dasharray="4 5" fill="none"/>
  <path d="M118 0 Q 130 100 96 200" stroke="#ffffff" stroke-width="0.8" stroke-opacity="0.35" stroke-dasharray="4 5" fill="none"/>
  <g><circle cx="58" cy="70" r="13" fill="#00cd92" fill-opacity="0.20"/><circle cx="58" cy="70" r="6.5" fill="#00cd92"/><circle cx="58" cy="70" r="6.5" fill="none" stroke="#ffffff" stroke-width="1.6"/></g>
  <g><circle cx="155" cy="55" r="13" fill="#00cd92" fill-opacity="0.20"/><circle cx="155" cy="55" r="6.5" fill="#00cd92"/><circle cx="155" cy="55" r="6.5" fill="none" stroke="#ffffff" stroke-width="1.6"/></g>
  <g><circle cx="248" cy="82" r="13" fill="#00cd92" fill-opacity="0.20"/><circle cx="248" cy="82" r="6.5" fill="#00cd92"/><circle cx="248" cy="82" r="6.5" fill="none" stroke="#ffffff" stroke-width="1.6"/></g>
  <g><circle cx="108" cy="142" r="13" fill="#f5c259" fill-opacity="0.28"/><circle cx="108" cy="142" r="6.5" fill="#f5c259"/><circle cx="108" cy="142" r="6.5" fill="none" stroke="#ffffff" stroke-width="1.6"/></g>
  <g><circle cx="212" cy="152" r="13" fill="#e95369" fill-opacity="0.28"/><circle cx="212" cy="152" r="6.5" fill="#e95369"/><circle cx="212" cy="152" r="6.5" fill="none" stroke="#ffffff" stroke-width="1.6"/></g>
  <g><circle cx="48" cy="158" r="11" fill="#00cd92" fill-opacity="0.20"/><circle cx="48" cy="158" r="5.5" fill="#00cd92"/><circle cx="48" cy="158" r="5.5" fill="none" stroke="#ffffff" stroke-width="1.4"/></g>
</svg>`;

// Capture cartographique embarquée — déplacée de la cover à la page 2
// (sous la phrase de bascule). Chargée en data URL via loadAssetDataUrl.
const MAP_SCREENSHOT_DATA_URL = loadAssetDataUrl('wp-buildy-easy-access-cover.webp');

// ─── Page 2 ─ accroche Excel + capture (bande horizontale) + solution ─
// Fusion en une seule page dense : douleur → charnière → révélation
// visuelle (capture cartographique en taille moyenne) → explication
// (bloc « Comment ça marche ») → 3 bénéfices.
const CHAPTER_1_TITLE = '<span class="chapter-overhead">Le logiciel d\'hypervision et de GTB le plus utilisé en France ?</span><span class="chapter-big">Un fichier Excel.</span>';
const CHAPTER_1_HTML = `
<p class="lead-narrative">Une colonne par site : l'URL de la GTB, le login, le mot de passe en clair. Et les accès VPN, partagés avec toute l'équipe.</p>

<p class="lead-narrative">Résultat : avant même de pouvoir s'en servir, il faut réussir à s'y connecter. Un parcours du combattant, parfois impossible.</p>

<p class="chapter-bridge">Voilà à quoi ça devrait ressembler.</p>

<figure class="chapter-figure chapter-figure-band">
  <img src="${MAP_SCREENSHOT_DATA_URL}" alt="Tous vos bâtiments sur une carte dans Hyperveez" />
</figure>

<div class="solution-card solution-card-compact">
  <div class="solution-eyebrow">Comment ça marche</div>
  <h2>Une carte, un clic, vous êtes dans la GTB</h2>
  <p>Tous vos sites apparaissent sur une carte dans Hyperveez. Vous cliquez sur un bâtiment, sa supervision s'ouvre directement. Pas de VPN à lancer. Pas de login à retrouver. Pas de logiciel à changer.</p>
  <p>Un seul accès, géré par vous. Quand un collaborateur part, vous coupez son accès d'un coup, sans toucher aux mots de passe des GTB.</p>
</div>

<div class="pain-grid pain-grid-compact">
  <div class="pain-card">
    <div class="pain-icon">${ICON_USER_SHIELD}</div>
    <div class="pain-title">Plus de dépendance à une seule personne</div>
    <p>Les accès sont dans le portail, pas dans une tête.</p>
  </div>
  <div class="pain-card">
    <div class="pain-icon">${ICON_LOCK_OPEN}</div>
    <div class="pain-title">Plus de mots de passe qui traînent sur Teams</div>
    <p>Un seul accès, que vous coupez quand vous voulez.</p>
  </div>
  <div class="pain-card">
    <div class="pain-icon">${ICON_BOLT}</div>
    <div class="pain-title">Plus de temps perdu à chaque alerte</div>
    <p>Vous cliquez, vous êtes dedans.</p>
  </div>
</div>
`.trim();

// ─── Page 3 ─ rien à remplacer + preuve sociale + logos ──────────────
const CHAPTER_2_TITLE = 'Rien à remplacer. Rien à risquer.';
const CHAPTER_2_HTML = `
<p class="lead">Vos automates, vos régulateurs, vos sondes, votre supervision actuelle : tout reste en place. Buildy n'ajoute qu'une couche d'accès et une vue d'ensemble.</p>

<div class="guarantee-card">
  <div class="guarantee-check">✓</div>
  <div>
    <div class="guarantee-title">Pas de gros serveur hyperviseur à 100 000 €. Pas de migration. Rien à réceptionner.</div>
    <p>Le matériel reste en place, vos automaticiens continuent leur travail comme avant. La supervision historique du site fonctionne sans changement. C'est uniquement la manière d'y accéder et de voir l'ensemble qui change.</p>
  </div>
</div>

<div class="proof-card">
  <div class="proof-eyebrow">Ce que font nos clients</div>
  <p class="proof-text">Comme beaucoup de nos clients, vous pouvez commencer par un site, voir ce que ça donne, puis en connecter d'autres à votre rythme.</p>
</div>

${CLIENT_LOGOS_HTML}
`.trim();

// ─── Page 4 ─ Tarification : Pack + Abonnement ───────────────────────
const CHAPTER_3_TITLE = 'Combien ça coûte';
const CHAPTER_3_HTML = `
<p class="lead">Deux lignes claires sur le devis. Une fois pour l'installation, puis un abonnement annuel pour la plateforme. Pas d'autres frais cachés.</p>

<div class="price-step">
  <div class="price-step-num">1</div>
  <div class="price-step-body">
    <div class="price-step-kicker">Une fois, sur devis</div>
    <h2 class="price-step-title">Le Buildy Easy Access Pack</h2>
    <p>Sur chaque site, on installe tout, clé en main. Vous n'avez rien à gérer. Le pack comprend :</p>
    <ul class="pack-list">
      <li>La passerelle Buildy Edge, avec l'intelligence embarquée qui relie votre GTB existante à la plateforme cloud Buildy.</li>
      <li>Un routeur 4G avec carte SIM multi-opérateurs.</li>
      <li>En option, une antenne 4G déportée et son câble.</li>
      <li>L'installation et la mise en service complètes.</li>
      <li>Les frais de déplacement sur site.</li>
    </ul>
  </div>
</div>

<div class="price-step price-step-recurring">
  <div class="price-step-num">2</div>
  <div class="price-step-body">
    <div class="price-step-kicker">Par bâtiment, facturé à l'année</div>
    <h2 class="price-step-title">L'abonnement plateforme</h2>
    <p>Une fois le Pack en place, l'accès à Hyperveez est facturé annuellement, en début de contrat. Tarif identique quel que soit le nombre d'interfaces de GTB présentes sur le bâtiment.</p>
    <p class="tiers-intro">Deux formules, selon qui fournit la connexion internet du site :</p>

    <div class="price-tiers">
      <div class="price-tier">
        <div class="tier-value">20 € <span class="tier-unit">HT / mois</span></div>
        <div class="tier-annual">Soit 240 € HT / an / bâtiment</div>
        <div class="tier-label">Vous fournissez la connexion internet du site.</div>
        <div class="tier-include">Inclus dans l'offre Smart.</div>
      </div>
      <div class="price-tier price-tier-highlight">
        <div class="tier-badge">Le plus populaire</div>
        <div class="tier-value">40 € <span class="tier-unit">HT / mois</span></div>
        <div class="tier-annual">Soit 480 € HT / an / bâtiment</div>
        <div class="tier-label">Buildy fournit la connexion, en 4G M2M multi-opérateurs. 1 Go par mois inclus. Vous n'avez rien à gérer.</div>
        <div class="tier-include">Inclus dans l'offre Premium.</div>
      </div>
    </div>

    <p class="price-step-note">Le routeur 4G est inclus dans le Pack.<br>L'abonnement couvre l'accès à la plateforme, et la connexion 4G mensuelle quand c'est Buildy qui la fournit.<br>Facturé annuellement en début de contrat, sans reconduction tacite.</p>

    <p class="price-step-secondary-cta"><a href="https://www.buildy.fr/dl/tableau-des-offres-buildy">Découvrir les offres Smart et Premium</a></p>
  </div>
</div>
`.trim();

// ─── Page 5 ─ back-cover CTA ─────────────────────────────────────────
const CHAPTER_4_TITLE = 'Toutes vos GTB, au même endroit.';
const CHAPTER_4_HTML = `
<p>Vous avez des bâtiments équipés de GTB de différentes marques, accessibles site par site, chacun dans son coin&nbsp;? Parlez-en à Julien. On regarde vos sites ensemble, on chiffre le déploiement, et on s'occupe de tout.</p>

<p class="cta-button"><a href="mailto:julien@buildy.fr">Contacter Julien</a></p>

<p class="contact-line">Julien, 06&nbsp;11&nbsp;30&nbsp;86&nbsp;12, <a href="mailto:julien@buildy.fr">julien@buildy.fr</a></p>

<p class="cta-note"><em>Devis gratuit, sans engagement.</em></p>
`.trim();

// ─── Idempotence + écriture DB ───────────────────────────────────────
const UPDATE_MODE = process.argv.includes('--update');
const existing = db.afs.getBySlug(SLUG);

const META = {
  subtitle: SUBTITLE,
  has_back_cover: true,
  cover_icon_svg: COVER_MAP_ILLUSTRATION,
  hide_cover_eyebrow: true,
  hide_cover_foot: true,
  footer_doc_label: 'Brochure Buildy',
};

const WANTED_CHAPTERS = [
  { position: 1, title: CHAPTER_1_TITLE, bodyHtml: CHAPTER_1_HTML },
  { position: 2, title: CHAPTER_2_TITLE, bodyHtml: CHAPTER_2_HTML },
  { position: 3, title: CHAPTER_3_TITLE, bodyHtml: CHAPTER_3_HTML },
  { position: 4, title: CHAPTER_4_TITLE, bodyHtml: CHAPTER_4_HTML },
];

if (existing && existing.kind === 'whitepaper' && !existing.deleted_at) {
  if (!UPDATE_MODE) {
    console.log(`✓ Whitepaper déjà présent : afs #${existing.id}.`);
    console.log(`  Édition  : https://docs.buildy.fr:3443/whitepapers/${existing.id}`);
    console.log(`  Preview  : https://docs.buildy.fr:3443/api/whitepapers/${existing.id}/preview`);
    console.log(`  Export PDF : https://docs.buildy.fr:3443/api/whitepapers/${existing.id}/export/pdf`);
    console.log('  Pour aligner sur le script : --update');
    process.exit(0);
  }
  console.log(`→ Mode --update : alignement du whitepaper afs #${existing.id} sur le script.`);
  db.afs.update(existing.id, {
    title: TITLE,
    wp_layout: 'book',
    wp_audience: 'asset_manager',
    wp_version: '1.0',
    wp_meta_json: JSON.stringify(META),
  });
  const currentChapters = db.sections.listByAf(existing.id)
    .slice().sort((a, b) => (a.position || 0) - (b.position || 0));
  for (const w of WANTED_CHAPTERS) {
    const c = currentChapters.find(x => x.position === w.position);
    if (c) {
      db.sections.update(c.id, { title: w.title, body_html: w.bodyHtml });
    } else {
      db.sections.create({ afId: existing.id, parentId: null, position: w.position,
                           title: w.title, bodyHtml: w.bodyHtml, kind: 'standard' });
    }
  }
  for (const c of currentChapters) {
    if (!WANTED_CHAPTERS.find(w => w.position === c.position)) db.sections.delete(c.id);
  }
  console.log(`✓ Whitepaper mis à jour : afs #${existing.id}.`);
  console.log(`  Preview  : https://docs.buildy.fr:3443/api/whitepapers/${existing.id}/preview`);
  console.log(`  Export PDF : https://docs.buildy.fr:3443/api/whitepapers/${existing.id}/export/pdf`);
  process.exit(0);
}

const owner = db.db.prepare('SELECT id FROM users ORDER BY id ASC LIMIT 1').get();
if (!owner) {
  console.error('✗ Aucun utilisateur en base.');
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
  status: 'draft',
  wp_layout: 'book',
  wp_audience: 'asset_manager',
  wp_version: '1.0',
  wp_meta_json: JSON.stringify(META),
  updatedBy: owner.id,
});
for (const w of WANTED_CHAPTERS) {
  db.sections.create({ afId: wp.id, parentId: null, position: w.position,
                       title: w.title, bodyHtml: w.bodyHtml, kind: 'standard' });
}
const others = db.db.prepare('SELECT id FROM users WHERE id != ?').all(owner.id);
for (const u of others) db.afPermissions.grant(wp.id, u.id, 'write', owner.id);

console.log(`✓ Whitepaper créé : afs #${wp.id} (slug='${SLUG}').`);
console.log(`  Édition  : https://docs.buildy.fr:3443/whitepapers/${wp.id}`);
console.log(`  Preview  : https://docs.buildy.fr:3443/api/whitepapers/${wp.id}/preview`);
console.log(`  Export PDF : https://docs.buildy.fr:3443/api/whitepapers/${wp.id}/export/pdf`);
process.exit(0);
