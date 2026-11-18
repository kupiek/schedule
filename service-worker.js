const VERSION = 'iek-shell-v3';
const DATA_CACHE = 'iek-data-v1';
const APP_ASSETS = [
  './', './index.html', './styles.css', './app.js', './data-model.mjs',
  './manifest.webmanifest', './assets/icon.svg',
  './assets/icon-192.png', './assets/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(VERSION).then(cache => cache.addAll(APP_ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => ![VERSION, DATA_CACHE].includes(key)).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('/data/schedule.json')) {
    event.respondWith((async () => {
      const cache = await caches.open(DATA_CACHE);
      try {
        const network = await fetch(event.request);
        if (!network.ok) throw new Error(`HTTP ${network.status}`);
        await cache.put('./data/schedule.json', network.clone());
        return network;
      } catch (error) {
        const saved = await cache.match('./data/schedule.json');
        if (saved) return saved;
        throw error;
      }
    })());
    return;
  }
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match('./index.html')));
    return;
  }
  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    try {
      const network = await fetch(event.request);
      if (network.ok) await cache.put(event.request, network.clone());
      return network;
    } catch (error) {
      const saved = await cache.match(event.request);
      if (saved) return saved;
      throw error;
    }
  })());
});
