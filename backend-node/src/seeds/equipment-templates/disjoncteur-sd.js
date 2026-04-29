'use strict';

module.exports = {
  slug: 'disjoncteur-sd',
  name: 'Disjoncteur — signalisation défaut SD',
  category: 'electricite',
  bacs_articles: null,
  bacs_justification: null,
  preferred_protocols: 'Modbus TCP',
  icon_kind: 'fa',
  icon_value: 'fa-bolt',
  icon_color: '#dc2626',
  description_html: `
<p>Un contact auxiliaire <strong>SD (Signalisation Défaut)</strong> sur un disjoncteur remonte spécifiquement un déclenchement sur défaut (court-circuit, surcharge, défaut différentiel) — par opposition à une coupure volontaire qui ne se voit que sur le contact OF.</p>

<p>La détection précoce de ce signal est critique pour la sécurité et la continuité de service.</p>

<p>La solution Buildy expose cette alarme pour notification immédiate à l'exploitant et corrélation avec les autres systèmes du tableau électrique.</p>
`.trim(),
  points: [
    { slug: 'alarme.sd', label: 'Signalisation défaut SD', dataType: 'Alarme', direction: 'read', position: 10 },
  ],
};
