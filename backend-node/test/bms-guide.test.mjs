// Étape GTB, mise en page « Nouvelle » (frontend/src/lib/bms-guide.js) : rubriques, états
// « à compléter » (exigé pour valider l'étape) / « sans réponse » (question affichée sans réponse),
// rubriques facultatives quand la GTB est hors service, parcours.
import { describe, it, expect } from 'vitest';
import {
  bmsRubrics, bmsGuideTotals, nextBmsRubric, bmsRubricStatus, BMS_RUBRICS, BMS_RUBRIC_GROUPS,
} from '../../frontend/src/lib/bms-guide.js';

// GTB entièrement renseignée.
const full = (over = {}) => ({
  present: 1, is_buildy_supervision: 0, existing_solution: 'Niagara', existing_solution_brand: 'Tridium',
  provided_protocols: '["bacnet_ip"]', out_of_service: 0, manages_heating: 1, manages_lighting: 1,
  meets_r175_3_p1: 1, r175_3_p1_retention_verified: 1, meets_r175_3_p2: 0,
  data_provision_to_manager: 1, data_provision_to_operators: 0,
  data_storage_5y_compliant: 'yes', data_owner_access: 'partial', gestionnaire_exploitant_access: 'no',
  export_capability: 'yes', data_storage_location: 'local',
  has_maintenance_procedures: 1, operator_trained: 0,
  ...over,
});
const ctx = (over = {}) => ({
  isBacs: true, isBuildySupervision: false, offerLabel: l => ({ smart: 'Smart' }[l] || l),
  afStatus: 'absent', afDocsCount: 0, protocolLabel: p => ({ bacnet_ip: 'BACnet IP' }[p] || p),
  devices: [{ managed_by_bms: 1 }, { managed_by_bms: 0 }], meters: [{ communicating: 1, managed_by_bms: 1 }],
  ...over,
});
const byKey = (list) => Object.fromEntries(list.map(r => [r.key, r]));

describe('rubriques de la GTB', () => {
  it('GTB complète : toutes les rubriques sont complètes, dans l’ordre du référentiel', () => {
    const list = bmsRubrics(full(), ctx());
    expect(list.map(r => r.key)).toEqual(BMS_RUBRICS.map(r => r.key));
    expect(list.every(r => r.state === 'done')).toBe(true);
    expect(bmsGuideTotals(list)).toEqual({ count: 12, done: 12, missing: 0, unanswered: 0 });
  });
  it('chaque rubrique appartient à un groupe connu', () => {
    const groups = new Set(BMS_RUBRIC_GROUPS.map(g => g.key));
    expect(BMS_RUBRICS.every(r => groups.has(r.group))).toBe(true);
  });
  it('présence non répondue : seule la rubrique Présence, « à compléter »', () => {
    const list = bmsRubrics({ present: null }, ctx());
    expect(list.map(r => r.key)).toEqual(['presence']);
    expect(list[0]).toMatchObject({ state: 'todo', missing: ['présence de la GTB'] });
  });
  it('pas de GTB : une seule rubrique, complète, résumé en clair', () => {
    const [r] = bmsRubrics({ present: 0 }, ctx());
    expect(r).toMatchObject({ key: 'presence', state: 'done', summary: 'Pas de GTB sur le site' });
  });
  it('solution en place manquante = « à compléter » (exigée pour valider l’étape)', () => {
    const r = byKey(bmsRubrics(full({ existing_solution: '  ' }), ctx())).identification;
    expect(r.state).toBe('todo');
    expect(r.missing).toEqual(['solution en place']);
  });
  it('questions sans réponse : « sans réponse », pas « à compléter »', () => {
    const r = byKey(bmsRubrics(full({ meets_r175_3_p1: null, meets_r175_3_p2: null }), ctx()));
    expect(r.capabilities.state).toBe('open');
    expect(r.capabilities.unanswered).toEqual(['suivi heure par heure', 'détection des dérives']);
    expect(r.capabilities.missing).toEqual([]);
  });
  it('une réponse « Non » est une réponse', () => {
    const r = byKey(bmsRubrics(full({ meets_r175_3_p2: 0, operator_trained: 0 }), ctx()));
    expect(r.capabilities.state).toBe('done');
    expect(r.upkeep.state).toBe('done');
  });
  it('conservation vérifiée sur place : demandée seulement si le suivi horaire est assuré', () => {
    expect(byKey(bmsRubrics(full({ meets_r175_3_p1: 1, r175_3_p1_retention_verified: null }), ctx())).capabilities.unanswered)
      .toEqual(['conservation vérifiée sur place ?']);
    expect(byKey(bmsRubrics(full({ meets_r175_3_p1: 0, r175_3_p1_retention_verified: null }), ctx())).capabilities.state)
      .toBe('done');
  });
  it('supervision Buildy : la question, puis le niveau d’offre', () => {
    expect(byKey(bmsRubrics(full(), ctx({ isBuildySupervision: null }))).presence.unanswered).toEqual(['supervision Buildy ?']);
    const r = byKey(bmsRubrics(full(), ctx({ isBuildySupervision: true }))).presence;
    expect(r.unanswered).toEqual(['niveau d’offre']);
    const s = byKey(bmsRubrics(full({ buildy_offer_level: 'smart' }), ctx({ isBuildySupervision: true }))).presence;
    expect(s).toMatchObject({ state: 'done', summary: 'GTB présente · supervision Buildy Smart' });
  });
  it('analyse fonctionnelle : existe-t-elle, puis le document', () => {
    expect(byKey(bmsRubrics(full(), ctx({ afStatus: null }))).af.unanswered).toEqual(['analyse fonctionnelle : existe-t-elle ?']);
    expect(byKey(bmsRubrics(full(), ctx({ afStatus: 'present', afDocsCount: 0 }))).af.unanswered).toEqual(['document à déposer']);
    expect(byKey(bmsRubrics(full(), ctx({ afStatus: 'present', afDocsCount: 2 }))).af).toMatchObject({ state: 'done', summary: 'Existe · 2 documents déposés' });
  });
  it('intégration : équipements et compteurs communicants sans réponse', () => {
    const r = byKey(bmsRubrics(full(), ctx({
      devices: [{ managed_by_bms: null }, { managed_by_bms: null }, { managed_by_bms: 1 }],
      meters: [{ communicating: 1, managed_by_bms: null }, { communicating: 0, managed_by_bms: null }],
    }))).integrated;
    expect(r.unanswered).toEqual(['2 équipements : intégré ?', '1 compteur : intégré ?']);
    expect(r.summary).toBe('1 équipement intégré sur 3 · 0 compteur sur 2');
  });
  it('composants matériels : nombre saisi (jamais exigé)', () => {
    expect(byKey(bmsRubrics(full(), ctx({ componentsCount: 3 }))).components).toMatchObject({ state: 'done', summary: '3 composants saisis' });
    expect(byKey(bmsRubrics(full(), ctx({ componentsCount: 0 }))).components.summary).toBe('Aucun composant saisi');
  });
  it('usages traités : liste en clair, ou « sans réponse » si aucun', () => {
    expect(byKey(bmsRubrics(full(), ctx())).usages.summary).toBe('Chauffage, éclairage');
    expect(byKey(bmsRubrics(full({ manages_heating: 0, manages_lighting: 0 }), ctx())).usages.unanswered).toEqual(['usages traités']);
  });
  it('GTB hors service : les rubriques sur ce qu’elle fait deviennent facultatives', () => {
    const r = byKey(bmsRubrics(full({ out_of_service: 1, meets_r175_3_p1: null, provided_protocols: null }), ctx()));
    expect(r.capabilities).toMatchObject({ optional: true, unanswered: [], state: 'done' });
    expect(r.protocols.optional).toBe(true);
    expect(r.identification.optional).toBe(false);
    expect(bmsRubricStatus(r.capabilities)).toEqual({ text: 'Facultatif : GTB hors service', tone: 'muted', mark: '—' });
  });
  it('audit hors décret (supervision seule) : pas de rubriques du décret', () => {
    const keys = bmsRubrics(full(), ctx({ isBacs: false })).map(r => r.key);
    expect(keys).not.toContain('capabilities');
    expect(keys).not.toContain('upkeep');
  });
});

describe('parcours et lignes d’état', () => {
  it('reprend d’abord les rubriques à compléter, puis celles sans réponse, en boucle', () => {
    const list = bmsRubrics(full({ existing_solution: '', operator_trained: null, meets_r175_3_p2: null }), ctx());
    expect(nextBmsRubric(list).key).toBe('identification');
    expect(nextBmsRubric(list, 'identification').key).toBe('capabilities');
    expect(nextBmsRubric(list, 'capabilities').key).toBe('upkeep');
    expect(nextBmsRubric(list, 'upkeep').key).toBe('identification');
    expect(nextBmsRubric(bmsRubrics(full(), ctx()))).toBeNull();
  });
  it('lignes d’état', () => {
    const r = byKey(bmsRubrics(full({ existing_solution: '', export_capability: null, data_owner_access: null }), ctx()));
    expect(bmsRubricStatus(r.identification)).toEqual({ text: '1 à compléter', tone: 'amber', mark: '1' });
    expect(bmsRubricStatus(r['data-storage'])).toEqual({ text: '2 questions sans réponse', tone: 'slate', mark: '2' });
    expect(bmsRubricStatus(r.upkeep)).toEqual({ text: 'Complet', tone: 'green', mark: '✓' });
  });
});
