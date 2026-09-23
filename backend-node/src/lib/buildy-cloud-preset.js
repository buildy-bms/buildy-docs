'use strict';

/**
 * Modèle « Supervision Buildy Cloud » de la carte GTB (audit BACS / GTB).
 *
 * Pré-remplit la fiche GTB d'un site supervisé par Buildy Cloud selon le
 * NIVEAU D'OFFRE souscrit (Essentials / Smart / Premium), et crée l'accès
 * « comptes nominatifs » de la carte Credentials (chaque utilisateur a son
 * compte Buildy ID : aucun identifiant partagé n'est stocké).
 *
 * Couverture par niveau = catalogue seeds/service-levels.js :
 *  - R175-3 1° : retention_mensuelles E=12 mois / S=5 ans / P=10 ans,
 *    dashboards_consommations S/P ;
 *  - R175-3 2° : notifications_push S/P ;
 *  - R175-4    : maintenance_infra_gtb S/P ;
 *  - R175-5    : gestion_comptes E=option payante, S/P ;
 *  - R175-3 dernier alinéa (transmission structurée aux exploitants) :
 *    api_cloud (API Buildy Connect) Premium uniquement, sur devis.
 * → la conformité BACS complète exige le niveau Premium.
 *
 * Règles d'application : les champs qui DÉCOULENT du niveau sont toujours
 * réécrits (changer de niveau met la fiche en cohérence) ; les autres ne
 * remplissent que les champs vides (jamais d'écrasement d'une saisie).
 */

const BUILDY_OFFER_LEVELS = ['essentials', 'smart', 'premium'];
const BUILDY_OFFER_LEVEL_LABEL = { essentials: 'Essentials', smart: 'Smart', premium: 'Premium' };
const BUILDY_REQUIRED_LEVEL = 'premium';

const BUILDY_CLOUD_URL = 'https://app.buildy.fr';
const BUILDY_CLOUD_CREDENTIAL = {
  title: 'Supervision Buildy — comptes nominatifs',
  type: 'web',
  url: BUILDY_CLOUD_URL,
  notes: 'Chaque utilisateur se connecte avec son compte personnel (Buildy ID). Aucun identifiant partagé n\'est stocké ici.',
};

// Exigences du décret NON couvertes par un niveau (affichées à l'écran, au
// PDF et dans l'action « passer en Premium »).
const API_REQ = {
  article: 'R175-3 dernier alinéa',
  label: 'transmission structurée des données aux exploitants des systèmes techniques (API Buildy Connect)',
};
const BUILDY_UNCOVERED_BY_LEVEL = {
  essentials: [
    { article: 'R175-3 1°', label: 'conservation des consommations mensuelles pendant 5 ans (12 mois en Essentials)' },
    { article: 'R175-3 2°', label: 'détection et notification des pertes d\'efficacité énergétique' },
    { article: 'R175-4', label: 'maintenance et vérifications périodiques de la GTB' },
    { article: 'R175-5', label: 'gestion des comptes et accompagnement des utilisateurs (option payante en Essentials)' },
    API_REQ,
  ],
  smart: [API_REQ],
  premium: [],
};

function isBuildyOfferLevel(level) {
  return BUILDY_OFFER_LEVELS.includes(level);
}

/**
 * Valeurs du modèle pour un niveau : { fixed, defaults }.
 *  - fixed    : découlent du niveau, toujours appliquées ;
 *  - defaults : propriétés du produit, appliquées seulement si le champ est vide.
 */
function buildBuildyCloudPreset(level) {
  if (!isBuildyOfferLevel(level)) throw new Error(`Niveau d'offre Buildy inconnu : ${level}`);
  const essentials = level === 'essentials';
  const premium = level === 'premium';
  const fixed = {
    present: 1,
    buildy_offer_level: level,
    provided_protocols: JSON.stringify(premium ? ['rest', 'mqtt'] : ['mqtt']),
    // R175-3 1°
    meets_r175_3_p1: essentials ? 0 : 1,
    data_storage_5y_compliant: essentials ? 'no' : 'yes',
    r175_3_p1_retention_verified: essentials ? null : 1,
    // R175-3 2°
    meets_r175_3_p2: essentials ? 0 : 1,
    r175_3_p2_anomaly_rules_html: essentials
      ? '<p>Essentials : surveillance de la communication des équipements. Les notifications de dérive et les tableaux de bord de consommation sont inclus à partir du niveau Smart.</p>'
      : '<p>Seuils paramétrables compteur par compteur (occupation, inoccupation, global), notifications de dérive, tableaux de bord de consommation avec normalisation DJU / DHU.</p>',
    // R175-3 dernier alinéa
    data_provision_to_operators: premium ? 1 : 0,
    data_provision_format: premium
      ? 'Portail web Hyperveez, exports CSV, API Buildy Connect'
      : 'Portail web Hyperveez, exports CSV',
    notes_data_provision: premium
      ? 'Le gestionnaire et les exploitants consultent les données sur la supervision Buildy avec leurs comptes nominatifs et peuvent les exporter en CSV. Transmission structurée et automatique aux exploitants des systèmes techniques par l\'API Buildy Connect.'
      : `Le gestionnaire et les exploitants consultent les données sur la supervision Buildy avec leurs comptes nominatifs et peuvent les exporter en CSV. La transmission structurée aux exploitants (API Buildy Connect) n'est disponible qu'en niveau Premium.`,
  };
  // R175-4 : maintenance incluse en Smart / Premium. En Essentials, laissée à
  // l'auditeur (un tiers peut assurer la maintenance) — non réécrite.
  if (!essentials) {
    Object.assign(fixed, {
      has_maintenance_procedures: 1,
      maintenance_periodicity: 'Surveillance continue des passerelles (24/7) et maintenance logicielle',
      maintenance_responsible: 'Buildy',
    });
  }
  const defaults = {
    existing_solution: 'Supervision Buildy Cloud',
    existing_solution_brand: 'Buildy',
    data_storage_location: 'cloud_editeur',
    data_owner_access: 'yes',
    gestionnaire_exploitant_access: 'yes',
    export_capability: 'yes',
    data_provision_to_manager: 1,
    data_provision_frequency: 'Temps réel (pas infra-horaire)',
    r175_3_p1_archival_format: 'Base de données cloud Buildy (valeurs brutes, horaires, journalières, mensuelles), exports CSV',
    operator_trained: 1,
    operator_training_provider: 'Buildy',
    operator_training_topics: 'Navigation dans la supervision, lecture des alarmes, consultation et export des consommations, gestion des comptes utilisateurs',
  };
  return { fixed, defaults };
}

const isEmpty = (v) => v == null || (typeof v === 'string' && v.trim() === '');

/**
 * Applique le modèle à la fiche GTB d'un audit + crée l'accès carte 10.
 * Transactionnel et idempotent (l'accès n'est créé qu'une fois par site).
 * @returns {{ bms: object, credentialCreated: boolean, fields: string[] }}
 */
function applyBuildyCloudPreset(db, { documentId, siteId, level, userId }) {
  const { fixed, defaults } = buildBuildyCloudPreset(level);
  return db.transaction(() => {
    db.prepare('INSERT OR IGNORE INTO bacs_audit_bms (document_id) VALUES (?)').run(documentId);
    const current = db.prepare('SELECT * FROM bacs_audit_bms WHERE document_id = ?').get(documentId);
    const toWrite = { ...fixed };
    for (const [k, v] of Object.entries(defaults)) if (isEmpty(current[k])) toWrite[k] = v;
    const keys = Object.keys(toWrite);
    db.prepare(`UPDATE bacs_audit_bms SET ${keys.map(k => `${k} = ?`).join(', ')}, updated_at = CURRENT_TIMESTAMP
      WHERE document_id = ?`).run(...keys.map(k => toWrite[k]), documentId);

    let credentialCreated = false;
    if (siteId) {
      const exists = db.prepare('SELECT 1 FROM site_credentials WHERE site_id = ? AND url = ?')
        .get(siteId, BUILDY_CLOUD_URL);
      if (!exists) {
        const c = BUILDY_CLOUD_CREDENTIAL;
        db.prepare(`INSERT INTO site_credentials (site_id, title, type, url, notes, created_by)
          VALUES (?, ?, ?, ?, ?, ?)`).run(siteId, c.title, c.type, c.url, c.notes, userId || null);
        credentialCreated = true;
      }
    }
    return {
      bms: db.prepare('SELECT * FROM bacs_audit_bms WHERE document_id = ?').get(documentId),
      credentialCreated,
      fields: keys,
    };
  })();
}

module.exports = {
  BUILDY_OFFER_LEVELS,
  BUILDY_OFFER_LEVEL_LABEL,
  BUILDY_REQUIRED_LEVEL,
  BUILDY_UNCOVERED_BY_LEVEL,
  BUILDY_CLOUD_URL,
  BUILDY_CLOUD_CREDENTIAL,
  isBuildyOfferLevel,
  buildBuildyCloudPreset,
  applyBuildyCloudPreset,
};
