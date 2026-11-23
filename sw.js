// Missing Numbers service worker.
// 1) Clean-up (launch, Nov 2026): the old main site saved its files on phones for offline use. This deletes
//    those saved files and, if there were any, reloads open pages once so they show the new site.
// 2) Draw alerts (Nov 22, 2026): shows the alerts sent by scripts/send_alerts.py and opens the site when
//    one is tapped. It is only installed when someone turns alerts on (alerts.js). No offline saving.
self.window = self;                       // supabase-config.js sets window.MN_SUPABASE
try { importScripts('supabase-config.js'); } catch (e) {}

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    await self.clients.claim();           // so a tapped alert can bring an open page to the result
    const keys = await caches.keys();
    if (!keys.length) return;
    await Promise.all(keys.map(k => caches.delete(k)));
    const pages = await self.clients.matchAll({ type: 'window' });
    pages.forEach(p => p.navigate(p.url).catch(() => {}));
  })());
});

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { body: e.data && e.data.text() }; }
  const title = d.title || 'Missing Numbers';
  e.waitUntil(self.registration.showNotification(title, {
    body: d.body || 'New results are in.',
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    tag: d.tag || 'mn-draw',
    renotify: true,
    data: { url: d.url || '/?alert=1' }
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || '/?alert=1', self.location.origin).href;
  e.waitUntil((async () => {
    const pages = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const p of pages) {
      if (new URL(p.url).origin === self.location.origin) {
        try { await p.focus(); await p.navigate(url); return; } catch (x) {}
      }
    }
    await self.clients.openWindow(url);
  })());
});

// the phone replaced its push address: subscribe again and move the saved settings to the new one
self.addEventListener('pushsubscriptionchange', e => {
  e.waitUntil((async () => {
    const cfg = self.MN_SUPABASE || {};
    const old = e.oldSubscription;
    const opts = old && old.options;
    if (!old || !opts || !opts.applicationServerKey || !cfg.url) return;
    const s = e.newSubscription || await self.registration.pushManager.subscribe(opts);
    const j = s.toJSON();
    await fetch(String(cfg.url).replace(/\/+$/, '') + '/rest/v1/rpc/push_move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: cfg.key, Authorization: 'Bearer ' + cfg.key },
      body: JSON.stringify({ p_old: old.endpoint, p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth })
    });
  })().catch(() => {}));
});
