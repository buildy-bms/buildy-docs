'use strict';

/**
 * Genere les actions correctives `bacs_audit_action_items` a partir des
 * donnees de l'audit BACS (systems / meters / bms / thermal_regulation).
 *
 * Idempotent : les items auto-generes sont identifies par la combinaison
 * (FK source non-NULL, source_subtype). Si la donnee source change,
 * l'item est mis a jour. Si la source est resolue (gap comble), l'item
 * passe en done. Si la source est hard-deletee, l'item disparait via FK
 * ON DELETE CASCADE (mig 125).
 *
 * Items manuels (auto_generated=0) ne sont jamais touches.
 *
 * Annotations commerciales (commercial_notes, estimated_effort, status hors
 * 'open'/'done') sont preservees entre regenerations.
 *
 * Regles de generation : cf plan section "Generation automatique des
 * actions correctives" + extensions cohérence inventaire equipments.
 */

const db = require('../database');
const log = require('./logger').system;
const { isTrue, isFalse } = require('../routes/bacs-audit/_ternary');

// Mappings FR pour les libellés affichés dans les actions correctives
// (utilisés dans tout le code BACS — détail view, action items view, PDF).
const SYSTEM_LABEL_FR = {
  heating: 'chauffage',
  cooling: 'refroidissement',
  ventilation: 'ventilation',
  dhw: 'eau chaude sanitaire',
  lighting_indoor: 'éclairage intérieur',
  lighting_outdoor: 'éclairage extérieur',
  electricity_production: 'production photovoltaïque',
};
// Label naturel pour les titres d'actions : « le système de chauffage »
// vs « le système d'eau chaude sanitaire » (apostrophe quand la categorie
// commence par voyelle). Evite les tournures bancales « de eau chaude »
// generees par concatenation brute. Cf. retour Kevin 2026-05-29.
function systemTitleLabel(systemCategory) {
  const cat = SYSTEM_LABEL_FR[systemCategory] || systemCategory || '';
  if (!cat) return 'le système';
  // Apostrophe si la categorie commence par voyelle / h muet (en pratique
  // « eau chaude sanitaire », « éclairage intérieur », « éclairage extérieur »).
  if (/^[aeiouhéèà]/i.test(cat)) return `le système d'${cat}`;
  return `le système de ${cat}`;
}
// Formate la zone en suffixe lisible : « (zone Bureaux) » plutot que
// «  en zone « Bureaux » » (guillemets francais qui detonnent dans un
// titre court).
function zoneSuffix(zoneName) {
  if (!zoneName || !zoneName.trim()) return '';
  return ` (zone ${zoneName.trim()})`;
}
const METER_TYPE_LABEL_FR = {
  electric: 'électrique',
  electric_production: 'électrique de production',
  gas: 'gaz',
  water: 'eau',
  thermal: 'thermique',
  other: 'autre',
};
const METER_USAGE_LABEL_FR = {
  heating: 'chauffage',
  cooling: 'refroidissement',
  ventilation: 'ventilation',
  dhw: 'ECS',
  pv: 'production PV',
  lighting: 'éclairage',
  other: 'général',
};

/**
 * Helper : si la solution GTB en place contient "buildy" (insensible a la
 * casse), R175-5 (formation) est nativement couverte par le support Buildy
 * → ne pas generer d'action `training`.
 */
function isBuildySolution(bms) {
  const text = `${bms?.existing_solution || ''} ${bms?.existing_solution_brand || ''}`.toLowerCase();
  return /buildy/.test(text);
}

// Item 10 — Contre-indications de pilotage par type d'équipement.
// Chaque code bloque un certain type d'action R175-3 §4 (coupure /
// arrêt manuel) et génère à la place un encart informatif.
// Map code → { label (texte affiché dans l'action informative),
//   blocksCutPower (true = bloque l'action « arrêt manuel ») }.
const CONTRAINDICATION_INFO = {
  do_not_cut_power_thermodynamic: {
    label: 'Équipement thermodynamique : ne pas couper l\'alimentation électrique en cours de fonctionnement (lubrification du compresseur). Privilégier un arrêt piloté par la régulation.',
    blocksCutPower: true,
  },
  do_not_cut_power_winter_boiler: {
    label: 'Chaudière en période hivernale : ne pas couper l\'alimentation (perte de la protection hors-gel). L\'arrêt doit rester piloté.',
    blocksCutPower: true,
  },
  legionella_loop_ecs: {
    label: 'Boucle ECS : l\'arrêt est interdit (arrêté du 30 novembre 2005 — risque légionelle). Surveiller la température de bouclage.',
    blocksCutPower: true,
  },
  continuous_ventilation_required: {
    label: 'Ventilation en continu requise (EHPAD, hôpitaux, sanitaires) : ne pas programmer d\'arrêt — qualité d\'air et hygiène.',
    blocksCutPower: true,
  },
  aci_tank_no_long_cut: {
    label: 'Ballon ECS à anode à courant imposé (ACI) : pas de coupure prolongée (> 8 h) — perte de la protection anti-corrosion.',
    blocksCutPower: true,
  },
  circulator_degommage: {
    label: 'Circulateur avec fonction de dégommage : ne pas couper en été — perte de la protection anti-grippage.',
    blocksCutPower: true,
  },
  lighting_already_optimized: {
    label: 'Éclairage déjà optimisé (détection de présence + LED récentes) : généraliser une commande BACS n\'apporte pas de gisement d\'économies.',
    blocksCutPower: false,
  },
};

/**
 * Charge les contre-indications BACS d'un device via son modèle
 * d'équipement de la bibliothèque (`equipment_template_id`, mig 145+154).
 * Retourne un tableau de codes (vide si non rattaché ou non renseigné).
 */
function loadContraindications(equipmentTemplateId) {
  if (!equipmentTemplateId) return [];
  try {
    const row = db.db.prepare(
      'SELECT bacs_contraindications FROM equipment_templates WHERE id = ?'
    ).get(equipmentTemplateId);
    if (!row || !row.bacs_contraindications) return [];
    const parsed = JSON.parse(row.bacs_contraindications);
    return Array.isArray(parsed) ? parsed.filter(c => typeof c === 'string') : [];
  } catch { return []; }
}

// Cle d'idempotence : derivee de la FK source non-NULL (1 max parmi 6)
// + source_subtype. Permet le matching `existingByKey` sur regen.
function keyOfItem(item) {
  if (item.source_system_id != null)        return `s:${item.source_system_id}:${item.source_subtype || ''}`;
  if (item.source_meter_id != null)         return `m:${item.source_meter_id}:${item.source_subtype || ''}`;
  if (item.source_thermal_id != null)       return `t:${item.source_thermal_id}:${item.source_subtype || ''}`;
  if (item.source_device_id != null)        return `d:${item.source_device_id}:${item.source_subtype || ''}`;
  if (item.source_inspection_id != null)    return `i:${item.source_inspection_id}:${item.source_subtype || ''}`;
  if (item.source_bms_document_id != null)  return `b:${item.source_bms_document_id}:${item.source_subtype || ''}`;
  // Item synthetique sans FK (ex : inspection 'no_inspection')
  return `_:${item.source_subtype || ''}`;
}

/**
 * Construit la liste cible d'actions a poser pour un document.
 * Retourne un Map<key, item> ou key = keyOfItem(item).
 */
function computeTargetActions(documentId) {
  const target = new Map();
  function addTarget(item) {
    target.set(keyOfItem(item), item);
  }

  // Systems (R175-1 §4 + R175-3 §3 + §4). Les usages manuels non BACS
  // (is_bacs=0) sont hors décret → exclus du scoring (mig 144).
  const systems = db.db.prepare(`
    SELECT s.*, z.name AS zone_name FROM bacs_audit_systems s
    LEFT JOIN zones z ON z.id = s.zone_id
    WHERE s.document_id = ? AND s.is_bacs = 1
  `).all(documentId);
  for (const s of systems) {
    const catFr = SYSTEM_LABEL_FR[s.system_category] || s.system_category;
    const zoneStr = s.zone_name ? ` en zone « ${s.zone_name} »` : '';

    // Système absent → R175-1 §4 (plusieurs sources_id par paire systemId pour
    // ne pas se recouvrir avec les autres règles ci-dessous)
    // NE PLUS générer d'action "Ajouter un système de X" si la catégorie
    // n'est pas marquée présente : la matrice nature_zone est purement
    // indicative, pas prescriptive. Un audit ne génère d'action que sur
    // ce qui a été observé en panne (cf retour Kevin v2.7).
    // Si l'auditeur veut signaler une absence problématique, il ajoute
    // une action manuelle via la vue commerciale.
    // present est ternaire : null (non répondu) et 0 (absent) skippent
    // tous les deux — on ne génère d'action que sur du constaté présent.
    if (!isTrue(s.present)) continue;

    // Item 1 — Règle des 5 % : si l'auditeur a marqué le système comme
    // négligeable (< 5 % de la consommation totale, FAQ ministère juin
    // 2025), on ne génère AUCUNE action R175-3 dessus. Une action
    // informative non-bloquante trace l'exemption (cf. encart PDF).
    if (s.marked_negligible_under_5pct) {
      const justif = (s.negligible_justification || '').trim();
      addTarget({
        source_system_id: s.id, source_subtype: 'negligible_5pct',
        category: 'other', severity: 'minor',
        r175_article: 'R175-3',
        title: `Poste exempté — ${catFr}${zoneStr} considéré négligeable (< 5 %)`,
        description: `Ce poste a été exempté de mise en conformité R175-3 en application de la règle des 5 % (FAQ ministère, juin 2025) : un poste représentant moins de 5 % de la consommation totale du bâtiment peut être écarté du raccordement et du comptage.${justif ? ` Justification de l'auditeur : ${justif}` : ''}`,
        zone_id: s.zone_id, equipment_id: s.equipment_id,
      });
      continue;
    }

    // Système présent + non communicant (legacy : on garde la règle communication=non_communicant)
    if (s.communication === 'non_communicant') {
      addTarget({
        source_system_id: s.id, source_subtype: 'non_communicant',
        category: 'communication_upgrade', severity: 'major',
        r175_article: 'R175-3 §3',
        title: `Rendre communicant le système de ${catFr}${zoneStr}`,
        description: `L'interopérabilité (R175-3 §3) requiert que les systèmes techniques exposent au moins un protocole standard ouvert (BACnet, Modbus, KNX, M-Bus, MQTT).`,
        zone_id: s.zone_id, equipment_id: s.equipment_id,
      });
    }

    // Refonte 2026-05-29 — R175-3 §3 et §4 evalues au niveau SYSTEME
    // (et plus device par device). Lecture stricte du decret : le texte
    // demande l'interoperabilite du BACS avec les SYSTEMES TECHNIQUES,
    // pas de chaque equipement individuel. Les emetteurs (radiateurs,
    // panneaux rayonnants, ventilo-convecteurs passifs) sous regulation
    // autonome (vanne thermostatique mecanique) restent conformes R175-6
    // — le decret n'impose pas leur communication.
    //
    // Cf. CSV ISO 52120-1 fonction 1.1.2 (Regulation individuelle par
    // piece) classe C : « L'interconnexion de la regulation terminale
    // avec le systeme de GTB est interessant a etudier mais n'est pas
    // imposee par le decret BACS. »
    //
    // Les devices Hors-Service sont ignores. Le device_role est lu pour
    // identifier le ou les equipements pertinents pour l'interoperabilite
    // du systeme (production / distribution / regulation, pas emission).
    const sysDevices = db.db.prepare(`
      SELECT id, name, brand, model_reference, communication_protocol,
             communication_protocols, wired,
             meets_r175_3_p4, meets_r175_3_p4_autonomous, out_of_service,
             managed_by_bms, bms_integration_out_of_service, equipment_template_id,
             device_role
      FROM bacs_audit_system_devices WHERE system_id = ?
    `).all(s.id);

    // Item 3 — ECS bouclée : une boucle ECS ne peut pas être arrêtée
    // (arrêté du 30 nov. 2005 — risque légionelle). On ne génère pas
    // d'action « arrêt manuel » R175-3 §4 sur les équipements de ce
    // système ; à la place, une action informative au niveau du système.
    const ecsLooped = s.system_category === 'dhw' && s.is_looped === 'looped';
    if (ecsLooped) {
      addTarget({
        source_system_id: s.id, source_subtype: 'ecs_looped_legionella',
        category: 'other', severity: 'minor',
        r175_article: 'R175-3 §4',
        title: `Surveiller la température du bouclage ECS${zoneStr}`,
        description: 'Le système d\'eau chaude sanitaire est bouclé : son arrêt est interdit (arrêté du 30 novembre 2005 — risque légionelle). Le décret BACS ne s\'applique pas à l\'arrêt de ce poste. Surveillance de la température de bouclage recommandée (≥ 50 °C en tout point de la boucle).',
        zone_id: s.zone_id, equipment_id: s.equipment_id,
      });
    }

    // Helpers pour evaluer la communicabilite et le raccordement d'un device.
    function deviceProtocols(d) {
      let arr = [];
      if (d.communication_protocols) {
        try { arr = JSON.parse(d.communication_protocols); } catch { arr = []; }
      }
      const legacy = d.communication_protocol &&
        d.communication_protocol !== 'non_communicant' &&
        d.communication_protocol !== 'absent';
      if (!arr.length && legacy) arr = [d.communication_protocol];
      return arr.filter(p => p && p !== 'non_communicant' && p !== 'absent');
    }
    function deviceRoleArr(d) {
      if (!d.device_role) return [];
      try {
        const v = JSON.parse(d.device_role);
        return Array.isArray(v) ? v : [];
      } catch { return []; }
    }
    // Un device est « pertinent pour l'interoperabilite du systeme » s'il
    // porte au moins un niveau actif (production / distribution / regulation).
    // Les emetteurs purs (role = ['emission'] uniquement) sont exclus du
    // critere — pas d'obligation decret de les rendre communicants.
    function isInteropRelevant(d) {
      const roles = deviceRoleArr(d);
      return roles.some(r => r === 'production' || r === 'distribution' || r === 'regulation');
    }

    // Liaison GTB cassee (device fonctionnel mais GTB ne le voit pas).
    // Conservee au niveau device : c'est une action de reparation ciblee,
    // pas une exigence d'interoperabilite globale du systeme.
    for (const d of sysDevices) {
      if (d.out_of_service) continue;
      if (d.managed_by_bms && d.bms_integration_out_of_service) {
        const devName2 = d.name || d.brand || d.model_reference || `équipement #${d.id}`;
        addTarget({
          source_device_id: d.id, source_subtype: 'bms_link_broken',
          category: 'bms_upgrade', severity: 'major',
          r175_article: 'R175-3 §3',
          title: `Rétablir la liaison GTB de « ${devName2} »`,
          description: `L'équipement est intégré à la GTB mais la liaison est cassée (paramétrage ou communication). À diagnostiquer / reconfigurer.`,
          zone_id: s.zone_id, equipment_id: null,
        });
      }
    }

    // R175-3 §3 — interoperabilite SYSTEME (refonte 2026-05-29).
    // Le systeme est interoperable si au moins UN device pertinent
    // (production / distribution / regulation, non HS) :
    //   - dispose d'un protocole de communication actif ET
    //   - est raccorde a la GTB (wired OU managed_by_bms).
    // Si aucun device pertinent ne remplit ces criteres → 1 action systeme.
    const relevantActive = sysDevices.filter(d => !isTrue(d.out_of_service) && isInteropRelevant(d));
    const hasInteropPath = relevantActive.some(d => {
      const protos = deviceProtocols(d);
      return protos.length > 0 && (isTrue(d.wired) || isTrue(d.managed_by_bms));
    });
    // On ne genere pas l'action si le systeme ne contient AUCUN device pertinent
    // (ex : usage sans production/distribution/regulation saisis), pour eviter
    // un faux positif quand l'auditeur n'a pas encore complete la saisie.
    // Idem si AUCUN device pertinent n'a de reponse explicite sur le
    // raccordement (wired / managed_by_bms tous null = non repondu) :
    // le constat « aucune voie GTB » n'est pas etabli, on ne conclut pas
    // sur du non-qualifie (principe ternaire, incident Communay).
    const interopAnswered = relevantActive.some(d =>
      d.wired != null || d.managed_by_bms != null);
    if (relevantActive.length > 0 && interopAnswered && !hasInteropPath) {
      // Balises {{type:id}} resolues en pilules cliquables cote UI et en
      // pilules visuelles SVG FontAwesome cote PDF.
      // Structure description : sections "Titre\nContenu" separees par
      // \n\n. ActionDescription.vue / stripActionTags() rendent les titres
      // en sous-titres distinctifs.
      // Pas de bloc « Equipement actif concerne » : la card systeme dans
      // l'audit liste deja les equipements en detail, le repeter ici dans
      // chaque action est redondant.
      addTarget({
        source_system_id: s.id, source_subtype: 'system_not_interoperable',
        category: 'bms_upgrade', severity: 'major',
        r175_article: 'R175-3 §3',
        title: `Raccorder {{system:${s.id}}} au BACS`,
        description: [
          // Décret en tête — seule source opposable.
          `Décret R175-3 §3\n« [Les systèmes d'automatisation et de contrôle des bâtiments] sont interopérables avec les différents systèmes techniques du bâtiment. »`,
          `Constat\nAucune communication n'est possible aujourd'hui entre {{system:${s.id}}} et la GTB.`,
          `Recommandation Buildy pour la conformité\nÉtablir une communication entre {{system:${s.id}}} et la GTB. Le décret n'impose pas une solution particulière ni un composant précis. La solution la moins coûteuse est généralement :\n  • Ajouter un module de communication sur le régulateur existant s'il l'accepte (souvent le cas pour les régulateurs récents).\n  • À défaut, installer une passerelle protocolaire (BACnet / Modbus / KNX / M-Bus / MQTT) sur le composant qui porte la régulation centrale.`,
          `Lecture Buildy du décret\nLes émetteurs passifs sans interface technique (radiateurs simples, ventilo-convecteurs passifs) et la régulation d'émission autonome (vanne thermostatique mécanique, thermostat de zone) ne sont pas concernés par l'exigence d'interopérabilité R175-3 §3. L'action ne porte pas sur eux.`,
        ].join('\n\n'),
        zone_id: s.zone_id, equipment_id: s.equipment_id,
      });
    }

    // R175-3 §4 — arret manuel + gestion autonome SYSTEME.
    // Le systeme satisfait §4 si au moins UN device pertinent (production
    // / distribution / regulation) coche meets_r175_3_p4. Idem pour
    // l'autonomie. Les emetteurs ne sont pas evalues (pas pilotables au
    // sens du decret). Contre-indications par device : tracees en action
    // informative non-bloquante.
    const ecsLoopedAtSystem = ecsLooped; // shortcut
    const hasManualStop = relevantActive.some(d => isTrue(d.meets_r175_3_p4));
    const hasAutonomous  = relevantActive.some(d => isTrue(d.meets_r175_3_p4_autonomous));
    // Gating ternaire : ne conclure « pas d'arret manuel / pas autonome »
    // que si au moins un device pertinent a une reponse explicite. Tous
    // null = question non posee → pas d'action (principe Communay).
    const manualStopAnswered = relevantActive.some(d => d.meets_r175_3_p4 != null);
    const autonomousAnswered = relevantActive.some(d => d.meets_r175_3_p4_autonomous != null);

    if (relevantActive.length > 0 && manualStopAnswered && !hasManualStop && !ecsLoopedAtSystem) {
      addTarget({
        source_system_id: s.id, source_subtype: 'system_no_manual_stop',
        category: 'bms_upgrade', severity: 'major',
        r175_article: 'R175-3 §4',
        title: `Permettre l'arrêt manuel sur place de {{system:${s.id}}}`,
        description: [
          `Décret R175-3 §4\n« [Les systèmes d'automatisation et de contrôle des bâtiments] permettent un arrêt manuel et la gestion autonome d'un ou plusieurs systèmes techniques de bâtiment. »`,
          `Constat\nAucun équipement actif de {{system:${s.id}}} ne permet aujourd'hui un arrêt manuel directement sur place.`,
          `Recommandation Buildy pour la conformité\nIdentifier (ou installer si absent) un interrupteur d'arrêt accessible sur la régulation centrale ou un équipement actif du système. Le décret n'exige pas d'équipement de pilotage complexe.`,
        ].join('\n\n'),
        zone_id: s.zone_id, equipment_id: s.equipment_id,
      });
    }
    if (relevantActive.length > 0 && autonomousAnswered && !hasAutonomous) {
      addTarget({
        source_system_id: s.id, source_subtype: 'system_not_autonomous',
        category: 'bms_upgrade', severity: 'major',
        r175_article: 'R175-3 §4',
        title: `Garantir le redémarrage autonome de {{system:${s.id}}}`,
        description: [
          `Décret R175-3 §4\n« [Les systèmes d'automatisation et de contrôle des bâtiments] permettent […] la gestion autonome d'un ou plusieurs systèmes techniques de bâtiment. »`,
          `Constat\nAucun équipement actif de {{system:${s.id}}} n'est aujourd'hui déclaré capable de reprendre seul après une coupure de courant ou un redémarrage de la GTB.`,
          `Recommandation Buildy pour la conformité\nConfigurer la régulation centrale pour qu'elle redémarre automatiquement en mémorisant son dernier état de fonctionnement. Sur la plupart des régulateurs récents, c'est un simple paramètre d'usine à activer (aucune dépense matérielle).`,
        ].join('\n\n'),
        zone_id: s.zone_id, equipment_id: s.equipment_id,
      });
    }

    // Contre-indications de pilotage par device (informatives, conservees
    // car utiles pour le traçage technique dans le PDF) : equipements qui
    // ne supportent pas de coupure brutale meme si §4 manuel s'applique.
    for (const d of sysDevices) {
      if (d.out_of_service) continue;
      const contraindications = loadContraindications(d.equipment_template_id);
      const cutPowerContraindicated = ecsLooped || contraindications.some(
        c => CONTRAINDICATION_INFO[c]?.blocksCutPower);
      if (isFalse(d.meets_r175_3_p4) && cutPowerContraindicated && !ecsLooped) {
        const devName = d.name || d.brand || d.model_reference || `équipement #${d.id}`;
        const codes = contraindications.filter(c => CONTRAINDICATION_INFO[c]?.blocksCutPower);
        const infoText = codes.map(c => CONTRAINDICATION_INFO[c].label).join(' ');
        addTarget({
          source_device_id: d.id, source_subtype: 'contraindication_no_cut',
          category: 'other', severity: 'minor',
          r175_article: 'R175-3 §4',
          title: `Pilotage adapté requis pour « ${devName} » (contre-indication)`,
          description: `${infoText} L'arrêt manuel R175-3 §4 ne doit pas se traduire par une coupure brutale d'alimentation sur cet équipement (${catFr}${zoneStr}).`,
          zone_id: s.zone_id, equipment_id: null,
        });
      }
    }
  }

  // Meters (R175-3 §1)
  const meters = db.db.prepare(`
    SELECT m.*, z.name AS zone_name FROM bacs_audit_meters m
    LEFT JOIN zones z ON z.id = m.zone_id
    WHERE m.document_id = ?
  `).all(documentId);
  for (const m of meters) {
    if (m.out_of_service) continue;  // skip HS
    const typeFr = METER_TYPE_LABEL_FR[m.meter_type] || m.meter_type;
    const usageFr = METER_USAGE_LABEL_FR[m.usage] || m.usage;
    const zoneStr = m.zone_name ? ` en zone « ${m.zone_name} »` : ' (général bâtiment)';
    // Ternaires stricts : `required=1 + present_actual=null` (non vérifié
    // sur place) ne génère PAS « Ajouter compteur » — seul un constat
    // explicite d'absence (present_actual=0) le fait. Idem communicating.
    if (isTrue(m.required) && isFalse(m.present_actual)) {
      addTarget({
        source_meter_id: m.id,
        category: 'meter_addition', severity: 'blocking',
        r175_article: 'R175-3 §1',
        title: `Ajouter compteur ${typeFr}${zoneStr} — ${usageFr}`,
        description: `Le suivi continu R175-3 §1 requiert un compteur ${typeFr} pour l'usage « ${usageFr} ».`,
        zone_id: m.zone_id, equipment_id: null,
      });
    } else if (isTrue(m.present_actual) && isFalse(m.communicating)) {
      addTarget({
        source_meter_id: m.id,
        category: 'meter_connection', severity: 'major',
        r175_article: 'R175-3 §1',
        title: `Raccorder le compteur ${typeFr}${zoneStr}`,
        description: `Le compteur est présent mais non-communicant. Le suivi à pas horaire et la conservation 5 ans (R175-3 §1) ne sont pas possibles sans remontée automatique.`,
        zone_id: m.zone_id, equipment_id: m.equipment_id,
      });
    }
    // Liaison GTB du compteur cassee (compteur integre a la GTB mais GTB ne
    // releve pas correctement)
    if (m.managed_by_bms && m.bms_integration_out_of_service) {
      addTarget({
        source_meter_id: m.id, source_subtype: 'bms_link_broken',
        category: 'bms_upgrade', severity: 'major',
        r175_article: 'R175-3 §3',
        title: `Rétablir la liaison GTB du compteur ${typeFr}${zoneStr}`,
        description: `Le compteur est intégré à la GTB mais la remontée est cassée (paramétrage, adresse, protocole). À diagnostiquer / reconfigurer.`,
        zone_id: m.zone_id, equipment_id: m.equipment_id,
      });
    }
  }

  // BMS (R175-3 P1-P4, R175-4, R175-5).
  // BMS = 1:1 avec l'AF, donc on rattache via source_bms_document_id =
  // documentId. Le discriminator entre les checks (P1, P2, maintenance...)
  // passe par source_subtype.
  const bms = db.db.prepare('SELECT * FROM bacs_audit_bms WHERE document_id = ?').get(documentId);
  // present === 0 : aucune GTB sur site → une seule action « installer une
  // GTB », et on saute toutes les vérifs de capacités GTB.
  const noGtb = bms && bms.present === 0;
  if (noGtb) {
    addTarget({
      source_bms_document_id: documentId, source_subtype: 'no_gtb',
      category: 'bms_upgrade', severity: 'blocking',
      r175_article: 'R175-3',
      title: 'Mettre en place une GTB conforme au décret BACS',
      description: 'Aucune GTB n\'est déclarée sur le site. Le décret BACS impose un système d\'automatisation et de contrôle du bâtiment assurant le suivi des consommations, la détection des dérives et le pilotage des systèmes techniques. Deux pistes à instruire avec l\'intégrateur : (1) étendre une supervision ou un automate existants s\'ils peuvent porter les fonctions R175-3 ; (2) déployer une solution GTB neuve si rien d\'exploitable n\'est en place. L\'arbitrage dépend de l\'architecture déjà câblée sur site.',
    });
  }
  if (!noGtb && bms && !bms.out_of_service) {
    if (bms.meets_r175_3_p1 === 0) {
      addTarget({
        source_bms_document_id: documentId, source_subtype: 'r175_3_p1',
        category: 'data_retention_upgrade', severity: 'blocking',
        r175_article: 'R175-3 §1',
        title: 'Etendre la retention des donnees a 5 ans minimum',
        description: 'La GTB en place ne conserve pas les donnees a l\'echelle mensuelle pendant 5 ans (exigence R175-3 §1).',
      });
    }
    if (bms.meets_r175_3_p2 === 0) {
      addTarget({
        source_bms_document_id: documentId, source_subtype: 'r175_3_p2',
        category: 'bms_upgrade', severity: 'major',
        r175_article: 'R175-3 §2',
        title: 'Activer la détection des pertes d\'efficacité',
        description: 'La GTB doit détecter les dérives de consommation (R175-3 §2). Cette capacité n\'est pas présente dans la solution en place.',
      });
    }
    // NOTE : meets_r175_3_p3 et p4 sont désormais gérés au niveau des systèmes
    // (cf section systems ci-dessus), pas dans la GTB.
    if (bms.has_maintenance_procedures === 0) {
      addTarget({
        source_bms_document_id: documentId, source_subtype: 'maintenance',
        category: 'documentation', severity: 'major',
        r175_article: 'R175-4',
        title: 'Établir des consignes écrites de maintenance du BACS',
        description: 'L\'article R175-4 exige la présence de consignes écrites encadrant la maintenance du BACS. Aucune procédure documentée n\'a été identifiée.',
      });
    }
    // R175-3 dernier alinea : mise a disposition des donnees
    if (bms.data_provision_to_manager === 0) {
      addTarget({
        source_bms_document_id: documentId, source_subtype: 'data_provision_manager',
        category: 'documentation', severity: 'major',
        // « dernier alinéa » → axe « Mise à disposition des données » du
        // tableau de bord (axisOfArticle matche /dernier|alin|donn/).
        r175_article: 'R175-3 dernier alinéa',
        title: 'Documenter la mise à disposition des données au gestionnaire du bâtiment',
        description: 'L\'article R175-3 (dernier alinéa) impose au propriétaire de mettre les données archivées à disposition du gestionnaire du bâtiment à sa demande. Aucune procédure documentée n\'a été identifiée.',
      });
    }
    if (bms.data_provision_to_operators === 0) {
      addTarget({
        source_bms_document_id: documentId, source_subtype: 'data_provision_operators',
        category: 'documentation', severity: 'major',
        r175_article: 'R175-3 dernier alinéa',
        title: 'Documenter la transmission des données aux exploitants des systèmes techniques',
        description: 'L\'article R175-3 (dernier alinéa) impose au propriétaire de transmettre à chaque exploitant les données concernant le système technique qu\'il opère. Aucune procédure documentée n\'a été identifiée.',
      });
    }
    // Item 15 — GTB existante : stockage 5 ans + accès aux données (R175-3).
    // data_storage_5y_compliant = 'no' → action bloquante R175-3 1°.
    if (bms.data_storage_5y_compliant === 'no') {
      addTarget({
        source_bms_document_id: documentId, source_subtype: 'data_storage_5y',
        category: 'data_retention_upgrade', severity: 'blocking',
        r175_article: 'R175-3 1°',
        title: 'Mettre en place un archivage des consommations sur 5 ans',
        description: 'L\'article R175-3 1° impose la conservation des données de consommation à l\'échelle mensuelle pendant au moins 5 ans. La GTB en place ne garantit pas cet archivage.',
      });
    }
    // data_owner_access = 'no' → action majeure R175-3 (le propriétaire est
    // propriétaire des données et doit y avoir accès).
    if (bms.data_owner_access === 'no') {
      addTarget({
        source_bms_document_id: documentId, source_subtype: 'data_owner_access',
        category: 'documentation', severity: 'major',
        r175_article: 'R175-3 dernier alinéa',
        title: 'Garantir l\'accès du propriétaire à ses données',
        description: 'Le propriétaire du BACS est propriétaire des données de consommation et doit pouvoir y accéder directement (R175-3). Exiger l\'ouverture d\'un compte propriétaire auprès de l\'éditeur de la GTB.',
      });
    }
    // export_capability = 'no' → action mineure (facilite le suivi).
    if (bms.export_capability === 'no') {
      addTarget({
        source_bms_document_id: documentId, source_subtype: 'data_export_capability',
        category: 'data_retention_upgrade', severity: 'minor',
        r175_article: 'R175-3',
        title: 'Activer l\'export des données au format standard',
        description: 'La GTB ne permet pas d\'exporter les données au format standard (CSV / Excel). Recommandation : activer cette capacité pour faciliter le suivi énergétique et les déclarations réglementaires.',
      });
    }

    // R175-5 : formation. Skip si la solution en place est Buildy (support natif).
    if (bms.operator_trained === 0 && !isBuildySolution(bms)) {
      addTarget({
        source_bms_document_id: documentId, source_subtype: 'training',
        category: 'training', severity: 'major',
        r175_article: 'R175-5',
        title: 'Former l\'exploitant au paramétrage du BACS',
        description: 'L\'exploitant doit être formé au paramétrage du BACS (R175-5). Aucune formation documentée n\'a été attestée.',
      });
    }
  }

  // Thermal regulation (R175-6) — applicable seulement si declencheur :
  // PC > 21/07/2021 OU travaux generateur > 21/07/2021.
  const af = db.db.prepare('SELECT bacs_building_permit_date, bacs_generator_works_date FROM afs WHERE id = ?').get(documentId);
  const TRIGGER = '2021-07-21';
  const r175_6_applicable =
    (af?.bacs_building_permit_date && af.bacs_building_permit_date > TRIGGER) ||
    (af?.bacs_generator_works_date && af.bacs_generator_works_date > TRIGGER);

  if (r175_6_applicable) {
    // Mig 180 : 1 ligne par système. On lit aussi le nom du système
    // (custom_label) via JOIN sur bacs_audit_systems, et les
    // regulation_type_* des devices Production / Distribution / Émission
    // (pour évaluer la conformité « régulation déclarée sur l'équipement »).
    const thermal = db.db.prepare(`
      SELECT t.*, z.name AS zone_name,
             s.custom_label AS system_label,
             dProd.energy_source AS prod_energy_source,
             dProd.regulation_type_production AS prod_reg_type,
             dProd.has_regulation AS prod_has_regulation,
             dDist.regulation_type_distribution AS dist_reg_type,
             dDist.has_regulation AS dist_has_regulation,
             dEmit.regulation_type_emission AS emit_reg_type,
             dEmit.has_regulation AS emit_has_regulation
      FROM bacs_audit_thermal_regulation t
      LEFT JOIN zones z ON z.id = t.zone_id
      LEFT JOIN bacs_audit_systems s ON s.id = t.system_id
      LEFT JOIN bacs_audit_system_devices dProd ON dProd.id = t.generator_device_id
      LEFT JOIN bacs_audit_system_devices dDist ON dDist.id = t.distribution_device_id
      LEFT JOIN bacs_audit_system_devices dEmit ON dEmit.id = t.emission_device_id
      WHERE t.document_id = ?
    `).all(documentId);
    for (const t of thermal) {
      // Exemption R175-6 II : appareil indépendant de chauffage au bois.
      // Auto-détectée via l'énergie du device en Production = 'wood'.
      if (t.prod_energy_source === 'wood') continue;
      // « Régulation déclarée » : on considère le système régulé si AU MOINS
      // un de ces signaux est positif sur un device impliqué (production /
      // distribution / émission) :
      //  (a) un type de régulation est saisi (regulation_type_X ≠ null)
      //  (b) le toggle has_regulation = true (mig 179) sur le device
      //  (c) l'archive legacy regulation_type au niveau thermal_regulation
      //      ≠ 'none' (compat audits pré-mig 180)
      // Un toggle Non explicite (has_regulation = false) sur un niveau ne
      // suffit pas à invalider le système si un autre niveau est régulé.
      const typeDeclared = !!(t.prod_reg_type || t.dist_reg_type || t.emit_reg_type);
      const flagSet = t.prod_has_regulation === 1 || t.dist_has_regulation === 1 || t.emit_has_regulation === 1;
      const legacyTypeOk = t.regulation_type && t.regulation_type !== 'none';
      if (!typeDeclared && !flagSet && !legacyTypeOk) {
        const cat = t.category || 'heating';
        const defaultLabel = cat === 'cooling' ? 'Refroidissement' : 'Chauffage';
        const entryLabel = (t.system_label && t.system_label.trim())
          || (t.label && t.label.trim())
          || defaultLabel;
        addTarget({
          source_thermal_id: t.id,
          category: 'thermal_regulation', severity: 'major',
          r175_article: 'R175-6',
          title: `Mettre en place une régulation thermique automatique en zone « ${t.zone_name || '?'} » — ${entryLabel}`,
          description: `L'article R175-6 exige une régulation thermique automatique par pièce ou par zone ${cat === 'cooling' ? 'refroidie' : 'chauffée'}. Le système « ${entryLabel} » n'en dispose pas actuellement. Selon l'existant, l'intégrateur arbitre entre : mise à niveau d'un thermostat déjà câblé, ajout d'un module de pilotage piloté par la GTB, ou pose d'une régulation neuve.`,
          zone_id: t.zone_id,
        });
      }
    }
  }

  // R175-5-1 — inspection periodique par tiers (rapport conserve 10 ans).
  // Sans GTB sur site, aucune inspection BACS n'est à programmer.
  // Mig 187 : si l'auditeur a explicitement coché « Aucune inspection à
  // déclarer » (ex. ERP non concerné, site non encore inspecté), on saute
  // également la génération de l'action corrective.
  const inspectionNa = db.db.prepare('SELECT inspection_not_applicable FROM afs WHERE id = ?').get(documentId);
  const inspectionMarkedNa = inspectionNa && (inspectionNa.inspection_not_applicable === 1 || inspectionNa.inspection_not_applicable === true);
  if (!noGtb && !inspectionMarkedNa) {
   const inspections = db.db.prepare(
    'SELECT * FROM bacs_audit_inspections WHERE document_id = ? ORDER BY COALESCE(last_inspection_date, \'1970\') DESC'
   ).all(documentId);
   const today = new Date().toISOString().slice(0, 10);
   if (inspections.length === 0) {
    // Item synthetique : aucune inspection en DB, donc pas de FK.
    // source_subtype = 'no_inspection' assure l'unicite de la cle d'idempotence.
    addTarget({
      source_subtype: 'no_inspection',
      category: 'documentation', severity: 'major',
      r175_article: 'R175-5-1',
      title: 'Programmer une inspection périodique du BACS par un tiers',
      description: 'L\'article R175-5-1 impose une inspection périodique réalisée par un tiers (rapport conservé 10 ans). Aucune trace d\'inspection n\'a été déposée pour ce site.',
    });
   } else {
    const latest = inspections[0];
    if (latest.next_inspection_due_date && latest.next_inspection_due_date < today) {
      addTarget({
        source_inspection_id: latest.id,
        category: 'documentation', severity: 'major',
        r175_article: 'R175-5-1',
        title: 'Inspection périodique R175-5-1 dépassée — replanifier',
        description: `Échéance prévue ${latest.next_inspection_due_date} non respectée. Replanifier l'inspection par un tiers (rapport conservé 10 ans).`,
      });
    }
   }
  }

  return target;
}

/**
 * Regenere les action_items en preservant les annotations commerciales.
 *
 * Strategie :
 * 1. Calcule la liste cible (target).
 * 2. Pour chaque item auto existant : s'il est dans target, le mettre a jour
 *    (en preservant commercial_notes/estimated_effort/status non-open).
 *    S'il n'y est plus, le marquer status='done' (le gap a ete resolu).
 * 3. Pour chaque target absent en DB : INSERT avec status='open'.
 * 4. Items manuels (auto_generated=0) : ne pas toucher.
 *
 * Retourne { added, updated, resolved }.
 */
function regenerateActionItems(documentId) {
  // Skip pour les audits site (devis Buildy) : aucun plan d'actions
  // automatique R175 n'est pertinent — la synthese Claude porte les
  // recommandations Buildy.
  const doc = db.afs.getById(documentId);
  if (doc && doc.kind && doc.kind !== 'bacs_audit') {
    return { added: 0, updated: 0, resolved: 0 };
  }
  const target = computeTargetActions(documentId);

  const existing = db.db.prepare(`
    SELECT id,
           source_system_id, source_meter_id, source_thermal_id,
           source_device_id, source_inspection_id, source_bms_document_id,
           source_subtype, status, category, severity, r175_article,
           title, description, zone_id, equipment_id
    FROM bacs_audit_action_items
    WHERE document_id = ? AND auto_generated = 1
  `).all(documentId);

  const existingByKey = new Map();
  for (const e of existing) {
    existingByKey.set(keyOfItem(e), e);
  }

  let added = 0, updated = 0, resolved = 0;

  // 1. Sync les items existants vs target
  for (const [key, e] of existingByKey) {
    const t = target.get(key);
    if (!t) {
      // Plus dans la cible -> gap resolu, marquer 'done'.
      // Concerne les items open/quoted/in_progress (gap résolu naturellement)
      // ET les items declined dont la source a disparu (sinon ils restent
      // orphelins et polluent les compteurs/PDF — Vague 4 item 16 de l'audit).
      // Les items déjà 'done' ne sont pas re-touchés (idempotence).
      if (e.status !== 'done') {
        db.db.prepare(`
          UPDATE bacs_audit_action_items
          SET status = 'done', updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(e.id);
        resolved++;
      }
    } else {
      // Mise a jour. L'item est de nouveau dans la cible :
      //  - s'il etait 'done' (gap precedemment resolu), le gap est RE-OUVERT
      //    -> on repasse en 'open' (sinon l'action reste invisible alors que
      //    le probleme est revenu — cf. bascule GTB presente/absente).
      //  - s'il etait 'declined' (ecarte manuellement par l'auditeur), on
      //    respecte ce choix et on le laisse 'declined'.
      const updateStatus = e.status === 'declined' ? 'declined' : 'open';
      db.db.prepare(`
        UPDATE bacs_audit_action_items
        SET category = ?, severity = ?, r175_article = ?, title = ?, description = ?,
            zone_id = ?, equipment_id = ?, status = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        t.category, t.severity, t.r175_article || null, t.title, t.description || null,
        t.zone_id || null, t.equipment_id || null, updateStatus, e.id,
      );
      updated++;
    }
  }

  // 2. Insertions des nouveaux targets
  const ins = db.db.prepare(`
    INSERT INTO bacs_audit_action_items
      (document_id, category, severity, r175_article, title, description,
       zone_id, equipment_id,
       source_system_id, source_meter_id, source_thermal_id,
       source_device_id, source_inspection_id, source_bms_document_id,
       source_subtype, auto_generated, status, position)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'open', ?)
  `);
  let pos = 0;
  for (const [key, t] of target) {
    if (existingByKey.has(key)) continue;
    ins.run(
      documentId, t.category, t.severity, t.r175_article || null, t.title,
      t.description || null, t.zone_id || null, t.equipment_id || null,
      t.source_system_id || null, t.source_meter_id || null, t.source_thermal_id || null,
      t.source_device_id || null, t.source_inspection_id || null, t.source_bms_document_id || null,
      t.source_subtype || null, pos * 10,
    );
    added++;
    pos++;
  }

  log.info(`Regen action items document #${documentId} : +${added} new, ~${updated} synced, ✓${resolved} resolved`);

  // Recalcule + persiste bacs_total_power_kw au passage : c'est le seul hook
  // appelé après TOUTES les modifs metier (device add/update/delete/move/
  // duplicate, meter, BMS…), donc on garantit que la puissance stockée reste
  // synchro avec les devices réels. Incident audit Communay 2026-05-25 :
  // bacs_total_power_kw=161.3 cached alors que computeAutoPower donnait 112.
  try {
    const { recomputeAndPersistAuditPower } = require('./bacs-audit-power');
    recomputeAndPersistAuditPower(db.db, documentId);
  } catch (e) {
    log.warn(`recomputeAndPersistAuditPower échec pour #${documentId} : ${e.message}`);
  }

  return { added, updated, resolved };
}

module.exports = { regenerateActionItems, computeTargetActions };
