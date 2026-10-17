// Offline shell. Bump VERSION whenever files change so installed copies refresh.
const VERSION = 'vt-v2';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'css/app.css', 'js/core.js', 'js/xlsx.js', 'js/db.js', 'js/updater.js', 'js/app.js',
  'vendor/exceljs.min.js', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request; const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  // Network first (fresh code when online), cache when offline or slow.
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    try {
      const r = await Promise.race([fetch(req), new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), 3500))]);
      if (r && r.ok) cache.put(req, r.clone());
      return r;
    } catch (err) {
      return (await cache.match(req, { ignoreSearch: true })) || (req.mode === 'navigate' ? await cache.match('index.html') : Response.error());
    }
  })());
});
