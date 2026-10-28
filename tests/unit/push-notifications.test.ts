import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { base64UrlToBytes, disablePush, disablePushBeforeSignOut, enablePush, needsHomeScreenInstall, readOpenOrderLink, readOpenOrderMessage, readPushConfig, retryPendingPushRemoval } from '@/lib/push-subscription';

const orderId = '22222222-2222-4222-8222-222222222222';
const source = readFileSync(fileURLToPath(new URL('../../public/sw.js', import.meta.url)), 'utf8');

type Listener = (event: Record<string, unknown>) => void;
type FakeClient = { url: string; frameType: string; postMessage: ReturnType<typeof vi.fn>; focus: ReturnType<typeof vi.fn> };
function worker(windows: FakeClient[] = []) {
  const listeners = new Map<string, Listener>();
  const showNotification = vi.fn(async () => undefined);
  const openWindow = vi.fn(async () => undefined);
  const self = {
    location: { origin: 'https://stockflow.example' },
    registration: { showNotification },
    clients: { claim: vi.fn(), matchAll: vi.fn(async () => windows), openWindow },
    skipWaiting: vi.fn(),
    addEventListener: (name: string, listener: Listener) => listeners.set(name, listener),
  };
  class TestMessageChannel {
    port1 = { onmessage: null as ((event: { data: unknown }) => void) | null, close: vi.fn() };
    port2 = { postMessage: (data: unknown) => this.port1.onmessage?.({ data }), close: vi.fn() };
  }
  runInNewContext(source, { self, caches: {}, fetch: vi.fn(), Request, Response, URL, Error, Promise, encodeURIComponent, MessageChannel: TestMessageChannel, setTimeout, clearTimeout });
  async function dispatch(name: string, event: Record<string, unknown>) {
    let pending: Promise<unknown> | undefined;
    listeners.get(name)?.({ ...event, waitUntil: (value: Promise<unknown>) => { pending = value; } });
    await pending;
  }
  return { dispatch, showNotification, openWindow };
}

describe('push helpers', () => {
  it('accepts only a well-formed exact-order deep link', () => {
    expect(readOpenOrderLink(`?openOrder=${orderId}&n=SF-26-1043`)).toEqual({ orderId, orderNumber: 'SF-26-1043' });
    expect(readOpenOrderLink('?openOrder=not-a-uuid&n=SF-1')).toBeNull();
    expect(readOpenOrderLink(`?openOrder=${orderId}&n=<script>`)).toBeNull();
    expect(readOpenOrderMessage({ type: 'stockflow-open-order', orderId, orderNumber: 'SF-26-1043' })).toEqual({ orderId, orderNumber: 'SF-26-1043' });
    expect(readOpenOrderMessage({ type: 'other', orderId, orderNumber: 'SF-1' })).toBeNull();
  });

  it('stays dormant unless the server enables push with a plausible public key', () => {
    const key = 'B'.repeat(87);
    expect(readPushConfig({ enabled: true, publicKey: key })).toEqual({ enabled: true, publicKey: key });
    expect(readPushConfig({ enabled: true, publicKey: 'short' }).enabled).toBe(false);
    expect(readPushConfig({ enabled: false, publicKey: key }).enabled).toBe(false);
    expect(readPushConfig(null).enabled).toBe(false);
    expect(base64UrlToBytes('AQID_-8')).toEqual(new Uint8Array([1, 2, 3, 255, 239]));
  });

  it('asks iPhone users to add StockFlow to the Home Screen first', () => {
    expect(needsHomeScreenInstall('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', false)).toBe(true);
    expect(needsHomeScreenInstall('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', true)).toBe(false);
    expect(needsHomeScreenInstall('Mozilla/5.0 (Linux; Android 14; Pixel 7)', false)).toBe(false);
    expect(needsHomeScreenInstall('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', false, 5)).toBe(true);
    expect(needsHomeScreenInstall('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', false, 0)).toBe(false);
  });
});

describe('shared-device push cleanup', () => {
  const endpoint = 'https://push.example.test/device';
  const email = 'old@example.test';
  const pendingKey = 'stockflow-push-pending-removal';
  const storage = new Map<string, string>();
  const subscription = { endpoint, unsubscribe: vi.fn(), toJSON: () => ({ endpoint, keys: { p256dh: 'BBB', auth: 'AAA' } }) };
  const fetchJson = vi.fn<typeof fetch>();
  beforeEach(() => {
    storage.clear();
    vi.clearAllMocks();
    vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
    const worker = { pushManager: { getSubscription: vi.fn(async () => subscription) } };
    vi.stubGlobal('navigator', { serviceWorker: { getRegistration: vi.fn(async () => worker), ready: Promise.resolve(worker) } });
    vi.stubGlobal('PushManager', class {});
    vi.stubGlobal('Notification', { requestPermission: vi.fn(async () => 'granted') });
    subscription.unsubscribe.mockResolvedValue(true);
    fetchJson.mockResolvedValue(new Response('{}'));
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('returns DELETE success and clears the pending record even if local unsubscribe fails', async () => {
    subscription.unsubscribe.mockRejectedValue(new Error('local failure'));
    expect(await disablePush(fetchJson, email)).toBe(true);
    expect(storage.has(pendingKey)).toBe(false);
    expect(fetchJson).toHaveBeenCalledWith('/api/push-subscription', expect.objectContaining({ method: 'DELETE', body: JSON.stringify({ endpoint }) }));
  });
  it('persists failed DELETE for retry under the next signed-in session', async () => {
    fetchJson.mockResolvedValueOnce(new Response('{}', { status: 503 }));
    expect(await disablePush(fetchJson, email)).toBe(false);
    expect(JSON.parse(storage.get(pendingKey)!)).toEqual({ endpoint, email });
    fetchJson.mockRejectedValueOnce(new Error('offline'));
    expect(await retryPendingPushRemoval(fetchJson)).toBe(false);
    expect(storage.has(pendingKey)).toBe(true);
    expect(await retryPendingPushRemoval(fetchJson)).toBe(true);
    expect(storage.has(pendingKey)).toBe(false);
    // No stored actor is sent: ownership is determined by the new authenticated session.
    expect(JSON.parse(String(fetchJson.mock.calls.at(-1)?.[1]?.body))).toEqual({ endpoint });
  });
  it('keeps the record when subscribe fails, and clears it when another account subscribes', async () => {
    storage.set(pendingKey, JSON.stringify({ endpoint, email }));
    const config = { enabled: true, publicKey: 'B'.repeat(87) };
    fetchJson.mockResolvedValueOnce(new Response('{}', { status: 503 }));
    expect(await enablePush(config, fetchJson, 'new@example.test')).toBe('error');
    expect(storage.has(pendingKey)).toBe(true);
    expect(await enablePush(config, fetchJson, email)).toBe('on');
    expect(storage.has(pendingKey)).toBe(true);
    expect(await enablePush(config, fetchJson, 'new@example.test')).toBe('on');
    expect(storage.has(pendingKey)).toBe(false);
  });
  it('waits for cleanup before sign-out can continue', async () => {
    vi.useFakeTimers();
    let respond!: (response: Response) => void;
    fetchJson.mockImplementationOnce(() => new Promise(resolve => { respond = resolve; }));
    const continueSignOut = vi.fn();
    const cleanup = disablePushBeforeSignOut(email, fetchJson).then(result => { continueSignOut(); return result; });
    await vi.advanceTimersByTimeAsync(2000);
    expect(continueSignOut).not.toHaveBeenCalled();
    respond(new Response('{}'));
    expect(await cleanup).toBe(true);
    expect(continueSignOut).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('continues after 3 s, aborts DELETE, and retains removal for the next load', async () => {
    vi.useFakeTimers();
    fetchJson.mockImplementationOnce(() => new Promise(() => undefined));
    const continueSignOut = vi.fn();
    const cleanup = disablePushBeforeSignOut(email, fetchJson).then(result => { continueSignOut(); return result; });
    await vi.advanceTimersByTimeAsync(2999);
    expect(continueSignOut).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await cleanup).toBe(false);
    expect(continueSignOut).toHaveBeenCalledOnce();
    expect(fetchJson.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(JSON.parse(storage.get(pendingKey)!)).toEqual({ endpoint, email });
    expect(await retryPendingPushRemoval(fetchJson)).toBe(true);
    expect(storage.has(pendingKey)).toBe(false);
  });
});

describe('service worker push handling', () => {
  it('always shows a notification, one per order, with no unchecked fields', async () => {
    const runtime = worker();
    await runtime.dispatch('push', { data: { json: () => ({ title: 'SF-26-1043 · Packed · ready for Tally billing', body: 'Tap to open', orderId, orderNumber: 'SF-26-1043', extra: 'ignored' }) } });
    expect(runtime.showNotification).toHaveBeenCalledWith('SF-26-1043 · Packed · ready for Tally billing', expect.objectContaining({ tag: `stockflow-order-${orderId}`, data: { orderId, orderNumber: 'SF-26-1043' } }));
    await runtime.dispatch('push', { data: { json: () => ({ body: 'Packed · ready for Tally billing', orderId, orderNumber: 'SF-26-1043', customerName: 'Care Hospital' }) } });
    expect(runtime.showNotification).toHaveBeenLastCalledWith('Care Hospital · SF-26-1043', expect.objectContaining({ body: 'Packed · ready for Tally billing' }));
    await runtime.dispatch('push', { data: { json: () => { throw new Error('bad'); } } });
    expect(runtime.showNotification).toHaveBeenLastCalledWith('StockFlow', expect.objectContaining({ body: 'New work is waiting for you.', tag: 'stockflow-work' }));
    await runtime.dispatch('push', { data: { json: () => null } });
    expect(runtime.showNotification).toHaveBeenLastCalledWith('StockFlow', expect.objectContaining({ body: 'New work is waiting for you.', tag: 'stockflow-work' }));
    await runtime.dispatch('push', { data: { json: () => 'invalid payload' } });
    expect(runtime.showNotification).toHaveBeenLastCalledWith('StockFlow', expect.objectContaining({ body: 'New work is waiting for you.', tag: 'stockflow-work' }));
  });

  it('opens the exact order: messages an open window, otherwise opens a deep link', async () => {
    // The Stock screen is a same-origin iframe; the tap must go to the top-level app window.
    const stockFrame = { url: 'https://stockflow.example/stockflow.html', frameType: 'nested', postMessage: vi.fn(), focus: vi.fn(async () => undefined) };
    const open = { url: 'https://stockflow.example/', frameType: 'top-level', postMessage: vi.fn((_message, ports: MessagePort[]) => ports[0].postMessage('ack')), focus: vi.fn(async () => undefined) };
    const withWindow = worker([stockFrame, open]);
    const close = vi.fn();
    await withWindow.dispatch('notificationclick', { notification: { close, data: { orderId, orderNumber: 'SF-26-1043' } } });
    expect(close).toHaveBeenCalled();
    expect(open.postMessage).toHaveBeenCalledWith({ type: 'stockflow-open-order', orderId, orderNumber: 'SF-26-1043' }, [expect.anything()]);
    expect(open.focus).toHaveBeenCalled();
    expect(withWindow.openWindow).not.toHaveBeenCalled();
    expect(stockFrame.postMessage).not.toHaveBeenCalled();

    const closedApp = worker([]);
    await closedApp.dispatch('notificationclick', { notification: { close, data: { orderId, orderNumber: 'SF-26-1043' } } });
    expect(closedApp.openWindow).toHaveBeenCalledWith(`/?openOrder=${orderId}&n=SF-26-1043`);
    await closedApp.dispatch('notificationclick', { notification: { close, data: { orderId: 'x', orderNumber: 'y' } } });
    expect(closedApp.openWindow).toHaveBeenLastCalledWith('/');
  });

  it('falls back after 1 s when a standalone or sign-in window does not acknowledge', async () => {
    vi.useFakeTimers();
    try {
      const standalone = { url: 'https://stockflow.example/staff-signin', frameType: 'top-level', postMessage: vi.fn(), focus: vi.fn() };
      const external = { url: 'https://other.example/', frameType: 'top-level', postMessage: vi.fn(), focus: vi.fn() };
      const runtime = worker([standalone, external]);
      const clicked = runtime.dispatch('notificationclick', { notification: { close: vi.fn(), data: { orderId, orderNumber: 'SF-26-1043' } } });
      await vi.advanceTimersByTimeAsync(999);
      expect(runtime.openWindow).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await clicked;
      expect(runtime.openWindow).toHaveBeenCalledWith(`/?openOrder=${orderId}&n=SF-26-1043`);
      expect(standalone.focus).not.toHaveBeenCalled();
      expect(external.postMessage).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it('finds an acknowledging app even when the first window is standalone', async () => {
    vi.useFakeTimers();
    try {
      const standalone = { url: 'https://stockflow.example/offline-preparation', frameType: 'top-level', postMessage: vi.fn(), focus: vi.fn() };
      const app = { url: 'https://stockflow.example/', frameType: 'top-level', postMessage: vi.fn((_message, ports: MessagePort[]) => ports[0].postMessage('ack')), focus: vi.fn() };
      const runtime = worker([standalone, app]);
      await runtime.dispatch('notificationclick', { notification: { close: vi.fn(), data: { orderId, orderNumber: 'SF-26-1043' } } });
      expect(app.focus).toHaveBeenCalledOnce();
      expect(runtime.openWindow).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1000);
      expect(runtime.openWindow).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
});
