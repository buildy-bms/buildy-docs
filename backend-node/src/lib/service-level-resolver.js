'use strict';

/**
 * Calcul du niveau de service minimal requis pour une AF en fonction
 * des sections effectivement incluses dans l'export.
 *
 * Regle :
 *   - Hierarchie : Essentials < Smart < Premium
 *   - Si UNE section requiert P, l'AF requiert P (meme si tout le reste est E).
 *   - Les valeurs textuelles 'E/S/P' / 'S/P' / 'P' / 'E' / 'S' / 'P' / null
 *     proviennent de service-levels.js (formatServiceLevel).
 */

const RANK = { E: 0, S: 1, P: 2 };
const LABELS = { E: 'Essentials', S: 'Smart', P: 'Premium' };

function minRequiredFromValue(value) {
  // 'P' → P / 'S/P' → S (le minimum dans S/P est S) / 'E/S/P' → E / null → null
  if (!value) return null;
  if (value.includes('/')) {
    const parts = value.split('/').map(s => s.trim()).filter(Boolean);
    return parts.reduce((acc, p) => {
      if (RANK[p] == null) return acc;
      if (acc == null) return p;
      return RANK[p] < RANK[acc] ? p : acc;
    }, null);
  }
  return RANK[value] != null ? value : null;
}

/**
 * Calcule le niveau global requis (E, S, P) depuis une liste de sections
 * incluses. Renvoie aussi le label complet et la liste des sections qui ont
 * pousse le niveau (utile pour l'encart "Niveau requis : Premium — justifie par...").
 */
function resolveAfLevel(includedSections) {
  let maxRank = -1;
  let maxLevel = null;
  const justifications = [];

  for (const sec of includedSections) {
    const required = minRequiredFromValue(sec.service_level);
    if (required == null) continue;
    const r = RANK[required];
    if (r > maxRank) {
      maxRank = r;
      maxLevel = required;
      // Reset justifications avec la nouvelle section qui a augmente le niveau
      justifications.length = 0;
      justifications.push({ number: sec.number, title: sec.title, level: sec.service_level });
    } else if (r === maxRank && r > 0) {
      // Meme niveau max : ajoute a la liste des justifications
      justifications.push({ number: sec.number, title: sec.title, level: sec.service_level });
    }
  }

  return {
    level: maxLevel,
    label: maxLevel ? LABELS[maxLevel] : null,
    justifications: justifications.slice(0, 8), // top 8
  };
}

/**
 * Pour un service_level brut ('E', 'S/P', 'E/S/P', etc.), retourne un libelle
 * complet pour affichage : 'Essentials', 'Smart', 'Premium', 'Smart et Premium',
 * 'Tous niveaux', etc.
 */
function formatLevelFull(value) {
  if (!value) return null;
  if (value === 'E') return 'Essentials';
  if (value === 'S') return 'Smart';
  if (value === 'P') return 'Premium';
  if (value === 'E/S/P') return 'Tous niveaux';
  if (value === 'S/P') return 'Smart et Premium';
  // Fallback : decompose 'X/Y/Z' → 'Xlabel, Ylabel et Zlabel'
  const parts = value.split('/').map(s => s.trim()).filter(Boolean);
  const labels = parts.map(p => LABELS[p] || p).filter(Boolean);
  if (!labels.length) return null;
  if (labels.length === 1) return labels[0];
  return labels.slice(0, -1).join(', ') + ' et ' + labels.slice(-1);
}

module.exports = { resolveAfLevel, formatLevelFull, LABELS, RANK };
