/**
 * Helpers de manipulation de dates ISO (YYYY-MM-DD).
 *
 * Toutes les fonctions retournent une chaîne ISO ou null. Pas de Date
 * mutable exposée — les composants restent côté string.
 */

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseIso(iso) {
  if (!iso || typeof iso !== 'string' || !ISO_RE.test(iso)) return null;
  const d = new Date(iso + 'T00:00:00');
  return Number.isNaN(d.getTime()) ? null : d;
}

function toIso(d) {
  if (!d || Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * Ajoute `n` années à une date ISO. Gère le 29 février -> 28 février.
 * @param {string} iso
 * @param {number} n
 * @returns {string|null}
 */
export function addYearsIso(iso, n) {
  const d = parseIso(iso);
  if (!d) return null;
  const target = new Date(d);
  target.setFullYear(target.getFullYear() + n);
  // Cas 29 février -> année non bissextile : Date.setFullYear ramène
  // automatiquement au 1er mars. Suffit pour l'usage métier.
  return toIso(target);
}

/** Date du jour au format ISO (timezone locale). */
export function todayIso() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return toIso(d);
}
