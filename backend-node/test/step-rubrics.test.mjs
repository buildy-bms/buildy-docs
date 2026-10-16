// Rubriques repliables des étapes (composables/useStepRubrics.js). Bug signalé par Kévin
// (2026-10-16, étape GTB de STEF) : les rubriques se refermaient toutes seules. La synchro de
// l'audit (toutes les 5 s) remplace l'objet GTB du store ; la clé de remise à zéro, recalculée,
// donnait un nouveau tableau aux mêmes valeurs et refermait ce que l'auditeur venait d'ouvrir.
import { describe, it, expect } from 'vitest';
// Même instance de Vue que le composable (sinon la réactivité ne se suit pas d'une copie à l'autre).
import { ref, nextTick } from '../../frontend/node_modules/vue/index.mjs';
import { useStepRubrics } from '../../frontend/src/composables/useStepRubrics.js';

function setup() {
  const bms = ref({ document_id: 60 });
  const loaded = ref(true);
  const rubrics = ref([{ key: 'identification', state: 'done' }, { key: 'usages', state: 'done' }, { key: 'af', state: 'todo' }]);
  const r = useStepRubrics(rubrics, () => [bms.value?.document_id, loaded.value]);
  return { bms, loaded, r };
}

describe('rubriques d’une étape : ouverture et remise à zéro', () => {
  it('par défaut, seules les rubriques à compléter sont ouvertes', () => {
    const { r } = setup();
    expect(r.isOpen('af')).toBe(true);
    expect(r.isOpen('identification')).toBe(false);
  });
  it('une rubrique ouverte reste ouverte quand la synchro remplace les données par les mêmes', async () => {
    const { bms, r } = setup();
    r.toggle('identification');
    expect(r.isOpen('identification')).toBe(true);
    bms.value = { document_id: 60 }; // softRefresh() du store : nouvel objet, même audit
    await nextTick();
    expect(r.isOpen('identification')).toBe(true);
  });
  it('remise à zéro quand l’audit change ou quand le chargement attendu se termine', async () => {
    const { bms, loaded, r } = setup();
    r.toggle('identification');
    bms.value = { document_id: 61 };
    await nextTick();
    expect(r.isOpen('identification')).toBe(false);
    r.toggle('identification');
    loaded.value = false;
    await nextTick();
    expect(r.isOpen('identification')).toBe(false);
  });
});
