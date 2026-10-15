// Étape Documents, mise en page « Nouvelle » (frontend/src/lib/documents-guide.js).
import { describe, it, expect } from 'vitest';
import { groupDocuments, docGroupKey, kindShownInGroup, DOC_GROUP_ORDER } from '../../frontend/src/lib/documents-guide.js';
import { DOCS_GROUPS, docsSummaryLine, docsReportCount } from '../../frontend/src/lib/audit-tips-guided.js';

const doc = (id, kind, label = '', inReport = 0) => ({ id, kind, label, include_in_report: inReport });
const kindOf = d => d.kind;
const labelOf = d => d.label;

describe('documents groupés par rattachement', () => {
  it('chaque rattachement a son groupe ; un rattachement inconnu reste avec le site', () => {
    expect(['Site', 'Check-list', 'GTB', 'Zone', 'Système', 'Équipement', 'Compteur', 'Action', 'Inspection', 'X'].map(docGroupKey))
      .toEqual(['site', 'checklist', 'gtb', 'elements', 'elements', 'elements', 'elements', 'other', 'other', 'site']);
  });
  it('ordre des groupes, premier document de chaque groupe, totaux et documents joints', () => {
    const docs = [doc(1, 'GTB', 'Buildy'), doc(2, 'Site', '', 1), doc(3, 'Check-list', 'Plans'), doc(4, 'Site'), doc(5, 'Zone', 'Bureaux', 1)];
    const { rows, groups } = groupDocuments(docs, kindOf, labelOf);
    expect(rows.map(r => r.doc.id)).toEqual([2, 4, 3, 1, 5]);
    expect(rows.filter(r => r.first).map(r => r.group)).toEqual(['site', 'checklist', 'gtb', 'elements']);
    expect(groups.site).toEqual({ count: 2, inReport: 1 });
    expect(groups.other).toEqual({ count: 0, inReport: 0 });
    expect(rows).toHaveLength(docs.length);
  });
  it('check-list : les pièces d’un même point se suivent, ordre d’origine ensuite', () => {
    const docs = [doc(1, 'Check-list', 'Schémas hydrauliques'), doc(2, 'Check-list', 'Accès locaux'), doc(3, 'Check-list', 'Schémas hydrauliques'), doc(4, 'Check-list', 'Accès locaux')];
    expect(groupDocuments(docs, kindOf, labelOf).rows.map(r => r.doc.id)).toEqual([2, 4, 1, 3]);
  });
  it('documents du site : ordre d’origine conservé', () => {
    const docs = [doc(9, 'Site', 'b'), doc(8, 'Site', 'a')];
    expect(groupDocuments(docs, kindOf, labelOf).rows.map(r => r.doc.id)).toEqual([9, 8]);
  });
  it('le type de rattachement n’est redit que dans les groupes qui en mélangent plusieurs', () => {
    expect(DOC_GROUP_ORDER.filter(kindShownInGroup)).toEqual(['elements', 'other']);
    expect(Object.keys(DOCS_GROUPS)).toEqual(DOC_GROUP_ORDER);
  });
  it('textes', () => {
    expect(docsSummaryLine(19, 3)).toBe('19 documents · 3 joints au rapport');
    expect(docsSummaryLine(1, 0)).toBe('1 document · aucun joint au rapport');
    expect(docsReportCount(1)).toBe('1 joint au rapport');
    expect(docsReportCount(0)).toBe('');
  });
});
