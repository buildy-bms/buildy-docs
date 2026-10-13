// Bulles des sigles et des protocoles de communication, en clair (petit module : importé par des
// composants partagés comme SearchableSelect, sans charger tout lib/library-tips.js).

// Pastille d'un protocole (« Modbus TCP », « DALI »…) : à quoi sert ce langage, en clair, et la
// liaison (réseau informatique ou câble dédié) quand le nom la précise.
const PROTOCOL_FAMILIES = [
  { re: /modbus/, text: 'Langage d’échange très répandu entre automates, compteurs et équipements techniques.' },
  { re: /bacnet/, text: 'Langage standard de la GTB, compris par la plupart des équipements de chauffage et de climatisation.' },
  { re: /knx/, text: 'Standard européen pour piloter l’éclairage, les stores et le chauffage pièce par pièce.' },
  { re: /m-?bus/, text: 'Bus qui relève à distance les compteurs d’électricité, d’eau et de chaleur.' },
  { re: /mqtt/, text: 'Échange de messages entre objets connectés et logiciels, par un serveur.' },
  { re: /opc/, text: 'Standard industriel d’échange de données entre automates et logiciels.' },
  { re: /lora/, text: 'Réseau radio longue portée pour des capteurs sans fil, sur pile.' },
  { re: /dali/, text: 'Bus de pilotage de l’éclairage, luminaire par luminaire.' },
  { re: /ocpp/, text: 'Langage de pilotage des bornes de recharge de véhicules électriques.' },
  { re: /\blon/, text: 'Ancien réseau d’automatismes du bâtiment, encore présent sur certains sites.' },
  { re: /enocean/, text: 'Radio sans pile pour interrupteurs et capteurs autonomes.' },
  { re: /zigbee/, text: 'Radio courte portée pour capteurs et objets connectés.' },
  { re: /\brest\b|\bapi\b|http/, text: 'Échange par internet avec le logiciel d’un fabricant.' },
];
const PROTOCOL_LINKS = [
  { re: /tcp|\/ip|\bip\b/, value: 'réseau informatique' },
  { re: /rtu|ms\/?tp|\btp\b|filaire|rs-?485/, value: 'câble dédié (bus)' },
];
export function protocolTip(label) {
  const name = String(label ?? '').trim();
  if (!name) return null;
  const key = name.toLowerCase();
  const family = PROTOCOL_FAMILIES.find((f) => f.re.test(key));
  if (!family) return null;
  const link = PROTOCOL_LINKS.find((l) => l.re.test(key));
  return {
    title: name,
    icon: 'network-wired',
    tone: 'info',
    text: family.text,
    ...(link ? { rows: [{ label: 'Liaison', value: link.value }] } : {}),
  };
}

// Sigles affichés tels quels (catégories, zones) : leur nom complet.
const ABBREVIATIONS = {
  ECS: 'Eau chaude sanitaire',
  QAI: 'Qualité de l’air intérieur',
  PV: 'Production photovoltaïque',
  CTA: 'Centrale de traitement d’air',
  CVC: 'Chauffage, ventilation et climatisation',
  IRVE: 'Recharge de véhicules électriques',
  TGBT: 'Tableau général basse tension',
  GTB: 'Gestion technique du bâtiment',
  DRV: 'Débit de réfrigérant variable',
  PAC: 'Pompe à chaleur',
  AGBT: 'Armoire générale basse tension',
  RDC: 'Rez-de-chaussée',
  SSI: 'Système de sécurité incendie',
  VMC: 'Ventilation mécanique contrôlée',
  GTC: 'Gestion technique centralisée',
  UTA: 'Unité de traitement d’air',
};
export function abbreviationTip(label) {
  const key = String(label ?? '').trim().toUpperCase();
  return ABBREVIATIONS[key] || null;
}

