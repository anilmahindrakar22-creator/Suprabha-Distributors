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
    keys: vi.fn(async () => ['suprabha-stockflow-v2', 'suprabha-stockflow-static-v1', 'suprabha-stockflow-static-v6', 'suprabha-stockflow-static-v7', 'suprabha-stockflow-static-v8', 'suprabha-stockflow-static-v9', 'suprabha-stockflow-static-v10', 'suprabha-stockflow-static-v11', 'suprabha-stockflow-static-v12', 'suprabha-stockflow-static-v13', 'suprabha-stockflow-static-v14', 'suprabha-stockflow-static-v15', 'suprabha-stockflow-static-v16', 'suprabha-stockflow-static-v17', 'suprabha-stockflow-static-v18', 'unrelated-cache']),
    delete: vi.fn(async (key: string) => { deleted.push(key); return true; }),
  };
  const self = {
    location: { origin: 'https://stockflow.example' },
    clients: { claim },
    skipWaiting: vi.fn(async () => undefined),
    addEventListener: (name: string, listener: (event: RuntimeEvent) => void) => listeners.set(name, listener),
  };
  // A service worker resolves relative Request paths against its own origin; Node's Request does not.
  class WorkerRequest extends Request {
    constructor(input: string | Request, init?: RequestInit) {
      super(typeof input === 'string' ? new URL(input, 'https://stockflow.example').href : input, init);
    }
  }
  runInNewContext(source, { self, caches, fetch: fetchFn, Request: WorkerRequest, Response, URL, Error, Promise, setTimeout });
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

  it.each(['/suprabha-logo.png'])('serves approved public asset %s from the static cache', async (path) => {
    const cached = new Response('<html>offline</html>');
    const runtime = workerRuntime(cached);
    const response = dispatchFetch(runtime.listeners, new Request(`https://stockflow.example${path}`));
    expect(await response).toBe(cached);
    expect(runtime.cache.match).toHaveBeenCalledWith(path);
  });

  // Mark a Response as a same-origin basic response, as the browser would for an approved public asset.
  function basic(response: Response) {
    return Object.defineProperty(response, 'type', { value: 'basic' });
  }

  it('refreshes the Stock page from the network before serving it', async () => {
    const cached = new Response('<html>old</html>');
    const fetchFn = vi.fn(async (_request: Request) => basic(new Response('<html>new</html>', { status: 200 })));
    const runtime = workerRuntime(cached, fetchFn);
    const response = await dispatchFetch(runtime.listeners, new Request('https://stockflow.example/stockflow.html'));
    expect(response).toBe(cached);
    expect(runtime.cache.put).toHaveBeenCalledWith('/stockflow.html', expect.anything());
    const request = fetchFn.mock.calls[0][0];
    expect(request.url).toMatch(/\/stockflow\.html$/);
    expect(request.cache).toBe('reload');
  });

  it('serves the cached Stock page when offline', async () => {
    const cached = new Response('<html>old</html>');
    const runtime = workerRuntime(cached, vi.fn().mockRejectedValue(new TypeError('offline')));
    expect(await dispatchFetch(runtime.listeners, new Request('https://stockflow.example/stockflow.html'))).toBe(cached);
    expect(runtime.cache.put).not.toHaveBeenCalled();
  });

  it('does not cache a redirected or failed Stock page', async () => {
    const cached = new Response('<html>old</html>');
    const runtime = workerRuntime(cached, vi.fn(async () => basic(new Response('server error', { status: 500 }))));
    expect(await dispatchFetch(runtime.listeners, new Request('https://stockflow.example/stockflow.html'))).toBe(cached);
    expect(runtime.cache.put).not.toHaveBeenCalled();
  });

  it('removes old StockFlow caches while preserving unrelated origin storage', async () => {
    const runtime = workerRuntime();
    let activation: Promise<unknown> | undefined;
    runtime.listeners.get('activate')?.({ waitUntil: (value) => { activation = value; } });
    await activation;
    expect(runtime.deleted).toEqual(['suprabha-stockflow-v2', 'suprabha-stockflow-static-v1', 'suprabha-stockflow-static-v6', 'suprabha-stockflow-static-v7', 'suprabha-stockflow-static-v8', 'suprabha-stockflow-static-v9', 'suprabha-stockflow-static-v10', 'suprabha-stockflow-static-v11', 'suprabha-stockflow-static-v12', 'suprabha-stockflow-static-v13', 'suprabha-stockflow-static-v14', 'suprabha-stockflow-static-v15', 'suprabha-stockflow-static-v16', 'suprabha-stockflow-static-v17']);
    expect(runtime.claim).toHaveBeenCalledOnce();
  });
});
