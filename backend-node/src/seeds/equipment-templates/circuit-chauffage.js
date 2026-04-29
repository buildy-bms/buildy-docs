'use strict';

module.exports = {
  slug: 'circuit-chauffage',
  name: 'Circuit de chauffage',
  category: 'chauffage',
  bacs_articles: 'R175-1 §1',
  bacs_justification: '<p>Un circuit secondaire de chauffage (avec ses pompes, sa vanne 3 voies et ses sondes de départ/retour) est un sous-ensemble du système de chauffage défini à l\'article R175-1 §1 du décret BACS.</p><p>Le décret impose la <strong>supervision continue</strong>, la <strong>capacité d\'arrêt manuel</strong> et la <strong>gestion autonome</strong> via le système BACS, notamment pour la programmation horaire, la détection de dérives et la remontée des défauts (manque d\'eau, défaut pompe).</p><p>L\'intégration des circuits de chauffage dans la solution Buildy permet de superviser les températures aller/retour, l\'état des pompes (avec leur secours éventuel), la position de la vanne 3 voies et les défauts associés.</p>',
  preferred_protocols: 'Modbus TCP,BACnet/IP',
  icon_kind: 'fa',
  icon_value: 'fa-arrow-right-arrow-left',
  icon_color: '#dc2626',
  description_html: `
<p>Un circuit de chauffage est un sous-ensemble du système de production de chaleur, dédié à un usage ou une zone (radiateurs, plancher chauffant, batterie CTA…). Il comprend typiquement une pompe (parfois doublée pour le secours), une vanne 3 voies de mélange et des sondes de départ et retour d'eau.</p>

<p>Ce circuit est <strong>concerné par le décret BACS au titre du système de chauffage</strong> (R175-1 §1).</p>

<p><strong>La régulation du circuit est assurée par le régulateur de chaufferie ou par l'automate du circuit lui-même</strong>, qui pilote la position de la vanne 3 voies, le démarrage de la pompe et la cascade de secours.</p>

<p>La solution Buildy supervise les températures aller/retour, l'état et les défauts des pompes, la position de la vanne 3 voies et les alarmes manque d'eau.</p>
`.trim(),
  points: [
    // ── Donnees lues ──
    { slug: 'temp.depart', label: 'Température départ d\'eau', dataType: 'Mesure', direction: 'read', unit: '°C', position: 10 },
    { slug: 'temp.retour', label: 'Température retour d\'eau', dataType: 'Mesure', direction: 'read', unit: '°C', position: 20 },
    { slug: 'etat.pompe1', label: 'État pompe 1 (marche/arrêt)', dataType: 'État', direction: 'read', position: 30 },
    { slug: 'etat.pompe2', label: 'État pompe 2 secours (marche/arrêt)', dataType: 'État', direction: 'read', position: 40, isOptional: true },
    { slug: 'alarme.defaut_pompe1', label: 'Défaut pompe 1', dataType: 'Alarme', direction: 'read', position: 50 },
    { slug: 'alarme.defaut_pompe2', label: 'Défaut pompe 2 secours', dataType: 'Alarme', direction: 'read', position: 60, isOptional: true },
    { slug: 'mesure.position_v3v', label: 'Position vanne 3 voies', dataType: 'Mesure', direction: 'read', unit: '%', position: 70 },
    { slug: 'alarme.manque_eau', label: 'Alarme manque d\'eau', dataType: 'Alarme', direction: 'read', position: 80 },
  ],
};
