// Contenus des infobulles hors audit (frontend/src/lib/misc-tips.js : sites, accueil, livres
// blancs, brochures, offres, rapports de maintenance) : règles de rédaction de Kévin (français
// simple, tutoiement, pas d'article du décret dans le texte, pas de « (s) »…) vérifiées sur
// les textes produits par les fonctions, avec des valeurs typiques.
import { describe, it, expect } from 'vitest';
import * as tips from '../../frontend/src/lib/misc-tips.js';
import { normalizeTip } from '../../frontend/src/lib/tooltip-content.js';
import { checkCopy } from '../../frontend/scripts/tooltip-lint.mjs';
import { wantedIconNames } from '../../frontend/scripts/gen-tooltip-icons.mjs';

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
    if (s.label) expect({ name, text: s.text, long: s.text.length > 40 }).toEqual({ name, text: s.text, long: false });
  }
  expect(normalizeTip(value)).not.toBeUndefined();
}

const SITE_UUID = '6f1c2b9e-4a7d-4c1e-9b3a-2d5e8f0a1c34';

describe('misc-tips : dates lisibles', () => {
  it('date SQL et ISO → « 12 oct. 2026 à 10:15 »', () => {
    expect(tips.formatDateTime('2026-10-12 10:15:00')).toMatch(/^12 oct\. 2026 à 10:15$/);
    expect(tips.formatDateTime('2026-10-12T10:15:00')).toMatch(/^12 oct\. 2026 à 10:15$/);
    expect(tips.formatDateTime(null)).toBe('');
    expect(tips.formatDateTime('pas une date')).toBe('');
  });

  it('étiquette datée avec horloge, rien sans date', () => {
    expect(tips.dateLabel('Modifié le', '2026-10-12 10:15:00')).toEqual({ label: 'Modifié le 12 oct. 2026 à 10:15', icon: 'clock' });
    expect(tips.dateLabel('Modifié le', null)).toBeNull();
    expectClean('dateLabel', tips.dateLabel('Livré le', '2026-10-12 10:15:00'));
  });
});

describe('misc-tips : règles de rédaction', () => {
  it('constantes', () => {
    for (const [name, v] of Object.entries(tips)) {
      if (typeof v === 'function' || /ICONS$/.test(name)) continue;
      expectClean(name, v);
    }
  });

  it('sites', () => {
    expectClean('siteSyncTip jamais', tips.siteSyncTip({ synced_at: null }));
    const synced = normalizeTip(tips.siteSyncTip({ synced_at: '2026-10-12T08:15:00.000Z' }));
    expect(synced.tone).toBe('success');
    expect(synced.rows[0].value).toMatch(/oct\. 2026 à/);
    expectClean('siteSyncTip synchronisé', tips.siteSyncTip({ synced_at: '2026-10-12T08:15:00.000Z' }));
    expect(tips.siteSyncTip(null)).toBeNull();
    expectClean('siteIdTip', tips.siteIdTip(SITE_UUID));
    expect(normalizeTip(tips.siteIdTip(SITE_UUID)).rows[0].value).toBe(SITE_UUID);
    expect(tips.siteIdTip('')).toBeNull();
    for (const k of ['af', 'bacs_audit', 'site_audit']) expectClean(`docKindTip ${k}`, tips.docKindTip(k));
    expect(tips.docKindTip('brochure')).toBeNull();
    expect(normalizeTip(tips.ZONE_KIND_TIPS.functional).meta).toBe('Décret BACS · article R175-1 6°');
  });

  it('photos du site', () => {
    const full = {
      title: 'Chaufferie — vue générale',
      taken_at: '2026-09-12 10:15:00',
      uploaded_at: '2026-09-12 18:02:00',
      camera_make: 'Apple',
      camera_model: 'iPhone 15 Pro',
      gps_latitude: 48.85,
    };
    expectClean('sitePhotoTip complète', tips.sitePhotoTip(full));
    const t = normalizeTip(tips.sitePhotoTip(full));
    expect(t.kind).toBe('card');
    expect(t.rows.map((r) => r.label)).toEqual(['Nom', 'Prise le', 'Ajoutée le', 'Appareil', 'Position GPS']);
    expect(normalizeTip(tips.sitePhotoTip({ uploaded_at: '2026-09-12 18:02:00' })).rows.map((r) => r.label)).toEqual(['Ajoutée le']);
    expect(tips.sitePhotoTip(null)).toBeNull();
  });

  it('compte connecté (accueil mobile)', () => {
    expectClean('accountTip', tips.accountTip({ display_name: 'Julien Desmaris', email: 'julien@exemple.fr' }));
    expect(normalizeTip(tips.accountTip({ email: 'julien@exemple.fr' })).rows).toHaveLength(1);
    expect(tips.accountTip({})).toBeNull();
    expect(tips.accountTip(null)).toBeNull();
  });

  it('rapports de maintenance', () => {
    expectClean('maintenanceStatusTip brouillon', tips.maintenanceStatusTip('draft'));
    expectClean('maintenanceStatusTip publié', tips.maintenanceStatusTip('published'));
    expect(normalizeTip(tips.maintenanceStatusTip('draft')).todo.items).toHaveLength(1);
    expect(tips.maintenanceStatusTip('redaction')).toBeNull();
  });
});

describe('misc-tips : icônes', () => {
  it('toutes les icônes citées existent en free-solid (enregistrées par node scripts/gen-tooltip-icons.mjs)', () => {
    const wanted = new Set(wantedIconNames());
    expect(tips.MISC_TIP_ICONS.filter((n) => !wanted.has(n))).toEqual([]);
  });
});
