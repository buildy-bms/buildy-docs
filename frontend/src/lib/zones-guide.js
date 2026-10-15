// Étape Zones, mise en page « Nouvelle » : zones fonctionnelles puis locaux techniques en deux
// groupes, et ce qui manque à chaque zone. Logique pure (testée : backend-node/test/zones-guide.test.mjs).
// Une zone « à compléter » bloque la validation de l'étape (lib/step-unanswered.js, décision de
// Kévin du 14/10 : toute question affichée a sa réponse). Imports relatifs (testable sous Node).
import { plural } from './tooltip-content.js';

export const isTechnicalZone = (z) => (z?.kind || 'functional') === 'technical';

/** Ce qui manque à une zone : nature ; pour une zone fonctionnelle, aussi régime d'activité et surface. */
export function zoneMissing(z) {
  const out = [];
  if (!z?.nature) out.push('nature');
  if (!isTechnicalZone(z)) {
    if (!z?.occupancy_profile) out.push('régime d’activité');
    if (z?.surface_m2 == null || z?.surface_m2 === '') out.push('surface');
  }
  return out;
}

/** Zones regroupées pour l'affichage : fonctionnelles puis techniques, ordre conservé dans chaque groupe. */
export function groupZones(zones) {
  const list = zones || [];
  return [...list.filter(z => !isTechnicalZone(z)), ...list.filter(isTechnicalZone)];
}

/** Totaux d'un groupe : nombre, surface, zones à compléter. */
export function zoneGroupTotals(zones) {
  const list = zones || [];
  return {
    count: list.length,
    surface: list.reduce((s, z) => s + (Number(z.surface_m2) || 0), 0),
    todo: list.filter(z => zoneMissing(z).length).length,
  };
}

/** Ligne « reste à faire » : « 3 zones à compléter : nature, régime d’activité ou surface manquants. » */
export function zonesTodoLine(n) {
  return `${plural(n, 'zone à compléter', 'zones à compléter')} : nature, régime d’activité ou surface manquants.`;
}
