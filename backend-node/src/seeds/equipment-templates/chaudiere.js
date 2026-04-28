'use strict';

module.exports = {
  slug: 'chaudiere',
  name: 'Chaudière / générateur de chaleur',
  category: 'chauffage',
  bacs_articles: 'R175-1 §1',
  bacs_justification: 'Une chaudière constitue un système de chauffage au sens du décret BACS (R175-1 §1). Le décret impose l\'automatisation, la supervision continue, le pilotage à distance et la traçabilité du fonctionnement.',
  preferred_protocols: 'Modbus TCP,BACnet/IP,Modbus RTU',
  icon_kind: 'fa',
  icon_value: 'fa-fire',
  icon_color: '#ef4444',
  description_html: `
<p><strong>Une chaudière (ou tout générateur de chaleur) est concernée par le décret BACS au titre du système de chauffage (R175-1 §1).</strong></p>
<p>Une chaudière assure la production de chaleur pour le bâtiment, qu\'elle soit alimentée par combustion (gaz, fioul, biomasse), par effet Joule, par pompe à chaleur ou par échange avec un réseau de chaleur. Elle dispose de son propre régulateur embarqué qui pilote en autonomie l\'allumage, la modulation de puissance et la sécurité. La solution Buildy supervise la chaudière en lisant ses états, mesures et alarmes, et en lui transmettant des commandes et consignes depuis l\'application Hyperveez.</p>
`.trim(),
  points: [
    { slug: 'etat.marche_arret', label: 'État marche/arrêt', dataType: 'État', direction: 'read', techName: 'CHAUD_ETAT', nature: 'Booléen', position: 10 },
    { slug: 'etat.mode', label: 'Mode de fonctionnement (été/hiver/auto)', dataType: 'État', direction: 'read', techName: 'CHAUD_MODE', nature: 'Enum', position: 20 },
    { slug: 'temp.depart_chauffage', label: 'Température départ chauffage', dataType: 'Mesure', direction: 'read', unit: '°C', techName: 'T_DEPART', nature: 'Numérique', position: 30 },
    { slug: 'temp.retour_chauffage', label: 'Température retour chauffage', dataType: 'Mesure', direction: 'read', unit: '°C', techName: 'T_RETOUR', nature: 'Numérique', position: 40 },
    { slug: 'temp.fumees', label: 'Température fumées', dataType: 'Mesure', direction: 'read', unit: '°C', position: 50 },
    { slug: 'pression.circuit', label: 'Pression circuit', dataType: 'Mesure', direction: 'read', unit: 'bar', position: 60 },
    { slug: 'puissance.instantanee', label: 'Puissance instantanée', dataType: 'Mesure', direction: 'read', unit: 'kW', position: 70 },
    { slug: 'consigne.depart_effective', label: 'Consigne départ effective', dataType: 'Mesure', direction: 'read', unit: '°C', position: 80 },
    { slug: 'compteur.heures_fonctionnement', label: 'Compteur d\'heures de fonctionnement', dataType: 'Mesure', direction: 'read', unit: 'h', nature: 'Numérique', position: 90 },
    { slug: 'compteur.demarrages', label: 'Nombre de démarrages', dataType: 'Mesure', direction: 'read', position: 100 },
    { slug: 'alarme.defaut_general', label: 'Défaut général', dataType: 'Alarme', direction: 'read', techName: 'CHAUD_DEFAUT', nature: 'Booléen', position: 110 },
    { slug: 'alarme.defaut_bruleur', label: 'Défaut brûleur / allumage', dataType: 'Alarme', direction: 'read', position: 120 },
    { slug: 'alarme.surchauffe', label: 'Alarme surchauffe', dataType: 'Alarme', direction: 'read', position: 130 },
    { slug: 'alarme.manque_eau', label: 'Alarme manque d\'eau / pression basse', dataType: 'Alarme', direction: 'read', position: 140 },
    { slug: 'alarme.defaut_communication', label: 'Défaut communication régulateur', dataType: 'Alarme', direction: 'read', position: 150 },
    { slug: 'cmd.marche_arret', label: 'Commande marche/arrêt', dataType: 'Commande', direction: 'write', techName: 'CHAUD_CMD', nature: 'Booléen', position: 200 },
    { slug: 'cmd.mode', label: 'Commande mode (été/hiver/auto)', dataType: 'Commande', direction: 'write', nature: 'Enum', position: 210 },
    { slug: 'consigne.depart', label: 'Consigne température départ', dataType: 'Consigne', direction: 'write', unit: '°C', techName: 'CONS_DEPART', nature: 'Numérique', position: 220 },
    { slug: 'consigne.confort_reduit', label: 'Consigne confort/réduit', dataType: 'Consigne', direction: 'write', position: 230 },
  ],
};
