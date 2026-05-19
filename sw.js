const CACHE_NAME = 'flyer-map-v3';

function getBaseUrl() {
  return self.location.pathname.replace(/\/sw\.js$/, '');
}

self.addEventListener('install', event => {
  const base = getBaseUrl();
  const assets = [
    `${base}/`,
    `${base}/index.html`,
    `${base}/css/style.css`,
    `${base}/js/app.js`,
    `${base}/manifest.json`,
    `${base}/icons/icon-192.png`,
    `${base}/icons/icon-512.png`,
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
  ];
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(assets))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(cached => {
      return cached || fetch(event.request).then(response => {
        if (event.request.method === 'GET') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      });
    }).catch(() => {
      if (event.request.destination === 'document') {
        const base = getBaseUrl();
        return caches.match(`${base}/index.html`);
      }
    })
  );
});
