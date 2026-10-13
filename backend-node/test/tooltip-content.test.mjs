// Contenu des infobulles (frontend/src/lib/tooltip-content.js) : normalisation étiquette /
// carte, tons, accents métier, pied « article du décret », icône d'après le premier mot, et
// enregistrement de TOUTES les icônes affichables (lib/tooltip-icons.js).
import { describe, it, expect } from 'vitest';
import {
  normalizeTip,
  resolveTone,
  TIP_TONES,
  ACCENTS,
  parseText,
  rowLayout,
  formatKeys,
  ariaKeys,
  plural,
  labelVariant,
  labelIcon,
  articleMeta,
  typo,
  tipAccessibleName,
  tooltipIconNames,
} from '../../frontend/src/lib/tooltip-content.js';
import { TOOLTIP_ICON_NAMES } from '../../frontend/src/lib/tooltip-icons.js';
import { decreePlain, normalizeArticle, DECREE_PLAIN } from '../../frontend/src/lib/decree-plain.js';
import { checkCopy } from '../../frontend/scripts/tooltip-lint.mjs';

describe('normalizeTip', () => {
  it('valeurs vides : pas de bulle', () => {
    for (const v of [null, undefined, false, '', '   ', () => null, { label: '' }]) expect(normalizeTip(v)).toBe(null);
  });

  it('chaîne et { text, placement } (ancienne syntaxe) → étiquette', () => {
    expect(normalizeTip('Supprimer ce compteur')).toMatchObject({ kind: 'label', label: 'Supprimer ce compteur' });
    expect(normalizeTip({ text: 'Gras', placement: 'bottom' })).toMatchObject({ kind: 'label', label: 'Gras', placement: 'bottom' });
    expect(normalizeTip({ label: 'Gras', keys: ['Mod', 'B'] }).keys).toEqual(['Mod', 'B']);
  });

  it('carte : ton, icône par défaut, lignes, À faire, liste', () => {
    const c = normalizeTip({
      title: 'Compteur absent',
      tone: 'red',
      text: 'Il manque.\n• Électricité\n• Gaz',
      rows: [{ label: 'Zone', value: 'Bureaux' }, { label: '', value: null }],
      todo: 'Ajoute-le',
    });
    expect(c.kind).toBe('card');
    expect(c.tone).toBe('error');
    expect(c.icon).toBe('circle-exclamation');
    expect(c.blocks).toEqual([{ type: 'p', text: 'Il manque.' }, { type: 'list', items: ['Électricité', 'Gaz'] }]);
    expect(c.rows).toHaveLength(1);
    expect(c.todo).toEqual({ title: 'À faire', items: ['Ajoute-le'] });
  });

  it('accent métier : icône et couleur de la catégorie', () => {
    const c = normalizeTip({ title: 'Chauffage', accent: 'heating' });
    expect(c.accent).toBe('heating');
    expect(c.icon).toBe('fire');
    const row = normalizeTip({ title: 'x', rows: [{ label: 'Électricité', value: '1', accent: 'electric' }] }).rows[0];
    expect(row.icon).toBe('bolt');
    expect(row.iconClass).toBe(ACCENTS.electric.rowIcon);
  });

  it('article du décret en pied discret', () => {
    expect(normalizeTip({ title: 'Compteur requis', article: 'R175-3' }).meta).toBe('Décret BACS · article R175-3');
    expect(normalizeTip({ title: 'x', meta: 'Source : audit', article: 'R175-6' }).meta).toBe('Source\u00a0: audit · Décret BACS · article R175-6');
    expect(articleMeta('')).toBe('');
  });

  it('fonction évaluée au survol', () => {
    let n = 0;
    expect(normalizeTip(() => `Valeur ${++n}`).label).toBe('Valeur 1');
  });

  it('nom accessible : étiquette ou titre', () => {
    expect(tipAccessibleName('Fermer')).toBe('Fermer');
    expect(tipAccessibleName({ title: 'Hors service' })).toBe('Hors service');
  });
});

describe('typographie française', () => {
  it('espaces insécables : guillemets, deux-points, unités', () => {
    expect(typo('la question « Intégré à la GTB » : oui')).toBe('la question «\u00a0Intégré à la GTB\u00a0»\u00a0: oui');
    expect(typo('Puissance 290 kW, part 5 %')).toBe('Puissance 290\u00a0kW, part 5\u00a0%');
    expect(typo('Enregistré à 08:15')).toBe('Enregistré à 08:15');
    expect(typo("L'audit n'est pas prêt")).toBe('L’audit n’est pas prêt');
    expect(normalizeTip({ title: 'x', text: 'Réponds « Oui »' }).blocks[0].text).toBe('Réponds «\u00a0Oui\u00a0»');
  });
});

describe('tons et formats', () => {
  it('alias de pastilles (danger, rose, muted…)', () => {
    expect(resolveTone('danger')).toBe('error');
    expect(resolveTone('emerald')).toBe('success');
    expect(resolveTone('muted')).toBe('neutral');
    expect(resolveTone('inconnu')).toBe('info');
    for (const t of Object.values(TIP_TONES)) expect(Object.keys(t).sort()).toEqual(['bar', 'chip', 'rowIcon', 'todo']);
  });

  it('listes à puces et lignes courtes / longues', () => {
    expect(parseText(['- a', '- b'])).toEqual([{ type: 'list', items: ['a', 'b'] }]);
    expect(rowLayout({ label: 'Zone', value: 'Bureaux' })).toBe('inline');
    expect(rowLayout({ label: 'Équipements mesurés', value: 'Chaudière gaz, pompe à chaleur air/eau' })).toBe('stacked');
  });

  it('touches : Mac et PC, et aria-keyshortcuts', () => {
    expect(formatKeys(['Mod', 'b'], true)).toEqual(['⌘', 'B']);
    expect(formatKeys(['Mod', 'Shift', 'h'], false)).toEqual(['Ctrl', 'Maj', 'H']);
    expect(ariaKeys(['Mod', 'B'], true)).toBe('Meta+B');
    expect(ariaKeys(['Mod', 'B'], false)).toBe('Control+B');
  });

  it('pluriel sans « (s) »', () => {
    expect(plural(1, 'compteur', 'compteurs')).toBe('1 compteur');
    expect(plural(0, 'compteur', 'compteurs')).toBe('0 compteur');
    expect(plural(3, 'compteur', 'compteurs')).toBe('3 compteurs');
  });
});

describe('icône d’une étiquette', () => {
  it('d’après le premier mot, accents et ponctuation ignorés', () => {
    expect(labelIcon('Supprimer ce compteur')).toEqual({ icon: 'trash', tone: 'danger' });
    expect(labelIcon('Aperçu du rapport')).toEqual({ icon: 'eye', tone: 'default' });
    expect(labelIcon('Régénérer avec Claude')).toEqual({ icon: 'wand-magic-sparkles', tone: 'default' });
    expect(labelIcon('Tout replier')).toEqual({ icon: 'chevron-up', tone: 'default' });
    expect(labelIcon('Gras')).toEqual({ icon: 'bold', tone: 'default' });
  });

  it('les deux premiers mots passent avant le premier seul', () => {
    expect(labelIcon('Eau chaude sanitaire')).toEqual({ icon: 'faucet', tone: 'default' });
    expect(labelIcon('Eau')).toEqual({ icon: 'droplet', tone: 'default' });
    expect(labelIcon('Proposer un meilleur nom avec Claude')).toEqual({ icon: 'wand-magic-sparkles', tone: 'default' });
    expect(labelIcon('Tout eau chaude')).toEqual({ icon: 'faucet', tone: 'default' });
  });

  it('information : horloge pour une date, ⓘ sinon ; action inconnue : aucune', () => {
    expect(labelIcon('Enregistré le 12/10 à 08:15', 'info').icon).toBe('check');
    expect(labelIcon('Dernière sauvegarde à 08:15', 'info')).toEqual({ icon: 'clock', tone: 'info' });
    expect(labelIcon('Bureaux du 2e étage', 'info')).toEqual({ icon: 'circle-info', tone: 'info' });
    expect(labelIcon('Bureaux du 2e étage', 'action')).toBe(null);
  });

  it('style d’étiquette : action ou information', () => {
    expect(labelVariant({ tag: 'BUTTON' })).toBe('action');
    expect(labelVariant({ tag: 'SPAN' })).toBe('info');
    expect(labelVariant({ tag: 'SPAN', clickable: true })).toBe('action');
    expect(labelVariant({ tag: 'BUTTON', disabled: true })).toBe('info');
  });

  it('toutes les icônes affichables sont enregistrées', () => {
    const missing = [...tooltipIconNames()].filter((n) => !TOOLTIP_ICON_NAMES.has(n));
    expect(missing).toEqual([]);
  });
});

describe('décret en clair', () => {
  it('alinéa connu, alinéa inconnu (article parent), notation §', () => {
    expect(decreePlain('R175-3 1°').title).toBe('Suivre les consommations');
    expect(decreePlain('R175-3 9°')).toBe(DECREE_PLAIN['R175-3']);
    expect(normalizeArticle('R175-1 §4')).toBe('R175-1 4°');
    expect(decreePlain('R175-1 §6').title).toBe('La zone fonctionnelle');
    expect(decreePlain('')).toBe(null);
  });

  it('les phrases « en clair » respectent les règles de rédaction', () => {
    for (const [code, v] of Object.entries(DECREE_PLAIN)) {
      expect({ code, problems: checkCopy(v.text) }).toEqual({ code, problems: [] });
      expect({ code, problems: checkCopy(v.title, { label: true }) }).toEqual({ code, problems: [] });
    }
  });
});

describe('règles de rédaction (checkCopy)', () => {
  it('signale (s), Cliquer pour, vous, article, anglais, ...', () => {
    expect(checkCopy('2 compteur(s)')).toHaveLength(1);
    expect(checkCopy('Cliquer pour renommer')).toHaveLength(1);
    expect(checkCopy('Répondez d’abord')).toEqual(['vouvoiement → tutoiement']);
    expect(checkCopy('Exigence R175-3 1°')[0]).toMatch(/article du décret/);
    expect(checkCopy('Fige le snapshot Git')[0]).toMatch(/anglais/);
    expect(checkCopy('Chargement...')).toEqual(['« ... » → « … »']);
    expect(checkCopy('Ligne 1\nLigne 2', { label: true })[0]).toMatch(/retour à la ligne/);
  });

  it('un titre cité entre « » garde son vouvoiement, pas le texte autour', () => {
    expect(checkCopy('• « Contrôle à distance de vos équipements depuis Hyperveez »')).toEqual([]);
    expect(checkCopy('Ouvre « Pilotez votre site » pour le relire.')).toEqual([]);
    expect(checkCopy('Ouvrez « Pilotage » pour le relire.')).toEqual(['vouvoiement → tutoiement']);
    expect(checkCopy('Contrôle de vos équipements')).toEqual(['vouvoiement → tutoiement']);
  });

  it('laisse passer un texte simple au tutoiement', () => {
    expect(checkCopy('Réponds d’abord à la question « Communicant ».')).toEqual([]);
    expect(checkCopy('Supprimer ce compteur', { label: true })).toEqual([]);
  });
});
