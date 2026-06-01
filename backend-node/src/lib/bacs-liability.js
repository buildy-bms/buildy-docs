'use strict';

/**
 * Calcul automatique de l'assujetti au décret BACS par système (item 4d du
 * plan PROFEEL — guide p.9-10).
 *
 * Le décret distingue 6 cas d'assujettissement selon la structure juridique
 * du site (`sites.ownership_structure`) et l'affectation du périmètre :
 *
 *  A. single_owner_occupant       — le propriétaire occupant.
 *  B. condominium                 — le syndicat de copropriété par défaut ;
 *                                   si un système est rattaché à une partie
 *                                   spécifique (système indépendant), cette
 *                                   partie est l'assujettie.
 *  C. owner_with_tenants          — le propriétaire par défaut ; un preneur
 *                                   devient assujetti pour un système s'il
 *                                   y a réalisé des « travaux preneurs »
 *                                   (`system_parties.responsible_for_works`).
 *  D. multiple_independent_tenants — les preneurs rattachés à la zone du
 *                                   système (chacun pour ses systèmes).
 *  E. is_district_heating_substation — sous-station de réseau de chaleur
 *                                   urbain : le gestionnaire de réseau
 *                                   (`kind='network_operator'`) est EXCLU ;
 *                                   l'assujetti est le propriétaire du
 *                                   bâtiment (installation intérieure).
 *  F. serves_multiple_buildings   — système centralisé desservant plusieurs
 *                                   bâtiments du site : tous les
 *                                   propriétaires du site sont assujettis.
 *
 * NB cas F : Buildy ne modélise pas aujourd'hui le multi-bâtiments
 * structurel (pas de table `buildings`, pas de champ bâtiment sur les
 * zones). Le cas F est donc calculé de façon dégradée — « tous les
 * propriétaires du site ». Le multi-bâtiments structurel est un chantier
 * séparé.
 *
 * Ce module ne dépend pas de la DB — il opère sur des structures déjà
 * chargées, pour être réutilisable par _export-data.js (audit réel) et
 * _preview-fixture.js (dataset fictif).
 */

// Genres de parties considérés comme « propriétaire » du bâtiment.
const OWNER_KINDS = new Set(['owner_occupant', 'owner_lessor', 'co_owner']);

/**
 * Calcule la/les partie(s) assujettie(s) pour chaque système d'un audit.
 *
 * @param {object} input
 * @param {object} input.site            — { ownership_structure, ... }
 * @param {Array}  input.parties         — [{ id, name, kind }] (parties actives)
 * @param {Array}  input.systems         — [{ id, zone_id, system_category,
 *                                          is_district_heating_substation,
 *                                          serves_multiple_buildings }]
 * @param {Array}  input.zonePartyLinks  — [{ zone_id, party_id }]
 * @param {Array}  input.systemPartyLinks— [{ system_id, party_id,
 *                                          responsible_for_works }]
 * @returns {Map<number, object>}  system_id -> {
 *   case: 'A'|'B'|'C'|'D'|'E'|'F'|null,
 *   caseLabel: string,
 *   partyIds: number[],
 *   partyNames: string[],
 *   label: string,        // « Assujetti : … » prêt pour le PDF
 *   explanation: string,  // justification courte
 * }
 */
function computeSystemLiability(input = {}) {
  const {
    site = null,
    parties = [],
    systems = [],
    zonePartyLinks = [],
    systemPartyLinks = [],
  } = input;

  const structure = site?.ownership_structure || null;

  // Index id -> partie.
  const partyById = new Map();
  for (const p of parties) partyById.set(p.id, p);

  // Parties « propriétaires » du site (cas A/B/E/F fallback).
  const ownerParties = parties.filter(p => OWNER_KINDS.has(p.kind));
  const syndicate = parties.find(p => p.kind === 'syndicate') || null;

  // zone_id -> [party_id, ...]
  const partiesByZone = new Map();
  for (const l of zonePartyLinks) {
    if (!partiesByZone.has(l.zone_id)) partiesByZone.set(l.zone_id, []);
    partiesByZone.get(l.zone_id).push(l.party_id);
  }
  // system_id -> [{ party_id, responsible_for_works }]
  const partiesBySystem = new Map();
  for (const l of systemPartyLinks) {
    if (!partiesBySystem.has(l.system_id)) partiesBySystem.set(l.system_id, []);
    partiesBySystem.get(l.system_id).push(l);
  }

  const CASE_LABEL = {
    A: 'Propriétaire unique occupant',
    B: 'Copropriété',
    C: 'Propriétaire bailleur et preneurs',
    D: 'Preneurs indépendants',
    E: 'Sous-station de réseau urbain',
    F: 'Système centralisé multi-bâtiments',
  };

  const namesOf = (ids) => ids
    .map(id => partyById.get(id))
    .filter(Boolean)
    .map(p => p.name);

  const result = new Map();

  for (const sys of systems) {
    const sysLinks = partiesBySystem.get(sys.id) || [];
    // Surcharge explicite du système (rattachement direct à une/des partie(s)).
    const sysPartyIds = sysLinks.map(l => l.party_id);
    // Parties héritées de la zone du système.
    const zonePartyIds = partiesByZone.get(sys.zone_id) || [];
    const responsibleTenants = sysLinks
      .filter(l => l.responsible_for_works
        && partyById.get(l.party_id)?.kind === 'tenant')
      .map(l => l.party_id);

    let caseCode = null;
    let partyIds = [];
    let explanation = '';

    // Cas F — système centralisé multi-bâtiments (prioritaire).
    if (sys.serves_multiple_buildings) {
      caseCode = 'F';
      partyIds = ownerParties.map(p => p.id);
      explanation = 'Système centralisé desservant plusieurs bâtiments — '
        + 'tous les propriétaires du site sont assujettis ensemble.';
    }
    // Cas E — sous-station réseau de chaleur urbain.
    else if (sys.is_district_heating_substation) {
      caseCode = 'E';
      // Le gestionnaire de réseau est exclu : l'assujetti est le
      // propriétaire du bâtiment pour l'installation intérieure.
      partyIds = ownerParties.length
        ? ownerParties.map(p => p.id)
        : (syndicate ? [syndicate.id] : []);
      explanation = 'Sous-station de réseau de chaleur urbain : le gestionnaire '
        + 'du réseau n\'est pas assujetti. L\'assujetti est le propriétaire '
        + 'du bâtiment pour l\'installation intérieure.';
    }
    // Cas B — copropriété.
    else if (structure === 'condominium') {
      caseCode = 'B';
      if (sysPartyIds.length) {
        // Système indépendant rattaché à un copropriétaire précis.
        partyIds = sysPartyIds;
        explanation = 'Système indépendant rattaché à une partie spécifique '
          + 'de la copropriété.';
      } else {
        partyIds = syndicate ? [syndicate.id] : ownerParties.map(p => p.id);
        explanation = 'Système partagé — le syndicat de copropriété est assujetti.';
      }
    }
    // Cas C — propriétaire bailleur + preneurs.
    else if (structure === 'owner_with_tenants') {
      caseCode = 'C';
      if (responsibleTenants.length) {
        // Travaux preneurs : le preneur devient assujetti pour ce système.
        partyIds = responsibleTenants;
        explanation = 'Le preneur à bail a réalisé des travaux preneurs sur '
          + 'ce système : il en devient l\'assujetti.';
      } else {
        partyIds = ownerParties.map(p => p.id);
        explanation = 'Aucuns travaux preneurs sur ce système — le propriétaire '
          + 'bailleur est assujetti.';
      }
    }
    // Cas D — preneurs indépendants.
    else if (structure === 'multiple_independent_tenants') {
      caseCode = 'D';
      // Préférence à la surcharge système, sinon les parties de la zone.
      const candidate = sysPartyIds.length ? sysPartyIds : zonePartyIds;
      const tenantIds = candidate.filter(id => partyById.get(id)?.kind === 'tenant');
      partyIds = tenantIds.length ? tenantIds : candidate;
      explanation = 'Chaque preneur indépendant est assujetti pour les systèmes '
        + 'de son périmètre.';
    }
    // Cas A — propriétaire unique occupant (et défaut).
    else {
      caseCode = structure === 'single_owner_occupant' ? 'A' : null;
      partyIds = ownerParties.map(p => p.id);
      explanation = caseCode === 'A'
        ? 'Propriétaire unique occupant — il est l\'assujetti pour l\'ensemble '
          + 'des systèmes du bâtiment.'
        : 'Structure juridique du site non renseignée — assujetti par défaut : '
          + 'le(s) propriétaire(s) saisi(s).';
    }

    // Dédoublonnage en conservant l'ordre.
    partyIds = [...new Set(partyIds)];
    const partyNames = namesOf(partyIds);
    const label = partyNames.length
      ? `Assujetti : ${partyNames.join(', ')}`
      : 'Assujetti : à déterminer (aucune partie prenante renseignée)';

    result.set(sys.id, {
      case: caseCode,
      caseLabel: caseCode ? CASE_LABEL[caseCode] : null,
      partyIds,
      partyNames,
      label,
      explanation,
    });
  }

  return result;
}

// Libellés FR des structures juridiques (item 4a) — partagés avec le PDF
// et les preview fixtures. Synchro avec OWNERSHIP_STRUCTURES côté
// frontend (frontend/src/lib/audit-options.js) et le CHECK migration 160.
const OWNERSHIP_STRUCTURE_LABEL = {
  single_owner_occupant: 'Propriétaire unique occupant',
  condominium: 'Copropriété (avec syndicat)',
  owner_with_tenants: 'Propriétaire bailleur et preneurs à bail',
  multiple_independent_tenants: 'Preneurs indépendants multiples',
  mixed: 'Structure mixte',
};

// Libellés FR des genres de partie prenante (item 4b).
const PARTY_KIND_LABEL = {
  owner_occupant: 'Propriétaire occupant',
  owner_lessor: 'Propriétaire bailleur',
  co_owner: 'Copropriétaire',
  tenant: 'Preneur à bail',
  syndicate: 'Syndicat de copropriété',
  network_operator: 'Gestionnaire de réseau',
};

module.exports = {
  computeSystemLiability,
  OWNERSHIP_STRUCTURE_LABEL,
  PARTY_KIND_LABEL,
  OWNER_KINDS,
};
