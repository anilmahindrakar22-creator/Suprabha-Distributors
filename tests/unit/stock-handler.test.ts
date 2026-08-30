import { describe, expect, it, vi } from 'vitest';
import { createStockHandler } from '../../lib/stock-handler';

const user = { email: 'approved@example.com' };

function makeHandler(overrides = {}) {
  return createStockHandler({
    endpoint: 'https://stock.example/snapshot',
    fetchFn: vi.fn(async () => Response.json({ rows: [1, 2] })),
    getUser: vi.fn(async () => user),
    hasAccess: vi.fn(() => true),
    readKey: vi.fn(() => 'server-only-key'),
    ...overrides,
  });
}

describe('stock API handler', () => {
  it('denies unauthenticated requests before contacting stock storage', async () => {
    const fetchFn = vi.fn();
    const response = await makeHandler({
      fetchFn,
      getUser: vi.fn(async () => null),
    })();

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Sign in required' });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('denies authenticated users outside the allowlist', async () => {
    const response = await makeHandler({ hasAccess: vi.fn(() => false) })();
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Access denied' });
  });

  it('fails safely when the server credential is absent', async () => {
    const response = await makeHandler({ readKey: vi.fn(() => undefined) })();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: 'Stock service is not configured',
    });
  });

  it('proxies an approved request without exposing cacheable data', async () => {
    const fetchFn = vi.fn(async () =>
      Response.json({ rows: [1, 2] }, { status: 200 }),
    );
    const response = await makeHandler({ fetchFn })();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ rows: [1, 2] });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(fetchFn).toHaveBeenCalledWith('https://stock.example/snapshot', {
      cache: 'no-store',
      headers: { 'x-dashboard-key': 'server-only-key' },
    });
  });

  it('returns a controlled error when stock storage is unavailable', async () => {
    const response = await makeHandler({
      fetchFn: vi.fn(async () => {
        throw new Error('network unavailable');
      }),
    })();
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: 'Stock service is temporarily unavailable',
    });
  });
});
