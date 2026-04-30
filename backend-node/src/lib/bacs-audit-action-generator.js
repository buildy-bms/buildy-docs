'use strict';

/**
 * Genere les actions correctives `bacs_audit_action_items` a partir des
 * donnees de l'audit BACS (systems / meters / bms / thermal_regulation).
 *
 * Idempotent : les items auto-generes sont identifies par
 * (source_table, source_id). Si la donnee source change, l'item est mis
 * a jour. Si la source est resolue (gap comble), l'item passe en done.
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

// Mappings FR pour les libellés affichés dans les actions correctives
// (utilisés dans tout le code BACS — détail view, action items view, PDF).
const SYSTEM_LABEL_FR = {
  heating: 'chauffage',
  cooling: 'refroidissement',
  ventilation: 'ventilation',
  dhw: 'eau chaude sanitaire',
  lighting_indoor: 'éclairage intérieur',
  lighting_outdoor: 'éclairage extérieur',
  electricity_production: 'production électrique',
};
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

/**
 * Construit la liste cible d'actions a poser pour un document.
 * Retourne un Map<key, item> ou key = `${source_table}:${source_id}`.
 */
function computeTargetActions(documentId) {
  const target = new Map();
  function addTarget(item) {
    const key = `${item.source_table}:${item.source_id}:${item.source_subtype || ''}`;
    target.set(key, item);
  }

  // Systems (R175-1 §4 + R175-3 §3 + §4)
  const systems = db.db.prepare(`
    SELECT s.*, z.name AS zone_name FROM bacs_audit_systems s
    LEFT JOIN zones z ON z.zone_id = s.zone_id
    WHERE s.document_id = ?
  `).all(documentId);
  for (const s of systems) {
    const catFr = SYSTEM_LABEL_FR[s.system_category] || s.system_category;
    const zoneStr = s.zone_name ? ` en zone « ${s.zone_name} »` : '';

    // Système absent → R175-1 §4 (plusieurs sources_id par paire systemId pour
    // ne pas se recouvrir avec les autres règles ci-dessous)
    if (!s.present) {
      addTarget({
        source_table: 'systems', source_id: s.id, source_subtype: 'absent',
        category: 'system_addition', severity: 'major',
        r175_article: 'R175-1 §4',
        title: `Ajouter un système de ${catFr}${zoneStr}`,
        description: `Cette zone devrait disposer d'un système de ${catFr} selon le périmètre R175-1 §4. Aucun système n'a été identifié à l'audit.`,
        zone_id: s.zone_id, equipment_id: null,
      });
      continue; // pas de p3/p4 si le système n'est pas présent
    }

    // Système présent + non communicant (legacy : on garde la règle communication=non_communicant)
    if (s.communication === 'non_communicant') {
      addTarget({
        source_table: 'systems', source_id: s.id, source_subtype: 'non_communicant',
        category: 'communication_upgrade', severity: 'major',
        r175_article: 'R175-3 §3',
        title: `Rendre communicant le système de ${catFr}${zoneStr}`,
        description: `L'interopérabilité (R175-3 §3) requiert que les systèmes techniques exposent au moins un protocole standard ouvert (BACnet, Modbus, KNX, M-Bus, MQTT).`,
        zone_id: s.zone_id, equipment_id: s.equipment_id,
      });
    }

    // R175-3 §3 — interopérabilité par système (saisie explicite via case à cocher)
    if (s.meets_r175_3_p3 === 0) {
      addTarget({
        source_table: 'systems', source_id: s.id, source_subtype: 'r175_3_p3',
        category: 'communication_upgrade', severity: 'major',
        r175_article: 'R175-3 §3',
        title: `Assurer l'interopérabilité du système de ${catFr}${zoneStr}`,
        description: `L'auditeur a constaté que ce système ne satisfait pas l'exigence d'interopérabilité (R175-3 §3). Il devrait exposer au moins un protocole standard ouvert (BACnet, Modbus, KNX, M-Bus, MQTT) pour communiquer avec la GTB et les autres systèmes.`,
        zone_id: s.zone_id, equipment_id: s.equipment_id,
      });
    }

    // R175-3 §4 — arret manuel par systeme
    if (s.meets_r175_3_p4 === 0) {
      addTarget({
        source_table: 'systems', source_id: s.id, source_subtype: 'r175_3_p4',
        category: 'bms_upgrade', severity: 'major',
        r175_article: 'R175-3 §4',
        title: `Permettre l'arrêt manuel du ${catFr}${zoneStr}`,
        description: `R175-3 §4 exige que l'utilisateur puisse arrêter manuellement le système.`,
        zone_id: s.zone_id, equipment_id: s.equipment_id,
      });
    }

    // R175-3 §4 — fonctionnement autonome par systeme (case distincte)
    if (s.meets_r175_3_p4_autonomous === 0) {
      addTarget({
        source_table: 'systems', source_id: s.id, source_subtype: 'r175_3_p4_autonomous',
        category: 'bms_upgrade', severity: 'major',
        r175_article: 'R175-3 §4',
        title: `Activer le fonctionnement autonome du ${catFr}${zoneStr}`,
        description: `R175-3 §4 exige que la GTB reprenne automatiquement la main sur le système après un arrêt manuel et le pilote de manière autonome.`,
        zone_id: s.zone_id, equipment_id: s.equipment_id,
      });
    }
  }

  // Meters (R175-3 §1)
  const meters = db.db.prepare(`
    SELECT m.*, z.name AS zone_name FROM bacs_audit_meters m
    LEFT JOIN zones z ON z.zone_id = m.zone_id
    WHERE m.document_id = ?
  `).all(documentId);
  for (const m of meters) {
    const typeFr = METER_TYPE_LABEL_FR[m.meter_type] || m.meter_type;
    const usageFr = METER_USAGE_LABEL_FR[m.usage] || m.usage;
    const zoneStr = m.zone_name ? ` en zone « ${m.zone_name} »` : ' (général bâtiment)';
    if (m.required && !m.present_actual) {
      addTarget({
        source_table: 'meters', source_id: m.id,
        category: 'meter_addition', severity: 'blocking',
        r175_article: 'R175-3 §1',
        title: `Ajouter compteur ${typeFr}${zoneStr} — ${usageFr}`,
        description: `Le suivi continu R175-3 §1 requiert un compteur ${typeFr} pour l'usage « ${usageFr} ».`,
        zone_id: m.zone_id, equipment_id: null,
      });
    } else if (m.present_actual && !m.communicating) {
      addTarget({
        source_table: 'meters', source_id: m.id,
        category: 'meter_connection', severity: 'major',
        r175_article: 'R175-3 §1',
        title: `Raccorder le compteur ${typeFr}${zoneStr}`,
        description: `Le compteur est présent mais non-communicant. Le suivi à pas horaire et la conservation 5 ans (R175-3 §1) ne sont pas possibles sans remontée automatique.`,
        zone_id: m.zone_id, equipment_id: m.equipment_id,
      });
    }
  }

  // BMS (R175-3 P1-P4, R175-4, R175-5)
  const bms = db.db.prepare('SELECT * FROM bacs_audit_bms WHERE document_id = ?').get(documentId);
  if (bms) {
    if (bms.meets_r175_3_p1 === 0) {
      addTarget({
        source_table: 'bms', source_id: 1,
        category: 'data_retention_upgrade', severity: 'blocking',
        r175_article: 'R175-3 §1',
        title: 'Etendre la retention des donnees a 5 ans minimum',
        description: 'La GTB en place ne conserve pas les donnees a l\'echelle mensuelle pendant 5 ans (exigence R175-3 §1).',
      });
    }
    if (bms.meets_r175_3_p2 === 0) {
      addTarget({
        source_table: 'bms', source_id: 2,
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
        source_table: 'bms', source_id: 5,
        category: 'documentation', severity: 'major',
        r175_article: 'R175-4',
        title: 'Établir des consignes écrites de maintenance du BACS',
        description: 'L\'article R175-4 exige la présence de consignes écrites encadrant la maintenance du BACS. Aucune procédure documentée n\'a été identifiée.',
      });
    }
    // R175-5 : formation. Skip si la solution en place est Buildy (support natif).
    if (bms.operator_trained === 0 && !isBuildySolution(bms)) {
      addTarget({
        source_table: 'bms', source_id: 6,
        category: 'training', severity: 'major',
        r175_article: 'R175-5',
        title: 'Former l\'exploitant au paramétrage du BACS',
        description: 'L\'exploitant doit être formé au paramétrage du BACS (R175-5). Aucune formation documentée n\'a été attestée.',
      });
    }
  }

  // Thermal regulation (R175-6)
  const thermal = db.db.prepare(`
    SELECT t.*, z.name AS zone_name FROM bacs_audit_thermal_regulation t
    LEFT JOIN zones z ON z.zone_id = t.zone_id
    WHERE t.document_id = ?
  `).all(documentId);
  for (const t of thermal) {
    // Exemption R175-6 : appareil independant de chauffage au bois
    if (!t.has_automatic_regulation && t.generator_type !== 'wood_appliance') {
      addTarget({
        source_table: 'thermal_regulation', source_id: t.id,
        category: 'thermal_regulation', severity: 'major',
        r175_article: 'R175-6',
        title: `Installer une régulation thermique automatique en zone « ${t.zone_name || '?'} »`,
        description: 'L\'article R175-6 exige une régulation thermique automatique par pièce ou par zone. La zone n\'en dispose pas actuellement.',
        zone_id: t.zone_id,
      });
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
  const target = computeTargetActions(documentId);

  const existing = db.db.prepare(`
    SELECT id, source_table, source_id, source_subtype, status, category, severity, r175_article,
           title, description, zone_id, equipment_id
    FROM bacs_audit_action_items
    WHERE document_id = ? AND auto_generated = 1
  `).all(documentId);

  const existingByKey = new Map();
  for (const e of existing) {
    if (e.source_table && e.source_id != null) {
      existingByKey.set(`${e.source_table}:${e.source_id}:${e.source_subtype || ''}`, e);
    }
  }

  let added = 0, updated = 0, resolved = 0;

  // 1. Sync les items existants vs target
  for (const [key, e] of existingByKey) {
    const t = target.get(key);
    if (!t) {
      // Plus dans la cible -> gap resolu, marquer 'done' (sauf si deja done/declined)
      if (e.status === 'open' || e.status === 'quoted' || e.status === 'in_progress') {
        db.db.prepare(`
          UPDATE bacs_audit_action_items
          SET status = 'done', updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(e.id);
        resolved++;
      }
    } else {
      // Mise a jour (sans toucher status si != open)
      const updateStatus = e.status === 'open' ? 'open' : e.status;
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
       zone_id, equipment_id, source_table, source_id, source_subtype,
       auto_generated, status, position)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'open', ?)
  `);
  let pos = 0;
  for (const [key, t] of target) {
    if (existingByKey.has(key)) continue;
    ins.run(
      documentId, t.category, t.severity, t.r175_article || null, t.title,
      t.description || null, t.zone_id || null, t.equipment_id || null,
      t.source_table, t.source_id, t.source_subtype || null, pos * 10,
    );
    added++;
    pos++;
  }

  log.info(`Regen action items document #${documentId} : +${added} new, ~${updated} synced, ✓${resolved} resolved`);
  return { added, updated, resolved };
}

module.exports = { regenerateActionItems, computeTargetActions };
