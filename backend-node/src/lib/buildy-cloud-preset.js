'use strict';

/**
 * Modèle « Supervision Buildy Cloud » de la carte GTB (audit BACS / GTB).
 *
 * Pré-remplit la fiche GTB d'un site supervisé par Buildy Cloud selon le
 * NIVEAU D'OFFRE souscrit (Essentials / Smart / Premium), et crée l'accès
 * « comptes nominatifs » de la carte Credentials (chaque utilisateur a son
 * compte Buildy ID : aucun identifiant partagé n'est stocké).
 *
 * Doctrine (validée par Kévin le 2026-09-23) : une supervision Buildy, quel
 * que soit le niveau d'offre, est considérée CONFORME au décret BACS — jamais
 * « non conforme » à cause du niveau souscrit — SOUS RÉSERVE des obligations
 * de BUILDY_RESERVES_BY_LEVEL, mises en évidence dans le rapport :
 *  - Essentials conserve 12 mois de données (retention_mensuelles) : le
 *    client exporte et sauvegarde régulièrement ses consommations depuis
 *    Hyperveez pour les garder 5 ans (R175-3 1°) ;
 *  - la maintenance (maintenance_infra_gtb) n'est incluse qu'en Smart /
 *    Premium : en Essentials, la maintenance de la GTB DOIT être organisée
 *    (contrat de maintenance ou personnel interne compétent, vérifications
 *    périodiques encadrées par des consignes écrites, R175-4) si aucune
 *    n'est déclarée.
 * La formation de l'exploitant (R175-5) n'est jamais présumée : l'assistance
 * intégrée ne remplace pas une formation attestée (feuille d'émargement,
 * FAQ n° 30) — la question reste à l'auditeur.
 * L'API Buildy Connect (Premium, sur devis) automatise la transmission aux
 * exploitants ; les comptes Hyperveez et les exports CSV suffisent au
 * dernier alinéa de R175-3.
 *
 * Règles d'application : les champs qui DÉCOULENT du niveau sont toujours
 * réécrits (changer de niveau met la fiche en cohérence) ; les autres ne
 * remplissent que les champs vides (jamais d'écrasement d'une saisie).
 */

const BUILDY_OFFER_LEVELS = ['essentials', 'smart', 'premium'];
const BUILDY_OFFER_LEVEL_LABEL = { essentials: 'Essentials', smart: 'Smart', premium: 'Premium' };

const BUILDY_CLOUD_URL = 'https://app.buildy.fr';
const BUILDY_CLOUD_CREDENTIAL = {
  title: 'Supervision Buildy — comptes nominatifs',
  type: 'web',
  url: BUILDY_CLOUD_URL,
  notes: 'Chaque utilisateur se connecte avec son compte personnel (Buildy ID). Aucun identifiant partagé n\'est stocké ici.',
};

// Réserves de conformité liées au niveau d'offre (affichées à l'écran, au
// PDF et dans le plan). `key` = source_subtype de l'action générée ; la
// réserve « maintenance » ne vaut que si aucune maintenance n'est déclarée
// (has_maintenance_procedures ≠ 1, cf. buildyReserves).
const BUILDY_RESERVES_BY_LEVEL = {
  essentials: [
    { key: 'data_export_backup', article: 'R175-3 1°',
      label: 'exporter et sauvegarder régulièrement les données de consommation depuis Hyperveez, pour les conserver 5 ans (la solution les conserve 12 mois en Essentials)' },
    { key: 'maintenance', article: 'R175-4',
      label: 'mettre en place la maintenance de la GTB, par un contrat de maintenance ou un personnel interne compétent (vérifications périodiques encadrées par des consignes écrites) : elle n\'est pas incluse en Essentials' },
  ],
  smart: [],
  premium: [],
};

function isBuildyOfferLevel(level) {
  return BUILDY_OFFER_LEVELS.includes(level);
}

/** Réserves applicables à une fiche GTB Buildy (liste vide sinon). */
function buildyReserves(bms) {
  const list = (bms && BUILDY_RESERVES_BY_LEVEL[bms.buildy_offer_level]) || [];
  return list.filter(r => r.key !== 'maintenance'
    || !(bms.has_maintenance_procedures === 1 || bms.has_maintenance_procedures === true));
}

/**
 * Fiche GTB « effective » : pour une supervision Buildy, les champs qui
 * DÉCOULENT du niveau (valeurs `fixed` du modèle) priment sur la valeur
 * stockée — une fiche pré-remplie avant un changement de doctrine (ex. audit
 * Sénas, pré-rempli quand Essentials valait « non couvert ») ne doit pas
 * contredire le rapport. Les autres champs restent ceux saisis.
 */
function effectiveBuildyBms(bms) {
  if (!bms || !isBuildyOfferLevel(bms.buildy_offer_level)) return bms;
  const { fixed } = buildBuildyCloudPreset(bms.buildy_offer_level);
  return { ...bms, ...fixed };
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
    is_buildy_supervision: 1, // mig 206 — question préalable « supervision Buildy ? »
    buildy_offer_level: level,
    provided_protocols: JSON.stringify(premium ? ['rest', 'mqtt'] : ['mqtt']),
    // R175-3 1° — en Essentials, conservation 5 ans assurée par les exports
    // réguliers du client (réserve « data_export_backup »).
    meets_r175_3_p1: 1,
    data_storage_5y_compliant: 'yes',
    r175_3_p1_retention_verified: essentials ? null : 1,
    // R175-3 2°
    meets_r175_3_p2: 1,
    r175_3_p2_anomaly_rules_html: essentials
      ? '<p>Essentials : console d\'alarmes multi-sites sur Hyperveez (anomalies et défauts des équipements) et consultation des consommations. Les notifications push d\'anomalie et les tableaux de bord de consommation mensuels et annuels sont inclus à partir du niveau Smart.</p>'
      : '<p>Seuils paramétrables compteur par compteur (occupation, inoccupation, global), notifications de dérive, tableaux de bord de consommation avec normalisation DJU / DHU.</p>',
    // R175-3 dernier alinéa — comptes nominatifs Hyperveez + exports CSV.
    data_provision_to_operators: 1,
    data_provision_format: premium
      ? 'Portail web Hyperveez, exports CSV, API Buildy Connect'
      : 'Portail web Hyperveez, exports CSV',
    notes_data_provision: premium
      ? 'Le gestionnaire et les exploitants consultent les données sur la supervision Buildy avec leurs comptes nominatifs et peuvent les exporter en CSV. Transmission structurée et automatique aux exploitants des systèmes techniques par l\'API Buildy Connect.'
      : 'Le gestionnaire et les exploitants consultent les données sur la supervision Buildy avec leurs comptes nominatifs et peuvent les exporter en CSV. En option (niveau Premium), l\'API Buildy Connect automatise la transmission aux exploitants des systèmes techniques.',
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
    // operator_trained volontairement absent : la formation R175-5 se
    // constate (attestation, feuille d'émargement), elle ne se présume pas.
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
  BUILDY_RESERVES_BY_LEVEL,
  BUILDY_CLOUD_URL,
  BUILDY_CLOUD_CREDENTIAL,
  isBuildyOfferLevel,
  buildyReserves,
  effectiveBuildyBms,
  buildBuildyCloudPreset,
  applyBuildyCloudPreset,
};
