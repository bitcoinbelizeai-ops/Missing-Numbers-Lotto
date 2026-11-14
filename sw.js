// Offline support. Bump VERSION whenever you change index.html, app.css or app.js.
const VERSION = 'boledo-v30';
const CORE = ['./', 'index.html', 'app.css', 'app.js', 'draws.json', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Results file: try the network first so new results show up, fall back to the saved copy.
  if (url.pathname.endsWith('/draws.json')) {
    e.respondWith(fetch(req).then(r => {
      const copy = r.clone(); caches.open(VERSION).then(c => c.put('draws.json', copy)); return r;
    }).catch(() => caches.match('draws.json')));
    return;
  }

  // Everything else (app files and Google Fonts): saved copy first, then network.
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => {
    if (r.ok && (url.origin === location.origin || url.hostname.endsWith('gstatic.com') || url.hostname.endsWith('googleapis.com'))) {
      const copy = r.clone(); caches.open(VERSION).then(c => c.put(req, copy));
    }
    return r;
  }).catch(() => req.mode === 'navigate' ? caches.match('index.html') : undefined)));
});
