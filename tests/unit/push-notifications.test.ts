import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { base64UrlToBytes, needsHomeScreenInstall, readOpenOrderLink, readOpenOrderMessage, readPushConfig } from '@/lib/push-subscription';

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
  runInNewContext(source, { self, caches: {}, fetch: vi.fn(), Request, Response, URL, Error, Promise, encodeURIComponent });
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
    const open = { url: 'https://stockflow.example/', frameType: 'top-level', postMessage: vi.fn(), focus: vi.fn(async () => undefined) };
    const withWindow = worker([stockFrame, open]);
    const close = vi.fn();
    await withWindow.dispatch('notificationclick', { notification: { close, data: { orderId, orderNumber: 'SF-26-1043' } } });
    expect(close).toHaveBeenCalled();
    expect(open.postMessage).toHaveBeenCalledWith({ type: 'stockflow-open-order', orderId, orderNumber: 'SF-26-1043' });
    expect(open.focus).toHaveBeenCalled();
    expect(stockFrame.postMessage).not.toHaveBeenCalled();

    const closedApp = worker([]);
    await closedApp.dispatch('notificationclick', { notification: { close, data: { orderId, orderNumber: 'SF-26-1043' } } });
    expect(closedApp.openWindow).toHaveBeenCalledWith(`/?openOrder=${orderId}&n=SF-26-1043`);
    await closedApp.dispatch('notificationclick', { notification: { close, data: { orderId: 'x', orderNumber: 'y' } } });
    expect(closedApp.openWindow).toHaveBeenLastCalledWith('/');
  });
});
