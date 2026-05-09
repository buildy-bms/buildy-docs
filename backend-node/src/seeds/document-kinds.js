'use strict';

/**
 * Liste des types de documents Buildy auxquels une section type peut être
 * rattachée. Source de vérité pour le multi-select de la biblio + filtrage
 * côté seeder (seul 'af' déclenche le seed des sections dans une AF).
 *
 * Pour ajouter un nouveau type : ajouter une entrée dans `DOCUMENT_KINDS`
 * et — si une nouvelle table de documents est créée — adapter les filtres
 * dans les seeders/routes correspondants.
 */

const DOCUMENT_KINDS = [
  {
    kind: 'af',
    label: 'Analyse fonctionnelle',
    description: 'Livrable de chantier — analyse fonctionnelle examinée lors de l\'inspection R175-5-1',
  },
  {
    kind: 'brochure',
    label: 'Brochure commerciale',
    description: 'Document marketing assemblé depuis la bibliothèque de fonctionnalités',
  },
  {
    kind: 'bacs_audit',
    label: 'Audit BACS',
    description: 'Rapport d\'audit de conformité au décret BACS R175',
  },
];

const DOCUMENT_KINDS_BY_KIND = Object.fromEntries(DOCUMENT_KINDS.map(d => [d.kind, d]));

const DOCUMENT_KINDS_VALUES = DOCUMENT_KINDS.map(d => d.kind);

function isValidDocumentKind(kind) {
  return DOCUMENT_KINDS_VALUES.includes(kind);
}

module.exports = {
  DOCUMENT_KINDS,
  DOCUMENT_KINDS_BY_KIND,
  DOCUMENT_KINDS_VALUES,
  isValidDocumentKind,
};
