// File d'attente hors-ligne de la PWA (frontend/src/lib/offline-queue.js) :
// opérations longues jamais mises en file, session expirée sans perte,
// entrées devenues non éligibles retirées sans être rejouées.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  isQueueable, enqueue, listPending, drain, clearAll,
} from '../../frontend/src/lib/offline-queue.js';

// localStorage minimal (le module le lit à chaque appel).
beforeEach(() => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  clearAll();
});

const httpError = (status) => Object.assign(new Error(`HTTP ${status}`), { response: { status, data: {} } });

describe('isQueueable', () => {
  it('met en file les petites écritures de l\'audit', () => {
    expect(isQueueable('patch', '/bacs-audit/devices/12')).toBe(true);
    expect(isQueueable('post', '/bacs-audit/61/meters')).toBe(true);
    expect(isQueueable('post', '/bacs-audit/suggestions/9/apply')).toBe(true);
    expect(isQueueable('delete', '/bacs-audit/inspections/3')).toBe(true);
  });

  it('ne met jamais en file les opérations longues ou à effet unique', () => {
    expect(isQueueable('post', '/bacs-audit/61/deliver')).toBe(false);
    expect(isQueueable('post', '/bacs-audit/61/deliver?force=1')).toBe(false);
    expect(isQueueable('post', '/bacs-audit/61/generate-synthesis')).toBe(false);
    expect(isQueueable('post', '/bacs-audit/action-items/5/generate-alternatives')).toBe(false);
    expect(isQueueable('post', '/bacs-audit/transcripts/3/suggestions')).toBe(false);
    expect(isQueueable('post', '/bacs-audit/61/resync')).toBe(false);
    expect(isQueueable('post', '/afs/4/clone')).toBe(false);
    expect(isQueueable('post', '/afs/4/versions/restore')).toBe(false);
  });

  it('exclut toujours exports, lectures et envois de fichiers', () => {
    expect(isQueueable('post', '/bacs-audit/61/export-pdf')).toBe(false);
    expect(isQueueable('post', '/bacs-audit/61/exports/dossier')).toBe(false);
    expect(isQueueable('get', '/bacs-audit/61/meters')).toBe(false);
    expect(isQueueable('post', '/sites/abc/documents', 'multipart/form-data; boundary=x')).toBe(false);
    expect(isQueueable('post', '/auth/login')).toBe(false);
  });
});

describe('drain', () => {
  it('rejoue dans l\'ordre et vide la file', async () => {
    enqueue({ method: 'patch', url: '/bacs-audit/devices/1', data: { a: 1 } });
    enqueue({ method: 'patch', url: '/bacs-audit/devices/2', data: { a: 2 } });
    const request = vi.fn().mockResolvedValue({ status: 200 });
    const stats = await drain({ request });
    expect(stats).toMatchObject({ replayed: 2, failed: 0, dropped: 0 });
    expect(request.mock.calls.map(c => c[0].url)).toEqual(['/bacs-audit/devices/1', '/bacs-audit/devices/2']);
    expect(listPending()).toHaveLength(0);
  });

  it('session expirée (401) : arrêt sans rien perdre', async () => {
    enqueue({ method: 'patch', url: '/bacs-audit/devices/1' });
    enqueue({ method: 'patch', url: '/bacs-audit/devices/2' });
    const request = vi.fn().mockRejectedValue(httpError(401));
    const stats = await drain({ request });
    expect(request).toHaveBeenCalledTimes(1);
    expect(stats.failed).toBe(0);
    expect(listPending().map(i => i.url)).toEqual(['/bacs-audit/devices/1', '/bacs-audit/devices/2']);
  });

  it('408 et 429 : arrêt sans retrait', async () => {
    for (const status of [408, 429]) {
      clearAll();
      enqueue({ method: 'patch', url: '/bacs-audit/devices/1' });
      const stats = await drain({ request: vi.fn().mockRejectedValue(httpError(status)) });
      expect(stats.failed).toBe(0);
      expect(listPending()).toHaveLength(1);
    }
  });

  it('refus de validation (400) : retrait de la mutation, la suite continue', async () => {
    enqueue({ method: 'patch', url: '/bacs-audit/devices/1' });
    enqueue({ method: 'patch', url: '/bacs-audit/devices/2' });
    const onMutationFailed = vi.fn();
    const request = vi.fn()
      .mockRejectedValueOnce(httpError(400))
      .mockResolvedValueOnce({ status: 200 });
    const stats = await drain({ request }, { onMutationFailed });
    expect(stats).toMatchObject({ replayed: 1, failed: 1 });
    expect(onMutationFailed).toHaveBeenCalledTimes(1);
    expect(listPending()).toHaveLength(0);
  });

  it('erreur réseau : arrêt, la file est gardée', async () => {
    enqueue({ method: 'patch', url: '/bacs-audit/devices/1' });
    const stats = await drain({ request: vi.fn().mockRejectedValue(new Error('Network Error')) });
    expect(stats.skipped).toBe(1);
    expect(listPending()).toHaveLength(1);
  });

  it('retire sans les rejouer les livraisons et générations coincées dans la file', async () => {
    // Entrées mises en file par une version précédente de l'appli.
    enqueue({ method: 'post', url: '/bacs-audit/61/generate-synthesis' });
    enqueue({ method: 'post', url: '/bacs-audit/61/deliver' });
    enqueue({ method: 'patch', url: '/bacs-audit/devices/2' });
    const request = vi.fn().mockResolvedValue({ status: 200 });
    const stats = await drain({ request });
    expect(stats).toMatchObject({ replayed: 1, dropped: 2 });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0].url).toBe('/bacs-audit/devices/2');
    expect(listPending()).toHaveLength(0);
  });
});
