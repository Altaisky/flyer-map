const CACHE_NAME = 'flyer-map-v42';
const TILE_CACHE = 'flyer-map-tiles-v1';

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
      Promise.all(keys.filter(k => k !== CACHE_NAME && k !== TILE_CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  if (url.hostname.endsWith('tile.openstreetmap.org')) {
    event.respondWith(
      caches.open(TILE_CACHE).then(cache =>
        cache.match(event.request).then(cached => {
          if (cached) return cached;
          return fetch(event.request).then(response => {
            if (response.ok) {
              cache.put(event.request, response.clone());
            }
            return response;
          }).catch(() => cached);
        })
      )
    );
    return;
  }

  const isDocument = event.request.destination === 'document';

  if (isDocument) {
    event.respondWith(
      fetch(event.request).then(response => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return response;
      }).catch(() => {
        return caches.match(event.request).then(cached => {
          if (cached) return cached;
          const base = getBaseUrl();
          return caches.match(`${base}/index.html`);
        });
      })
    );
    return;
  }

  if (url.hostname === 'unpkg.com') {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        });
      })
    );
    return;
  }

  event.respondWith(
    fetch(event.request).then(response => {
      const clone = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
      return response;
    }).catch(() => caches.match(event.request))
  );
});

self.addEventListener('message', event => {
  if (event.data && event.data.action === 'preloadTiles') {
    const tiles = event.data.tiles || [];
    event.waitUntil(
      caches.open(TILE_CACHE).then(cache =>
        Promise.all(
          tiles.map(url =>
            cache.match(url).then(cached => {
              if (cached) return cached;
              return fetch(url).then(response => {
                if (response.ok) cache.put(url, response.clone());
                return response;
              }).catch(() => null);
            })
          )
        )
      )
    );
  }
});
