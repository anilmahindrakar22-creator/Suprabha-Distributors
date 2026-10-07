import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(fileURLToPath(new URL('../../public/sw.js', import.meta.url)), 'utf8');

type RuntimeEvent = { request?: Request; respondWith?: (value: Promise<Response | undefined>) => void; waitUntil?: (value: Promise<unknown>) => void };

function workerRuntime(cached?: Response, fetchFn = vi.fn()) {
  const listeners = new Map<string, (event: RuntimeEvent) => void>();
  const deleted: string[] = [];
  const claim = vi.fn(async () => undefined);
  const cache = { match: vi.fn(async () => cached), put: vi.fn(async () => undefined) };
  const caches = {
    open: vi.fn(async () => cache),
    keys: vi.fn(async () => ['suprabha-stockflow-v2', 'suprabha-stockflow-static-v1', 'unrelated-cache']),
    delete: vi.fn(async (key: string) => { deleted.push(key); return true; }),
  };
  const self = {
    location: { origin: 'https://stockflow.example' },
    clients: { claim },
    skipWaiting: vi.fn(async () => undefined),
    addEventListener: (name: string, listener: (event: RuntimeEvent) => void) => listeners.set(name, listener),
  };
  runInNewContext(source, { self, caches, fetch: fetchFn, Request, Response, URL, Error, Promise });
  return { listeners, caches, cache, deleted, claim };
}

function dispatchFetch(listeners: Map<string, (event: RuntimeEvent) => void>, request: Request) {
  let response: Promise<Response | undefined> | undefined;
  listeners.get('fetch')?.({ request, respondWith: (value) => { response = value; } });
  return response;
}

describe('service worker runtime boundary', () => {
  function navigation() {
    const request = new Request('https://stockflow.example/');
    Object.defineProperty(request, 'mode', { value: 'navigate' });
    return request;
  }
  it('falls back only to the public shell on network failure', async () => {
    const fallback = new Response('public offline shell');
    const runtime = workerRuntime(fallback, vi.fn().mockRejectedValue(new TypeError('offline')));
    expect(await dispatchFetch(runtime.listeners, navigation())).toBe(fallback);
    expect(runtime.cache.match).toHaveBeenCalledWith('/offline.html');
    expect(runtime.cache.put).not.toHaveBeenCalled();
  });
  it.each([200, 401, 403, 500])('returns network navigation status %s unchanged without caching', async (status) => {
    const response = new Response('not cached', { status });
    const runtime = workerRuntime(undefined, vi.fn().mockResolvedValue(response));
    expect(await dispatchFetch(runtime.listeners, navigation())).toBe(response);
    expect(runtime.cache.put).not.toHaveBeenCalled();
    expect(runtime.cache.match).not.toHaveBeenCalled();
  });
  it.each(['/api/orders', '/', '/orders?view=active'])('does not intercept protected request %s', (path) => {
    const runtime = workerRuntime();
    expect(dispatchFetch(runtime.listeners, new Request(`https://stockflow.example${path}`))).toBeUndefined();
  });

  it('does not intercept writes, cross-origin assets, or query variants', () => {
    const runtime = workerRuntime();
    expect(dispatchFetch(runtime.listeners, new Request('https://stockflow.example/stockflow.html', { method: 'POST', body: 'x' }))).toBeUndefined();
    expect(dispatchFetch(runtime.listeners, new Request('https://other.example/app-icon.svg'))).toBeUndefined();
    expect(dispatchFetch(runtime.listeners, new Request('https://stockflow.example/app-icon.svg?v=2'))).toBeUndefined();
  });

  it.each(['/stockflow.html', '/suprabha-logo.png'])('serves approved public asset %s from the static cache', async (path) => {
    const cached = new Response('<html>offline</html>');
    const runtime = workerRuntime(cached);
    const response = dispatchFetch(runtime.listeners, new Request(`https://stockflow.example${path}`));
    expect(await response).toBe(cached);
    expect(runtime.cache.match).toHaveBeenCalledWith(path);
  });

  it('removes old StockFlow caches while preserving unrelated origin storage', async () => {
    const runtime = workerRuntime();
    let activation: Promise<unknown> | undefined;
    runtime.listeners.get('activate')?.({ waitUntil: (value) => { activation = value; } });
    await activation;
    expect(runtime.deleted).toEqual(['suprabha-stockflow-v2', 'suprabha-stockflow-static-v1']);
    expect(runtime.claim).toHaveBeenCalledOnce();
  });
});
