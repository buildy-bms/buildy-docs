'use strict';

module.exports = {
  slug: 'portail-motorise',
  name: 'Portail motorisé',
  category: 'autres',
  bacs_articles: null,
  bacs_justification: null,
  preferred_protocols: 'KNX/IP,Modbus TCP',
  icon_kind: 'fa',
  icon_value: 'fa-door-open',
  icon_color: '#475569',
  description_html: `
<p>Un portail motorisé permet l'accès véhicules au site. Il est piloté à distance (badge, télécommande, automate) pour automatiser l'ouverture en horaires d'occupation et la fermeture sécurisée hors plages.</p>

<p>La fonction de motorisation et les sécurités (cellules, butées, limiteurs de couple) sont <strong>portées par l'automate du portail lui-même</strong>.</p>

<p>La solution Buildy expose la commande d'ouverture automatique pour les scénarios applicatifs (intégration avec le contrôle d'accès, ouverture sur événement caméra, programmation horaire).</p>
`.trim(),
  points: [
    { slug: 'etat.ouverture', label: 'État ouverture (ouvert / fermé / en mouvement)', dataType: 'État', direction: 'read', position: 10, techName: 'Auto_Open_R', nature: 'Booléen' },
    { slug: 'alarme.defaut', label: 'Défaut motorisation', dataType: 'Alarme', direction: 'read', position: 20, isOptional: true, techName: 'System_Fault_R', nature: 'Booléen' },
    { slug: 'cmd.ouverture', label: 'Commande ouverture automatique', dataType: 'Commande', direction: 'write', position: 100, techName: 'Auto_Open_W', nature: 'Booléen' },
  ],
};
