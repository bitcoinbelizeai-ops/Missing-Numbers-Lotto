// Clean-up worker (launch, Nov 2026).
// The old main site saved its files on phones for offline use. The new site doesn't use offline saving
// (it shows an "Update now" bar instead), so this version deletes the old saved files, removes itself,
// and reloads any open page once so it shows the new site. Keep this file for a few months after launch
// so every returning phone picks it up; it does nothing for new visitors.
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => caches.delete(k)));
    await self.registration.unregister();
    const pages = await self.clients.matchAll({ type: 'window' });
    pages.forEach(p => p.navigate(p.url).catch(() => {}));
  })());
});
