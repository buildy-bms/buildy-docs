'use strict';

module.exports = {
  slug: 'regulateur-chaufferie',
  name: 'Régulateur de chaufferie',
  category: 'chauffage',
  bacs_articles: 'R175-1 §1, §2',
  bacs_justification: '<p>Le régulateur de chaufferie est l\'automate central qui pilote la production de chaleur (et de froid si réversible) du bâtiment. Il porte la régulation du système de chauffage défini à l\'article R175-1 §1 du décret BACS, et selon configuration la régulation du système de climatisation (§2).</p><p>Le décret impose <strong>l\'interopérabilité</strong> avec les autres systèmes techniques, la <strong>capacité d\'arrêt manuel</strong> et la <strong>gestion autonome</strong> via le système BACS (programmation horaire, modes vacances, supervision et remontée des alarmes).</p><p>L\'intégration du régulateur de chaufferie dans la solution Buildy permet de superviser le mode global (chaud/froid), les modes spéciaux (vacances/jours fériés), la température extérieure et les défauts généraux de la chaufferie.</p>',
  preferred_protocols: 'Modbus TCP,BACnet/IP',
  icon_kind: 'fa',
  icon_value: 'fa-microchip',
  icon_color: '#475569',
  description_html: `
<p>Le régulateur de chaufferie est l'automate qui orchestre l'ensemble de la production de chaleur (et de froid si réversible) : générateurs, circuits, vannes, pompes et sécurités.</p>

<p>Il englobe également la fonction de <strong>système de production de chauffage</strong> dans son périmètre : pas de modèle séparé pour ce concept.</p>

<p>À ce titre, il est <strong>concerné par le décret BACS au titre du système de chauffage</strong> (R175-1 §1) <strong>et de climatisation</strong> (§2) si la chaufferie est réversible.</p>

<p><strong>La régulation est portée par l'équipement lui-même</strong>, via la logique embarquée fournie par le constructeur ou paramétrée par l'intégrateur thermique lors de la mise en service.</p>

<p>La solution Buildy supervise les modes globaux et défauts du régulateur, et porte les logiques applicatives transverses (programmations horaires, scénarios par usage, basculement vacances).</p>
`.trim(),
  points: [
    // ── Donnees lues ──
    { slug: 'temp.exterieure', label: 'Température extérieure', dataType: 'Mesure', direction: 'read', unit: '°C', position: 10 },
    { slug: 'etat.mode_chaud_froid', label: 'Mode global chaud/froid', dataType: 'État', direction: 'read', position: 20 },
    { slug: 'etat.mode_vacances', label: 'Mode vacances / jour férié', dataType: 'État', direction: 'read', position: 30 },
    { slug: 'alarme.defaut_general', label: 'Défaut général chaufferie', dataType: 'Alarme', direction: 'read', position: 40 },
    { slug: 'alarme.manque_eau', label: 'Alarme manque d\'eau', dataType: 'Alarme', direction: 'read', position: 50 },
    { slug: 'temp.depart_general', label: 'Température départ général', dataType: 'Mesure', direction: 'read', unit: '°C', position: 60, isOptional: true },
    { slug: 'temp.retour_general', label: 'Température retour général', dataType: 'Mesure', direction: 'read', unit: '°C', position: 70, isOptional: true },

    // ── Donnees ecrites ──
    { slug: 'cmd.mode_chaud_froid', label: 'Commande mode global chaud/froid', dataType: 'Commande', direction: 'write', position: 200 },
    { slug: 'cmd.mode_vacances', label: 'Commande mode vacances', dataType: 'Commande', direction: 'write', position: 210 },
    { slug: 'consigne.temperature_depart', label: 'Consigne température départ', dataType: 'Consigne', direction: 'write', unit: '°C', position: 220, isOptional: true },
  ],
};
