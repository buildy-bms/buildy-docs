'use strict';

/**
 * Fixture pour l'atelier de design du PDF audit BACS.
 *
 * Retourne un dataset fictif **ultra-complet et crédible** qui exerce tous
 * les cas du template `templates/pdf/bacs-audit.hbs`. Servi par la route dev
 * `GET /api/bacs-audit/__preview-fixture` (cf. routes/bacs-audit/exports.js).
 *
 * Double usage :
 *  1. Itération design — on edite le HBS/CSS et on rafraichit la preview.
 *  2. Livrable technico-commercial — Buildy peut envoyer le PDF généré comme
 *     exemple de ce qu'on délivre (test crédibilité : un technicien ne doit
 *     pas pouvoir dire que c'est fictif).
 *
 * Site fictif : Plateforme Logistique Atlas Sud — Saint-Quentin-Fallavier
 * (45 000 m² bati, PC 2017, assujetti R175-2 immédiat). Représentatif du
 * parc logistique français récent — c'est exactement le type de site sur
 * lequel Buildy intervient.
 *
 * La shape du retour est strictement alignée sur celle de
 * `buildBacsAuditExportData()` dans `_export-data.js`. Toute évolution là-bas
 * doit être répercutée ici (sinon le template plante).
 */

const fs = require('fs');
const path = require('path');
const { loadAssetDataUrl } = require('../../lib/pdf');
const bacsArticlesData = require('../../seeds/bacs-articles');
const bacsAuditMethodologyStatic = require('../../lib/bacs-audit-methodology');
const bacsAuditDisclaimersStatic = require('../../lib/bacs-audit-disclaimers');
const {
  SYSTEM_LABEL, SYSTEM_NEGATIVE_LABEL, COMM_LABEL, ENERGY_LABEL, ROLE_LABEL,
  METER_TYPE_LABEL, METER_USAGE_LABEL, REGULATION_LABEL, GENERATOR_LABEL,
  APPLICABILITY_LABEL, COMPLIANCE_LABEL, ZONE_NATURE_LABEL,
} = require('./_labels');
const { buildComplianceSummary } = require('./_compliance-summary');

// Lazy require de pdf-charts (chartjs-node-canvas) — même pattern que
// _export-data.js pour éviter de polluer require.cache au boot Fastify.
let _charts = null;
function getCharts() {
  if (!_charts) _charts = require('../../lib/pdf-charts');
  return _charts;
}

// ─── Photos ─────────────────────────────────────────────────────────
// Placeholders 1280x720 generes par data/fixtures/photos/_generate.js.
// Charges en data URL pour embed dans le HTML/PDF (pas de fetch reseau).
const PHOTOS_DIR = path.resolve(__dirname, '../../../../data/fixtures/photos');

const photoCache = new Map();
function loadPhoto(filename) {
  if (photoCache.has(filename)) return photoCache.get(filename);
  const fullPath = path.join(PHOTOS_DIR, filename);
  if (!fs.existsSync(fullPath)) {
    console.warn(`[fixture] Photo introuvable: ${fullPath}`);
    return null;
  }
  const buf = fs.readFileSync(fullPath);
  const url = `data:image/png;base64,${buf.toString('base64')}`;
  photoCache.set(filename, url);
  return url;
}
function photoItem(id, filename) {
  const dataUrl = loadPhoto(filename);
  return dataUrl ? { id, dataUrl } : null;
}

// ═══════════════════════════════════════════════════════════════════
// 1. DOCUMENT (audit BACS) + SITE
// ═══════════════════════════════════════════════════════════════════

const DOCUMENT = {
  document_id: 9001,
  kind: 'bacs_audit',
  client_name: 'Atlas Logistics SAS',
  project_name: 'Plateforme Atlas Sud — Mise en conformité BACS',
  slug: 'plateforme-atlas-sud-bacs',
  status: 'review',
  bacs_total_power_kw: 522,
  bacs_district_heating_substation_kw: null,
  bacs_building_permit_date: '2017-06-15',
  // Travaux generateur post-2021-07-21 declenchent R175-6 (remplacement
  // des bruleurs des aerothermes Reznor en 2023 par Sodexo).
  bacs_generator_works_date: '2023-04-12',
  bacs_applicability_status: 'subject_immediate',
  audit_existing_af_status: 'absent',
  audit_synthesis_html: `
    <p>La <strong>Plateforme Logistique Atlas Sud</strong> (45 000 m² bâtis, mise en service 2019) est <strong>assujettie au décret BACS R175-2</strong> dès aujourd'hui : la puissance nominale utile cumulée chauffage + climatisation atteint <strong>522 kW</strong>, soit largement au-dessus du seuil de 290 kW. La conformité doit être atteinte sans délai.</p>
    <p>Le site dispose déjà d'une <strong>GTB Schneider EcoStruxure Building Operation</strong> (déployée en 2019 par Sodexo Energy Services) qui couvre honnêtement les usages tertiaires du bloc Bureaux R+1 (chauffage / refroidissement / ventilation). Cette base est saine et exploitable. <strong>Mais elle laisse un périmètre fonctionnel important hors supervision</strong> : les <strong>aérothermes gaz Reznor</strong> des cellules logistiques, le <strong>DRV Daikin VRV IV</strong> des bureaux, le sub-comptage électrique par usage, l'<strong>éclairage industriel</strong> des cellules, et la production photovoltaïque ne remontent pas dans la GTB.</p>
    <p>Quinze actions correctives sont nécessaires, dont <strong>5 bloquantes</strong> à traiter en priorité (intégration des aérothermes, intégration du DRV Daikin via passerelle CoolMaster Pro, sub-comptage électrique, complétion du suivi continu pas horaire, formalisation de la mise à disposition des données aux exploitants). Le reste — 6 actions majeures et 4 mineures — est étalable sur 12 mois. <strong>L'effort global d'intégration est dans la moyenne du parc logistique de cette génération</strong> : ni dramatique ni anecdotique. Buildy chiffrera le détail par lot d'intervention dans le devis associé.</p>
  `.trim(),
};

const SITE = {
  site_id: 9001,
  site_uuid: 'fixture-atlas-sud-uuid',
  name: 'Plateforme Logistique Atlas Sud',
  address: '12 rue des Chesnes, Parc des Chesnes, 38070 Saint-Quentin-Fallavier',
};

// ═══════════════════════════════════════════════════════════════════
// 2. ZONES FONCTIONNELLES (R175-1 6° — regroupement par usage primaire)
// ═══════════════════════════════════════════════════════════════════

const ZONES_RAW = [
  { zone_id: 1, name: 'Cellules logistiques',  nature: 'logistic-cell',   surface_m2: 38000, position: 1, ref: 'Z-001',
    notes_html: '<p>6 cellules sec classe A regroupées comme une seule zone fonctionnelle. Chauffage par aérothermes gaz Reznor (12 unités), ventilation naturelle haute via lanterneaux désenfumage + extracteurs en toiture, éclairage LED industrielles 200 W avec détection de présence (~280 luminaires).</p>',
    photoFiles: ['P-001.png', 'P-002.png', 'P-003.png', 'P-004.png'] },
  { zone_id: 2, name: 'Bureaux',                nature: 'open-space',      surface_m2:  2000, position: 2, ref: 'Z-002',
    notes_html: '<p>Bloc bureaux R+1 multi-services Atlas Logistics (administration, exploitation, sécurité, RH). Climatisation par DRV Daikin VRV IV non communicant avec la GTB.</p>',
    photoFiles: ['P-005.png', 'P-006.png', 'P-007.png'] },
  { zone_id: 3, name: 'Locaux sociaux',         nature: 'shared-space',    surface_m2:   500, position: 3, ref: 'Z-003',
    notes_html: '<p>Vestiaires hommes / femmes, réfectoire 80 places, sanitaires. ECS produite par ballon thermodynamique Atlantic 500 L au local technique attenant.</p>',
    photoFiles: ['P-008.png', 'P-009.png', 'P-010.png'] },
  { zone_id: 4, name: 'Locaux techniques',      nature: 'technical-area',  surface_m2:   300, position: 4, ref: 'Z-004',
    notes_html: '<p>Local chaufferie + locaux pompes incendie sprinkler + local GTC -1. Accès toiture via échelle fixe (4 m, point d\'attache présent).</p>',
    photoFiles: ['P-011.png', 'P-012.png', 'P-013.png'] },
  { zone_id: 5, name: 'Parkings et abords',     nature: 'outdoor',         surface_m2:  8000, position: 5, ref: 'Z-005',
    notes_html: '<p>Parking VL (visiteurs + collaborateurs) + parking PL (semi-remorques) + voies de circulation + abords éclairés. Ombrière + toiture parking équipées d\'une centrale photovoltaïque ~250 kWc (mise en service 2020).</p>',
    photoFiles: ['P-014.png', 'P-015.png', 'P-016.png'] },
];

// ═══════════════════════════════════════════════════════════════════
// 3. SYSTEMES TECHNIQUES PAR ZONE FONCTIONNELLE
// ═══════════════════════════════════════════════════════════════════

// system_category x zone_id : on définit pour chaque combinaison si le
// système est present, not_concerned, ou absent. Aligne sur les categories
// du decret BACS et la nomenclature SYSTEM_LABEL.
const SYSTEMS_RAW = [
  // ─── Z-001 Cellules logistiques ───
  { id: 101, zone_id: 1, system_category: 'heating',                present: 1, not_concerned: 0, communication: 'non_communicant' },
  { id: 102, zone_id: 1, system_category: 'cooling',                present: 0, not_concerned: 1 }, // Pas de clim en cellule sec classe A
  { id: 103, zone_id: 1, system_category: 'ventilation',            present: 1, not_concerned: 0, communication: 'non_communicant' },
  { id: 104, zone_id: 1, system_category: 'dhw',                    present: 0, not_concerned: 1 },
  { id: 105, zone_id: 1, system_category: 'lighting_indoor',        present: 1, not_concerned: 0, communication: 'non_communicant',
    notes_html: '<p>~280 luminaires LED industrielles 200 W avec détection de présence locale (autonome, non remontée GTB). Régulation par capteurs PIR uniquement, pas de programmation horaire centralisée.</p>' },
  { id: 106, zone_id: 1, system_category: 'lighting_outdoor',       present: 0, not_concerned: 1 },
  { id: 107, zone_id: 1, system_category: 'electricity_production', present: 0, not_concerned: 1 },
  // ─── Z-002 Bureaux ───
  { id: 201, zone_id: 2, system_category: 'heating',                present: 1, not_concerned: 0, communication: 'non_communicant',
    notes_html: '<p>Chauffage assuré en hiver par le mode chaud du DRV Daikin (PAC inversée). Pas d\'émetteurs additionnels.</p>' },
  { id: 202, zone_id: 2, system_category: 'cooling',                present: 1, not_concerned: 0, communication: 'non_communicant' },
  { id: 203, zone_id: 2, system_category: 'ventilation',            present: 1, not_concerned: 0, communication: 'modbus_tcp' },
  { id: 204, zone_id: 2, system_category: 'dhw',                    present: 0, not_concerned: 1 },
  { id: 205, zone_id: 2, system_category: 'lighting_indoor',        present: 1, not_concerned: 0, communication: 'absent',
    notes_html: '<p>Éclairage bureaux LED DALI géré par scénarios locaux (interrupteurs muraux). Pas d\'intégration GTB ni de programmation horaire.</p>' },
  { id: 206, zone_id: 2, system_category: 'lighting_outdoor',       present: 0, not_concerned: 1 },
  { id: 207, zone_id: 2, system_category: 'electricity_production', present: 0, not_concerned: 1 },
  // ─── Z-003 Locaux sociaux ───
  { id: 301, zone_id: 3, system_category: 'heating',                present: 0, not_concerned: 1 }, // Chauffé par diffusion bureaux
  { id: 302, zone_id: 3, system_category: 'cooling',                present: 0, not_concerned: 1 },
  { id: 303, zone_id: 3, system_category: 'ventilation',            present: 1, not_concerned: 0, communication: 'modbus_tcp' },
  { id: 304, zone_id: 3, system_category: 'dhw',                    present: 1, not_concerned: 0, communication: 'absent',
    notes_html: '<p>Ballon ECS thermodynamique Atlantic 500 L pour vestiaires/sanitaires. Régulation autonome (programmateur intégré). Pas de remontée GTB.</p>' },
  { id: 305, zone_id: 3, system_category: 'lighting_indoor',        present: 1, not_concerned: 0, communication: 'absent' },
  { id: 306, zone_id: 3, system_category: 'lighting_outdoor',       present: 0, not_concerned: 1 },
  { id: 307, zone_id: 3, system_category: 'electricity_production', present: 0, not_concerned: 1 },
  // ─── Z-004 Locaux techniques ───
  { id: 401, zone_id: 4, system_category: 'heating',                present: 0, not_concerned: 1 }, // Hors confort
  { id: 402, zone_id: 4, system_category: 'cooling',                present: 0, not_concerned: 1 },
  { id: 403, zone_id: 4, system_category: 'ventilation',            present: 1, not_concerned: 0, communication: 'modbus_tcp' },
  { id: 404, zone_id: 4, system_category: 'dhw',                    present: 0, not_concerned: 1 },
  { id: 405, zone_id: 4, system_category: 'lighting_indoor',        present: 1, not_concerned: 0, communication: 'absent' },
  { id: 406, zone_id: 4, system_category: 'lighting_outdoor',       present: 0, not_concerned: 1 },
  { id: 407, zone_id: 4, system_category: 'electricity_production', present: 0, not_concerned: 1 },
  // ─── Z-005 Parkings et abords ───
  { id: 501, zone_id: 5, system_category: 'heating',                present: 0, not_concerned: 1 },
  { id: 502, zone_id: 5, system_category: 'cooling',                present: 0, not_concerned: 1 },
  { id: 503, zone_id: 5, system_category: 'ventilation',            present: 0, not_concerned: 1 },
  { id: 504, zone_id: 5, system_category: 'dhw',                    present: 0, not_concerned: 1 },
  { id: 505, zone_id: 5, system_category: 'lighting_indoor',        present: 0, not_concerned: 1 },
  { id: 506, zone_id: 5, system_category: 'lighting_outdoor',       present: 1, not_concerned: 0, communication: 'absent',
    notes_html: '<p>Éclairage extérieur LED commandé par horloge crépusculaire. Pas de zonage par poche de parking, pas de détection de présence.</p>' },
  { id: 507, zone_id: 5, system_category: 'electricity_production', present: 1, not_concerned: 0, communication: 'modbus_tcp',
    notes_html: '<p>Centrale PV 250 kWc en autoconsommation collective. Production remontée sur le portail SMA Sunny Portal mais <strong>non intégrée à la GTB Schneider</strong>.</p>' },
];

// ═══════════════════════════════════════════════════════════════════
// 4. EQUIPEMENTS (devices) — marques uniquement sur les significatifs
// ═══════════════════════════════════════════════════════════════════

const DEVICES_RAW = [
  // ─── Z-001 Cellules logistiques ───
  { id: 1001, system_id: 101, ref: 'E-001', name: 'Aérothermes gaz cellules', brand: 'Reznor', model_reference: 'UDAP 100 (12 unités)',
    energy_source: 'gas', power_kw: 360, device_role: 'production',
    communication_protocol: 'non_communicant', location: '6 cellules logistiques (2 par cellule)',
    out_of_service: 0, meets_r175_3_p3: 0, meets_r175_3_p4: 0, meets_r175_3_p4_autonomous: 1,
    photoFiles: ['P-017.png', 'P-018.png', 'P-019.png'],
    notes_html: '<p>12 aérothermes gaz Reznor 30 kW unitaires (360 kW cumulés). Régulation locale par thermostat d\'ambiance déporté + programmation horaire mécanique. <strong>Aucune interface communicante</strong> (uniquement contacts secs marche/arrêt). Maintenance assurée par Sodexo dans le cadre du contrat global.</p>' },
  { id: 1002, system_id: 103, ref: 'E-002', name: 'Extracteurs ventilation cellules', brand: 'Aldes', model_reference: 'VEX 280',
    energy_source: 'electric', power_kw: 18, device_role: 'distribution',
    communication_protocol: 'non_communicant', location: 'Toiture 6 cellules',
    out_of_service: 0, meets_r175_3_p3: 0, meets_r175_3_p4: 1, meets_r175_3_p4_autonomous: 1,
    notes_html: '<p>Extracteurs en toiture pilotés par horloge mécanique simple. Démarrage manuel possible via TGBT. Pas de régulation CO₂, pas de variation de débit selon occupation.</p>' },
  // ─── Z-002 Bureaux ───
  { id: 2001, system_id: 201, ref: 'E-003', name: 'DRV Daikin VRV IV — chauffage bureaux', brand: 'Daikin', model_reference: 'RXYQ-T VRV IV',
    energy_source: 'electric', power_kw: 56, device_role: 'production',
    communication_protocol: 'autre', location: 'Toiture bureaux + UI plafonniers Daikin',
    out_of_service: 0, meets_r175_3_p3: 0, meets_r175_3_p4: 0, meets_r175_3_p4_autonomous: 1,
    photoFiles: ['P-020.png', 'P-021.png', 'P-022.png'],
    notes_html: '<p>Système DRV Daikin VRV IV à récupération de chaleur, 12 UI plafonniers cassettes type Roundflow. Pilotage par télécommandes filaires Daikin BRC1H + supervision via Daikin Cloud Service. <strong>Protocole propriétaire P1/P2 (D-III Net)</strong> — non interopérable nativement avec la GTB Schneider EcoStruxure (BACnet IP). Cas type pour passerelle <strong>CoolMaster Pro</strong> (cf. action BACS-002).</p>' },
  { id: 2002, system_id: 202, ref: 'E-003-bis', name: 'DRV Daikin VRV IV — refroidissement bureaux', brand: 'Daikin', model_reference: 'RXYQ-T VRV IV',
    energy_source: 'electric', power_kw: 64, device_role: 'production',
    communication_protocol: 'autre', location: 'Toiture bureaux',
    out_of_service: 0, meets_r175_3_p3: 0, meets_r175_3_p4: 0, meets_r175_3_p4_autonomous: 1,
    notes_html: '<p>Mode froid du même DRV Daikin (E-003). Comptabilisé séparément ici uniquement pour le calcul de puissance R175-2 (chauffage + climatisation cumulés).</p>' },
  { id: 2003, system_id: 203, ref: 'E-004', name: 'CTA double flux bureaux', brand: 'Aldes', model_reference: 'DFE Compact 4500',
    energy_source: 'electric', power_kw: 8, device_role: 'distribution',
    communication_protocol: 'modbus_tcp', location: 'Local CTA toiture R+1',
    out_of_service: 0, meets_r175_3_p3: 1, meets_r175_3_p4: 1, meets_r175_3_p4_autonomous: 1,
    notes_html: '<p>CTA double flux à récupération sur boucle d\'eau, débit nominal 4 500 m³/h. Régulation par sonde CO₂ retour + horloge GTB. Intégrée à la GTB EcoStruxure (Modbus TCP).</p>' },
  // ─── Z-003 Locaux sociaux ───
  { id: 3001, system_id: 303, ref: 'E-005', name: 'Extracteur ventilation vestiaires', brand: 'Aldes', model_reference: 'CXG 250',
    energy_source: 'electric', power_kw: 1.5, device_role: 'distribution',
    communication_protocol: 'modbus_tcp', location: 'Toiture vestiaires',
    out_of_service: 0, meets_r175_3_p3: 1, meets_r175_3_p4: 1, meets_r175_3_p4_autonomous: 1 },
  { id: 3002, system_id: 304, ref: 'E-006', name: 'Ballon ECS thermodynamique', brand: 'Atlantic', model_reference: 'Calypso Connect VM 500',
    energy_source: 'heat_pump', power_kw: 2.4, device_role: 'production',
    communication_protocol: 'absent', location: 'Local technique attenant vestiaires',
    out_of_service: 0, meets_r175_3_p3: 0, meets_r175_3_p4: 1, meets_r175_3_p4_autonomous: 1,
    photoFiles: ['P-023.png', 'P-024.png'],
    notes_html: '<p>Ballon ECS thermodynamique Atlantic Calypso 500 L, COP 3.2 nominal. Régulation autonome (programmateur intégré, mode Eco/Boost). <strong>Aucune sortie de communication</strong> — pas d\'intégration GTB possible sans rétrofit.</p>' },
  // ─── Z-004 Locaux techniques ───
  { id: 4001, system_id: 403, ref: 'E-007', name: 'Ventilation forcée locaux techniques', brand: 'Aldes', model_reference: 'C4 250',
    energy_source: 'electric', power_kw: 1.2, device_role: 'distribution',
    communication_protocol: 'modbus_tcp', location: 'Toiture locaux techniques',
    out_of_service: 0, meets_r175_3_p3: 1, meets_r175_3_p4: 1, meets_r175_3_p4_autonomous: 1 },
  // ─── Z-005 Parkings ───
  { id: 5001, system_id: 506, ref: 'E-008', name: 'Éclairage extérieur LED parking', brand: null, model_reference: '~80 luminaires LED 80 W',
    energy_source: 'electric', power_kw: 6.4, device_role: 'distribution',
    communication_protocol: 'absent', location: 'Mâts parking + abords',
    out_of_service: 0, meets_r175_3_p3: 0, meets_r175_3_p4: 1, meets_r175_3_p4_autonomous: 1,
    notes_html: '<p>~80 luminaires LED 80 W répartis sur mâts. Commandés par horloge crépusculaire centralisée au TGBT. Pas de zonage par poche de parking, pas de détection de présence — éclairage plein régime de la tombée du jour à l\'aube.</p>' },
  { id: 5002, system_id: 507, ref: 'E-009', name: 'Onduleurs PV ombrière parking', brand: 'SMA', model_reference: 'Sunny Tripower 25000TL (10 unités)',
    energy_source: 'solar', power_kw: 250, device_role: 'production',
    communication_protocol: 'modbus_tcp', location: 'Local onduleurs ombrière toiture parking',
    out_of_service: 0, meets_r175_3_p3: 1, meets_r175_3_p4: 1, meets_r175_3_p4_autonomous: 1,
    photoFiles: ['P-001.png', 'P-002.png', 'P-003.png'],
    notes_html: '<p>10 onduleurs SMA Sunny Tripower 25 kW (250 kWc cumulés), supervision native via SMA Sunny Portal. <strong>Pas d\'intégration GTB</strong> à ce jour — la donnée production remonte uniquement chez SMA, pas dans EcoStruxure (cf. action BACS-006).</p>' },
  // ─── Equipement HS ───
  { id: 4002, system_id: 401, ref: 'E-010', name: 'Ancienne chaudière secours (HS)', brand: 'De Dietrich', model_reference: 'GT 220 (HS)',
    energy_source: 'gas', power_kw: 0, device_role: 'production',
    communication_protocol: 'non_communicant', location: 'Local chaufferie',
    out_of_service: 1, meets_r175_3_p3: 0, meets_r175_3_p4: 0, meets_r175_3_p4_autonomous: 0,
    notes_html: '<p>Ancienne chaudière gaz De Dietrich GT 220 conservée comme « secours froid » mais <strong>déclassée et déconnectée du réseau hydraulique en 2021</strong>. À déposer pour libérer le local.</p>' },
];

// ═══════════════════════════════════════════════════════════════════
// 5. COMPTEURS (R175-3 1°)
// ═══════════════════════════════════════════════════════════════════

const METERS_RAW = [
  { id: 7001, ref: 'M-001', zone_id: null, usage: 'other',     meter_type: 'electric',
    required: 1, present_actual: 1, communicating: 1, managed_by_bms: 1, out_of_service: 0,
    notes_html: '<p>Schneider iEM3155 sur le départ TGBT général. Donnée horaire archivée 5 ans dans EcoStruxure.</p>',
    photoFiles: ['P-004.png', 'P-005.png', 'P-006.png'] },
  { id: 7002, ref: 'M-002', zone_id: 1,    usage: 'other',     meter_type: 'electric',
    required: 1, present_actual: 0, communicating: 0, managed_by_bms: 0, out_of_service: 0,
    notes: 'Sub-comptage électrique dédié Cellules logistiques attendu mais non installé.' },
  { id: 7003, ref: 'M-003', zone_id: 2,    usage: 'other',     meter_type: 'electric',
    required: 1, present_actual: 1, communicating: 1, managed_by_bms: 1, out_of_service: 0,
    notes: 'iEM3155 dédié bureaux, mais ne discrimine pas le DRV Daikin du reste des usages.' },
  { id: 7004, ref: 'M-004', zone_id: null, usage: 'heating',   meter_type: 'gas',
    required: 1, present_actual: 1, communicating: 0, managed_by_bms: 0, out_of_service: 0,
    notes: 'Itron Cyble Sensor sur arrivée gaz aérothermes cellules. Sortie impulsion non raccordée.' },
  { id: 7005, ref: 'M-005', zone_id: 3,    usage: 'dhw',       meter_type: 'water',
    required: 1, present_actual: 1, communicating: 0, managed_by_bms: 0, out_of_service: 1,
    notes_html: '<p>Sappel Aquadis+ sur ECS vestiaires. <strong>Tête électronique HS</strong> (foudre 2024). Index relevé manuellement.</p>',
    photoFiles: ['P-007.png', 'P-008.png', 'P-009.png'] },
  { id: 7006, ref: 'M-006', zone_id: 5,    usage: 'pv',        meter_type: 'electric_production',
    required: 1, present_actual: 1, communicating: 1, managed_by_bms: 0, out_of_service: 0,
    notes_html: '<p>SMA Energy Meter en pied de centrale PV. Donnée disponible via SMA Sunny Portal mais <strong>non remontée dans la GTB</strong>.</p>' },
  { id: 7007, ref: 'M-007', zone_id: 1,    usage: 'lighting',  meter_type: 'electric',
    required: 1, present_actual: 0, communicating: 0, managed_by_bms: 0, out_of_service: 0,
    notes_html: '<p>Sub-comptage éclairage cellules attendu (R175-3 1°). Compteur en hauteur sous gaine, accès par échelle hauteur 4 m.</p>' },
  { id: 7008, ref: 'M-008', zone_id: null, usage: 'other',     meter_type: 'water',
    required: 1, present_actual: 1, communicating: 1, managed_by_bms: 1, out_of_service: 0,
    notes: 'Compteur eau froide générale du site. Intégré GTB en 2022.' },
];

// ═══════════════════════════════════════════════════════════════════
// 6. REGULATION THERMIQUE (R175-6)
// ═══════════════════════════════════════════════════════════════════

// Mig 135 : generator_type et generator_age_years ont migré sur le
// device pointé via generator_device_id. La fixture ne les set plus ici.
const THERMAL_RAW = [
  { id: 8001, ref: 'T-001', zone_id: 1, category: 'heating',
    has_automatic_regulation: 1, regulation_type: 'per_zone',
    generator_exempt_wood: 0, sensor_position: 'Mural cellule',
    thermostat_type: 'programmable', has_thermostatic_valves: 0,
    notes: 'Régulation par thermostat d\'ambiance par cellule. Programmation horaire mécanique.' },
  { id: 8002, ref: 'T-002', zone_id: 2, category: 'heating',
    has_automatic_regulation: 1, regulation_type: 'central_only',
    generator_exempt_wood: 0, sensor_position: 'Reprise plafonnier UI',
    thermostat_type: 'connected', has_thermostatic_valves: 0,
    notes: 'Régulation centrale via UI Daikin BRC1H. Pas de zonage R175-6 (1 seule consigne pour les 12 UI).' },
  { id: 8003, ref: 'T-003', zone_id: 2, category: 'cooling',
    has_automatic_regulation: 1, regulation_type: 'central_only',
    generator_exempt_wood: 0, sensor_position: 'Reprise plafonnier UI',
    thermostat_type: 'connected', has_thermostatic_valves: 0,
    notes: 'Idem chauffage : 1 seule consigne pour le bloc bureaux. Zonage R175-6 attendu en open-space.' },
  { id: 8004, ref: 'T-004', zone_id: 3, category: 'heating',
    has_automatic_regulation: 0, regulation_type: 'none',
    generator_exempt_wood: 0, sensor_position: null,
    thermostat_type: null, has_thermostatic_valves: 0,
    notes: 'Locaux sociaux chauffés par diffusion bureaux, pas de régulation propre.' },
];

// ═══════════════════════════════════════════════════════════════════
// 7. GTB (R175-3 / R175-4 / R175-5)
// ═══════════════════════════════════════════════════════════════════

const BMS = {
  document_id: DOCUMENT.document_id,
  existing_solution: 'Schneider EcoStruxure Building Operation',
  existing_solution_brand: 'Schneider Electric',
  model_reference: '1× AS-P 8000 + 6× AS-B (version 3.2)',
  location: 'Local GTC sous-sol -1 (avec accès dédié exploitant)',
  out_of_service: 0,
  manages_heating: 1,
  manages_cooling: 1,
  manages_ventilation: 1,
  manages_dhw: 0,
  manages_lighting: 0,
  provided_protocols: ['modbus_tcp', 'bacnet_ip'],
  // R175-3 §1 — Suivi continu pas horaire 5 ans
  meets_r175_3_p1: 1,
  r175_3_p1_archival_format: 'Base SQL Server (instance dédiée). Exports CSV horaires programmés.',
  r175_3_p1_retention_verified: 1,
  // R175-3 §2 — Détection des pertes d'efficacité
  meets_r175_3_p2: 1,
  r175_3_p2_anomaly_rules_html: `<p>Alertes paramétrées dans EcoStruxure :</p>
    <ul>
      <li>ΔT entre départ et retour CTA &gt; 5 °C en régime stabilisé</li>
      <li>Surconsommation électrique journalière bureaux &gt; 20 % vs J-1 même type de jour</li>
      <li>COP DRV Daikin &lt; 2.5 en mode chaud (calculé indirectement via puissance et température extérieure — partiel car puissance non communicante)</li>
      <li>Dépassement de consigne CO₂ bureaux &gt; 1000 ppm</li>
    </ul>`,
  // R175-3 dernier alinéa — Mise à disposition des données
  data_provision_to_manager: 1,
  data_provision_to_operators: 0,
  notes_data_provision: 'Tableau de bord mensuel envoyé par mail au property manager Atlas Logistics. Pas de portail web ouvert aux exploitants des systèmes techniques (Sodexo, mainteneur DRV Daikin, exploitant PV).',
  data_provision_frequency: 'Mensuel (PDF) + temps réel (accès EcoStruxure restreint)',
  data_provision_format: 'PDF mensuel + dashboard EcoStruxure restreint au property manager',
  // R175-4 — Vérifications périodiques
  has_maintenance_procedures: 1,
  maintenance_periodicity: 'Trimestrielle + annuelle complète',
  maintenance_responsible: 'Sodexo Energy Services (contrat global FM)',
  // R175-5 — Formation exploitant
  operator_trained: 1,
  operator_training_date: '2023-09-12',
  operator_training_provider: 'Schneider Electric Formation',
  operator_training_topics: 'Paramétrage des consignes CTA et DRV, lecture des courbes de tendance, escalade des alarmes N2, exports CSV. Formation initiale uniquement, pas de mise à jour depuis.',
  notes_html: `<p>GTB Schneider EcoStruxure Building Operation déployée par Sodexo Energy Services en 2019. Couverture réelle observée :</p>
    <ul>
      <li><strong>Cellules logistiques :</strong> aucune intégration (aérothermes Reznor non communicants).</li>
      <li><strong>Bureaux :</strong> CTA Aldes intégrée, DRV Daikin <strong>non intégré</strong> (proto propriétaire), éclairage non intégré.</li>
      <li><strong>Locaux sociaux :</strong> ventilation intégrée, ECS thermo non intégrée.</li>
      <li><strong>Locaux techniques :</strong> ventilation intégrée.</li>
      <li><strong>Compteurs :</strong> M-001 (général), M-003 (bureaux), M-008 (eau froide générale).</li>
    </ul>
    <p>Configuration matériel surdimensionnée par rapport à l\'usage actuel — capacité disponible pour intégrer de nouveaux objets sans remplacer la GTB. <strong>Atout majeur</strong> pour la mise en conformité : pas besoin de refondre l\'existant, juste de l\'étendre.</p>`,
  photoFiles: ['P-010.png', 'P-011.png', 'P-012.png', 'P-013.png'],
  overall_compliance: 'partial',
};

// ═══════════════════════════════════════════════════════════════════
// 8. ACTIONS CORRECTIVES (5 bloquantes + 6 majeures + 4 mineures)
// ═══════════════════════════════════════════════════════════════════

const ACTIONS_RAW = [
  // ─── 5 BLOQUANTES ───
  { id: 9001, severity: 'blocking', r175_article: 'R175-3 1°', zone_id: 1, status: 'open',
    title: 'Installer le sub-comptage électrique des Cellules logistiques',
    description: 'Le R175-3 1° impose la mesure horaire des consommations par usage et par zone fonctionnelle. Aucun comptage électrique dédié aux cellules logistiques n\'est aujourd\'hui présent — seul M-001 (général) capture la consommation globale, sans discrimination cellules vs bureaux vs auxiliaires.',
    alternative_solutions_html: `<p><strong>Préconisation Buildy.</strong> Pose d\'1 compteur électrique communicant (Schneider iEM3255 ou équivalent) sur le départ TGBT dédié aux cellules logistiques. Liaison Modbus TCP vers la GTB EcoStruxure existante (capacité disponible). Création d\'un point de mesure horaire dans le data warehouse EcoStruxure avec rétention 5 ans.</p>
      <ul>
        <li>Matériel : 1 compteur Modbus TCP DIN 1 départ + transformateur de courant 250/5 A</li>
        <li>Pose : intervention TGBT 1 j (consignation départ), raccordement Modbus 0.5 j</li>
        <li>Intégration GTB : 0.5 j paramétrage Schneider EcoStruxure</li>
      </ul>
      <p><strong>Justification du choix :</strong> on conserve la GTB existante plutôt que d\'introduire un système de comptage tiers — cohérence opérationnelle pour Sodexo et reporting unifié pour Atlas Logistics.</p>`,
    commercial_notes: 'Devis estimé 2 800 € HT matériel + 1 200 € HT pose/intégration. À chiffrer sur catalogue Schneider iEM 2025.',
    source_meter_id: 7002 },
  { id: 9002, severity: 'blocking', r175_article: 'R175-3 3°', zone_id: 2, status: 'in_progress',
    title: 'Intégrer le DRV Daikin VRV IV via passerelle CoolMaster Pro',
    description: 'Le DRV Daikin VRV IV des bureaux (E-003 / E-003-bis) utilise le protocole propriétaire P1/P2 (D-III Net) et n\'est pas interopérable nativement avec la GTB Schneider EcoStruxure (BACnet IP). Le R175-3 3° exige l\'interopérabilité des systèmes techniques avec la solution de supervision.',
    alternative_solutions_html: `<p><strong>Préconisation Buildy : passerelle CoolMaster Pro CMP-Bnet</strong> (Intesis / CoolAutomation), passerelle dédiée VRV → BACnet/Modbus largement éprouvée en tertiaire.</p>
      <ul>
        <li>Matériel : 1× CoolMaster Pro CMP-Bnet (capacité 64 UI, ici 12 UI utilisées)</li>
        <li>Liaison côté Daikin : raccordement P1/P2 sur le bus principal du DRV (1 paire torsadée)</li>
        <li>Liaison côté GTB : Ethernet TCP → switch local technique → AS-P EcoStruxure</li>
        <li>Intégration : configuration BACnet IP côté GTB (12 objets UI + état générale + consigne globale + alarmes), 1 j</li>
        <li>Mise en service : tests d\'écriture consignes + remontée alarmes + courbes COP indirect, 0.5 j</li>
      </ul>
      <p>Une fois la passerelle en place, on récupère par UI : état marche/arrêt, consigne température, mode (chaud/froid/auto), température ambiante, code défaut. Permet de calculer un COP indirect et d\'alimenter la règle d\'anomalie R175-3 §2 déjà en place dans EcoStruxure.</p>`,
    commercial_notes: 'Devis émis le 2025-04-12 sous référence BUILDY-DEV-2025-0412 (CoolMaster Pro 1 800 € HT + intégration Buildy 2 100 € HT).',
    source_device_id: 2001 },
  { id: 9003, severity: 'blocking', r175_article: 'R175-3 3°', zone_id: 1, status: 'open',
    title: 'Rendre les aérothermes Reznor cellules pilotables et observables par la GTB',
    description: 'Les 12 aérothermes gaz Reznor des cellules logistiques (E-001) ne disposent que de contacts secs marche/arrêt, sans interface communicante. L\'exigence R175-3 3° d\'interopérabilité n\'est pas satisfaite, et le suivi horaire des consommations par zone (R175-3 1°) est impossible.',
    alternative_solutions_html: `<p><strong>Préconisation Buildy : armoire de tête de boucle + automate intermédiaire.</strong></p>
      <ul>
        <li>Pose d\'un automate Wago PFC200 dans le local TGBT cellules</li>
        <li>Récupération des contacts secs marche/arrêt + sondes T° ambiance déjà existantes (1 par cellule)</li>
        <li>Pilotage des 12 aérothermes via 12 sorties relais à partir de la logique automate (programmation horaire centralisée + dérogation locale conservée)</li>
        <li>Liaison Modbus TCP automate → GTB Schneider</li>
      </ul>
      <p>Cette solution évite le remplacement coûteux des aérothermes (qui ont 5 ans et fonctionnent bien). On apporte la couche de pilotage et de remontée GTB sans toucher à l\'organe de production. Variante avec optimisation par mesure CO₂ (pour démarrage modulé selon occupation) chiffrable en option.</p>`,
    commercial_notes: 'Lot complet (auto + cablage + intégration) estimé 18 000 € HT. À sécuriser avec le sub-comptage M-002 dans le même chantier TGBT.',
    source_device_id: 1001 },
  { id: 9004, severity: 'blocking', r175_article: 'R175-3 1°', zone_id: null, status: 'open',
    title: 'Compléter le suivi continu pas horaire pour couvrir les usages absents',
    description: 'EcoStruxure archive bien en pas horaire les usages couverts par la GTB (CTA, ventilations communicantes, compteurs intégrés). Mais 4 usages échappent au suivi : aérothermes cellules, DRV bureaux, ECS thermodynamique, éclairage. Le R175-3 1° impose le suivi de l\'ensemble des usages ; tant que ces 4 trous existent, l\'exigence n\'est pas satisfaite.',
    alternative_solutions_html: `<p><strong>Préconisation Buildy.</strong> Cette action est <em>conditionnée</em> par les 3 actions BACS-001/002/003 ci-dessus : une fois les compteurs ajoutés et les passerelles posées, EcoStruxure peut intégrer les nouveaux points de mesure dans le data warehouse existant (rétention 5 ans déjà en place).</p>
      <p>Effort résiduel après BACS-001/002/003 :</p>
      <ul>
        <li>Création des points de tendance EcoStruxure pour aérothermes (consommation gaz + état marche par cellule), DRV (état marche, consigne, ambiance), ECS (consommation élec + T° ballon)</li>
        <li>Vérification rétention 5 ans sur les nouveaux points</li>
        <li>Mise à jour du tableau de bord property manager avec les nouveaux indicateurs</li>
      </ul>
      <p>Estimation : 1 j paramétrage + 0.5 j contrôle.</p>`,
    commercial_notes: null,
    source_bms_document_id: BMS.document_id },
  { id: 9005, severity: 'blocking', r175_article: 'R175-3 dernier alinéa', zone_id: null, status: 'open',
    title: 'Mettre en place une procédure de mise à disposition des données aux exploitants',
    description: 'Le R175-3 dernier alinéa exige que les données de la GTB soient mises à disposition à la fois du gestionnaire du bâtiment (Atlas Logistics) ET des exploitants des systèmes techniques (Sodexo pour le FM, mainteneur DRV Daikin, exploitant PV SMA). Aujourd\'hui seul Atlas Logistics reçoit le tableau de bord mensuel — Sodexo et les autres mainteneurs n\'ont pas d\'accès structuré aux données.',
    alternative_solutions_html: `<p><strong>Préconisation Buildy.</strong> Mise en place d\'un portail web restreint <strong>BuildyView</strong> (instance dédiée Atlas Sud) qui agrège la donnée EcoStruxure et la rend accessible par profil exploitant :</p>
      <ul>
        <li><strong>Sodexo Energy Services</strong> : accès aux indicateurs CVC + consommations gaz/élec + alertes maintenance</li>
        <li><strong>Mainteneur DRV Daikin</strong> : accès aux indicateurs DRV (état UI, alarmes, COP indirect)</li>
        <li><strong>Exploitant PV SMA</strong> : déjà autonome via SMA Sunny Portal — vérification que la donnée production est bien rapprochable côté Atlas Logistics</li>
      </ul>
      <p>Procédure documentaire associée : signature d\'avenants aux contrats d\'exploitation pour formaliser la mise à disposition (Buildy fournit le modèle). Audit annuel de l\'effectivité de la transmission.</p>
      <p>Effort : déploiement BuildyView 3 j + accompagnement procédure 1 j.</p>`,
    commercial_notes: 'Abonnement BuildyView Atlas Sud : 240 €/mois. Setup initial 4 200 € HT.',
    source_bms_document_id: BMS.document_id },

  // ─── 6 MAJEURES ───
  { id: 9006, severity: 'major', r175_article: 'R175-3 1°', zone_id: 5, status: 'open',
    title: 'Intégrer la production PV (M-006) à la GTB',
    description: 'La centrale PV 250 kWc (E-009) remonte sa production sur SMA Sunny Portal mais pas dans la GTB EcoStruxure. R175-3 1° impose le suivi horaire de tous les usages, production PV incluse pour l\'autoconsommation collective.',
    alternative_solutions_html: `<p><strong>Préconisation Buildy.</strong> Connexion directe des onduleurs SMA en Modbus TCP à la GTB Schneider EcoStruxure (les onduleurs SMA Sunny Tripower exposent nativement Modbus TCP — pas besoin de passerelle).</p>
      <ul>
        <li>Câblage Ethernet du local onduleurs au switch local technique : 1 j</li>
        <li>Intégration des 10 onduleurs comme objets EcoStruxure : 0.5 j</li>
        <li>Création tableau de bord production vs consommation : 0.5 j</li>
      </ul>`,
    commercial_notes: 'Action peu coûteuse, à intégrer dans le lot Cellules pour mutualiser le déplacement.',
    source_meter_id: 7006 },
  { id: 9007, severity: 'major', r175_article: 'R175-3 1°', zone_id: 3, status: 'quoted',
    title: 'Remplacer le compteur eau ECS HS (M-005)',
    description: 'Le compteur eau ECS Sappel Aquadis+ (M-005) a sa tête électronique HS depuis l\'orage de juillet 2024 (foudre). Index relevé manuellement, suivi horaire impossible. Non-conformité R175-3 1° sur l\'usage ECS.',
    alternative_solutions_html: `<p><strong>Préconisation Buildy.</strong> Remplacement par un compteur eau communicant Sappel Aquadis+ neuf (compatible drop-in sur la même tête mécanique — pas de tranchée).</p>
      <ul>
        <li>Matériel : 1× Sappel Aquadis+ DN20 communicant (M-Bus filaire ou radio)</li>
        <li>Pose : 0.5 j (consignation eau froide locaux sociaux)</li>
        <li>Intégration GTB : passerelle M-Bus → Modbus si filaire, ou concentrateur radio si M-Bus radio (à confirmer selon contraintes site)</li>
      </ul>`,
    commercial_notes: 'Devis BUILDY-DEV-2025-0327, 1 450 € HT global. Validé client en attente bon de commande.',
    source_meter_id: 7005 },
  { id: 9008, severity: 'major', r175_article: 'R175-6', zone_id: 2, status: 'open',
    title: 'Compléter le zonage thermique R175-6 sur les Bureaux',
    description: 'Le DRV Daikin pilote actuellement les 12 UI bureaux avec 1 seule consigne globale. Le R175-6 impose une régulation thermique automatique avec des sondes par pièce ou par zone. Sur un open-space + bureaux fermés + salles de réunion, 1 seule consigne ne suffit pas.',
    alternative_solutions_html: `<p><strong>Préconisation Buildy.</strong> À traiter conjointement avec BACS-002 (intégration DRV via CoolMaster Pro). Une fois la passerelle posée, créer dans EcoStruxure 4 zones de consigne distinctes : open-space N+1 nord, open-space N+1 sud, salles de réunion (3), bureaux fermés direction (2). Chaque zone régulée par sa sonde T° ambiante de l\'UI Daikin correspondante.</p>
      <p>Effort : paramétrage seul, pas de matériel additionnel (les sondes sont déjà dans les UI). 1 j configuration + 0.5 j tests.</p>`,
    commercial_notes: null,
    source_thermal_id: 8002 },
  { id: 9009, severity: 'major', r175_article: 'R175-5', zone_id: null, status: 'open',
    title: 'Compléter la formation R175-5 de l\'exploitant',
    description: 'L\'exploitant Sodexo a été formé en septembre 2023 sur le paramétrage CTA + DRV (formation Schneider initiale). Mais la formation n\'a pas couvert : la lecture des courbes de tendance long terme, l\'interprétation des règles d\'anomalie R175-3 §2, l\'export et l\'analyse des CSV horaires. Aucune mise à jour depuis 2023.',
    alternative_solutions_html: `<p><strong>Préconisation Buildy.</strong> Session de formation complémentaire 1 j sur site avec Sodexo, focus :</p>
      <ul>
        <li>Lecture des courbes de tendance EcoStruxure (CTA, DRV après intégration, consommations)</li>
        <li>Comprendre et faire évoluer les règles d\'anomalie R175-3 §2</li>
        <li>Exports CSV horaires + analyses simples (Excel ou outil tiers)</li>
        <li>Atelier pratique sur 3 alarmes types</li>
      </ul>
      <p>À cadencer annuellement (formation continue). Buildy peut prendre en charge ce volet récurrent.</p>`,
    commercial_notes: 'Formation 1 j Sodexo : 1 600 € HT. Forfait annuel renouvelable proposé à 1 200 €/an.',
    source_bms_document_id: BMS.document_id },
  { id: 9010, severity: 'major', r175_article: 'R175-4', zone_id: null, status: 'open',
    title: 'Formaliser et dater la procédure de maintenance R175-4',
    description: 'Sodexo réalise bien des interventions trimestrielles + une révision annuelle, mais la procédure de maintenance écrite n\'est pas datée ni versionnée formellement. R175-4 exige une procédure de vérifications périodiques tracée.',
    alternative_solutions_html: `<p><strong>Préconisation Buildy.</strong> Audit du contrat Sodexo existant + rédaction (ou mise à jour) du document « Procédure de vérifications périodiques R175-4 » daté, versionné, signé par les 3 parties (Atlas Logistics, Sodexo, Buildy). Stockage dans BuildyView avec rappel automatique de revue annuelle.</p>
      <p>Effort Buildy : 1 j rédaction + 0.5 j atelier signature.</p>`,
    commercial_notes: null,
    source_bms_document_id: BMS.document_id },
  { id: 9011, severity: 'major', r175_article: 'R175-3 1°', zone_id: 1, status: 'open',
    title: 'Rendre communicant le compteur gaz aérothermes (M-004)',
    description: 'Le compteur gaz Itron Cyble Sensor sur l\'arrivée gaz aérothermes cellules est présent mais sa sortie impulsion n\'est pas raccordée à la GTB. La consommation gaz cellules n\'est donc pas tracée en pas horaire.',
    alternative_solutions_html: `<p><strong>Préconisation Buildy.</strong> Raccordement de la sortie impulsion Itron Cyble vers un module M-Bus (ou directement Modbus via convertisseur impulsions/Modbus type Wago). Liaison vers la GTB via le même bus que les nouveaux compteurs élec cellules (mutualisation chantier BACS-001 / BACS-003).</p>
      <ul>
        <li>Matériel : convertisseur impulsions Modbus + cablage 1 paire</li>
        <li>Pose + intégration : 0.5 j</li>
      </ul>`,
    commercial_notes: 'À intégrer dans le lot TGBT cellules. Coût marginal ~600 € HT.',
    source_meter_id: 7004 },

  // ─── 4 MINEURES ───
  { id: 9012, severity: 'minor', r175_article: 'R175-3 §2', zone_id: 1, status: 'open',
    title: 'Optimiser la programmation horaire des aérothermes cellules (arrêt nuit/WE)',
    description: 'Une fois les aérothermes intégrés à la GTB (BACS-003), une programmation horaire centralisée permettra d\'éteindre le chauffage des cellules la nuit (22h-5h) et le week-end (sauf mode hors-gel à 8 °C). Économie estimée 12-18 % sur la consommation gaz cellules.',
    alternative_solutions_html: `<p><strong>Préconisation Buildy.</strong> Configuration EcoStruxure post-BACS-003 :</p>
      <ul>
        <li>Programme horaire par cellule : 5h-22h consigne 16 °C, 22h-5h consigne hors-gel 8 °C, week-end consigne hors-gel</li>
        <li>Dérogation manuelle possible depuis l\'UI Sodexo si activité exceptionnelle</li>
        <li>Mesure d\'économie sur 3 mois post-mise en service pour valider</li>
      </ul>
      <p>Effort marginal après BACS-003 : 0.5 j paramétrage.</p>`,
    commercial_notes: 'À proposer en option après mise en service BACS-003. ROI rapide.',
    manual: true },
  { id: 9013, severity: 'minor', r175_article: 'R175-3 §2', zone_id: 2, status: 'open',
    title: 'Ajouter un monitoring CO₂ dans les bureaux',
    description: 'Pas d\'exigence stricte R175 mais bonne pratique : sonde CO₂ par zone bureaux pour piloter la CTA en débit variable selon occupation réelle (économie ventilation + qualité d\'air).',
    alternative_solutions_html: `<p><strong>Préconisation Buildy.</strong> Pose de 4 sondes CO₂ KNX (1 par zone bureaux) raccordées au routeur KNX/IP du bloc bureaux + intégration à EcoStruxure. Pilotage de la CTA Aldes en débit variable selon CO₂ max des 4 zones.</p>`,
    commercial_notes: null,
    manual: true },
  { id: 9014, severity: 'minor', r175_article: 'R175-3 §2', zone_id: 5, status: 'open',
    title: 'Détection de présence sur l\'éclairage parking',
    description: 'L\'éclairage parking LED (E-008) fonctionne aujourd\'hui plein régime de la tombée du jour à l\'aube. Ajout de détecteurs de présence par poche pour réduire à 30 % en l\'absence d\'activité — économie estimée 35-45 % sur la consommation éclairage parking.',
    alternative_solutions_html: `<p><strong>Préconisation Buildy.</strong> Pose de 6 détecteurs hyperfréquence sur mâts (1 par poche), gradation 30 %/100 % via driver des luminaires LED existants (compatibles 0-10 V). Pas d\'intégration GTB nécessaire (régulation locale).</p>`,
    commercial_notes: null,
    manual: true },
  { id: 9015, severity: 'minor', r175_article: null, zone_id: null, status: 'open',
    title: 'Mettre en place le reporting CEE BAT-TH-116',
    description: 'Le décret BACS et le dispositif CEE BAT-TH-116 sont distincts mais complémentaires. Sur un site de cette taille, valoriser les actions correctives via CEE est pertinent. Buildy peut accompagner le montage du dossier CEE.',
    alternative_solutions_html: `<p><strong>Préconisation Buildy.</strong> Accompagnement Buildy au montage CEE BAT-TH-116 : dossier technique + suivi 12 mois + revente kWh CUMAC. À chiffrer après réalisation des actions bloquantes (l\'éligibilité dépend des kWh économisés mesurés).</p>`,
    commercial_notes: null,
    manual: true },
];

// ═══════════════════════════════════════════════════════════════════
// 9. ASSEMBLAGE FINAL — mime exactement la shape de _export-data.js
// ═══════════════════════════════════════════════════════════════════

/**
 * @param {object} opts
 * @param {object|null} opts.user — user injecte (display_name pour authorName)
 *
 * Le kind 'site_audit' a été supprimé (mig 106) ; tout audit est désormais
 * un bacs_audit avec verdict R175, dashboard, plan de mise en conformité
 * et annexes décret.
 */
async function buildFixturePreviewData({ user = null } = {}) {
  // Zones : ajout natureLabel + photos
  const zones = ZONES_RAW.map(z => ({
    ...z,
    natureLabel: ZONE_NATURE_LABEL[z.nature] || z.nature,
    photos: (z.photoFiles || []).map((f, i) => photoItem(`${z.zone_id}-${i}`, f)).filter(Boolean),
  }));

  // Devices : enrichissements (energyLabel, roleLabel, commLabel, photos,
  // managed_by_bms derive du protocole de communication pour le fixture).
  // + indexation par system_id pour reconstruire systems.devices
  const COMMUNICANT_PROTOS_FIXTURE = ['modbus_tcp', 'modbus_rtu', 'bacnet_ip', 'bacnet_mstp', 'knx', 'mbus', 'mqtt'];
  // Multi-rôle (mig 117) : si la fixture déclare un scalaire, on le passe
  // en array de 1 élément pour rester cohérent avec le format API.
  const toRolesArr = (v) => Array.isArray(v) ? v : (v ? [v] : []);
  const devices = DEVICES_RAW.map(d => {
    const roles = toRolesArr(d.device_role);
    return ({
    ...d,
    device_role: roles,
    energyLabel: d.energy_source ? (ENERGY_LABEL[d.energy_source] || d.energy_source) : '—',
    roleLabel: roles.length ? roles.map(r => ROLE_LABEL[r] || r).join(' / ') : '—',
    commLabel: d.communication_protocol
      ? (COMM_LABEL[d.communication_protocol] || d.communication_protocol)
      : 'Non communicant',
    managed_by_bms: COMMUNICANT_PROTOS_FIXTURE.includes(d.communication_protocol) ? 1 : 0,
    zone_name: ZONES_RAW.find(z => z.zone_id === SYSTEMS_RAW.find(s => s.id === d.system_id)?.zone_id)?.name,
    system_category: SYSTEMS_RAW.find(s => s.id === d.system_id)?.system_category,
    photos: (d.photoFiles || []).map((f, i) => photoItem(`d-${d.id}-${i}`, f)).filter(Boolean),
    });
  });
  const devicesBySystem = new Map();
  for (const d of devices) {
    if (!devicesBySystem.has(d.system_id)) devicesBySystem.set(d.system_id, []);
    devicesBySystem.get(d.system_id).push(d);
  }

  // Systems : enrichissements + injection devices
  const enrichedSystems = SYSTEMS_RAW.map(s => {
    const z = ZONES_RAW.find(zz => zz.zone_id === s.zone_id);
    const devs = devicesBySystem.get(s.id) || [];
    const totalKw = devs.reduce((sum, d) => sum + (Number(d.power_kw) || 0), 0);
    return {
      ...s,
      zone_name: z?.name,
      zone_nature: z?.nature,
      categoryLabel: SYSTEM_LABEL[s.system_category] || s.system_category,
      negativeLabel: SYSTEM_NEGATIVE_LABEL[s.system_category] || `Pas de ${(SYSTEM_LABEL[s.system_category] || s.system_category).toLowerCase()}`,
      commLabel: s.communication ? (COMM_LABEL[s.communication] || s.communication) : '—',
      devices: devs,
      device_count: devs.length,
      total_power_kw: totalKw,
      photos: [],
    };
  });
  const systemsByZoneMap = new Map();
  for (const s of enrichedSystems) {
    const k = s.zone_id;
    if (!systemsByZoneMap.has(k)) {
      systemsByZoneMap.set(k, { zone_name: s.zone_name, zone_nature: s.zone_nature, items: [] });
    }
    systemsByZoneMap.get(k).items.push(s);
  }
  const systemsByZone = [...systemsByZoneMap.values()];

  // Meters : enrichissements
  const enrichedMeters = METERS_RAW.map(m => {
    const z = ZONES_RAW.find(zz => zz.zone_id === m.zone_id);
    return {
      ...m,
      zone_name: z?.name,
      typeLabel: METER_TYPE_LABEL[m.meter_type] || m.meter_type,
      usageLabel: METER_USAGE_LABEL[m.usage] || m.usage,
      zoneLabel: z?.name || 'Général bâtiment',
      photos: (m.photoFiles || []).map((f, i) => photoItem(`m-${m.id}-${i}`, f)).filter(Boolean),
    };
  });
  const metersWithDetails = enrichedMeters.filter(m => m.notes_html || m.notes || (m.photos && m.photos.length));

  // Thermal regulations
  const thermal = THERMAL_RAW.map(t => {
    const z = ZONES_RAW.find(zz => zz.zone_id === t.zone_id);
    return {
      ...t,
      zone_name: z?.name,
      category: t.category || 'heating',
      categoryLabel: SYSTEM_LABEL[t.category || 'heating'] || (t.category || 'heating'),
      regulationLabel: t.regulation_type ? (REGULATION_LABEL[t.regulation_type] || t.regulation_type) : '—',
      // Mig 135 : generator_type a migré sur device.energy_source.
      // Pour la fixture, on garde un placeholder "—".
      generatorLabel: '—',
    };
  });

  // BMS : ajout photos
  const bms = {
    ...BMS,
    photos: (BMS.photoFiles || []).map((f, i) => photoItem(`bms-${i}`, f)).filter(Boolean),
  };

  // BMS managed / unmanaged lists (gap analysis pour l'integrateur)
  const COMMUNICANT_PROTOS = ['modbus_tcp', 'modbus_rtu', 'bacnet_ip', 'bacnet_mstp', 'knx', 'mbus', 'mqtt'];
  const bmsManagedDevices = devices.filter(d =>
    COMMUNICANT_PROTOS.includes(d.communication_protocol)
  ).map(d => ({
    ...d,
    managed_by_bms: 1,
    categoryLabel: SYSTEM_LABEL[d.system_category] || d.system_category,
  }));
  // Non integres : equipements presents mais NON communicants nativement
  // (DRV Daikin, aerothermes Reznor, ECS Atlantic, eclairages...). Cas
  // typique a chiffrer dans le devis Buildy.
  const bmsUnmanagedDevices = devices.filter(d =>
    !COMMUNICANT_PROTOS.includes(d.communication_protocol) && !d.out_of_service
  ).map(d => ({
    ...d,
    managed_by_bms: 0,
    categoryLabel: SYSTEM_LABEL[d.system_category] || d.system_category,
  }));
  const bmsManagedMeters = enrichedMeters.filter(m => m.managed_by_bms);
  const bmsUnmanagedMeters = enrichedMeters.filter(m => !m.managed_by_bms && m.present_actual && !m.out_of_service);

  // Compteurs groupes par zone fonctionnelle (pour PDF tableaux paysage)
  const metersByZoneMap = new Map();
  for (const m of enrichedMeters) {
    const key = m.zone_id || '__general';
    if (!metersByZoneMap.has(key)) {
      metersByZoneMap.set(key, {
        zone_id: m.zone_id,
        zone_name: m.zone_id ? m.zone_name : 'Général bâtiment',
        items: [],
      });
    }
    metersByZoneMap.get(key).items.push(m);
  }
  const metersByZone = [...metersByZoneMap.values()].sort((a, b) => {
    if (a.zone_id == null) return 1;
    if (b.zone_id == null) return -1;
    return 0;
  });

  // Actions : numérotation BACS-XXX par sévérité (bloq → maj → min)
  const actionItemsRaw = ACTIONS_RAW.map(a => ({
    ...a,
    zone_name: a.zone_id ? ZONES_RAW.find(z => z.zone_id === a.zone_id)?.name : null,
  })).filter(a => a.status !== 'done' && a.status !== 'declined');
  const numberedItems = [
    ...actionItemsRaw.filter(a => a.severity === 'blocking'),
    ...actionItemsRaw.filter(a => a.severity === 'major'),
    ...actionItemsRaw.filter(a => a.severity === 'minor'),
  ].map((a, idx) => ({
    ...a,
    display_number: 'BACS-' + String(idx + 1).padStart(3, '0'),
  }));
  const actionItems = { blocking: [], major: [], minor: [] };
  for (const a of numberedItems) actionItems[a.severity]?.push(a);
  const actionStats = {
    blocking: actionItems.blocking.length,
    major: actionItems.major.length,
    minor: actionItems.minor.length,
  };

  // Justifications (Annexe C). Cf. _export-data.js : derive le label
  // depuis la FK non-NULL (apres mig 125).
  function actionSourceLabel(a) {
    if (a.source_system_id)        return `système (#${a.source_system_id})`;
    if (a.source_meter_id)         return `compteur (#${a.source_meter_id})`;
    if (a.source_thermal_id)       return `régulation thermique (#${a.source_thermal_id})`;
    if (a.source_device_id)        return `équipement (#${a.source_device_id})`;
    if (a.source_inspection_id)    return `inspection (#${a.source_inspection_id})`;
    if (a.source_bms_document_id)  return `GTB (${a.source_subtype || ''})`;
    return 'Item manuel';
  }
  const justifications = numberedItems.map(a => ({
    title: a.title,
    article: a.r175_article || '—',
    source: actionSourceLabel(a),
    description: a.description || a.title,
  }));

  // BACS articles (Annexe A) + methodology + disclaimers : depuis seeds réels
  const bacsArticles = bacsArticlesData.BACS_ARTICLES.map(a => ({
    code: a.code, title: a.title, html: a.full_html,
  }));
  const methodology = bacsAuditMethodologyStatic;
  const disclaimers = bacsAuditDisclaimersStatic;

  // Buildy solution detection
  const buildySolution = /buildy/i.test(`${BMS.existing_solution || ''} ${BMS.existing_solution_brand || ''}`);

  // R175-6 applicabilite
  const R175_6_TRIGGER = '2021-07-21';
  const pcAfter = DOCUMENT.bacs_building_permit_date && DOCUMENT.bacs_building_permit_date > R175_6_TRIGGER;
  const worksAfter = DOCUMENT.bacs_generator_works_date && DOCUMENT.bacs_generator_works_date > R175_6_TRIGGER;
  const r175_6_applicable = pcAfter || worksAfter
    ? { applies: true, reason: pcAfter && worksAfter
          ? 'permis de construire postérieur au 21/07/2021 et travaux générateur récents'
          : (pcAfter ? 'permis de construire postérieur au 21/07/2021' : 'travaux d\'installation/remplacement de générateur postérieurs au 21/07/2021') }
    : { applies: false, reason: 'aucun déclencheur (permis de construire et travaux générateur antérieurs ou égaux au 21/07/2021)' };

  // Heating/cooling breakdown pour le détail puissance
  const heatingCoolingBreakdown = devices
    .filter(d => ['heating', 'cooling'].includes(d.system_category) && d.power_kw != null)
    .map(d => ({
      name: d.name, brand: d.brand, model_reference: d.model_reference,
      power_kw: d.power_kw, zone_name: d.zone_name,
      category: d.system_category,
      categoryLabel: SYSTEM_LABEL[d.system_category] || d.system_category,
    }));
  const heatingCoolingTotal = heatingCoolingBreakdown.reduce((s, d) => s + (Number(d.power_kw) || 0), 0);

  // Date d'export figée pour le fixture (reproductibilité visuelle)
  const exportDate = new Date().toLocaleDateString('fr-FR', {
    day: '2-digit', month: 'long', year: 'numeric',
  });

  // Recap chiffre pour le PDF tableaux de synthese (4 tuiles d'en-tete)
  const recapStats = {
    devicesTotal: devices.length,
    devicesPresent: devices.filter(d => !d.out_of_service).length,
    devicesIntegrated: devices.filter(d => d.managed_by_bms === 1 || COMMUNICANT_PROTOS.includes(d.communication_protocol)).length,
    devicesHs: devices.filter(d => d.out_of_service).length,
    metersRequired: enrichedMeters.filter(m => m.required).length,
    metersPresent: enrichedMeters.filter(m => m.present_actual && !m.out_of_service).length,
    metersIntegrated: enrichedMeters.filter(m => m.managed_by_bms).length,
    metersMissing: enrichedMeters.filter(m => m.required && !m.present_actual).length,
  };

  const document = DOCUMENT;
  const applicabilityLabelForSummary = APPLICABILITY_LABEL[DOCUMENT.bacs_applicability_status] || null;
  const compliance = buildComplianceSummary({
    document, actionItems, actionItemsRaw: numberedItems, bms,
    r175_6_applicable,
    applicabilityLabel: applicabilityLabelForSummary,
  });

  return {
    document,
    isBacs: true,
    isSiteAudit: false,
    site: SITE,
    zones,
    systemsByZone,
    compliance,
    meters: enrichedMeters,
    metersWithDetails,
    thermal,
    bms,
    bmsManagedDevices,
    bmsUnmanagedDevices,
    bmsManagedMeters,
    bmsUnmanagedMeters,
    metersByZone,
    recapStats,
    buildySolution,
    actionItems,
    actionStats,
    actionItemsRaw: numberedItems,
    // Mig 109 : notes par sujet de la carte GTB (notesByTopic = map
    // topic_key -> note_html). Ici on remplit 2 sujets pour la preview.
    bmsTopicNotes: {
      analyse_fonctionnelle: '<p>L\'analyse fonctionnelle d\'origine (Dalkia 2018) est disponible mais incomplète : pas de schéma à jour des automates récemment ajoutés (PAC 2024).</p>',
      r175_3_capacites: '<p>Historisation 30 j seulement (config par défaut EcoStruxure). Aucune alerte automatique configurée sur les dérives de COP.</p>',
    },
    synthesisHtml: document.audit_synthesis_html,
    heatingCoolingBreakdown,
    heatingCoolingTotal: Math.round(heatingCoolingTotal * 10) / 10,
    r175_6_applicable,
    complianceLabel: COMPLIANCE_LABEL[BMS.overall_compliance] || null,
    applicabilityLabel: applicabilityLabelForSummary,
    bacsArticles,
    methodology,
    disclaimers,
    justifications,
    authorName: user?.display_name || 'Auditeur Buildy (fixture)',
    exportDate,
    version: 'bacs-vAPERCU',
    logoDataUrl: loadAssetDataUrl('logo-buildy.svg'),
    // Charts générés via chartjs-node-canvas (Vague 4 item 17) :
    // donut sévérité + bar usage power. Permet à la preview HTML/PDF
    // d'être visuellement fidèle au PDF prod (sinon cases blanches).
    sevDonutDataUrl: await getCharts().donutSeverity({
      blocking: actionStats.blocking,
      major: actionStats.major,
      minor: actionStats.minor,
    }),
    barUsagePowerDataUrl: await (async () => {
      const powerByUsage = new Map();
      for (const d of devices) {
        if (d.power_kw == null) continue;
        const cat = d.system_category || 'autre';
        powerByUsage.set(cat, (powerByUsage.get(cat) || 0) + Number(d.power_kw));
      }
      const USAGE_ORDER = ['heating', 'cooling', 'ventilation', 'dhw', 'lighting_indoor', 'lighting_outdoor'];
      const items = USAGE_ORDER.filter(u => powerByUsage.has(u)).map(u => ({
        label: SYSTEM_LABEL[u] || u,
        kw: Math.round(powerByUsage.get(u) * 10) / 10,
        color: getCharts().COLORS[u === 'heating' ? 'heating'
          : u === 'cooling' ? 'cooling'
          : u === 'ventilation' ? 'ventilation'
          : u === 'dhw' ? 'dhw'
          : 'lighting'],
      }));
      return items.length ? getCharts().barUsagePower({ items }) : null;
    })(),
    barItems: [],
  };
}

module.exports = { buildFixturePreviewData };
