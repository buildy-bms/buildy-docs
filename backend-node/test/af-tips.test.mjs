// Contenus des infobulles des analyses fonctionnelles et de la liste des documents
// (frontend/src/lib/af-tips.js) : règles de rédaction de Kévin (français simple, tutoiement,
// pas d'article du décret dans le texte, pas de « (s) », pas d'anglais…) vérifiées sur TOUS
// les textes produits, avec des valeurs typiques ; quelques comportements clés.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import * as tips from '../../frontend/src/lib/af-tips.js';
import { normalizeTip } from '../../frontend/src/lib/tooltip-content.js';
import { checkCopy } from '../../frontend/scripts/tooltip-lint.mjs';

const SKIP = new Set(['meta', 'article', 'icon', 'tone', 'accent', 'placement', 'keys', 'layout']);

/** Tous les textes affichés d'une valeur de bulle : [{ text, label }]. */
function shown(value, inCard = false, key = null) {
  if (value == null || value === false) return [];
  if (typeof value === 'string') return [{ text: value, label: !inCard && (!key || key === 'label' || key === 'text') }];
  if (typeof value === 'number') return [];
  if (Array.isArray(value)) return value.flatMap((v) => shown(v, inCard, key));
  if (typeof value === 'object') {
    const card = inCard || !!value.title;
    return Object.entries(value).flatMap(([k, v]) => (SKIP.has(k) ? [] : shown(v, card, k)));
  }
  return [];
}

function expectClean(name, value) {
  for (const s of shown(value)) {
    expect({ name, text: s.text, problems: checkCopy(s.text, { label: s.label }) }).toEqual({ name, text: s.text, problems: [] });
  }
  expect(normalizeTip(value) !== undefined).toBe(true);
}

/** Étiquette (texte court) : ≤ 40 caractères, conforme. */
function expectShortLabel(name, value) {
  expect(typeof value).toBe('string');
  expect({ name, length: value.length <= 40 }).toEqual({ name, length: true });
  expectClean(name, value);
}

describe('af-tips : règles de rédaction', () => {
  it('constantes', () => {
    for (const [name, v] of Object.entries(tips)) {
      if (typeof v === 'function' || name === 'AF_TIP_ICONS') continue;
      expectClean(name, v);
    }
  });

  it('étiquettes courtes', () => {
    for (const name of ['UNDEMAND_LABEL', 'OPT_IN_LABEL', 'REMOVE_PAID_OPTION_LABEL', 'INCLUDE_SECTION_LABEL', 'NO_CONTRACT_LABEL',
      'VERSION_ID_LABEL', 'VERSION_COMPARE_LABEL', 'QTY_TOTAL_LABEL', 'TEMPLATE_SELECTED_LABEL']) {
      expectShortLabel(name, tips[name]);
    }
    for (const [k, v] of Object.entries(tips.POINT_TYPE_LABELS)) expectShortLabel(`POINT_TYPE_LABELS.${k}`, v);
    for (const [k, v] of Object.entries(tips.POINT_NATURE_LABELS)) expectShortLabel(`POINT_NATURE_LABELS.${k}`, v);
    for (const [k, v] of Object.entries(tips.SECTION_KIND_LABELS)) expectShortLabel(`SECTION_KIND_LABELS.${k}`, v);
    expectShortLabel('POINT_KPI_TIPS.all', tips.POINT_KPI_TIPS.all);
  });

  it('fonctions, avec des valeurs typiques', () => {
    for (const s of [...tips.AF_PHASES, 'draft', 'published']) {
      expectClean(`docStatusTip ${s}`, tips.docStatusTip(s));
      for (const kind of ['bacs_audit', 'maintenance_report']) expectClean(`docStatusTip ${s} ${kind}`, tips.docStatusTip(s, kind));
    }
    expect(tips.docStatusTip('inconnu')).toBeNull();
    // Audit BACS : pas de texte propre à l'analyse fonctionnelle, pas de phases d'AF.
    expect(tips.docStatusTip('redaction', 'bacs_audit').text).not.toMatch(/analyse fonctionnelle/);
    expect(tips.docStatusTip('livree', 'bacs_audit').rows).toBeUndefined();
    for (const [cur, next] of [['redaction', 'validee'], ['validee', 'commissioning'], ['commissioning', 'commissioned'], ['commissioned', 'livree']]) {
      expectClean(`phaseAdvanceTip ${next}`, tips.phaseAdvanceTip(cur, next));
    }
    expect(tips.phaseAdvanceTip('livree', null)).toBeNull();
    for (const l of ['E', 'S', 'P', 'S/P', 'E/S/P', 'e']) expectClean(`serviceLevelTip ${l}`, tips.serviceLevelTip(l));
    expect(tips.serviceLevelTip(null)).toBeNull();
    expectClean('contractShortfallTip', tips.contractShortfallTip('Essentiel', 'Smart'));
    expectClean('contractShortfallTip sans noms', tips.contractShortfallTip(null, null));
    expectClean('contractOkTip', tips.contractOkTip('Premium'));
    expectClean('moreJustificationsTip', tips.moreJustificationsTip(['Courbes de charge', 'Gestion des alarmes']));
    // Titres écrits pour le client (vouvoiement) : cités entre guillemets, tels quels.
    const cited = tips.moreJustificationsTip(['Contrôle à distance de vos équipements depuis Hyperveez', 'Maintenance logicielle de votre infrastructure GTB']);
    expectClean('moreJustificationsTip titres du client', cited);
    expect(cited.text.split('\n')).toEqual(['• « Contrôle à distance de vos équipements depuis Hyperveez »', '• « Maintenance logicielle de votre infrastructure GTB »']);
    expect(tips.moreJustificationsTip([])).toBeNull();
    expectClean('missingInfoTip', tips.missingInfoTip(['Renseigne le client']));
    expect(tips.missingInfoTip([false, null])).toBeNull();
    expectClean('transitionBlockedTip', tips.transitionBlockedTip({ motifMissing: true, agreementMissing: true }));
    expect(tips.transitionBlockedTip({})).toBeNull();
    expectClean('docFormBlockedTip audit', tips.docFormBlockedTip({ clientMissing: true, projectMissing: true, siteMissing: true, kind: 'bacs_audit' }));
    expectClean('docFormBlockedTip rapport', tips.docFormBlockedTip({ siteMissing: true, kind: 'maintenance_report' }));
    expectClean('addSectionBlockedTip', tips.addSectionBlockedTip({ titleMissing: true, templateMissing: true }));
    for (const [verified, total] of [[3, 12], [12, 12], [0, 0]]) {
      expectClean(`verificationProgressTip ${verified}/${total}`, tips.verificationProgressTip({ verified, total }));
    }
    expectClean('sectionKindsTip', tips.sectionKindsTip({ standard: 40, equipment: 12, hyperveez_page: 9, synthesis: 1 }));
    for (const k of ['af', 'bacs_audit', 'maintenance_report', 'brochure', undefined]) expectClean(`docKindTip ${k}`, tips.docKindTip(k));
    for (const [count, total] of [[0, 12], [1, 11], [12, 12]]) expectClean(`bacsProgressTip ${count}/${total}`, tips.bacsProgressTip({ count, total }));
    for (const t of ['af-v0.3', 'lp-v0.2', 'synth-v0.1', 'livraison-client']) expectClean(`versionTagTip ${t}`, tips.versionTagTip(t));
    for (const s of ['equipment', 'section_template', 'functionality', 'new_section', 'new_functionality', null]) {
      expectClean(`propagationSourceTip ${s}`, tips.propagationSourceTip(s));
      expectClean(`propagationDismissTip ${s}`, tips.propagationDismissTip(s));
    }
    expectClean('templateVersionTip', tips.templateVersionTip(2, 5));
    for (const item of [{ source: 'new_section' }, { source: 'equipment' }, { source: 'section_template', body_changed: true }, { source: 'functionality' }]) {
      expectClean(`propagationApplyTip ${item.source}`, tips.propagationApplyTip(item));
    }
    expectClean('pointDirectionLabel read', tips.pointDirectionLabel('read'));
    expectClean('pointDirectionLabel write', tips.pointDirectionLabel('write'));
    expectClean('pointOptionalLabel', tips.pointOptionalLabel(true));
    expectClean('pointOptionalLabel non', tips.pointOptionalLabel(false));
    expectClean('templatePointsLabel', tips.templatePointsLabel(14));
    for (const [state, kids] of [['on', true], ['on', false], ['off', true], ['partial', false]]) {
      expectShortLabel(`sectionPickLabel ${state}`, tips.sectionPickLabel(state, kids));
    }
    for (const ref of ['R175-3 1°', 'R175-1 §1, §2', 'R175-1 1°, 2° ; R175-3 3°', 'R175-5-1', 'R175-1 à R175-6', 'R175-9']) {
      expectClean(`bacsReferenceTip ${ref}`, tips.bacsReferenceTip(ref, 'equipment'));
      expectClean(`bacsReferenceTip section ${ref}`, tips.bacsReferenceTip(ref));
    }
    expectClean('bacsJustifyTip', tips.bacsJustifyTip(false));
    expectClean('bacsJustifyTip modifier', tips.bacsJustifyTip(true));
    expectClean('bacsJustifyTip bibliothèque', tips.bacsJustifyTip(false, true));
  });
});

describe('af-tips : comportements', () => {
  it('statut : phase et phase suivante', () => {
    const t = normalizeTip(tips.docStatusTip('validee'));
    expect(t.kind).toBe('card');
    expect(t.rows.map((r) => r.value)).toEqual(['2 sur 5', 'Commissionnement en cours']);
    expect(normalizeTip(tips.docStatusTip('livree')).rows).toHaveLength(1);
    expect(normalizeTip(tips.docStatusTip('draft')).rows).toHaveLength(0);
  });

  it('offres : combinaisons', () => {
    expect(tips.serviceLevelTip('S/P').title).toBe('Offres Smart et Premium');
    expect(tips.serviceLevelTip('E/S/P').title).toBe('Toutes les offres');
    expect(tips.serviceLevelTip('s').title).toBe('Offre Smart');
  });

  it('décret : références découpées, article en pied, texte sans code', () => {
    expect(tips.decreeRefKeys('R175-1 §1, §2')).toEqual(['R175-1 1°', 'R175-1 2°']);
    expect(tips.decreeRefKeys('R175-1 1°, 2° ; R175-3 3°')).toEqual(['R175-1 1°', 'R175-1 2°', 'R175-3 3°']);
    expect(tips.decreeRefKeys('R175-5-1')).toEqual(['R175-5-1']);
    const t = normalizeTip(tips.bacsReferenceTip('R175-1 1°, 2° ; R175-3 3°'));
    expect(t.meta.replace(/ /g, ' ')).toBe('Un clic ouvre l’extrait officiel · Décret BACS · article R175-1 1°, 2° ; R175-3 3°');
    expect(t.blocks.some((b) => b.type === 'list')).toBe(true);
    expect(JSON.stringify(t.blocks)).not.toMatch(/R175/);
    // Alinéas 1° à 3° de l'article R175-1 : les systèmes visés, en clair.
    const eq = normalizeTip(tips.bacsReferenceTip('R175-1 §1, §2', 'equipment'));
    expect(eq.blocks[0].text).toBe('Le décret compte le chauffage et la climatisation parmi les systèmes techniques qu’il vise.');
    expect(tips.bacsReferenceTip('')).toBeNull();
  });

  it('boutons grisés : seulement ce qui manque', () => {
    const t = tips.docFormBlockedTip({ projectMissing: true });
    expect(t.todo).toEqual(['Renseigne le projet']);
    expect(tips.docFormBlockedTip({})).toBeNull();
  });

  it('icônes citées : toutes existent dans free-solid', () => {
    const require = createRequire(new URL('../../frontend/package.json', import.meta.url));
    const free = require('@fortawesome/free-solid-svg-icons');
    const exportName = (n) => 'fa' + n.split('-').map((s) => s[0].toUpperCase() + s.slice(1)).join('');
    expect(tips.AF_TIP_ICONS.filter((n) => !free[exportName(n)])).toEqual([]);
  });
});
