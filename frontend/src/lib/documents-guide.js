// Étape Documents de l'audit, mise en page « Nouvelle » : les documents du site groupés par
// rattachement (ceux de l'ensemble du site d'abord, puis la check-list, la GTB, les photos
// d'éléments, les actions et l'inspection). Fonctions pures, testées
// (backend-node/test/documents-guide.test.mjs). Rattachement : attachmentLabel(d).kind de
// SiteDocumentsManager ('Site', 'Check-list', 'GTB', 'Zone', 'Système', 'Équipement', 'Compteur',
// 'Action', 'Inspection').

// Ordre des groupes ; libellés dans lib/audit-tips-guided.js (DOCS_GROUPS).
export const DOC_GROUP_ORDER = ['site', 'checklist', 'gtb', 'elements', 'other'];

const KIND_TO_GROUP = {
  Site: 'site',
  'Check-list': 'checklist',
  GTB: 'gtb',
  Zone: 'elements',
  Système: 'elements',
  Équipement: 'elements',
  Compteur: 'elements',
  Action: 'other',
  Inspection: 'other',
};

export function docGroupKey(kind) {
  return KIND_TO_GROUP[kind] || 'site';
}

/** Le type de rattachement est redit par le titre du groupe : seul le nom reste sur la pastille. */
export function kindShownInGroup(groupKey) {
  return groupKey === 'elements' || groupKey === 'other';
}

/**
 * Documents dans l'ordre des groupes, avec le total de chaque groupe. Dans un groupe, l'ordre
 * d'origine est conservé, sauf pour la check-list et les éléments : triés par point de check-list
 * ou par élément (les pièces d'un même point se suivent), puis dans l'ordre d'origine.
 * @param {Array} docs
 * @param {(d) => string} kindOf rattachement d'un document (attachmentLabel(d).kind)
 * @param {(d) => string} [labelOf] nom de l'élément rattaché (attachmentLabel(d).label)
 * @returns {{ rows: Array<{ doc, group, first: boolean }>, groups: Record<string, { count, inReport }> }}
 */
export function groupDocuments(docs, kindOf, labelOf = () => '') {
  const buckets = Object.fromEntries(DOC_GROUP_ORDER.map(k => [k, []]));
  for (const d of docs || []) buckets[docGroupKey(kindOf(d))].push(d);
  for (const key of ['checklist', 'elements']) {
    const key2 = (d) => `${key === 'elements' ? kindOf(d) : ''} ${labelOf(d) || ''}`;
    buckets[key] = buckets[key]
      .map((d, i) => ({ d, i, k: key2(d) }))
      .sort((a, b) => a.k.localeCompare(b.k, 'fr') || a.i - b.i)
      .map(x => x.d);
  }
  const rows = [];
  const groups = {};
  for (const key of DOC_GROUP_ORDER) {
    const list = buckets[key];
    groups[key] = { count: list.length, inReport: list.filter(d => !!d.include_in_report).length };
    list.forEach((doc, i) => rows.push({ doc, group: key, first: i === 0 }));
  }
  return { rows, groups };
}
