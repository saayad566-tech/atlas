/* Atlas service worker — app-shell caching for offline start.
 *
 * Strategy:
 *   · navigation  → network first, fall back to the cached shell
 *   · static file → cache first, refresh in the background
 *   · /api/*      → network only (financial data must never be served stale)
 */
const VERSION = 'atlas-v1';
const SHELL = [
  './', './index.html', './styles.css', './app.js', './manifest.json',
  './icons/icon-192.png', './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // addAll rejects the whole batch if one file 404s, so add individually.
    await Promise.all(SHELL.map((url) => cache.add(url).catch(() => undefined)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // API calls are never cached — stale prices are worse than no prices.
  if (url.pathname.includes('/api/')) {
    event.respondWith(fetch(req).catch(() => new Response(
      JSON.stringify({ error: 'Offline — the local Atlas server is not reachable.', code: 'OFFLINE' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    )));
    return;
  }

  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try { return await fetch(req); }
      catch { return (await caches.match('./index.html')) || (await caches.match('./')) || Response.error(); }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) {
      fetch(req).then((res) => { if (res.ok) caches.open(VERSION).then((c) => c.put(req, res)); }).catch(() => undefined);
      return cached;
    }
    try { return await fetch(req); }
    catch { return new Response('', { status: 504 }); }
  })());
});
