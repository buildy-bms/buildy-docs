/**
 * Service Worker minimal — Buildy Docs PWA.
 *
 * Stratégie volontairement conservatrice :
 * - N'intercepte PAS les navigations (le navigateur gère normalement
 *   cookies, redirects OIDC, etc — vu que ça avait cassé Safari en v1).
 * - N'intercepte PAS /api/* ni /auth/* (network-only par défaut).
 * - Cache uniquement /assets/* et /icons/* en StaleWhileRevalidate
 *   pour accélérer le second lancement en mode standalone.
 *
 * Le SW est nécessaire pour que iOS Safari déclenche l'eligibilité PWA
 * "Add to Home Screen" en mode standalone propre.
 */

const CACHE_VERSION = 'buildy-docs-v3';
const ASSET_CACHE = `${CACHE_VERSION}-assets`;

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(CACHE_VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // ⚠️ Laisse passer toute navigation / API / auth — le navigateur gère.
  if (req.mode === 'navigate') return;
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) return;

  // Assets statiques uniquement : StaleWhileRevalidate.
  const isStatic = url.pathname.startsWith('/assets/')
                || url.pathname.startsWith('/icons/')
                || /\.(svg|png|jpg|jpeg|webp|woff2|woff)$/.test(url.pathname);
  if (!isStatic) return;

  event.respondWith(
    caches.open(ASSET_CACHE).then((cache) =>
      cache.match(req).then((cached) => {
        const fetched = fetch(req)
          .then((res) => {
            if (res && res.status === 200 && res.type === 'basic') cache.put(req, res.clone());
            return res;
          })
          .catch(() => cached);
        return cached || fetched;
      })
    )
  );
});
