// ============================================================================
// SCADLite service worker — versioned, atomic, cache-first.
// Update model: bump CACHE_NAME on every release deploy. The new worker
// precaches the full asset list into a fresh cache while the old version
// keeps serving; it takes over on the next launch (no skipWaiting), so a
// running session never sees a mix of old and new files. Old caches are
// deleted on activate.
// ============================================================================
const CACHE_NAME = 'scadlite-v334';   // <-- bump this with every deploy
const ASSETS_TO_CACHE = [
  // Base HTML and Manifest
  './',
  './index.html',
  './app.js',
  './manifest.json',
  './favicon.ico',

  // PWA icons (make sure these exist in your root folder!)
  './icon-192.png',
  './icon-512.png',
  // custom buttons
  './images/axes_btn.png',
  './images/ellipsis_btn.png',
  './images/grid_btn.png',
  './images/ortho_btn.png',
  './images/reset_btn.png',
  './images/wireframe_btn.png',
  // local libraries
  './libs/three.min.js',
  './libs/3MFLoader.js',
  './libs/fflate.js',
  './libs/OrbitControls.js',
  './libs/STLExporter.js',
  './libs/openscad.js',
  './libs/openscad.wasm',
  './preview-transforms.js',
  './library-manager.js',
  './user-files.js',
  './libs/scadlite-cm6.bundle.js',

  // Local typography suite
  './fonts/LiberationSans-Regular.ttf',
  './fonts/LiberationSans-Bold.ttf',
  './fonts/LiberationSans-Italic.ttf',
  './fonts/LiberationSans-BoldItalic.ttf',
  './fonts/LiberationMono-Regular.ttf',
  './fonts/LiberationMono-Bold.ttf',
  './fonts/LiberationMono-Italic.ttf',
  './fonts/LiberationMono-BoldItalic.ttf',
  './fonts/LiberationSerif-Regular.ttf',
  './fonts/LiberationSerif-Bold.ttf',
  './fonts/LiberationSerif-Italic.ttf',
  './fonts/LiberationSerif-BoldItalic.ttf'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Caching offline assets...');
      return cache.addAll(ASSETS_TO_CACHE);
      // NOTE: addAll is atomic — if ANY asset 404s, the whole install fails
      // and the previous version keeps serving. Good for consistency, but if
      // an update mysteriously never applies, check DevTools › Application ›
      // Service Workers for a failed install (usually a renamed/missing file).
    })
  );
  // Deliberately NO self.skipWaiting(): the new version waits until the next
  // launch to take over, so an already-running session can never end up with
  // a mix of old app.js and new lazily-fetched assets (wasm, fonts).
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.map((key) => {
        if (key !== CACHE_NAME) {
          console.log('[Service Worker] Clearing old cache...', key);
          return caches.delete(key);
        }
      })
    ))
  );
  // claim() is kept: on the very first install it lets the page work offline
  // immediately without a reload. On updates it only runs at next-launch
  // activation anyway (since we don't skipWaiting), so it can't cause skew.
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Ignore non-GET requests and anything cross-origin — this app is fully
  // local, so foreign requests are none of our business (and must never be
  // written into our cache).
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  const isNavigation = event.request.mode === 'navigate';

  event.respondWith(
    // ignoreSearch on navigations: a manifest start_url like "./?source=pwa"
    // should still hit the cached shell.
    caches.match(event.request, { ignoreSearch: isNavigation }).then((cached) => {
      // Cache-first: precached assets are immutable within a release; updates
      // arrive atomically via a CACHE_NAME bump, never piecemeal.
      if (cached) return cached;

      // Not precached (new asset, deep link, etc.): fetch and cache it for
      // offline use — but ONLY a healthy response. Caching a 404/500 here
      // would poison the cache and get served forever after.
      return fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.ok) {
          const copy = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return networkResponse;
      }).catch(() => {
        // Offline and not in cache: for navigations, fall back to the app
        // shell so a cold offline start still boots instead of erroring.
        if (isNavigation) return caches.match('./index.html');
      });
    })
  );
});