'use strict';

module.exports = {
  slug: 'borne-irve',
  name: 'Borne de recharge VE (IRVE)',
  category: 'electricite',
  bacs_articles: 'R175-1 §4',
  bacs_justification: '<p>L\'article R175-1 §4 du décret BACS inclut explicitement la <strong>production d\'électricité sur site</strong> dans la définition des systèmes techniques de bâtiment, mais la consommation pilotable est tout autant concernée par les obligations de suivi.</p><p>Une borne de recharge pour véhicule électrique (IRVE) constitue une charge significative et pilotable. Elle entre dans le périmètre des systèmes à <strong>superviser, arrêter manuellement et gérer de manière autonome</strong> au sens du décret, notamment pour le pilotage de l\'autoconsommation et le déplacement de la charge en heures creuses.</p><p>L\'intégration des bornes IRVE dans la solution Buildy permet de superviser l\'état d\'autorisation de fonctionnement, l\'énergie délivrée et de transmettre les commandes d\'autorisation correspondantes.</p>',
  preferred_protocols: 'OCPP,Modbus TCP',
  icon_kind: 'fa',
  icon_value: 'fa-charging-station',
  icon_color: '#10b981',
  description_html: `
<p>Une borne IRVE permet la recharge des véhicules électriques sur site (parking employés, visiteurs, flotte). Elle est généralement pilotable à distance pour :</p>
<ul>
<li>Autoriser ou refuser le démarrage d'une recharge</li>
<li>Limiter ou moduler la puissance disponible (load shedding, autoconsommation solaire)</li>
<li>Comptabiliser l'énergie délivrée</li>
</ul>

<p>La régulation de la charge (négociation avec le véhicule, sécurités électriques) est <strong>portée par la borne elle-même</strong>.</p>

<p>La solution Buildy expose l'autorisation de fonctionnement et l'index d'énergie délivrée, et porte les scénarios applicatifs (heures creuses, asservissement au PV, plafond de puissance par site).</p>
`.trim(),
  points: [
    { slug: 'etat.autorisation', label: 'État autorisation de fonctionnement', dataType: 'État', direction: 'read', position: 10, techName: 'On_Off_R', nature: 'Booléen' },
    { slug: 'energie.delivree', label: 'Énergie délivrée (index)', dataType: 'Mesure', direction: 'read', unit: 'kWh', position: 20, techName: 'Active_Energy_Index_R', nature: 'Numérique' },
    { slug: 'mesure.puissance', label: 'Puissance instantanée délivrée', dataType: 'Mesure', direction: 'read', unit: 'kW', position: 30, isOptional: true, nature: 'Numérique' },
    { slug: 'etat.session_active', label: 'Session de recharge en cours', dataType: 'État', direction: 'read', position: 40, isOptional: true, nature: 'Booléen' },
    { slug: 'alarme.defaut', label: 'Défaut borne', dataType: 'Alarme', direction: 'read', position: 50, isOptional: true, techName: 'System_Fault_R', nature: 'Booléen' },
    { slug: 'cmd.autorisation', label: 'Commande autorisation', dataType: 'Commande', direction: 'write', position: 100, techName: 'On_Off_W', nature: 'Booléen' },
    { slug: 'consigne.puissance_max', label: 'Consigne puissance maximale', dataType: 'Consigne', direction: 'write', unit: 'kW', position: 110, isOptional: true, nature: 'Numérique' },
  ],
};
