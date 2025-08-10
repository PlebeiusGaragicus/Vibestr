/* Vibestr Service Worker */
const CACHE = 'vibestr-v12'; // BUILD NUMBER TO INCREMENT FOR CACHE-BUSTING
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icons/icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(ASSETS);
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Optionally clean old caches in future versions
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  if (req.mode === 'navigate') {
    // SPA-style navigate fallback
    event.respondWith((async () => {
      try { return await fetch(req); } catch { return await caches.match('./index.html'); }
    })());
    return;
  }

  if (sameOrigin) {
    // Cache-first for same-origin assets
    event.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      try {
        const res = await fetch(req);
        const cache = await caches.open(CACHE);
        cache.put(req, res.clone());
        return res;
      } catch (err) {
        return cached || Response.error();
      }
    })());
  }
  // Let cross-origin (e.g., nostr-tools, relays via WS) pass-through
});
