const CACHE_PREFIX = 'suprabha-stockflow-static-';
const CACHE = `${CACHE_PREFIX}v16`;
const OWNED_CACHE_PREFIXES = [CACHE_PREFIX, 'suprabha-stockflow-v'];
const PUBLIC_ASSETS = ['/stockflow.html', '/manifest.webmanifest', '/suprabha-logo.png', '/app-icon.svg', '/favicon.svg', '/offline.html', '/offline.css', '/generated-offline/offline-app.js'];

async function cachePublicAsset(cache, path) {
  // Use the .html file when it is served directly (the offline preview). On
  // Vinext, it redirects to an extensionless URL; follow only that known
  // same-origin canonical path, then apply the strict no-redirect cache rule.
  const fetchPath = path === '/stockflow.html' ? '/stockflow' : path === '/offline.html' ? '/offline' : path;
  let response = await fetch(new Request(path, { cache: 'reload', credentials: 'omit', redirect: 'manual' }));
  if (fetchPath !== path && response.type === 'opaqueredirect') {
    response = await fetch(new Request(fetchPath, { cache: 'reload', credentials: 'omit' }));
  }
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
  if (url.origin === self.location.origin && event.request.mode === 'navigate' && url.pathname === '/' && !url.search) {
    // Network-only authenticated navigation; cache only the public fallback.
    // HTTP authentication/errors are not network failures and are returned unchanged.
    event.respondWith(fetch(event.request).catch(() => caches.open(CACHE).then((cache) => cache.match('/offline.html'))));
    return;
  }
  if (url.origin !== self.location.origin || !PUBLIC_ASSETS.includes(url.pathname) || url.search) return;
  event.respondWith(caches.open(CACHE).then((cache) => cache.match(url.pathname)).then((cached) => cached || fetch(event.request)));
});

// Phone push (docs/PUSH-NOTIFICATIONS.md). Every push shows a notification; taps open the exact order.
const ORDER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ORDER_NUMBER_PATTERN = /^[A-Za-z0-9/_.-]{1,40}$/;

function readPushPayload(event) {
  let data = {};
  try {
    const payload = event.data ? event.data.json() : {};
    data = payload && typeof payload === 'object' ? payload : {};
  } catch { data = {}; }
  const orderId = typeof data.orderId === 'string' && ORDER_ID_PATTERN.test(data.orderId) ? data.orderId : '';
  const orderNumber = typeof data.orderNumber === 'string' && ORDER_NUMBER_PATTERN.test(data.orderNumber) ? data.orderNumber : '';
  const text = (value, fallback, limit) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, limit) : fallback);
  // Owner decision: the customer name is shown on the lock screen ("Care Hospital · SF-26-1043").
  const customer = text(data.customerName, '', 60);
  const fallbackTitle = customer && orderNumber ? `${customer} · ${orderNumber}` : orderNumber ? `${orderNumber} · StockFlow` : 'StockFlow';
  return {
    title: text(data.title, fallbackTitle, 80),
    body: text(data.body, 'New work is waiting for you.', 160),
    orderId,
    orderNumber,
  };
}

self.addEventListener('push', (event) => {
  const payload = readPushPayload(event);
  event.waitUntil(self.registration.showNotification(payload.title, {
    body: payload.body,
    icon: '/suprabha-logo.png',
    tag: payload.orderId ? `stockflow-order-${payload.orderId}` : 'stockflow-work',
    renotify: true,
    data: { orderId: payload.orderId, orderNumber: payload.orderNumber },
  }));
});

function acknowledgeOrder(client, message) {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const finish = (acknowledged) => {
      clearTimeout(timer);
      channel.port1.close();
      channel.port2.close();
      resolve(acknowledged);
    };
    const timer = setTimeout(() => finish(false), 1_000);
    channel.port1.onmessage = (event) => { if (event.data === 'ack') finish(true); };
    try { client.postMessage(message, [channel.port2]); } catch { finish(false); }
  });
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const { orderId = '', orderNumber = '' } = event.notification.data || {};
  const exact = ORDER_ID_PATTERN.test(orderId) && ORDER_NUMBER_PATTERN.test(orderNumber);
  const target = exact ? `/?openOrder=${encodeURIComponent(orderId)}&n=${encodeURIComponent(orderNumber)}` : '/';
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (windows) => {
    // Only the top-level StockFlow window: the Stock screen is a same-origin iframe that must not receive the tap.
    const candidates = windows.filter((client) => client.frameType === 'top-level' && new URL(client.url).origin === self.location.origin);
    if (!exact && candidates.length) return candidates[0].focus();
    // Try every eligible window concurrently; a standalone page must not consume the tap.
    const acknowledged = await new Promise((resolve) => {
      if (!candidates.length) return resolve(null);
      let remaining = candidates.length;
      for (const client of candidates) {
        acknowledgeOrder(client, { type: 'stockflow-open-order', orderId, orderNumber }).then((ack) => {
          if (ack) resolve(client);
          if (--remaining === 0) resolve(null);
        });
      }
    });
    if (acknowledged) {
      try { return await acknowledged.focus(); } catch { /* Open the deep link if focus fails. */ }
    }
    return self.clients.openWindow(target);
  }));
});
