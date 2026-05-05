/**
 * Service Worker — KILL SWITCH (2026-05-05).
 *
 * Le SW v1/v2 a causé des problèmes de connexion sur Safari iOS. On
 * désactive temporairement la PWA. Ce SW se contente de se désinscrire
 * et de purger ses caches, dès qu'il est chargé.
 *
 * Pour réactiver : remettre le code original (cf. git history) ET le
 * register dans main.js.
 */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      // Purge tous les caches
      caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))),
      // Auto-désinscription
      self.registration.unregister(),
    ]).then(() => self.clients.claim())
  );
});

// Aucun fetch handler : tous les requests passent au navigateur normalement.
