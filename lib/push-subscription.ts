// Phone push, client side. The server side (subscriptions table, recipient policy, sender, VAPID secrets) is
// planned in docs/PUSH-NOTIFICATIONS.md. Until GET /api/push-subscription reports enabled, this stays dormant.

export type PushState = 'hidden' | 'unsupported' | 'install-required' | 'off' | 'on' | 'blocked' | 'working' | 'error';
export type PushConfig = { enabled: boolean; publicKey: string };

const subscriptionUrl = '/api/push-subscription';

export function pushSupported(scope: typeof globalThis = globalThis) {
  return 'serviceWorker' in (scope.navigator ?? {}) && 'PushManager' in scope && 'Notification' in scope;
}

/** iPhone/iPad Safari only allows web push from an app added to the Home Screen. */
export function needsHomeScreenInstall(userAgent: string, standalone: boolean, maxTouchPoints = 0) {
  // iPadOS Safari reports a desktop Macintosh user agent; touch support gives it away.
  const iOS = /iPhone|iPad|iPod/i.test(userAgent) || (/Macintosh/i.test(userAgent) && maxTouchPoints > 1);
  return iOS && !standalone;
}

export function readPushConfig(value: unknown): PushConfig {
  if (!value || typeof value !== 'object') return { enabled: false, publicKey: '' };
  const { enabled, publicKey } = value as { enabled?: unknown; publicKey?: unknown };
  const key = typeof publicKey === 'string' && /^[A-Za-z0-9_-]{80,100}$/.test(publicKey) ? publicKey : '';
  return { enabled: enabled === true && Boolean(key), publicKey: key };
}

export function base64UrlToBytes(value: string) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** Exact-order deep link used by notification taps: `/?openOrder=<uuid>&n=<order number>`. */
export function readOpenOrderLink(search: string): { orderId: string; orderNumber: string } | null {
  const parameters = new URLSearchParams(search);
  const orderId = parameters.get('openOrder') || '';
  const orderNumber = parameters.get('n') || '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId)) return null;
  if (!/^[A-Za-z0-9/_.-]{1,40}$/.test(orderNumber)) return null;
  return { orderId, orderNumber };
}

/** Same-origin message from the service worker when a notification is tapped while StockFlow is open. */
export function readOpenOrderMessage(value: unknown) {
  if (!value || typeof value !== 'object' || (value as { type?: unknown }).type !== 'stockflow-open-order') return null;
  const { orderId, orderNumber } = value as { orderId?: unknown; orderNumber?: unknown };
  if (typeof orderId !== 'string' || typeof orderNumber !== 'string') return null;
  return readOpenOrderLink(`?openOrder=${encodeURIComponent(orderId)}&n=${encodeURIComponent(orderNumber)}`);
}

export async function loadPushConfig(fetchJson: typeof fetch = fetch): Promise<PushConfig> {
  try {
    const response = await fetchJson(subscriptionUrl, { cache: 'no-store' });
    if (!response.ok) return { enabled: false, publicKey: '' };
    return readPushConfig(await response.json());
  } catch {
    return { enabled: false, publicKey: '' };
  }
}

/** The active service worker, waiting at most 10 s (`ready` never settles if registration failed). */
async function registration() {
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Service worker unavailable')), 10_000));
  return Promise.race([navigator.serviceWorker.ready, timeout]);
}

export async function currentPushState(config: PushConfig): Promise<PushState> {
  if (!config.enabled) return 'hidden';
  if (needsHomeScreenInstall(navigator.userAgent, window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true, navigator.maxTouchPoints)) return 'install-required';
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  // Checking state must not wait for the worker: no registration yet simply means alerts are off.
  const existing = await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription();
  return existing && Notification.permission === 'granted' ? 'on' : 'off';
}

/** Must be called from a tap: asks permission, subscribes and registers this phone for the signed-in person. */
export async function enablePush(config: PushConfig, fetchJson: typeof fetch = fetch): Promise<PushState> {
  if (!config.enabled || !pushSupported()) return 'unsupported';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'blocked' : 'off';
  const worker = await registration();
  const subscription = await worker.pushManager.getSubscription() ?? await worker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(config.publicKey) });
  const response = await fetchJson(subscriptionUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(subscription.toJSON()), cache: 'no-store' });
  if (!response.ok) {
    await subscription.unsubscribe().catch(() => undefined);
    return 'error';
  }
  return 'on';
}

/** Stops alerts on this phone. Also used on sign-out and account switch so a shared phone stops alerting the previous person. */
export async function disablePush(fetchJson: typeof fetch = fetch): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  const worker = await navigator.serviceWorker.getRegistration();
  const subscription = await worker?.pushManager.getSubscription();
  if (!subscription) return 'off';
  const endpoint = subscription.endpoint;
  await subscription.unsubscribe().catch(() => undefined);
  await fetchJson(subscriptionUrl, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint }), cache: 'no-store', keepalive: true, signal: AbortSignal.timeout(4_000) }).catch(() => undefined);
  return 'off';
}
