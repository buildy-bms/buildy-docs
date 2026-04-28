'use strict';

module.exports = {
  slug: 'drv',
  name: 'Système DRV / VRV / VRF',
  category: 'climatisation',
  bacs_articles: 'R175-1 §1, §2',
  bacs_justification: '<p>L\'article R175-1 définit un <strong>système de climatisation</strong> comme la combinaison des composantes nécessaires pour assurer un traitement de l\'air intérieur permettant le contrôle ou l\'abaissement de la température. Un système DRV/VRV/VRF entre dans cette définition, et combine également la fonction de chauffage (§1) sur une même boucle frigorifique réversible.</p><p>Le décret impose <strong>l\'interopérabilité</strong> avec les autres systèmes techniques, la <strong>capacité d\'arrêt manuel</strong> et la <strong>gestion autonome</strong> via le système BACS (suivi, alarmes, programmation, pilotage à distance).</p><p>L\'intégration du DRV dans la solution Buildy permet de superviser chaque unité intérieure (mode, consigne, état, alarmes) et de transmettre les commandes correspondantes.</p>',
  preferred_protocols: 'BACnet/IP,Modbus TCP',
  icon_kind: 'fa',
  icon_value: 'fa-snowflake',
  icon_color: '#06b6d4',
  description_html: `
<p>Un système à débit de réfrigérant variable assure le conditionnement thermique d\'unités intérieures multiples (chaud et/ou froid) à partir d\'une ou plusieurs unités extérieures.</p>

<p>À ce titre, il est <strong>concerné par le décret BACS au titre des systèmes de chauffage</strong> (R175-1 §1) <strong>et de climatisation</strong> (§2).</p>

<p><strong>La régulation du système DRV est assurée par l\'équipement lui-même</strong>, via la régulation native du fabricant qui pilote la puissance frigorifique, le basculement chaud/froid, la modulation et les sécurités de la boucle frigorifique.</p>

<p>La solution Buildy supervise l\'état des unités, les températures de consigne effectives, les modes de fonctionnement et les défauts, et peut transmettre des commandes par unité intérieure.</p>
`.trim(),
  points: [
    { slug: 'etat.unite_int', label: 'État unité intérieure (marche/arrêt)', dataType: 'État', direction: 'read', position: 10 },
    { slug: 'etat.mode', label: 'Mode (chauffage/clim/ventilation/auto)', dataType: 'État', direction: 'read', position: 20 },
    { slug: 'etat.vitesse_ventilation', label: 'Vitesse de ventilation', dataType: 'État', direction: 'read', position: 30 },
    { slug: 'temp.ambiance', label: 'Température d\'ambiance mesurée', dataType: 'Mesure', direction: 'read', unit: '°C', position: 40 },
    { slug: 'consigne.effective', label: 'Consigne effective', dataType: 'Mesure', direction: 'read', unit: '°C', position: 50 },
    { slug: 'puissance.frigorifique', label: 'Puissance frigorifique instantanée', dataType: 'Mesure', direction: 'read', unit: 'kW', position: 60 },
    { slug: 'puissance.calorifique', label: 'Puissance calorifique instantanée', dataType: 'Mesure', direction: 'read', unit: 'kW', position: 70 },
    { slug: 'energie.consommee', label: 'Énergie électrique consommée', dataType: 'Mesure', direction: 'read', unit: 'kWh', position: 80 },
    { slug: 'alarme.defaut_general', label: 'Défaut général', dataType: 'Alarme', direction: 'read', position: 90 },
    { slug: 'alarme.defaut_compresseur', label: 'Défaut compresseur unité extérieure', dataType: 'Alarme', direction: 'read', position: 100 },
    { slug: 'alarme.encrassement_filtre', label: 'Encrassement filtre unité intérieure', dataType: 'Alarme', direction: 'read', position: 110 },
    { slug: 'alarme.fuite_refrigerant', label: 'Détection de fuite réfrigérant', dataType: 'Alarme', direction: 'read', position: 120 },
    { slug: 'cmd.marche_arret', label: 'Commande marche/arrêt unité intérieure', dataType: 'Commande', direction: 'write', position: 200 },
    { slug: 'cmd.mode', label: 'Commande mode (chaud/froid/vent/auto)', dataType: 'Commande', direction: 'write', position: 210 },
    { slug: 'cmd.vitesse_ventilation', label: 'Commande vitesse de ventilation', dataType: 'Commande', direction: 'write', position: 220 },
    { slug: 'consigne.temperature', label: 'Consigne température', dataType: 'Consigne', direction: 'write', unit: '°C', position: 230 },
  ],
};
