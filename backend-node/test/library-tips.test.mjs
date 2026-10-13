// Contenus des infobulles de la bibliothèque (frontend/src/lib/library-tips.js) : règles de
// rédaction de Kévin (français simple, tutoiement, pas d'article du décret dans le texte, pas
// de « (s) », pas d'anglais…) vérifiées sur TOUS les textes produits par les fonctions, avec
// des valeurs typiques. Les constantes sont aussi couvertes par tooltip-copy-modules.test.mjs.
import { describe, it, expect } from 'vitest';
import * as tips from '../../frontend/src/lib/library-tips.js';
import { normalizeTip } from '../../frontend/src/lib/tooltip-content.js';
import { checkCopy } from '../../frontend/scripts/tooltip-lint.mjs';

const SKIP = new Set(['meta', 'article', 'icon', 'tone', 'accent', 'placement', 'keys', 'layout', 'variant']);

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

const WHEN = '2026-10-12 08:15:00';

describe('library-tips : règles de rédaction', () => {
  it('constantes', () => {
    for (const [name, v] of Object.entries(tips)) {
      if (typeof v === 'function' || /ICONS$/.test(name)) continue;
      expectClean(name, v);
    }
  });

  it('statut de validation, captures, utilisation dans les AF', () => {
    expectClean('validationTip validé', tips.validationTip('validated', { validatedAt: WHEN, validatedBy: 'Julien Desmaris' }));
    expectClean('validationTip brouillon', tips.validationTip('draft'));
    expectClean('validationTip vide', tips.validationTip('empty'));
    for (const n of [0, 1, 4]) {
      expectClean(`photosTip ${n}`, tips.photosTip(n));
      expectClean(`equipmentUsageTip ${n}`, tips.equipmentUsageTip(n));
      expectClean(`equipmentDeleteTip ${n}`, tips.equipmentDeleteTip(n));
      expectClean(`afOutdatedTip ${n}`, tips.afOutdatedTip(n || 1));
    }
    expectClean('fullWidthTip oui', tips.fullWidthTip(true));
    expectClean('fullWidthTip non', tips.fullWidthTip(false));
    for (const noun of ['section', 'fonctionnalité']) {
      expectClean('afColumnTip', tips.afColumnTip(noun));
      expectClean('bacsColumnTip', tips.bacsColumnTip(noun));
      expectClean('sectionUsageTip vide', tips.sectionUsageTip({ count: 0, noun }));
      expectClean('sectionUsageTip à jour', tips.sectionUsageTip({ count: 3, noun }));
      expectClean('sectionUsageTip en retard', tips.sectionUsageTip({ count: 3, outdated: 1, noun }));
      expectClean('sectionUsageTip en retard (2)', tips.sectionUsageTip({ count: 3, outdated: 2, noun }));
    }
  });

  it('versions, ordre, régénération', () => {
    expectClean('versionTip', tips.versionTip(4));
    expectClean('afSectionVersionTip à jour', tips.afSectionVersionTip(4, 4));
    expectClean('afSectionVersionTip en retard', tips.afSectionVersionTip(2, 4));
    expectClean('dragTip actif', tips.dragTip(true));
    for (const b of ['search', 'filter', 'sort']) expectClean(`dragTip ${b}`, tips.dragTip(false, b));
    for (const what of ['sections', 'functionalities', 'equipment']) {
      for (const n of [0, 1, 12]) expectClean(`regenerateTip ${what} ${n}`, tips.regenerateTip(n, what));
    }
    expectClean('regenerateStatusTip en cours', tips.regenerateStatusTip('running'));
    expectClean('regenerateStatusTip ok', tips.regenerateStatusTip('ok'));
    expectClean('regenerateStatusTip échec', tips.regenerateStatusTip('fail', 'Réponse vide.'));
  });

  it('décret, documents, couleurs, protocoles, points', () => {
    expectClean('bacsReferenceTip', tips.bacsReferenceTip('R175-3 1°, 2° ; R175-6'));
    expectClean('bacsReferenceTip historique', tips.bacsReferenceTip('R175-1 §1, §2 ; R175-5-1'));
    for (const code of ['R175-1', 'R175-2', 'R175-3', 'R175-4', 'R175-5', 'R175-5-1', 'R175-6']) {
      expectClean(`bacsArticleTip ${code}`, tips.bacsArticleTip(code, 'Titre officiel'));
    }
    for (const kind of ['af', 'brochure', 'bacs_audit']) expectClean(`documentKindTip ${kind}`, tips.documentKindTip(kind));
    expectClean('documentKindTip inconnu', tips.documentKindTip('autre', { label: 'Autre document', description: 'Document maison.' }));
    for (const hex of ['#3b82f6', '#0ea5e9', '#dc2626', '#123456']) expectClean(`colorLabel ${hex}`, tips.colorLabel(hex));
    expectClean('iconChoiceLabel', tips.iconChoiceLabel('temperature-arrow-up'));
    expectClean('moreProtocolsTip 1', tips.moreProtocolsTip(['KNX/IP']));
    expectClean('moreProtocolsTip 3', tips.moreProtocolsTip(['KNX/IP', 'M-Bus IP', 'LoRaWAN']));
    expectClean('pointsSelectAllTip', tips.pointsSelectAllTip(true));
    expectClean('pointsSelectAllTip', tips.pointsSelectAllTip(false));
  });

  it('offres, FAQ, publication, éditeurs', () => {
    for (const lvl of ['avail_e', 'avail_s', 'avail_p', 'E', 'S', 'P']) {
      expectClean(`offerColumnTip ${lvl}`, tips.offerColumnTip(lvl));
      for (const v of ['included', 'paid_option', null]) expectClean(`availTip ${lvl} ${v}`, tips.availTip(v, lvl));
    }
    for (const kind of ['locked', 'none', 'diverged', 'synced']) {
      expectClean(`faqStatusTip ${kind}`, tips.faqStatusTip(kind, { status: 'draft', source_synced_at: WHEN }));
      expectClean(`faqStatusTip ${kind} publié`, tips.faqStatusTip(kind, { status: 'published', source_synced_at: WHEN }));
    }
    for (const what of ['catalog', 'brochure']) {
      expectClean(`publishTip ${what}`, tips.publishTip(what, null));
      expectClean(`publishTip ${what} publié`, tips.publishTip(what, { published_at: WHEN }));
    }
    for (const noun of ['nom', 'titre']) {
      expectClean('suggestTitleTip', tips.suggestTitleTip({ noun }));
      expectClean('suggestTitleTip vide', tips.suggestTitleTip({ empty: true, noun }));
      expectClean('suggestTitleTip en cours', tips.suggestTitleTip({ busy: true, noun }));
    }
    for (const what of ['contenu', 'description']) {
      expectClean('validateBlockedTip vide', tips.validateBlockedTip({ canValidate: false, what }));
      expectClean('validateBlockedTip en cours', tips.validateBlockedTip({ busy: true, what }));
    }
    expectClean('saveTip manquant', tips.saveTip({ missing: 'un nom' }));
    expectClean('saveTip étiquette', tips.saveTip({ label: 'Enregistrer sans fermer' }));
  });
});

describe('library-tips : contenus', () => {
  it('dates lisibles (horodatage SQLite en UTC)', () => {
    expect(tips.formatDay(WHEN)).toMatch(/^\d{1,2} \S+ 2026$/);
    expect(tips.formatWhen(WHEN)).toMatch(/^\d{1,2} \S+ 2026 à \d{2}:\d{2}$/);
    expect(tips.formatDay(null)).toBe('');
    expect(tips.formatDay('pas une date')).toBe('');
  });

  it('pastille du décret : alinéas en clair, article en pied', () => {
    expect(tips.parseBacsReference('R175-1 §1, §2 ; R175-3 4° ; R175-5-1')).toEqual([
      { code: 'R175-1', points: ['1°', '2°'] },
      { code: 'R175-3', points: ['4°'] },
      { code: 'R175-5-1', points: [] },
    ]);
    const t = normalizeTip(tips.bacsReferenceTip('R175-3 1°, 2° ; R175-6'));
    expect(t.kind).toBe('card');
    expect(t.blocks[0].type).toBe('list');
    expect(t.blocks[0].items).toEqual(['Suivre les consommations', 'Repérer les dérives', 'Réguler la température pièce par pièce']);
    expect(t.meta).toMatch(/Décret BACS · article R175-3/);
    expect(tips.bacsReferenceTip('')).toBeNull();
  });

  it('validation : date et auteur en lignes', () => {
    const t = normalizeTip(tips.validationTip('validated', { validatedAt: WHEN, validatedBy: 'Julien Desmaris' }));
    expect(t.tone).toBe('success');
    expect(t.rows.map((r) => r.label)).toEqual(['Validé le', 'Par']);
    expect(t.rows[1].value).toBe('Julien Desmaris');
  });

  it('boutons grisés : raison seulement quand c’est grisé', () => {
    expect(tips.regenerateTip(0, 'sections').title).toBe('Rien à régénérer');
    expect(tips.regenerateTip(3, 'sections').label).toMatch(/3 textes/);
    expect(tips.equipmentDeleteTip(0)).toBe('Supprimer ce modèle d’équipement');
    expect(tips.equipmentDeleteTip(2).text).toMatch(/2 sections d’analyse fonctionnelle/);
    expect(tips.validateBlockedTip({ canValidate: true })).toBeNull();
    expect(tips.saveTip({ busy: true, missing: 'un nom' })).toBeNull();
    expect(tips.saveTip({})).toBeNull();
  });

  it('FAQ « Confidentiel » : cite la vraie case à cocher de la fiche', () => {
    expect(tips.faqStatusTip('locked').todo).toMatch(/Autoriser la publication d’un article FAQ/);
  });
});
