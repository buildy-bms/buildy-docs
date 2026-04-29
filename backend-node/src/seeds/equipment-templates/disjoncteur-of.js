'use strict';

module.exports = {
  slug: 'disjoncteur-of',
  name: 'Disjoncteur — état OF (ouvert/fermé)',
  category: 'electricite',
  bacs_articles: null,
  bacs_justification: null,
  preferred_protocols: 'Modbus TCP',
  icon_kind: 'fa',
  icon_value: 'fa-circle-half-stroke',
  icon_color: '#475569',
  description_html: `
<p>Un contact auxiliaire <strong>OF (Ouvert/Fermé)</strong> sur un disjoncteur remonte la position physique de l'organe : ouvert (déclenché ou commandé) ou fermé (en service).</p>

<p>Cet état est différent de la signalisation défaut SD (qui indique spécifiquement un déclenchement). On utilise les deux ensemble pour distinguer une coupure volontaire d'un déclenchement sur défaut.</p>

<p>La solution Buildy supervise cet état pour la cohérence du tableau de bord électrique et la détection d'anomalies.</p>
`.trim(),
  points: [
    { slug: 'etat.of', label: 'État OF (ouvert / fermé)', dataType: 'État', direction: 'read', position: 10, techName: 'Breaker_Status_R', nature: 'Booléen' },
  ],
};
