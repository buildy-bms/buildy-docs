// Étape GTB, mise en page « Nouvelle » : rubriques repliables avec leur état, comme la fiche
// équipement de l'étape Systèmes. Logique pure (testée : backend-node/test/bms-guide.test.mjs).
//
// Deux niveaux de manque, qui bloquent tous deux la validation de l'étape (décision de Kévin,
// 14/10 : toute question affichée a sa réponse, comme à l'étape Systèmes) :
//  - « à compléter » (missing) : présence de la GTB, solution en place ;
//  - « sans réponse » (unanswered) : une question affichée restée sans réponse (sauf rubrique
//    facultative, GTB hors service).
// La vue (STEP_DEFINITIONS.bms) et l'étape passent toutes deux par bmsStepRubrics.
// Imports relatifs uniquement (testable sous Node).
import { plural } from './tooltip-content.js';

export const BMS_RUBRIC_GROUPS = [
  { key: 'gtb', label: 'La GTB' },
  { key: 'scope', label: 'Ce qu’elle pilote' },
  { key: 'functions', label: 'Ce qu’elle sait faire' },
  { key: 'upkeep', label: 'Entretien et formation' },
];

// Ancres = id des blocs de la carte (sommaire de la mise en page actuelle, liens du rapport).
export const BMS_RUBRICS = [
  { key: 'presence', group: 'gtb', anchor: 'bms-block-presence', icon: 'tower-broadcast', title: 'Présence et offre Buildy Cloud' },
  { key: 'identification', group: 'gtb', anchor: 'bms-block-identification', icon: 'id-card', title: 'Identification' },
  { key: 'protocols', group: 'gtb', anchor: 'bms-block-protocols', icon: 'share-nodes', title: 'Partage des données' },
  { key: 'out-of-service', group: 'gtb', anchor: 'bms-block-out-of-service', icon: 'power-off', title: 'Fonctionnement de la GTB' },
  { key: 'af', group: 'gtb', anchor: 'bms-block-af', icon: 'file-lines', title: 'Analyse fonctionnelle' },
  { key: 'components', group: 'gtb', anchor: 'bms-block-components', icon: 'microchip', title: 'Composants matériels' },
  { key: 'usages', group: 'scope', anchor: 'bms-block-usages', icon: 'layer-group', title: 'Usages traités' },
  { key: 'integrated', group: 'scope', anchor: 'bms-block-integrated', icon: 'plug', title: 'Équipements et compteurs intégrés' },
  { key: 'capabilities', group: 'functions', anchor: 'bms-block-r175-3', icon: 'chart-line', title: 'Suivi des consommations et des dérives', bacs: true },
  { key: 'data-provision', group: 'functions', anchor: 'bms-block-data-provision', icon: 'share-from-square', title: 'Mise à disposition des données', bacs: true },
  { key: 'data-storage', group: 'functions', anchor: 'bms-block-data-storage', icon: 'database', title: 'Conservation et accès aux données', bacs: true },
  { key: 'upkeep', group: 'upkeep', anchor: 'bms-block-r175-4-5', icon: 'screwdriver-wrench', title: 'Vérifications et formation de l’exploitant', bacs: true },
];

// Rubriques qui restent utiles quand la GTB est hors service (les autres deviennent facultatives :
// le plan d'actions ignore alors les exigences sur la GTB).
const KEPT_WHEN_OUT_OF_SERVICE = new Set(['presence', 'identification', 'out-of-service', 'af', 'components']);

export const BMS_USAGES = [
  { key: 'manages_heating', label: 'chauffage' },
  { key: 'manages_cooling', label: 'froid' },
  { key: 'manages_ventilation', label: 'ventilation' },
  { key: 'manages_dhw', label: 'eau chaude' },
  { key: 'manages_lighting', label: 'éclairage' },
];

const isYes = (v) => v === 1 || v === true;

// « La GTB et la supervision sont-elles fonctionnelles ? » (mig 218) : 'functional' | 'partial' |
// 'not_functional' | null. Repli sur `out_of_service` (« hors service » = « Non ») pour une ligne qui
// n'a que lui.
export const BMS_FUNCTIONAL_OPTIONS = [
  { value: 'functional', label: 'Oui', tone: 'green' },
  { value: 'partial', label: 'Partiellement', tone: 'amber' },
  { value: 'not_functional', label: 'Non', tone: 'slate' },
];
export function bmsFunctionalState(bms) {
  const b = bms || {};
  if (['functional', 'partial', 'not_functional'].includes(b.functional_state)) return b.functional_state;
  if (b.out_of_service == null) return null;
  return isYes(b.out_of_service) ? 'not_functional' : 'functional';
}
const isNo = (v) => v === 0 || v === false;
const yesNo = (v) => (v == null ? '?' : (isYes(v) ? 'oui' : 'non'));
const TRI = { yes: 'oui', no: 'non', partial: 'partiel', unknown: 'inconnu' };
const STORAGE = { local: 'serveur local', cloud_editeur: 'cloud de l’éditeur', cloud_proprietaire: 'cloud du propriétaire', unknown: 'lieu inconnu' };
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function parseList(v) {
  if (Array.isArray(v)) return v;
  try { const a = JSON.parse(v || '[]'); return Array.isArray(a) ? a : []; } catch { return []; }
}

/**
 * Rubriques de l'étape GTB avec leur état.
 * @param {object} bms ligne bacs_audit_bms
 * @param {object} ctx { isBacs, isBuildySupervision (true/false/null), offerLabel(level),
 *   afStatus ('present'|'absent'|null), afDocsCount, protocolLabel(value), componentsCount,
 *   devices (équipements du périmètre GTB), meters (compteurs présents des usages traités) }
 * @returns {Array<{ key, group, anchor, icon, title, missing: string[], unanswered: string[],
 *   summary: string, optional: boolean, state: 'todo'|'open'|'done' }>}
 */
export function bmsRubrics(bms, ctx = {}) {
  const b = bms || {};
  const out = [];
  const present = b.present;
  const outOfService = bmsFunctionalState(b) === 'not_functional';
  for (const r of BMS_RUBRICS) {
    if (r.bacs && !ctx.isBacs) continue;
    if (r.key !== 'presence' && present !== 1) continue;
    const missing = [];
    const unanswered = [];
    let summary = '';
    switch (r.key) {
      case 'presence': {
        if (present == null) missing.push('présence de la GTB');
        if (present === 1 && ctx.isBuildySupervision == null) unanswered.push('supervision Buildy ?');
        if (present === 1 && ctx.isBuildySupervision === true && !b.buildy_offer_level) unanswered.push('niveau d’offre');
        if (present === 0) summary = 'Pas de GTB sur le site';
        else if (present === 1) {
          const level = b.buildy_offer_level && ctx.offerLabel ? ctx.offerLabel(b.buildy_offer_level) : null;
          const sup = ctx.isBuildySupervision === true ? `supervision Buildy${level ? ` ${level}` : ''}`
            : ctx.isBuildySupervision === false ? 'autre supervision' : null;
          summary = ['GTB présente', sup].filter(Boolean).join(' · ');
        }
        break;
      }
      case 'identification':
        if (!String(b.existing_solution || '').trim()) missing.push('solution en place');
        summary = [b.existing_solution, b.existing_solution_brand, b.model_reference, b.location]
          .map(s => String(s || '').trim()).filter(Boolean).join(' · ');
        break;
      case 'protocols': {
        const list = parseList(b.provided_protocols);
        if (!list.length) unanswered.push('protocoles de partage');
        summary = list.map(p => (ctx.protocolLabel ? ctx.protocolLabel(p) : p)).join(', ');
        break;
      }
      case 'out-of-service': {
        const st = bmsFunctionalState(b);
        const notes = String(b.functional_notes || '').trim();
        if (st == null) unanswered.push('fonctionnelle ?');
        // « Partiellement » : les notes disent ce qui ne fonctionne pas (imprimées dans le rapport et
        // reprises par l'action du plan) — décision de Kévin, 2026-10-16.
        if (st === 'partial' && !notes) missing.push('ce qui ne fonctionne pas');
        summary = st === 'functional' ? 'Fonctionnelle'
          : st === 'partial' ? `Partiellement fonctionnelle${notes ? ` : ${notes}` : ''}`
            : st === 'not_functional' ? 'Non fonctionnelle : le plan d’actions ignore les exigences sur la GTB' : '';
        if (notes && st !== 'partial') summary += ` · ${notes}`;
        break;
      }
      case 'af': {
        const st = ctx.afStatus ?? null;
        const n = ctx.afDocsCount || 0;
        if (st == null) unanswered.push('analyse fonctionnelle : existe-t-elle ?');
        else if (st !== 'absent' && !n) unanswered.push('document à déposer');
        summary = st === 'absent' ? 'Aucune analyse fonctionnelle'
          : n ? `Existe · ${plural(n, 'document déposé', 'documents déposés')}` : (st ? 'Existe' : '');
        break;
      }
      case 'components': {
        const n = ctx.componentsCount;
        summary = n == null ? 'Passerelles, automates, contrôleurs…'
          : n ? plural(n, 'composant saisi', 'composants saisis') : 'Aucun composant saisi';
        break;
      }
      case 'usages': {
        const on = BMS_USAGES.filter(u => isYes(b[u.key])).map(u => u.label);
        if (!on.length) unanswered.push('usages traités');
        summary = cap(on.join(', '));
        break;
      }
      case 'integrated': {
        const devices = ctx.devices || [];
        const meters = ctx.meters || [];
        const dNull = devices.filter(d => d.managed_by_bms == null).length;
        const mNull = meters.filter(m => (m.communicating === 1 || m.communicating === true) && m.managed_by_bms == null).length;
        if (dNull) unanswered.push(`${plural(dNull, 'équipement', 'équipements')} : intégré ?`);
        if (mNull) unanswered.push(`${plural(mNull, 'compteur', 'compteurs')} : intégré ?`);
        const dIn = devices.filter(d => isYes(d.managed_by_bms)).length;
        const mIn = meters.filter(m => isYes(m.managed_by_bms)).length;
        summary = devices.length || meters.length
          ? `${dIn} équipement${dIn > 1 ? 's' : ''} intégré${dIn > 1 ? 's' : ''} sur ${devices.length} · ${mIn} compteur${mIn > 1 ? 's' : ''} sur ${meters.length}`
          : 'Coche d’abord les usages traités';
        break;
      }
      case 'capabilities':
        if (b.meets_r175_3_p1 == null) unanswered.push('suivi heure par heure');
        if (b.meets_r175_3_p2 == null) unanswered.push('détection des dérives');
        if (isYes(b.meets_r175_3_p1) && b.r175_3_p1_retention_verified == null) unanswered.push('conservation vérifiée sur place ?');
        summary = `Suivi heure par heure : ${yesNo(b.meets_r175_3_p1)} · dérives : ${yesNo(b.meets_r175_3_p2)}`;
        break;
      case 'data-provision':
        if (b.data_provision_to_manager == null) unanswered.push('données au gestionnaire');
        if (b.data_provision_to_operators == null) unanswered.push('données aux exploitants');
        summary = `Gestionnaire : ${yesNo(b.data_provision_to_manager)} · exploitants : ${yesNo(b.data_provision_to_operators)}`;
        break;
      case 'data-storage':
        if (b.data_storage_5y_compliant == null) unanswered.push('conservation 5 ans');
        if (b.data_owner_access == null) unanswered.push('accès du propriétaire');
        if (b.gestionnaire_exploitant_access == null) unanswered.push('accès gestionnaire et exploitants');
        if (b.export_capability == null) unanswered.push('export CSV / Excel');
        if (b.data_storage_location == null) unanswered.push('lieu de stockage');
        summary = [
          b.data_storage_5y_compliant ? `5 ans : ${TRI[b.data_storage_5y_compliant] || b.data_storage_5y_compliant}` : null,
          b.data_storage_location ? STORAGE[b.data_storage_location] || b.data_storage_location : null,
          b.export_capability ? `export : ${TRI[b.export_capability] || b.export_capability}` : null,
        ].filter(Boolean).join(' · ');
        break;
      case 'upkeep':
        if (b.has_maintenance_procedures == null) unanswered.push('vérifications périodiques');
        if (b.operator_trained == null) unanswered.push('formation de l’exploitant');
        summary = `Vérifications : ${yesNo(b.has_maintenance_procedures)} · formation : ${yesNo(b.operator_trained)}`;
        break;
      default:
        break;
    }
    const optional = outOfService && !KEPT_WHEN_OUT_OF_SERVICE.has(r.key);
    const kept = optional ? [] : unanswered;
    out.push({
      ...r,
      missing,
      unanswered: kept,
      summary,
      optional,
      state: missing.length ? 'todo' : (kept.length ? 'open' : 'done'),
    });
  }
  return out;
}

// ─── Périmètre de la GTB (mêmes règles que les listes de l'étape) ──────────────────────────
/** « La GTB en place est-elle une supervision Buildy ? » : un niveau d'offre choisi vaut Oui. */
export function bmsIsBuildySupervision(bms) {
  const v = bms?.is_buildy_supervision;
  if (isYes(v)) return true;
  if (isNo(v)) return false;
  return bms?.buildy_offer_level ? true : null;
}
/** Usage d'un équipement piloté par la GTB (cases « Usages traités »). */
export function bmsManagesCategory(bms, cat) {
  if (!bms) return false;
  switch (cat) {
    case 'heating': return !!bms.manages_heating;
    case 'cooling': return !!bms.manages_cooling;
    case 'ventilation': return !!bms.manages_ventilation;
    case 'dhw': return !!bms.manages_dhw;
    case 'lighting_indoor':
    case 'lighting_outdoor': return !!bms.manages_lighting;
    default: return false;
  }
}
/** Usage d'un compteur suivi par la GTB ; compteurs généraux (« other ») dès qu'un usage l'est. */
export function bmsManagesMeterUsage(bms, usage) {
  if (!bms) return false;
  switch (usage) {
    case 'heating': return !!bms.manages_heating;
    case 'cooling': return !!bms.manages_cooling;
    case 'ventilation': return !!bms.manages_ventilation;
    case 'dhw': return !!bms.manages_dhw;
    case 'lighting': return !!bms.manages_lighting;
    case 'pv': return !!(bms.manages_electricity_production || bms.manages_electricity);
    case 'other':
      return !!(bms.manages_heating || bms.manages_cooling || bms.manages_ventilation || bms.manages_dhw || bms.manages_lighting);
    default: return false;
  }
}
/** Équipement dans le périmètre de la GTB : son usage, sauf choix forcé (gtb_scope_override). */
export function bmsDeviceInScope(bms, d) {
  if (isYes(d?.gtb_scope_override)) return true;
  if (isNo(d?.gtb_scope_override)) return false;
  return bmsManagesCategory(bms, d?.system_category);
}

/**
 * Rubriques de l'étape à partir des données de l'audit (équipements et compteurs présents, avant
 * filtrage par le périmètre de la GTB).
 * @param {object} bms ligne bacs_audit_bms
 * @param {object} ctx { isBacs, afStatus, afDocsCount, devicesWithMeta, metersPresent,
 *   offerLabel, protocolLabel, componentsCount } (les trois derniers : résumés seulement)
 */
export function bmsStepRubrics(bms, ctx = {}) {
  return bmsRubrics(bms, {
    isBacs: ctx.isBacs,
    isBuildySupervision: bmsIsBuildySupervision(bms),
    offerLabel: ctx.offerLabel,
    afStatus: ctx.afStatus ?? null,
    afDocsCount: ctx.afDocsCount || 0,
    protocolLabel: ctx.protocolLabel,
    componentsCount: ctx.componentsCount ?? null,
    devices: (ctx.devicesWithMeta || []).filter(d => bmsDeviceInScope(bms, d)),
    meters: (ctx.metersPresent || []).filter(m => bmsManagesMeterUsage(bms, m.usage)),
  });
}

/** Totaux : rubriques complètes, points à compléter, questions sans réponse. */
export function bmsGuideTotals(rubrics) {
  const list = rubrics || [];
  return {
    count: list.length,
    done: list.filter(r => r.state === 'done').length,
    missing: list.reduce((n, r) => n + r.missing.length, 0),
    unanswered: list.reduce((n, r) => n + r.unanswered.length, 0),
  };
}

/** Prochaine rubrique à reprendre (d'abord « à compléter », puis « sans réponse »), après `afterKey`. */
export function nextBmsRubric(rubrics, afterKey = null) {
  const list = rubrics || [];
  const order = [...list.filter(r => r.state === 'todo'), ...list.filter(r => r.state === 'open')];
  if (!order.length) return null;
  const i = afterKey ? order.findIndex(r => r.key === afterKey) : -1;
  return order[(i + 1) % order.length] || order[0];
}

/** État d'une rubrique (guide de gauche) : texte (infobulle), ton et pastille. */
export function bmsRubricStatus(r) {
  if (r.optional) return { text: 'Facultatif : GTB hors service', tone: 'muted', mark: '—' };
  if (r.missing.length) return { text: `${r.missing.length} à compléter`, tone: 'amber', mark: String(r.missing.length) };
  if (r.unanswered.length) {
    return { text: plural(r.unanswered.length, 'question sans réponse', 'questions sans réponse'), tone: 'slate', mark: String(r.unanswered.length) };
  }
  return { text: 'Complet', tone: 'green', mark: '✓' };
}
