#!/usr/bin/env node
/**
 * Crée le livre blanc marketing « Buildy Easy Access » (3 pages : cover +
 * chapitre corps + chapitre CTA). Mode chapitres (Tiptap + template
 * `whitepaper-book.hbs`). Idempotent : si slug='buildy-easy-access'
 * existe déjà, le script affiche l'URL et sort sans dupliquer.
 *
 * Lancer DEPUIS LA RACINE du repo buildy-docs :
 *   node backend-node/scripts/seed-whitepaper-buildy-easy-access.cjs
 *
 * Effet :
 *  - crée un document afs (kind='whitepaper', wp_layout='book',
 *    wp_audience='asset_manager', wp_meta_json.subtitle=...)
 *  - insère 2 chapitres dans `sections` (kind='standard', parent_id=null,
 *    position 1 et 2)
 *  - grant 'write' aux autres utilisateurs pour partage équipe
 *
 * Ton : « punchy LinkedIn » — reprend l'angle du post Kevin Brocard de
 * mars 2026 qui a fait réagir (« GTB la plus utilisée en France = Excel »).
 */
'use strict';

const path = require('path');

const ROOT = process.cwd();
const SLUG = 'buildy-easy-access';
const TITLE = 'Buildy Easy Access';
const SUBTITLE = 'Un seul portail sécurisé pour superviser toutes vos GTB tierces, quelle que soit la marque déployée sur chaque site.';

const CHAPTER_1_TITLE = 'Il est temps d\'oublier Excel pour la gestion technique de vos bâtiments';
const CHAPTER_1_HTML = `
<h2>La réalité du multi-sites aujourd'hui</h2>
<p>Sur un parc de plusieurs dizaines de bâtiments tertiaires, l'outil de supervision le plus utilisé n'est pas une plateforme GTB — c'est un fichier Excel. Une colonne URL, une colonne VPN, une colonne identifiant, une colonne mot de passe. Pour accéder à un site, il faut installer le client VPN du bon fabricant, retrouver les credentials, attendre la connexion, et tomber sur l'interface native de la GTB — Schneider EcoStruxure, Distech Controls, Niagara, PCVue, Panorama, ABB doGate, Spacelynk — toutes différentes les unes des autres.</p>
<p>Ce mode de fonctionnement crée trois problèmes structurels pour un gestionnaire de patrimoine :</p>
<ul>
  <li><strong>La connaissance est dans la tête d'une seule personne.</strong> Quand elle quitte l'entreprise, la moitié du parc devient inaccessible le temps de reconstituer les accès.</li>
  <li><strong>Les credentials circulent par email et Teams.</strong> Pas de révocation centralisée : un mot de passe partagé reste valide même après le départ du collaborateur.</li>
  <li><strong>Le temps d'investigation est démesuré.</strong> Quelques minutes pour ouvrir le bon VPN, retrouver le bon login, attendre la connexion — multiplié par le nombre de sites concernés à chaque alerte.</li>
</ul>

<h2>Ce que change Buildy Easy Access</h2>
<p>Buildy Easy Access centralise l'accès à toutes vos supervisions GTB tierces depuis un seul portail Hyperveez. Chaque interface native est exposée via un lien proxy chiffré HTTPS de la forme :</p>
<blockquote><p><code>https://votre_gtb.proxy.buildy.fr</code></p></blockquote>
<p>Concrètement, sur la vue cartographique nationale d'Hyperveez, vous cliquez sur un site et la console native du fabricant s'ouvre dans un nouvel onglet — sans client VPN, sans saisie d'identifiants, sans changement de logiciel. <strong>Authentification unique côté Buildy</strong> (un seul compte par collaborateur), révocation immédiate lors du départ d'un membre de l'équipe sans avoir à toucher aux credentials natifs des GTB.</p>

<h2>Pas de remplacement matériel</h2>
<p>Vos automates, vos régulateurs, vos sondes terrain et la supervision historique du site restent en place et continuent de fonctionner. Buildy Easy Access ne touche ni aux équipements, ni aux données, ni au paramétrage des GTB existantes — il intervient uniquement sur la couche <strong>accès</strong> et <strong>vue d'ensemble multi-sites</strong>. Aucun serveur hyperviseur à 100 k€ à déployer, aucune migration de base de données, aucun PV de réception à attendre.</p>
`.trim();

const CHAPTER_2_TITLE = 'Voir Buildy Easy Access lors d\'une démo live';
const CHAPTER_2_HTML = `
<p>Une démonstration guidée de 30 minutes sur Hyperveez avec vos sites réels. Nous configurons une ou deux supervisions tierces de votre patrimoine en direct, vous testez l'accès, vous mesurez le gain de temps obtenu.</p>

<div class="pricing-tile">
  <div class="pricing-eyebrow">À partir de</div>
  <div class="pricing-amount">20 € <span class="pricing-unit">HT / mois / bâtiment</span></div>
  <div class="pricing-note">même avec plusieurs interfaces de GTB sur le site</div>
  <div class="pricing-bundle">— ou incluse de série dans les abonnements <strong>Smart</strong> et <strong>Premium</strong></div>
</div>

<p class="cta-button"><a href="https://www.buildy.fr/demander-une-demo/">Réserver une démonstration</a></p>
<p>Ou par email&nbsp;: <a href="mailto:contact@buildy.fr">contact@buildy.fr</a> — Tél. 04 28 39 03 34</p>
<p><em>Aucun engagement n'est requis pour la démonstration.</em></p>
`.trim();

const db = require(path.join(ROOT, 'backend-node/src/database'));
db.init();

const UPDATE_MODE = process.argv.includes('--update');
const existing = db.afs.getBySlug(SLUG);
if (existing && existing.kind === 'whitepaper' && !existing.deleted_at) {
  if (!UPDATE_MODE) {
    console.log(`✓ Livre blanc déjà présent : afs #${existing.id} (slug='${SLUG}').`);
    console.log(`  Édition  : https://docs.buildy.fr:3443/whitepapers/${existing.id}`);
    console.log(`  Preview  : https://docs.buildy.fr:3443/api/whitepapers/${existing.id}/preview`);
    console.log(`  Export PDF : https://docs.buildy.fr:3443/api/whitepapers/${existing.id}/export/pdf`);
    console.log('  Pour re-synchroniser meta + body chapitres avec ce script (idempotent, sans toucher à la DB ad hoc) :');
    console.log('    node backend-node/scripts/seed-whitepaper-buildy-easy-access.cjs --update');
    process.exit(0);
  }

  // Mode --update : aligne le whitepaper existant sur le contenu du
  // script (meta + titres + body_html des 2 chapitres). Pas de DELETE :
  // on UPDATE en place via les helpers DB officiels. Tout edit manuel
  // utilisateur sur le titre/body sera écrasé — c'est le but du mode.
  console.log(`→ Mode --update : alignement du whitepaper afs #${existing.id} sur le script.`);

  db.afs.update(existing.id, {
    title: TITLE,
    wp_layout: 'book',
    wp_audience: 'asset_manager',
    wp_version: '1.0',
    wp_meta_json: JSON.stringify({
      subtitle: SUBTITLE,
      has_back_cover: true,
      cover_image_url: 'wp-asset:wp-buildy-easy-access-cover.webp',
      cover_image_caption: 'Visualisez l\'ensemble de vos bâtiments sur une carte et accédez à votre GTB en un clic !',
      hide_cover_eyebrow: true,
      footer_doc_label: 'Brochure Buildy',
    }),
  });

  const currentChapters = db.sections.listByAf(existing.id)
    .slice().sort((a, b) => (a.position || 0) - (b.position || 0));
  const wanted = [
    { position: 1, title: CHAPTER_1_TITLE, bodyHtml: CHAPTER_1_HTML },
    { position: 2, title: CHAPTER_2_TITLE, bodyHtml: CHAPTER_2_HTML },
  ];
  // Aligne 1-1 sur position : update si existe, create si manque, delete les excédents.
  for (const w of wanted) {
    const c = currentChapters.find(x => x.position === w.position);
    if (c) {
      db.sections.update(c.id, { title: w.title, body_html: w.bodyHtml });
    } else {
      db.sections.create({ afId: existing.id, parentId: null, position: w.position,
                           title: w.title, bodyHtml: w.bodyHtml, kind: 'standard' });
    }
  }
  for (const c of currentChapters) {
    if (!wanted.find(w => w.position === c.position)) db.sections.delete(c.id);
  }

  console.log(`✓ Whitepaper mis à jour : afs #${existing.id}.`);
  console.log(`  Preview  : https://docs.buildy.fr:3443/api/whitepapers/${existing.id}/preview`);
  console.log(`  Export PDF : https://docs.buildy.fr:3443/api/whitepapers/${existing.id}/export/pdf`);
  process.exit(0);
}

const owner = db.db.prepare('SELECT id FROM users ORDER BY id ASC LIMIT 1').get();
if (!owner) {
  console.error('✗ Aucun utilisateur en base — impossible d\'assigner un propriétaire.');
  process.exit(1);
}

// 1. Création du document whitepaper
const wp = db.afs.create({
  slug: SLUG,
  clientName: 'Buildy',         // colonnes legacy NOT NULL
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
  wp_meta_json: JSON.stringify({
    subtitle: SUBTITLE,
    has_back_cover: true,
    // Capture Hyperveez en page de garde — wp-asset: résolu en data URL
    // au rendu via loadAssetDataUrl(filename). Fichier dans
    // backend-node/templates/pdf/assets/wp-buildy-easy-access-cover.webp.
    cover_image_url: 'wp-asset:wp-buildy-easy-access-cover.webp',
    cover_image_caption: 'Visualisez l\'ensemble de vos bâtiments sur une carte et accédez à votre GTB en un clic !',
  }),
  updatedBy: owner.id,
});

// 2. Insertion des 2 chapitres (kind='standard', parent_id=null, position 1 et 2)
db.sections.create({
  afId: wp.id,
  parentId: null,
  position: 1,
  title: CHAPTER_1_TITLE,
  bodyHtml: CHAPTER_1_HTML,
  kind: 'standard',
});
db.sections.create({
  afId: wp.id,
  parentId: null,
  position: 2,
  title: CHAPTER_2_TITLE,
  bodyHtml: CHAPTER_2_HTML,
  kind: 'standard',
});

// 3. Accès équipe (grant 'write' aux autres utilisateurs)
const others = db.db.prepare('SELECT id FROM users WHERE id != ?').all(owner.id);
for (const u of others) db.afPermissions.grant(wp.id, u.id, 'write', owner.id);

console.log(`✓ Livre blanc créé : afs #${wp.id} (slug='${SLUG}').`);
console.log(`  Édition  : https://docs.buildy.fr:3443/whitepapers/${wp.id}`);
console.log(`  Preview  : https://docs.buildy.fr:3443/api/whitepapers/${wp.id}/preview`);
console.log(`  Export PDF : https://docs.buildy.fr:3443/api/whitepapers/${wp.id}/export/pdf`);
console.log(`  Propriétaire : user #${owner.id} · accès équipe : ${others.length} collègue(s).`);
process.exit(0);
