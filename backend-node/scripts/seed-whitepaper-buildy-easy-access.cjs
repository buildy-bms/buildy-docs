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
const TITLE = 'Le logiciel de supervision GTB le plus utilisé en France ? Un fichier Excel.';
const SUBTITLE = 'Comment Buildy Easy Access remplace les VPN, les credentials partagés et les interfaces obscures par un seul point d\'entrée sécurisé.';

const CHAPTER_1_TITLE = 'Un Excel, des VPN, et une grande confiance dans le turnover';
const CHAPTER_1_HTML = `
<h2>Aujourd'hui, voilà à quoi ressemble votre supervision multi-sites</h2>
<p>Un fichier Excel partagé dans Teams ou Google Drive. Une colonne « URL », une colonne « VPN », une colonne « login », une colonne « mot de passe ». Vous tapez le nom du site, vous récupérez les credentials, vous installez le client VPN du bon fabricant, vous attendez la connexion, vous tombez sur une interface qui n'a pas bougé depuis 2008.</p>
<p>Et quand la personne qui maintenait ce fichier quitte l'entreprise, <strong>c'est l'apocalypse</strong> : la moitié des sites devient inaccessible, les mots de passe sont périmés, plus personne ne sait quel VPN va avec quelle marque.</p>
<h2>Ce que Buildy Easy Access fait à la place</h2>
<p>Un seul portail Hyperveez. Les supervisions de Schneider EcoStruxure, Distech Controls, Niagara, PCVue, Panorama, ABB doGate, Spacelynk — <strong>quelle que soit la marque déployée sur chaque site</strong> — sont exposées via des liens proxy chiffrés HTTPS de la forme :</p>
<blockquote><p><code>https://votre_gtb.proxy.buildy.fr</code></p></blockquote>
<p>Pas de client VPN à installer. Pas de mot de passe partagé. <strong>Authentification forte unique</strong> + accès tracé. Les interfaces s'intègrent à la vue cartographique d'hypervision Buildy : un clic sur un site et la console native du fabricant s'ouvre dans un nouvel onglet, sans changer d'identité.</p>
<h2>Pas besoin de remplacer ce qui marche</h2>
<p>Vos automates, vos régulateurs, vos sondes terrain restent en place. La supervision historique du site continue de fonctionner — c'est juste l'<strong>accès</strong> et la <strong>vue d'ensemble</strong> qui changent. Pas de serveur hyperviseur à 100 k€, pas de migration de données, pas de PV de réception bloqué pendant 6 mois.</p>
`.trim();

const CHAPTER_2_TITLE = 'Voir Buildy Easy Access sur votre patrimoine';
const CHAPTER_2_HTML = `
<h2>30 minutes pour voir si ça change vraiment quelque chose</h2>
<p>Une démo guidée d'Hyperveez avec vos sites réels. On configure 1 ou 2 supervisions tierces sur votre patrimoine en live, vous testez l'accès, vous mesurez le gain de temps.</p>
<p>Si ça vous parle, vous déployez sur l'ensemble du parc. Si ça ne vous parle pas, vous gardez votre Excel.</p>
<h2>Réserver un créneau</h2>
<p>Email&nbsp;: <a href="mailto:contact@buildy.fr">contact@buildy.fr</a><br>Calendrier&nbsp;: <a href="https://buildy.fr/demo">buildy.fr/demo</a></p>
<p><em>Buildy Easy Access est inclus de série dans les niveaux Smart et Premium. Aucun engagement requis pour la démo.</em></p>
`.trim();

const db = require(path.join(ROOT, 'backend-node/src/database'));
db.init();

const existing = db.afs.getBySlug(SLUG);
if (existing && existing.kind === 'whitepaper' && !existing.deleted_at) {
  console.log(`✓ Livre blanc déjà présent : afs #${existing.id} (slug='${SLUG}').`);
  console.log(`  Édition : https://docs.buildy.fr:3443/whitepapers/${existing.id}`);
  console.log(`  Export PDF : https://docs.buildy.fr:3443/api/whitepapers/${existing.id}/export/pdf`);
  console.log('  Pour reseed après édition du script : DELETE FROM afs WHERE slug = \'' + SLUG + '\' puis relancer.');
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
  wp_meta_json: JSON.stringify({ subtitle: SUBTITLE }),
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
console.log(`  Édition : https://docs.buildy.fr:3443/whitepapers/${wp.id}`);
console.log(`  Export PDF : https://docs.buildy.fr:3443/api/whitepapers/${wp.id}/export/pdf`);
console.log(`  Propriétaire : user #${owner.id} · accès équipe : ${others.length} collègue(s).`);
process.exit(0);
