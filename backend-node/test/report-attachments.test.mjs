// Annexe « Documents joints » du rapport d'audit : sélection des documents
// cochés « Inclure dans le rapport », libellés et renvois aux chapitres.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { buildReportAttachments, sizeLabel, formatLabel } = require('../src/routes/bacs-audit/_report-attachments');

const ctx = {
  documentId: 61,
  zonesById: new Map([[10, { label: 'Plot Bureaux' }]]),
  systemsById: new Map([[20, { label: 'Chauffage · Plot Bureaux' }]]),
  devicesById: new Map([[30, { label: 'Chaudière gaz' }]]),
  metersById: new Map([[40, { label: 'Électrique · Général bâtiment' }]]),
  actionsById: new Map([[50, { label: 'BACS-004' }]]),
  chapters: { zones: 2, systems: 3, meters: 4, bms: 6 },
};
const doc = (over) => ({
  id: 1, title: 'Document', category: 'autre', mime_type: 'application/pdf',
  media_type: 'photo', size_bytes: 1024, include_in_report: 1,
  uploaded_at: '2026-04-17 10:00:00', ...over,
});

describe('buildReportAttachments', () => {
  it('ne retient que les documents cochés (décochés par défaut)', () => {
    const out = buildReportAttachments([
      doc({ id: 1, include_in_report: 0 }),
      doc({ id: 2 }),
      doc({ id: 3, include_in_report: null }),
    ], ctx);
    expect(out.map(a => a.id)).toEqual([2]);
    expect(out[0].ref).toBe('PJ 1');
  });

  it('classe les documents de référence avant les photos, puis par date', () => {
    const out = buildReportAttachments([
      doc({ id: 1, category: 'photo', mime_type: 'image/jpeg', uploaded_at: '2026-01-01' }),
      doc({ id: 2, category: 'schema_electrique', uploaded_at: '2026-03-01' }),
      doc({ id: 3, category: 'plan', uploaded_at: '2026-02-01' }),
      doc({ id: 4, category: 'schema_electrique', uploaded_at: '2026-02-15' }),
    ], ctx);
    expect(out.map(a => a.id)).toEqual([3, 4, 2, 1]);
    expect(out.map(a => a.ref)).toEqual(['PJ 1', 'PJ 2', 'PJ 3', 'PJ 4']);
  });

  it("libelle l'élément rattaché et renvoie au chapitre d'une photo déjà imprimée", () => {
    const [devicePhoto, sitePhoto, actionPhoto] = buildReportAttachments([
      doc({ id: 1, category: 'photo', mime_type: 'image/jpeg', bacs_audit_device_id: 30 }),
      doc({ id: 2, category: 'photo', mime_type: 'image/jpeg', uploaded_at: '2026-05-01' }),
      doc({ id: 3, category: 'photo', mime_type: 'image/jpeg', bacs_audit_action_item_id: 50, uploaded_at: '2026-06-01' }),
    ], ctx);
    expect(devicePhoto.attachedTo).toBe('Équipement : Chaudière gaz');
    expect(devicePhoto.shownInChapter).toBe(3);
    expect(devicePhoto.needsThumbnail).toBe(false);
    expect(sitePhoto.attachedTo).toBe('Site');
    expect(sitePhoto.needsThumbnail).toBe(true);
    expect(actionPhoto.attachedTo).toBe('Action BACS-004');
    expect(actionPhoto.needsThumbnail).toBe(true);
  });

  it("reproduit une image classée hors « Photo » même rattachée à un élément", () => {
    const [plan] = buildReportAttachments([
      doc({ id: 1, category: 'plan', mime_type: 'image/jpeg', bacs_audit_device_id: 30 }),
    ], ctx);
    expect(plan.shownInChapter).toBe(null);
    expect(plan.needsThumbnail).toBe(true);
    expect(plan.typeLabel).toBe('Plan');
  });

  it('retombe sur « Site » quand l’élément rattaché n’appartient pas à cet audit', () => {
    const [d] = buildReportAttachments([doc({ bacs_audit_system_id: 999 })], ctx);
    expect(d.attachedTo).toBe('Site');
  });

  it('présente une note vocale avec sa transcription', () => {
    const [n] = buildReportAttachments([
      doc({ media_type: 'audio', mime_type: 'audio/mpeg', transcript_text: '  Chaudière à remplacer.  ', bacs_audit_zone_id: 10 }),
    ], ctx);
    expect(n.typeLabel).toBe('Note vocale');
    expect(n.formatLabel).toBe('Audio');
    expect(n.transcript).toBe('Chaudière à remplacer.');
    expect(n.attachedTo).toBe('Zone : Plot Bureaux');
    expect(n.needsThumbnail).toBe(false);
  });
});

describe('libellés', () => {
  it('taille en Ko / Mo à la française', () => {
    expect(sizeLabel(0)).toBe('');
    expect(sizeLabel(141 * 1024)).toBe('141 Ko');
    expect(sizeLabel(1.44 * 1024 * 1024)).toBe('1,4 Mo');
  });
  it('format déduit du type MIME ou de l’extension', () => {
    expect(formatLabel({ mime_type: 'application/pdf' })).toBe('PDF');
    expect(formatLabel({ mime_type: 'text/csv', original_name: 'export.csv' })).toBe('Tableur');
    expect(formatLabel({ mime_type: 'application/octet-stream', original_name: 'plan.dwg' })).toBe('Plan DWG');
    expect(formatLabel({ mime_type: 'image/png' })).toBe('Image');
  });
});

describe('rattachement à la check-list', () => {
  it('cite le point de check-list quand il est connu', () => {
    const withChecklist = { ...ctx, checklistById: new Map([[70, { label: "Synoptique d'architecture GTB" }]]) };
    const [a, b] = buildReportAttachments([
      doc({ id: 1, bacs_audit_checklist_id: 70 }),
      doc({ id: 2, bacs_audit_checklist_id: 71, uploaded_at: '2026-05-01' }),
    ], withChecklist);
    expect(a.attachedTo).toBe("Check-list : Synoptique d'architecture GTB");
    expect(b.attachedTo).toBe('Check-list de visite');
  });
});
