/**
 * OpenMLGraph Offline-First Service Worker [NFR-3, AC-06].
 *
 * Strategy:
 * 1. Network-Only for all Firebase/Firestore endpoints (`firestore.googleapis.com`,
 *    `identitytoolkit.googleapis.com`) so real-time Cloud Share & Community Gallery
 *    are never intercepted or broken.
 * 2. Cache-First with background update for static fonts (`.woff2`), WebAssembly (`.wasm`),
 *    scripts (`.js`), styles (`.css`), and `/openmlgraph/` HTML shell so the application
 *    boots in < 1 second when completely offline.
 */
const CACHE_NAME = 'openmlgraph-offline-v3';
const PRECACHE_URLS = ['/openmlgraph/'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith('openmlgraph-') && k !== CACHE_NAME)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Strictly bypass Firebase / Firestore / Google APIs (Network-Only)
  if (
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('firebaseio.com') ||
    url.hostname.includes('gstatic.com')
  ) {
    return;
  }

  const isStaticAsset =
    url.pathname.startsWith('/openmlgraph') ||
    url.pathname.startsWith('/_astro/') ||
    /\.(woff2?|ttf|wasm|js|css|svg|png)$/i.test(url.pathname);

  if (!isStaticAsset) return;

  // Network-First with Offline Cache Fallback:
  // Ensures new deployments (new /_astro/* hashes) always load fresh when online,
  // while falling back seamlessly to cached HTML/CSS/JS/WASM/fonts when offline [AC-06].
  event.respondWith(
    fetch(req)
      .then((netRes) => {
        if (netRes && netRes.status === 200) {
          const clone = netRes.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return netRes;
      })
      .catch(() => caches.match(req))
  );
});
