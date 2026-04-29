'use strict';

module.exports = {
  slug: 'contact-tor',
  name: 'Contact TOR (entrée Tout Ou Rien)',
  category: 'autres',
  bacs_articles: null,
  bacs_justification: null,
  preferred_protocols: 'Modbus TCP,KNX/IP',
  icon_kind: 'fa',
  icon_value: 'fa-toggle-on',
  icon_color: '#6b7280',
  description_html: `
<p>Une entrée Tout Ou Rien (TOR) représente un contact sec — normalement ouvert (NO) ou normalement fermé (NC) — utilisé pour remonter une information binaire : présence, défaut générique, état de position, signal externe.</p>

<p>C'est un <strong>type de point générique</strong> à instancier autant que nécessaire pour câbler les contacts disponibles : entrées en armoire électrique, signalisations chaufferie, défauts d'équipements tiers non communicants.</p>

<p>La solution Buildy lit l'état du contact pour déclencher les alertes ou intégrer cette information dans les scénarios applicatifs.</p>
`.trim(),
  points: [
    { slug: 'etat.contact', label: 'État du contact', dataType: 'État', direction: 'read', position: 10, nature: 'Booléen' },
  ],
};
