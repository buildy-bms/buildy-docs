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

function newFinding(code, severity, entity, entity_id, field, message, hint, fixHint, opts = {}) {
  return {
    code, severity, entity, entity_id, field, message,
    hint: hint || null,
    fix_hint: fixHint || null,
    // Lot 7 — auto-fix : si `auto_fix_action` est posé, la modale UI propose
    // un bouton « Corriger automatiquement » qui appelle
    // POST /bacs-audit/:id/precheck/auto-fix avec { finding_code, entity_id }.
    auto_fix_action: opts.autoFixAction || null,
    auto_fix_label: opts.autoFixLabel || null,
    // Lot 9 — décor pour l'UI : catégorie d'usage (chauffage/refroidissement/
    // ventilation/ECS/éclairage/PV) → icône+couleur cohérentes avec le reste
    // de l'UI Buildy. `null` si l'entité n'est pas rattachée à une catégorie.
    system_category: opts.systemCategory || null,
  };
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
      'Aucun site n\'est rattaché à cet audit.',
      'Sans site, on ne peut renseigner ni les zones ni les compteurs.',
      'Ouvre la carte « Identification du site » et rattache un site existant ou crée-le.'));
  }
  if (!af.bacs_applicability_status) {
    blocking.push(newFinding('IDENT-002', 'blocking', 'document', documentId, 'bacs_applicability_status',
      'L\'assujettissement R175-2 n\'est pas encore déterminé pour ce site.',
      'Sans ce statut, le PDF affichera « Statut d\'assujettissement non renseigné » en première page — inacceptable pour un livrable.',
      'Carte « Identification » → renseigne la puissance retenue chauffage+climatisation et la date du permis de construire.'));
  }

  // ── Systèmes (cross-entités) ─────────────────────────────────────────
  const systems = db.db.prepare(`
    SELECT s.*, z.name AS zone_name FROM bacs_audit_systems s
    LEFT JOIN zones z ON z.id = s.zone_id
    WHERE s.document_id = ? AND s.is_bacs = 1
  `).all(documentId);

  const devicesAll = db.db.prepare(`
    SELECT d.*, s.system_category FROM bacs_audit_system_devices d
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
        `${lab} : ce système est marqué à la fois « présent » ET « non concerné ».`,
        'Ces deux réponses sont contradictoires — un système est soit présent, soit non concerné, jamais les deux.',
        'Va dans la carte Systèmes, ouvre cette ligne et décoche l\'une des deux cases.',
        { systemCategory: s.system_category }));
    }
    // Présent sans aucun équipement (ni propre ni partagé)
    if (isTrue(s.present)) {
      const devs = devicesBySystem.get(s.id) || [];
      if (devs.length === 0) {
        warnings.push(newFinding('SYS-002', 'warning', 'system', s.id, 'present',
          `${lab} : marqué présent mais aucun équipement n\'a été saisi dessus.`,
          'Sans équipement, on ne peut pas vérifier les exigences d\'interopérabilité GTB ni de régulation thermique sur ce système.',
          'Ouvre la carte Systèmes, déplie cette ligne et ajoute au moins un équipement (ou décoche « présent » si la zone n\'a vraiment rien).',
          { systemCategory: s.system_category }));
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
        `Équipement « ${d.name || '#' + d.id} » : une énergie primaire est renseignée alors que sa fonction ne contient pas « Production ».`,
        'Un émetteur passif (radiateur, ventilo-convecteur, unité intérieure DRV…) reçoit son fluide d\'un autre équipement — il n\'a pas d\'énergie primaire propre.',
        'Ouvre cet équipement (carte Systèmes) et, soit ajoute la fonction « Production » si c\'est réellement un générateur, soit supprime l\'énergie sélectionnée.',
        { systemCategory: d.system_category }));
    }
    if (isProducer && !d.energy_source) {
      warnings.push(newFinding('DEV-002', 'warning', 'device', d.id, 'energy_source',
        `Équipement de production « ${d.name || '#' + d.id} » sans énergie primaire renseignée.`,
        'Sans énergie, l\'équipement n\'est pas comptabilisé dans le cumul de puissance qui détermine l\'assujettissement R175-2.',
        'Ouvre cet équipement et choisis son énergie (gaz, électricité, fioul, réseau de chaleur urbain, etc.).',
        { systemCategory: d.system_category }));
    }
    // Régulation intégrée détournée comme régulateur déporté (audit-coherence-checks
    // garde déjà le PATCH thermal, ici on vérifie l'état actuel des rows).
    if (isTrue(d.regulation_integrated)) {
      const usedAsDeport = db.db.prepare(`
        SELECT t.id, t.zone_id, t.category, z.name AS zone_name FROM bacs_audit_thermal_regulation t
        LEFT JOIN zones z ON z.id = t.zone_id
        WHERE t.production_regulation_device_id = ? OR
              t.distribution_regulation_device_id = ? OR
              t.emission_regulation_device_id = ?
      `).all(d.id, d.id, d.id);
      if (usedAsDeport.length) {
        const where = usedAsDeport.map(r => `« ${r.zone_name || 'zone'} / ${r.category} »`).join(', ');
        blocking.push(newFinding('DEV-003', 'blocking', 'device', d.id, 'regulation_integrated',
          `Équipement « ${d.name || '#' + d.id} » : sa régulation est marquée intégrée à l\'équipement, mais il est désigné comme régulateur d\'un autre équipement dans la régulation thermique de ${where}.`,
          'Une régulation intégrée pilote uniquement son propre équipement — elle ne peut pas être désignée comme régulateur d\'un autre équipement situé ailleurs.',
          `Les champs « régulateur déporté » ne sont plus exposés dans l\'UI actuelle (refonte récente). Ce sont des saisies historiques restées en DB. Utilise le bouton « Corriger automatiquement » ci-dessous : Buildy retirera cet équipement des champs régulateur déporté de la régulation thermique de ${where}, sans toucher à sa propre case « Régulation intégrée à l\'équipement ».`,
          {
            autoFixAction: 'clear_regulation_deport_refs',
            autoFixLabel: 'Corriger automatiquement (retirer les références régulateur déporté fautives)',
            systemCategory: d.system_category,
          }));
      }
    }
    // Plages plausibles puissance
    const range = PLAUSIBLE_POWER_KW[d.system_category];
    if (range && d.power_kw != null && d.power_kw > 0) {
      if (d.power_kw < range.min || d.power_kw > range.max) {
        warnings.push(newFinding('DEV-004', 'warning', 'device', d.id, 'power_kw',
          `Équipement « ${d.name || '#' + d.id} » : puissance saisie ${d.power_kw} kW (hors plage habituelle ${range.min}–${range.max} kW pour un équipement ${d.system_category}).`,
          'Une valeur très haute ou très basse peut être un piège — fausse l\'assujettissement R175-2 et la crédibilité du rapport. Souvent une confusion entre puissance nominale et consommation instantanée.',
          'Ouvre cet équipement et vérifie le champ Puissance (en kW nominaux).',
          { systemCategory: d.system_category }));
      }
    }
    if (d.age_years != null && d.age_years > PLAUSIBLE_AGE_YEARS.max) {
      warnings.push(newFinding('DEV-005', 'warning', 'device', d.id, 'age_years',
        `Équipement « ${d.name || '#' + d.id} » : âge déclaré ${d.age_years} ans — c\'est inhabituel (> ${PLAUSIBLE_AGE_YEARS.max} ans).`,
        'Vérifier la date de mise en service — un équipement de plus de 60 ans est très rare en service réel.',
        'Ouvre cet équipement et vérifie le champ Âge.',
        { systemCategory: d.system_category }));
    }
    // Lot 8 — fonction(s) désalignée(s) du modèle biblio. Si le device est
    // basé sur un equipment_template dont les `default_device_role` ont
    // évolué (typiquement mig 195 : VMC, CTA, destratificateur, extracteur,
    // PAC, ASI, etc.), on propose de réaligner. Cas courant : un device
    // VMC créé avant juin 2026 en `['emission']` alors que la biblio est
    // désormais `['production','emission']` — résultat : son énergie n'est
    // plus saisissable dans l'UI.
    if (d.equipment_template_id) {
      const tpl = db.db.prepare(`
        SELECT name, default_device_role FROM equipment_templates WHERE id = ?
      `).get(d.equipment_template_id);
      if (tpl?.default_device_role) {
        const tplRoles = parseRoles(tpl.default_device_role);
        const tplHasProd = tplRoles.some(r => /production|generator/i.test(r));
        const devHasProd = roles.some(r => /production|generator/i.test(r));
        // Cas concret : la biblio a Production, l'instance ne l'a pas. La
        // doctrine énergie primaire bloque la saisie d'énergie sur ce device.
        if (tplHasProd && !devHasProd) {
          warnings.push(newFinding('DEV-006', 'warning', 'device', d.id, 'device_role',
            `Équipement « ${d.name || '#' + d.id} » (modèle « ${tpl.name} ») : la fonction « Production » n\'est pas cochée alors que la bibliothèque l\'attribue désormais à ce type d\'équipement.`,
            'Sans la fonction Production, le champ Énergie primaire reste désactivé pour cet équipement — ce qui empêche sa puissance d\'entrer dans le cumul R175-2 et le PDF affiche un trou.',
            `Si l\'équipement consomme bien de l\'élec / du gaz directement (cas habituel d\'une VMC, CTA, extracteur, destratificateur, panneau radiant, ASI), clique « Corriger automatiquement » ci-dessous : Buildy alignera les fonctions du device sur celles du modèle biblio (${tplRoles.join(' + ')}) — ensuite tu pourras choisir son énergie.`,
            {
              autoFixAction: 'align_device_roles_to_template',
              autoFixLabel: `Aligner les fonctions sur le modèle (${tplRoles.join(' + ')})`,
              systemCategory: d.system_category,
            }));
        }
      }
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
          `Zone « ${z.name} » : surface ${z.surface_m2} m² (hors plage habituelle ${PLAUSIBLE_ZONE_SURFACE_M2.min}–${PLAUSIBLE_ZONE_SURFACE_M2.max} m²).`,
          'Souvent une confusion d\'unité (m² confondu avec dam² ou hectares) ou une virgule manquante.',
          'Ouvre la carte Zones, édite la zone et vérifie la valeur en m².'));
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
        `Compteur « ${m.label || '#' + m.id} » : aucun usage rattaché (chauffage / refroidissement / ECS / éclairage / production PV).`,
        'Sans usage, ce compteur ne compte pas dans la matrice de couverture R175-3 §1° — il existe en DB mais le PDF l\'ignorera.',
        'Ouvre la carte Compteurs, édite cette ligne et sélectionne l\'usage qu\'il mesure.'));
    }
  }

  // ── Régulation thermique R175-6 : saisies incomplètes ──────────────
  const thermal = db.db.prepare(`
    SELECT t.*, z.name AS zone_name FROM bacs_audit_thermal_regulation t
    LEFT JOIN zones z ON z.id = t.zone_id
    WHERE t.document_id = ?
  `).all(documentId);
  // R175-6 vise la régulation de la CHALEUR et ne s'applique que si le permis
  // de construire OU des travaux sur le générateur sont postérieurs au
  // 21/07/2021 (aligné sur le générateur d'actions). Sinon aucun émetteur n'est
  // requis → pas de point d'attention (évite les faux positifs, ex. une ligne
  // « refroidissement » ou un bâtiment hors champ comme un PC de 1998).
  const R6_TRIGGER = '2021-07-21';
  const r175_6_applicable =
    (af.bacs_building_permit_date && af.bacs_building_permit_date > R6_TRIGGER)
    || (af.bacs_generator_works_date && af.bacs_generator_works_date > R6_TRIGGER);
  for (const t of (r175_6_applicable ? thermal : [])) {
    if (t.category === 'cooling') continue;            // R175-6 = chaleur uniquement
    if (t.emission_device_id || isTrue(t.generator_exempt_wood)) continue;
    {
      blocking.push(newFinding('THERMAL-001', 'blocking', 'thermal', t.id, 'emission_device_id',
        `Régulation thermique de la zone « ${t.zone_name || '?'} » (chauffage) : aucun équipement d'émission désigné.`,
        'R175-6 impose d\'identifier l\'émetteur (radiateur, ventilo-convecteur, plancher chauffant…) qui matérialise la régulation par pièce ou par zone chauffée.',
        `Ouvre la carte Systèmes, descends jusqu'à la zone « ${t.zone_name || '?'} » et désigne l'émetteur chauffage dans le panneau Régulation R175-6 (ou marque l'exemption bois si applicable).`,
        { systemCategory: t.category }));
    }
  }

  // ── GTB : qualification minimum ──────────────────────────────────────
  const bms = db.db.prepare(`
    SELECT * FROM bacs_audit_bms WHERE document_id = ?
  `).get(documentId);
  if (!bms || bms.present == null) {
    blocking.push(newFinding('BMS-001', 'blocking', 'bms', bms?.id || null, 'present',
      'La question « Une GTB est-elle présente sur le site ? » n\'a pas reçu de réponse.',
      'Tant qu\'on n\'a pas répondu Oui ou Non, le PDF ne peut pas conclure sur les exigences GTB du décret (R175-3 §3 interopérabilité, §4 arrêt/redémarrage, R175-4 maintenance, R175-5 formation).',
      'Ouvre la carte GTB et réponds Oui (GTB déjà installée) ou Non (pas de GTB aujourd\'hui).'));
  } else if (isTrue(bms.present) && !bms.existing_solution) {
    warnings.push(newFinding('BMS-002', 'warning', 'bms', bms.id, 'existing_solution',
      'GTB présente mais la solution n\'est pas identifiée.',
      'Le PDF affichera « solution GTB inconnue » — ça discrédite le rapport face au MOA qui sait quelle GTB il a sur site.',
      'Ouvre la carte GTB et renseigne la marque / le nom commercial de la GTB (Schneider EcoStruxure, Wattsense, Distech, etc.).'));
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
