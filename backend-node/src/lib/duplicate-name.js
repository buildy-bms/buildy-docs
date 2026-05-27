// Helper unique pour générer un nom de copie incrémenté lors de la
// duplication d'une entité (zone, device, etc.). Évite le « (copie) »
// systématique qui pose problème quand on duplique plusieurs fois.
//
// Règles :
// - Si l'original n'a pas de nom : renvoie null.
// - Si l'original est « Bureaux » et il existe déjà « Bureaux (2) » et
//   « Bureaux (3) » : renvoie « Bureaux (4) ».
// - Si l'original est « Bureaux (2) » : on dérive depuis la base
//   « Bureaux » et on cherche le prochain numéro libre → « Bureaux (3) »
//   (ou plus si la chaîne est déjà occupée).

const SUFFIX_RE = /^(.*) \((\d+)\)$/;

function extractBase(name) {
  const m = name.match(SUFFIX_RE);
  return m ? m[1] : name;
}

/**
 * Calcule le prochain nom incrémenté.
 * @param {string|null} originalName - le nom de l'entité d'origine.
 * @param {Iterable<string>} existingNames - noms déjà utilisés dans le
 *   périmètre concerné (zones du même site, devices du même système…).
 * @returns {string|null} nom suffixé `Base (N+1)`, ou null si originalName vide.
 */
function nextDuplicateName(originalName, existingNames) {
  if (!originalName) return null;
  const base = extractBase(originalName);
  const escapedBase = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matchRe = new RegExp(`^${escapedBase}( \\((\\d+)\\))?$`);
  let maxN = 1; // l'original implicitement = 1
  for (const name of (existingNames || [])) {
    if (!name) continue;
    const m = name.match(matchRe);
    if (m) maxN = Math.max(maxN, m[2] ? parseInt(m[2], 10) : 1);
  }
  return `${base} (${maxN + 1})`;
}

module.exports = { nextDuplicateName };
