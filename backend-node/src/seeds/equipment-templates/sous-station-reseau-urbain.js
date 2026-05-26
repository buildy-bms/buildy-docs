'use strict';

/**
 * Sous-station de réseau de chaleur urbain.
 *
 * Sert de marqueur métier pour le calcul d'assujettissement BACS :
 * dès qu'un équipement du système utilise ce modèle, le système parent
 * est automatiquement considéré comme une sous-station (cas E de
 * `lib/bacs-liability.js`) — le gestionnaire de réseau n'est PAS
 * assujetti, l'assujetti est le propriétaire du bâtiment pour
 * l'installation intérieure.
 *
 * La détection se fait via `equipment_template_id` côté dérivation
 * (cf. `_export-data.js` → enrichissement du système avant
 * `computeSystemLiability`). Le slug ne doit pas changer.
 */

module.exports = {
  slug: 'sous-station-reseau-urbain',
  name: 'Sous-station de réseau de chaleur urbain',
  category: 'chauffage',
  bacs_articles: 'R175-2',
  bacs_justification: '<p>Selon l\'article R175-2, lorsque la chaleur (ou le froid) du bâtiment est produite par échange avec un <strong>réseau de chaleur ou de froid urbain</strong>, la puissance à considérer pour l\'assujettissement BACS est celle de la <strong>station d\'échange</strong> (sous-station) — et non celle des générateurs amont, qui appartiennent au gestionnaire du réseau.</p><p>Le gestionnaire du réseau n\'est <strong>pas assujetti</strong> au décret BACS pour l\'installation intérieure du bâtiment desservi : l\'assujetti est le propriétaire du bâtiment, pour la partie aval de la sous-station.</p>',
  preferred_protocols: 'Modbus TCP,BACnet/IP,M-Bus',
  default_energy_source: 'district_heating',
  default_device_role: ['production', 'distribution', 'regulation'],
  icon_kind: 'fa',
  icon_value: 'fa-temperature-arrow-up',
  icon_color: '#dc2626',
  description_html: `
<p>Une sous-station de réseau de chaleur (ou de froid) urbain assure l'échange thermique entre le réseau primaire (gestionnaire du réseau) et le secondaire (bâtiment) via un échangeur à plaques ou un module thermique.</p>

<p>Au sens du décret BACS, la sous-station est <strong>le générateur de chaleur du bâtiment</strong> : c'est sa puissance nominale (côté primaire ou secondaire selon le contrat) qui détermine l'assujettissement (R175-2).</p>

<p>Côté assujettissement : le <strong>gestionnaire du réseau</strong> qui livre l'énergie n'est pas assujetti pour le bâtiment desservi. L'<strong>assujetti est le propriétaire du bâtiment</strong> pour la régulation, le pilotage et le suivi continu de la sous-station et de la distribution intérieure.</p>

<p>L'intégration Buildy supervise les températures primaire / secondaire, débit, puissance échangée, alarmes, et expose les consignes de régulation secondaire.</p>
`.trim(),
  points: [
    { slug: 'etat.echangeur', label: 'État échangeur', dataType: 'État', direction: 'read', position: 10, techName: 'On_Off_R', nature: 'Booléen' },
    { slug: 'temp.primaire_aller', label: 'Température primaire aller', dataType: 'Mesure', direction: 'read', unit: '°C', position: 20, techName: 'Supply_Water_Temp_R', nature: 'Numérique' },
    { slug: 'temp.primaire_retour', label: 'Température primaire retour', dataType: 'Mesure', direction: 'read', unit: '°C', position: 30, techName: 'Return_Water_Temp_R', nature: 'Numérique' },
    { slug: 'temp.secondaire_depart', label: 'Température secondaire départ', dataType: 'Mesure', direction: 'read', unit: '°C', position: 40, techName: 'Supply_Water_Temp_R', nature: 'Numérique' },
    { slug: 'temp.secondaire_retour', label: 'Température secondaire retour', dataType: 'Mesure', direction: 'read', unit: '°C', position: 50, techName: 'Return_Water_Temp_R', nature: 'Numérique' },
    { slug: 'debit.primaire', label: 'Débit primaire', dataType: 'Mesure', direction: 'read', unit: 'm³/h', position: 60, nature: 'Numérique' },
    { slug: 'puissance.echangee', label: 'Puissance échangée', dataType: 'Mesure', direction: 'read', unit: 'kW', position: 70, nature: 'Numérique' },
    { slug: 'energie.cumulee', label: 'Énergie cumulée livrée', dataType: 'Mesure', direction: 'read', unit: 'kWh', position: 80, nature: 'Numérique' },
    { slug: 'pression.primaire', label: 'Pression primaire', dataType: 'Mesure', direction: 'read', unit: 'bar', position: 90, techName: 'Pressure_R', nature: 'Numérique' },
    { slug: 'pression.secondaire', label: 'Pression secondaire', dataType: 'Mesure', direction: 'read', unit: 'bar', position: 100, techName: 'Pressure_R', nature: 'Numérique' },
    { slug: 'consigne.secondaire', label: 'Consigne départ secondaire', dataType: 'Mesure', direction: 'read', unit: '°C', position: 110, techName: 'Setpoint_Temp_R', nature: 'Numérique' },
    { slug: 'alarme.defaut_echangeur', label: 'Défaut échangeur', dataType: 'Alarme', direction: 'read', position: 120, techName: 'System_Fault_R', nature: 'Booléen' },
    { slug: 'alarme.defaut_vanne_primaire', label: 'Défaut vanne primaire', dataType: 'Alarme', direction: 'read', position: 130, techName: 'System_Fault_R', nature: 'Booléen' },
    { slug: 'alarme.fuite', label: 'Alarme fuite', dataType: 'Alarme', direction: 'read', position: 140, techName: 'System_Fault_R', nature: 'Booléen' },
    { slug: 'cmd.marche_arret', label: 'Commande marche/arrêt secondaire', dataType: 'Commande', direction: 'write', position: 200, techName: 'On_Off_W', nature: 'Booléen' },
    { slug: 'consigne.depart_secondaire', label: 'Consigne température départ secondaire', dataType: 'Consigne', direction: 'write', unit: '°C', position: 210, techName: 'Setpoint_Temp_W', nature: 'Numérique' },
  ],
};
