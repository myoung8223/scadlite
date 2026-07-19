const CACHE_NAME = 'scadlite-v332';

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
  
  // Your local typography suite
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
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
              console.log('[Service Worker] Clearing old cache...', key);
              return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Ignore non-GET requests
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      // Stale-while-revalidate: Return cache immediately if available, 
      // but fetch the latest version in the background for next time.
      if (cachedResponse) {
        fetch(event.request).then((networkResponse) => {
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, networkResponse.clone());
          });
        }).catch(() => {}); // Ignore network errors offline
        return cachedResponse;
      }

      // If it's not in the cache, fetch it from the network
      return fetch(event.request).then((networkResponse) => {
          return caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, networkResponse.clone());
              return networkResponse;
          });
      });
    })
  );
});
