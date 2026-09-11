const CACHE_PREFIX = 'suprabha-stockflow-static-';
const CACHE = `${CACHE_PREFIX}v5`;
const OWNED_CACHE_PREFIXES = [CACHE_PREFIX, 'suprabha-stockflow-v'];
const PUBLIC_ASSETS = ['/stockflow.html', '/manifest.webmanifest', '/suprabha-logo.png', '/app-icon.svg', '/favicon.svg'];

async function cachePublicAsset(cache, path) {
  const response = await fetch(new Request(path, { cache: 'reload', credentials: 'omit' }));
  if (!response.ok || response.redirected || response.type !== 'basic') throw new Error(`Unsafe public asset response: ${path}`);
  await cache.put(path, response);
}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => Promise.all(PUBLIC_ASSETS.map((path) => cachePublicAsset(cache, path)))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE && OWNED_CACHE_PREFIXES.some((prefix) => key.startsWith(prefix))).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !PUBLIC_ASSETS.includes(url.pathname) || url.search) return;
  event.respondWith(caches.open(CACHE).then((cache) => cache.match(url.pathname)).then((cached) => cached || fetch(event.request)));
});
