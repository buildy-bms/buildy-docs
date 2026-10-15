// Étape Identification, mise en page « Nouvelle » : le verdict « concerné par le décret ? » en tête,
// puis quatre rubriques repliables avec leur état (même dessin que l'étape GTB). Logique pure
// (testée : backend-node/test/identification-guide.test.mjs). « À compléter » = ce que l'étape
// exige (puissance et date du permis, qui donnent le verdict) ; « sans réponse » = question
// affichée restée vide, qui bloque aussi la validation (lib/step-unanswered.js, décision de Kévin
// du 14/10). Imports relatifs uniquement (testable sous Node).
import { plural } from './tooltip-content.js';

export const IDENTIFICATION_RUBRICS = [
  { key: 'applicability', anchor: 'ident-applicability', icon: 'gauge', title: 'Puissance et permis de construire' },
  { key: 'triggers', anchor: 'ident-triggers', icon: 'screwdriver-wrench', title: 'Travaux récents et réseau urbain' },
  { key: 'parties', anchor: 'ident-parties', icon: 'scale-balanced', title: 'Structure juridique et parties prenantes' },
  { key: 'history', anchor: 'ident-energy-history', icon: 'chart-column', title: 'Consommations de référence' },
];

// Teinte du verdict (mêmes sévérités que les pastilles du plan : bloquante, majeure, mineure).
export const VERDICT_TONES = {
  subject_immediate: 'red',
  subject_2025: 'orange',
  subject_2030: 'amber',
  not_subject: 'green',
};

/** Date ISO (AAAA-MM-JJ) → « 23 janvier 2015 ». */
export function frenchDate(iso) {
  if (!iso) return '';
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return String(iso);
  // « 1er janvier », comme dans le reste de l'audit (toLocaleDateString écrit « 1 janvier »).
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }).replace(/^1 /, '1er ');
}
/** 1200 → « 1 200 kW ». */
export function formatKw(v) {
  if (v == null || v === '') return '';
  return `${Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} kW`;
}

/**
 * @param {object} doc document d'audit (bacs_total_power_kw, bacs_building_permit_date,
 *   bacs_generator_works_date, bacs_district_heating_substation_kw)
 * @param {object} ctx { hasSite, structureLabel (structure juridique en clair, ou ''),
 *   partiesCount, historyCount (mois saisis ; null = inconnu),
 *   retainedKw (puissance retenue par l'audit, celle du verdict ; à défaut bacs_total_power_kw) }
 */
export function identificationRubrics(doc, ctx = {}) {
  const d = doc || {};
  const out = [];
  for (const r of IDENTIFICATION_RUBRICS) {
    if ((r.key === 'parties' || r.key === 'history') && !ctx.hasSite) continue;
    const missing = [];
    const unanswered = [];
    let summary = '';
    switch (r.key) {
      case 'applicability': {
        // Même puissance que le verdict en tête d'étape (en calcul automatique, la valeur enregistrée
        // peut dater d'un ancien calcul).
        const kw = ctx.retainedKw ?? d.bacs_total_power_kw;
        if (kw == null || kw === '') missing.push('puissance de chauffage et de climatisation');
        if (!d.bacs_building_permit_date) missing.push('date du permis de construire');
        summary = [formatKw(kw), d.bacs_building_permit_date ? `permis du ${frenchDate(d.bacs_building_permit_date)}` : '']
          .filter(Boolean).join(' · ');
        break;
      }
      case 'triggers': {
        const works = d.bacs_generator_works_date ? `travaux sur le générateur le ${frenchDate(d.bacs_generator_works_date)}` : 'pas de travaux sur le générateur';
        const district = d.bacs_district_heating_substation_kw != null
          ? `réseau urbain${Number(d.bacs_district_heating_substation_kw) ? ` (${formatKw(d.bacs_district_heating_substation_kw)})` : ''}`
          : 'pas de réseau urbain';
        summary = `${works.charAt(0).toUpperCase()}${works.slice(1)} · ${district}`;
        break;
      }
      case 'parties': {
        if (!ctx.structureLabel) unanswered.push('structure de propriété');
        const n = ctx.partiesCount || 0;
        summary = [ctx.structureLabel, n ? plural(n, 'partie prenante', 'parties prenantes') : 'aucune partie prenante']
          .filter(Boolean).join(' · ');
        break;
      }
      case 'history': {
        const n = ctx.historyCount;
        summary = n == null ? '' : n ? plural(n, 'mois saisi', 'mois saisis') : 'Aucune consommation saisie';
        break;
      }
      default:
        break;
    }
    out.push({ ...r, missing, unanswered, summary, optional: false,
      state: missing.length ? 'todo' : unanswered.length ? 'open' : 'done' });
  }
  return out;
}
