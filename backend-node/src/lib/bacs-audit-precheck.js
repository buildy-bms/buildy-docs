'use strict';

/**
 * Pré-check de cohérence avant livraison d'un audit BACS (Lot 3 — Plan
 * « Qualité du livrable PDF »).
 *
 * Retourne deux listes :
 *   - `blocking[]` : incohérences qui DOIVENT être corrigées avant de livrer
 *     (l'audit serait juridiquement attaquable s'il sortait en l'état).
 *   - `warnings[]` : zones d'attention qui méritent un coup d'œil mais ne
 *     bloquent pas la livraison (saisies plausibles mais à confirmer).
 *
 * Chaque entrée : { code, severity, entity, entity_id, field, message, hint? }.
 *
 * Le helper se concentre sur la **cohérence métier transversale** (entre
 * entités) — les check d'enums et de schémas sont déjà faits par Zod côté
 * routes. Voir `audit-coherence-checks.js` pour les guards FK régulation.
 */

const db = require('../database');
const { isTrue, isFalse } = require('../routes/bacs-audit/_ternary');
const { parseRoles } = require('./device-roles');

// Plages plausibles par catégorie d'usage. Au-delà, on flag un warning (pas
// un blocage — l'auditeur peut avoir un site exceptionnel). Seuils calés sur
// les ordres de grandeur observés sur la flotte Buildy + guide PROFEEL.
const PLAUSIBLE_POWER_KW = {
  heating:  { min: 1,   max: 5000,  unit: 'kW' },  // chaudière, PAC, sous-station
  cooling:  { min: 1,   max: 5000,  unit: 'kW' },  // groupe froid, DRV
  dhw:      { min: 0.5, max: 1000,  unit: 'kW' },  // ballon ECS, sous-station
  ventilation: { min: 0.1, max: 200, unit: 'kW' },
};

const PLAUSIBLE_AGE_YEARS = { max: 60 };
const PLAUSIBLE_ZONE_SURFACE_M2 = { min: 1, max: 50000 };

function newFinding(code, severity, entity, entity_id, field, message, hint, fixHint) {
  return { code, severity, entity, entity_id, field, message, hint: hint || null, fix_hint: fixHint || null };
}

function buildPrecheck(documentId) {
  const blocking = [];
  const warnings = [];

  const af = db.afs.getById(documentId);
  if (!af) throw new Error(`Audit #${documentId} introuvable.`);
  if (af.kind !== 'bacs_audit') {
    // Précheck silencieux pour les site_audit (hors décret R175).
    return { audit_id: documentId, kind: af.kind, blocking, warnings, generated_at: new Date().toISOString() };
  }

  // ── Identification ───────────────────────────────────────────────────
  if (!af.site_id) {
    blocking.push(newFinding('IDENT-001', 'blocking', 'document', documentId, 'site_id',
      'Aucun site n\'est rattaché à l\'audit.',
      'Sans site, ni les zones ni les compteurs ne peuvent être saisis.',
      'Carte « Identification du site ».'));
  }
  if (!af.bacs_applicability_status) {
    blocking.push(newFinding('IDENT-002', 'blocking', 'document', documentId, 'bacs_applicability_status',
      'L\'assujettissement R175-2 n\'est pas déterminé.',
      'Le PDF affiche « Statut d\'assujettissement non renseigné » — incompatible avec la livraison.',
      'Carte « Identification » → renseigner la puissance et la date de permis.'));
  }

  // ── Systèmes (cross-entités) ─────────────────────────────────────────
  const systems = db.db.prepare(`
    SELECT s.*, z.name AS zone_name FROM bacs_audit_systems s
    LEFT JOIN zones z ON z.id = s.zone_id
    WHERE s.document_id = ? AND s.is_bacs = 1
  `).all(documentId);

  const devicesAll = db.db.prepare(`
    SELECT d.* FROM bacs_audit_system_devices d
    JOIN bacs_audit_systems s ON s.id = d.system_id
    WHERE s.document_id = ?
  `).all(documentId);
  const sharedSysByDevice = db.db.prepare(`
    SELECT device_id, system_id FROM bacs_audit_device_shared_systems
  `).all();
  const sharedMap = new Map();
  for (const row of sharedSysByDevice) {
    if (!sharedMap.has(row.device_id)) sharedMap.set(row.device_id, []);
    sharedMap.get(row.device_id).push(row.system_id);
  }
  const devicesBySystem = new Map();
  for (const d of devicesAll) {
    const ids = [d.system_id, ...(sharedMap.get(d.id) || [])];
    for (const sid of ids) {
      if (!devicesBySystem.has(sid)) devicesBySystem.set(sid, []);
      devicesBySystem.get(sid).push(d);
    }
  }

  for (const s of systems) {
    const lab = `${s.zone_name || 'Zone ?'} · ${s.system_category}`;
    // Contradictions explicites
    if (isTrue(s.present) && isTrue(s.not_concerned)) {
      blocking.push(newFinding('SYS-001', 'blocking', 'system', s.id, 'present/not_concerned',
        `${lab} : système marqué à la fois « présent » ET « non concerné ».`,
        'Ces deux réponses sont mutuellement exclusives.',
        'Carte 03 « Systèmes » → décide l\'un OU l\'autre.'));
    }
    // Présent sans aucun équipement (ni propre ni partagé)
    if (isTrue(s.present)) {
      const devs = devicesBySystem.get(s.id) || [];
      if (devs.length === 0) {
        warnings.push(newFinding('SYS-002', 'warning', 'system', s.id, 'present',
          `${lab} : marqué présent mais aucun équipement saisi.`,
          'Sans équipement, R175-3 §3 et R175-6 ne peuvent pas être vérifiés sur ce système.',
          'Carte 03 → ajoute au moins un équipement OU décoche « présent ».'));
      }
    }
  }

  // ── Équipements : doctrine énergie primaire + plages plausibles ─────
  for (const d of devicesAll) {
    const roles = parseRoles(d.device_role);
    const isProducer = roles.some(r => /production|generator/i.test(r));
    // Doctrine mig 194 (Lot 1) — energy_source uniquement si rôle inclut production.
    if (d.energy_source && !isProducer) {
      blocking.push(newFinding('DEV-001', 'blocking', 'device', d.id, 'energy_source',
        `Équipement « ${d.name || '#' + d.id} » : énergie primaire renseignée alors que la fonction ne contient pas « Production ».`,
        'Un émetteur ou un distributeur passif n\'a pas d\'énergie primaire propre (cf. doctrine 0.1.135).',
        'Modale équipement → ajoute la fonction « Production » OU supprime l\'énergie.'));
    }
    if (isProducer && !d.energy_source) {
      warnings.push(newFinding('DEV-002', 'warning', 'device', d.id, 'energy_source',
        `Équipement de production « ${d.name || '#' + d.id} » sans énergie primaire renseignée.`,
        'Le décret exige de connaître l\'énergie cumulée pour calculer l\'assujettissement R175-2.',
        'Modale équipement → renseigne l\'énergie (gaz, électricité, RC urbain, etc.).'));
    }
    // Régulation intégrée détournée comme régulateur déporté (audit-coherence-checks
    // garde déjà le PATCH thermal, ici on vérifie l'état actuel des rows).
    if (isTrue(d.regulation_integrated)) {
      const usedAsDeport = db.db.prepare(`
        SELECT id FROM bacs_audit_thermal_regulation WHERE
          production_regulation_device_id = ? OR
          distribution_regulation_device_id = ? OR
          emission_regulation_device_id = ?
      `).all(d.id, d.id, d.id);
      if (usedAsDeport.length) {
        blocking.push(newFinding('DEV-003', 'blocking', 'device', d.id, 'regulation_integrated',
          `Équipement « ${d.name || '#' + d.id} » a sa régulation intégrée mais est désigné comme régulateur déporté ailleurs.`,
          'Une régulation intégrée à un équipement ne peut pas piloter un autre équipement.',
          'Régulation thermique → supprime la FK fautive ou décoche « régulation intégrée ».'));
      }
    }
    // Plages plausibles puissance
    const range = PLAUSIBLE_POWER_KW[d.system_category];
    if (range && d.power_kw != null && d.power_kw > 0) {
      if (d.power_kw < range.min || d.power_kw > range.max) {
        warnings.push(newFinding('DEV-004', 'warning', 'device', d.id, 'power_kw',
          `Équipement « ${d.name || '#' + d.id} » : puissance ${d.power_kw} kW hors plage plausible (${range.min}–${range.max} kW pour ${d.system_category}).`,
          'Vérifier que la saisie correspond bien à la puissance nominale (et non à la conso instantanée).',
          'Modale équipement → vérifier le champ Puissance.'));
      }
    }
    if (d.age_years != null && d.age_years > PLAUSIBLE_AGE_YEARS.max) {
      warnings.push(newFinding('DEV-005', 'warning', 'device', d.id, 'age_years',
        `Équipement « ${d.name || '#' + d.id} » : âge déclaré ${d.age_years} ans (> ${PLAUSIBLE_AGE_YEARS.max}).`,
        'Vérifier la date d\'installation (un équipement de + de 60 ans est très rare).',
        'Modale équipement → champ Âge.'));
    }
  }

  // ── Zones : plages plausibles surface ────────────────────────────────
  if (af.site_id) {
    const zones = db.db.prepare(`
      SELECT z.* FROM zones z WHERE z.site_id = ? AND z.deleted_at IS NULL
    `).all(af.site_id);
    for (const z of zones) {
      if (z.surface_m2 != null && (z.surface_m2 < PLAUSIBLE_ZONE_SURFACE_M2.min || z.surface_m2 > PLAUSIBLE_ZONE_SURFACE_M2.max)) {
        warnings.push(newFinding('ZONE-001', 'warning', 'zone', z.id, 'surface_m2',
          `Zone « ${z.name} » : surface ${z.surface_m2} m² hors plage plausible (${PLAUSIBLE_ZONE_SURFACE_M2.min}–${PLAUSIBLE_ZONE_SURFACE_M2.max} m²).`,
          'Vérifier la saisie de la surface (m², pas dam² ni ha).',
          'Carte 02 « Zones » → édition de la zone.'));
      }
    }
  }

  // ── Compteurs : saisies orphelines ──────────────────────────────────
  const meters = db.db.prepare(`
    SELECT * FROM bacs_audit_meters WHERE document_id = ?
  `).all(documentId);
  for (const m of meters) {
    if (!m.usage) {
      warnings.push(newFinding('METER-001', 'warning', 'meter', m.id, 'usage',
        `Compteur « ${m.label || '#' + m.id} » sans usage rattaché.`,
        'Sans usage, le compteur n\'est pas pris en compte dans la matrice de couverture R175-3 §1°.',
        'Carte 04 « Compteurs » → édition du compteur.'));
    }
  }

  // ── Régulation thermique R175-6 : saisies incomplètes ──────────────
  const thermal = db.db.prepare(`
    SELECT t.*, z.name AS zone_name FROM bacs_audit_thermal_regulation t
    LEFT JOIN zones z ON z.id = t.zone_id
    WHERE t.document_id = ?
  `).all(documentId);
  for (const t of thermal) {
    if (!t.emission_device_id && !isTrue(t.generator_exempt_wood)) {
      // Vérifier l'applicabilité R175-6 — si bâtiment hors champ, c'est un warning, pas blocking.
      const r175_6_required = af.bacs_building_permit_date && new Date(af.bacs_building_permit_date) > new Date('2021-07-21');
      const severity = r175_6_required ? 'blocking' : 'warning';
      const list = r175_6_required ? blocking : warnings;
      list.push(newFinding('THERMAL-001', severity, 'thermal', t.id, 'emission_device_id',
        `Régulation thermique zone « ${t.zone_name || '?'} » (${t.category}) sans équipement d'émission désigné.`,
        'R175-6 exige une régulation par zone/catégorie identifiée à l\'émetteur.',
        'Carte 03 → panneau Régulation R175-6 sous la zone.'));
    }
  }

  // ── GTB : qualification minimum ──────────────────────────────────────
  const bms = db.db.prepare(`
    SELECT * FROM bacs_audit_bms WHERE document_id = ?
  `).get(documentId);
  if (!bms || bms.present == null) {
    blocking.push(newFinding('BMS-001', 'blocking', 'bms', bms?.id || null, 'present',
      'Présence d\'une GTB non qualifiée.',
      'Sans réponse à la question « GTB présente ? », aucun verdict R175-3 §3/§4/§5 ne peut être conclu.',
      'Carte 06 « GTB » → réponds Oui ou Non.'));
  } else if (isTrue(bms.present) && !bms.existing_solution) {
    warnings.push(newFinding('BMS-002', 'warning', 'bms', bms.id, 'existing_solution',
      'GTB présente mais solution non renseignée.',
      'Le PDF affiche « solution GTB inconnue » — peu crédible pour un livrable.',
      'Carte 06 → champ Solution GTB en place.'));
  }

  return {
    audit_id: documentId,
    kind: af.kind,
    blocking,
    warnings,
    generated_at: new Date().toISOString(),
    can_deliver: blocking.length === 0,
    summary: {
      blocking_count: blocking.length,
      warnings_count: warnings.length,
    },
  };
}

module.exports = { buildPrecheck };
