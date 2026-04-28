'use strict';

module.exports = {
  slug: 'qai',
  name: 'Capteur qualité de l\'air intérieur',
  category: 'qai',
  bacs_articles: null,
  bacs_justification: null,
  preferred_protocols: 'Modbus TCP,KNX/IP,LoRaWAN,MQTT',
  icon_kind: 'fa',
  icon_value: 'fa-leaf',
  icon_color: '#10b981',
  description_html: `
<p>Un capteur de qualité de l\'air intérieur mesure les paramètres représentatifs du confort et de la santé des occupants : CO₂, COV, particules fines, humidité, température.</p>

<p>La <strong>sensibilité et la fréquence d\'acquisition sont déterminées par le capteur lui-même</strong>.</p>

<p>La solution Buildy lit ces mesures pour alimenter les tableaux de bord QAI, déclencher des alertes et, le cas échéant, moduler la ventilation associée.</p>
`.trim(),
  points: [
    { slug: 'mesure.co2', label: 'Concentration CO₂', dataType: 'Mesure', direction: 'read', unit: 'ppm', position: 10 },
    { slug: 'mesure.cov', label: 'COV totaux', dataType: 'Mesure', direction: 'read', unit: 'ppb', position: 20 },
    { slug: 'mesure.pm25', label: 'Particules fines PM2.5', dataType: 'Mesure', direction: 'read', unit: 'µg/m³', position: 30 },
    { slug: 'mesure.pm10', label: 'Particules fines PM10', dataType: 'Mesure', direction: 'read', unit: 'µg/m³', position: 40 },
    { slug: 'mesure.humidite', label: 'Humidité relative', dataType: 'Mesure', direction: 'read', unit: '%', position: 50 },
    { slug: 'mesure.temperature', label: 'Température ambiante', dataType: 'Mesure', direction: 'read', unit: '°C', position: 60 },
    { slug: 'mesure.formaldehyde', label: 'Formaldéhyde (HCHO)', dataType: 'Mesure', direction: 'read', unit: 'µg/m³', position: 70 },
    { slug: 'alarme.seuil_co2', label: 'Dépassement seuil CO₂', dataType: 'Alarme', direction: 'read', position: 80 },
    { slug: 'alarme.defaut_capteur', label: 'Défaut capteur', dataType: 'Alarme', direction: 'read', position: 90 },
  ],
};
