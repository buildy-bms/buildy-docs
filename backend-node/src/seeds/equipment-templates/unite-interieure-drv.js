'use strict';

module.exports = {
  slug: 'unite-interieure-drv',
  name: 'Unité intérieure DRV / VRV / VRF',
  category: 'climatisation',
  bacs_articles: 'R175-1 §1, §2',
  bacs_justification: '<p>Une unité intérieure DRV est une cassette plafond, console murale ou gaine encastrée raccordée à la boucle frigorifique d\'un système DRV / VRV / VRF. Elle est concernée par le décret BACS au titre des systèmes de chauffage (R175-1 §1) et de climatisation (§2) puisqu\'elle traite l\'air intérieur d\'une zone du bâtiment.</p><p>Le décret impose la <strong>capacité d\'arrêt manuel</strong>, l\'<strong>interopérabilité</strong> avec les autres systèmes (occultation, ventilation, présence) et la <strong>gestion autonome</strong> par le système BACS (programmation horaire, scénarios, pilotage zone par zone).</p><p>L\'intégration des unités intérieures dans la solution Buildy permet de superviser et piloter chaque tête individuellement (consigne, mode, ventilation, état) tout en s\'appuyant sur le groupe extérieur supervisé par le template <em>« Système DRV »</em>.</p>',
  preferred_protocols: 'BACnet/IP,Modbus TCP',
  icon_kind: 'fa',
  icon_value: 'fa-snowflake',
  icon_color: '#0ea5e9',
  description_html: `
<p>Une unité intérieure DRV (cassette, console, gaine, plafonnier) traite l'air d'une zone à partir de la boucle frigorifique d'un groupe DRV.</p>

<p>Ce template représente <strong>une unité intérieure individuelle</strong>, à instancier autant de fois qu'il y a de heads en pièce. Le groupe extérieur et la machine globale sont représentés par le template <em>« Système DRV »</em>.</p>

<p><strong>La régulation locale est assurée par l'unité intérieure elle-même</strong>, via la carte fournie par le fabricant qui gère le déclenchement, la modulation de ventilation et la régulation autour de la consigne.</p>

<p>La solution Buildy supervise l'état, le mode, la consigne, la température mesurée et les défauts de chaque head, et transmet les commandes correspondantes.</p>
`.trim(),
  points: [
    // ── Donnees lues ──
    { slug: 'etat.marche_arret', label: 'État marche/arrêt', dataType: 'État', direction: 'read', position: 10 },
    { slug: 'temp.ambiance', label: 'Température ambiante mesurée', dataType: 'Mesure', direction: 'read', unit: '°C', position: 20 },
    { slug: 'consigne.effective', label: 'Consigne effective', dataType: 'Mesure', direction: 'read', unit: '°C', position: 30 },
    { slug: 'etat.mode_chaud_froid', label: 'Mode chaud/froid', dataType: 'État', direction: 'read', position: 40 },
    { slug: 'etat.mode_hvac', label: 'Mode HVAC (auto/éco/confort/...)', dataType: 'État', direction: 'read', position: 50, nature: 'Enum' },
    { slug: 'etat.niveau_ventilation', label: 'Niveau de ventilation', dataType: 'État', direction: 'read', position: 60, nature: 'Enum' },
    { slug: 'mesure.vitesse_ventilation', label: 'Vitesse ventilation effective', dataType: 'Mesure', direction: 'read', unit: '%', position: 70, isOptional: true },
    { slug: 'alarme.defaut', label: 'Défaut unité intérieure', dataType: 'Alarme', direction: 'read', position: 80 },
    { slug: 'alarme.code_erreur', label: 'Code erreur constructeur', dataType: 'Alarme', direction: 'read', position: 90, isOptional: true },
    { slug: 'alarme.encrassement_filtre', label: 'Encrassement filtre', dataType: 'Alarme', direction: 'read', position: 100, isOptional: true },

    // ── Donnees ecrites ──
    { slug: 'cmd.marche_arret', label: 'Commande marche/arrêt', dataType: 'Commande', direction: 'write', position: 200 },
    { slug: 'cmd.mode_chaud_froid', label: 'Commande mode chaud/froid', dataType: 'Commande', direction: 'write', position: 210 },
    { slug: 'cmd.mode_hvac', label: 'Commande mode HVAC', dataType: 'Commande', direction: 'write', position: 220, nature: 'Enum' },
    { slug: 'cmd.niveau_ventilation', label: 'Commande niveau de ventilation', dataType: 'Commande', direction: 'write', position: 230, nature: 'Enum' },
    { slug: 'consigne.temperature', label: 'Consigne température', dataType: 'Consigne', direction: 'write', unit: '°C', position: 240 },
  ],
};
