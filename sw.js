/* Lexora service worker.
   - Pages (navigation): network first, fall back to the saved copy when offline
   - Our own files: stale-while-revalidate (served from cache at once, refreshed in the background)
   - Fonts and the Firebase SDK files: stale-while-revalidate too
   - Firebase data and sign-in traffic is never touched here
   All paths are relative to this file, so it works from a GitHub Pages sub-path such as /Lexora/. */
const VERSION = 'lexora-6d88d6df';
const SHELL_CACHE = VERSION + '-shell';
const RUNTIME_CACHE = 'lexora-runtime-v1';
const SHELL = /*SHELL_START*/["./", "index.html", "manifest.webmanifest", "css/app.css?v=6d88d6df", "js/srs.js?v=6d88d6df", "js/quiz.js?v=6d88d6df", "js/store.js?v=6d88d6df", "js/session.js?v=6d88d6df", "js/sync.js?v=6d88d6df", "js/firebase-config.js?v=6d88d6df", "js/firebase-adapter.js?v=6d88d6df", "js/app.js?v=6d88d6df", "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png", "icons/apple-touch-icon.png"]/*SHELL_END*/;
const CACHEABLE_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'www.gstatic.com'];
const scopeUrl = (p) => new URL(p, self.registration.scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => Promise.all(SHELL.map((p) => cache.add(new Request(scopeUrl(p), { cache: 'reload' })).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('lexora-') && k !== SHELL_CACHE && k !== RUNTIME_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function staleWhileRevalidate(request, cacheName) {
  return caches.open(cacheName).then((cache) =>
    cache.match(request).then((cached) => {
      const network = fetch(request).then((res) => {
        if (res && (res.ok || res.type === 'opaque')) cache.put(request, res.clone());
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
}

function networkFirstPage(request) {
  return fetch(request).then((res) => {
    if (res && res.ok) caches.open(SHELL_CACHE).then((c) => c.put(scopeUrl('index.html'), res.clone()));
    return res;
  }).catch(() =>
    caches.open(SHELL_CACHE).then((c) => c.match(scopeUrl('index.html')).then((m) => m || c.match(scopeUrl('./'))))
      .then((m) => m || new Response('Lexora is offline and not saved yet. Open it once while online.', { status: 503, headers: { 'Content-Type': 'text/plain' } }))
  );
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (req.mode === 'navigate') { event.respondWith(networkFirstPage(req)); return; }
  if (url.origin === self.location.origin) {
    if (url.pathname.endsWith('/sw.js')) return;
    event.respondWith(staleWhileRevalidate(req, SHELL_CACHE));
    return;
  }
  if (CACHEABLE_HOSTS.includes(url.hostname)) event.respondWith(staleWhileRevalidate(req, RUNTIME_CACHE));
});
