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
    target.set(`${item.source_table}:${item.source_id}`, item);
  }

  // Systems (R175-1 §4 + R175-3 §3)
  const systems = db.db.prepare(`
    SELECT s.*, z.name AS zone_name FROM bacs_audit_systems s
    LEFT JOIN zones z ON z.zone_id = s.zone_id
    WHERE s.document_id = ?
  `).all(documentId);
  for (const s of systems) {
    if (!s.present) {
      addTarget({
        source_table: 'systems', source_id: s.id,
        category: 'system_addition', severity: 'major',
        r175_article: 'R175-1 §4',
        title: `Ajouter ${s.system_category} en zone « ${s.zone_name || '?'} »`,
        description: `La zone « ${s.zone_name || '?'} » devrait disposer d'un systeme de ${s.system_category} selon le decoupage R175-1. Aucun systeme n'a ete identifie a l'audit.`,
        zone_id: s.zone_id, equipment_id: null,
      });
    } else if (s.communication === 'non_communicant') {
      addTarget({
        source_table: 'systems', source_id: s.id,
        category: 'communication_upgrade', severity: 'major',
        r175_article: 'R175-3 §3',
        title: `Rendre communicant le ${s.system_category} en zone « ${s.zone_name || '?'} »`,
        description: `L'interoperabilite (R175-3 §3) requiert que les systemes techniques exposent au moins un protocole standard ouvert (BACnet, Modbus, KNX, M-Bus, MQTT).`,
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
    if (m.required && !m.present_actual) {
      addTarget({
        source_table: 'meters', source_id: m.id,
        category: 'meter_addition', severity: 'blocking',
        r175_article: 'R175-3 §1',
        title: `Ajouter compteur ${m.meter_type}${m.zone_name ? ` en zone « ${m.zone_name} »` : ''} (${m.usage})`,
        description: `Le suivi continu R175-3 §1 requiert un compteur ${m.meter_type} pour l'usage ${m.usage}.`,
        zone_id: m.zone_id, equipment_id: null,
      });
    } else if (m.present_actual && !m.communicating) {
      addTarget({
        source_table: 'meters', source_id: m.id,
        category: 'meter_connection', severity: 'major',
        r175_article: 'R175-3 §1',
        title: `Raccorder le compteur ${m.meter_type}${m.zone_name ? ` en zone « ${m.zone_name} »` : ''}`,
        description: `Le compteur est present mais non-communicant. Le suivi a pas horaire et la conservation 5 ans (R175-3 §1) ne sont pas possibles sans remontee automatique.`,
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
        title: 'Activer la detection des pertes d\'efficacite',
        description: 'La GTB doit detecter les derives de consommation (R175-3 §2). Cette capacite n\'est pas presente dans la solution en place.',
      });
    }
    if (bms.meets_r175_3_p3 === 0) {
      addTarget({
        source_table: 'bms', source_id: 3,
        category: 'bms_upgrade', severity: 'major',
        r175_article: 'R175-3 §3',
        title: 'Assurer l\'interoperabilite multi-systemes de la GTB',
        description: 'La GTB doit pouvoir communiquer avec l\'ensemble des systemes techniques du batiment (R175-3 §3).',
      });
    }
    if (bms.meets_r175_3_p4 === 0) {
      addTarget({
        source_table: 'bms', source_id: 4,
        category: 'bms_upgrade', severity: 'major',
        r175_article: 'R175-3 §4',
        title: 'Permettre l\'arret manuel + gestion autonome',
        description: 'Les utilisateurs doivent pouvoir arreter manuellement les systemes ; la GTB doit ensuite les gerer de maniere autonome (R175-3 §4).',
      });
    }
    if (bms.has_maintenance_procedures === 0) {
      addTarget({
        source_table: 'bms', source_id: 5,
        category: 'documentation', severity: 'major',
        r175_article: 'R175-4',
        title: 'Etablir des consignes ecrites de maintenance du BACS',
        description: 'L\'article R175-4 exige la presence de consignes ecrites encadrant la maintenance du BACS. Aucune procedure documentee n\'a ete identifiee.',
      });
    }
    // R175-5 : formation. Skip si la solution en place est Buildy (support natif).
    if (bms.operator_trained === 0 && !isBuildySolution(bms)) {
      addTarget({
        source_table: 'bms', source_id: 6,
        category: 'training', severity: 'major',
        r175_article: 'R175-5',
        title: 'Former l\'exploitant au parametrage du BACS',
        description: 'L\'exploitant doit etre forme au parametrage du BACS (R175-5). Aucune formation documentee n\'a ete attestee.',
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
        title: `Installer une regulation automatique en zone « ${t.zone_name || '?'} »`,
        description: 'L\'article R175-6 exige une regulation thermique automatique par piece ou par zone. La zone n\'en dispose pas actuellement.',
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
    SELECT id, source_table, source_id, status, category, severity, r175_article,
           title, description, zone_id, equipment_id
    FROM bacs_audit_action_items
    WHERE document_id = ? AND auto_generated = 1
  `).all(documentId);

  const existingByKey = new Map();
  for (const e of existing) {
    if (e.source_table && e.source_id != null) {
      existingByKey.set(`${e.source_table}:${e.source_id}`, e);
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
       zone_id, equipment_id, source_table, source_id, auto_generated, status, position)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'open', ?)
  `);
  let pos = 0;
  for (const [key, t] of target) {
    if (existingByKey.has(key)) continue;
    ins.run(
      documentId, t.category, t.severity, t.r175_article || null, t.title,
      t.description || null, t.zone_id || null, t.equipment_id || null,
      t.source_table, t.source_id, pos * 10,
    );
    added++;
    pos++;
  }

  log.info(`Regen action items document #${documentId} : +${added} new, ~${updated} synced, ✓${resolved} resolved`);
  return { added, updated, resolved };
}

module.exports = { regenerateActionItems, computeTargetActions };
