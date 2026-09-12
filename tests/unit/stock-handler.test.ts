import { describe, expect, it, vi } from 'vitest';
import { createStockHandler, sanitizeStockPayload } from '../../lib/stock-handler';

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

  it('supports database-backed asynchronous membership checks', async () => {
    const response = await makeHandler({ hasAccess: vi.fn(async () => true) })();
    expect(response.status).toBe(200);
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

  it('removes restricted pricing, cost, margin, and suggestion data from stock payloads', () => {
    expect(sanitizeStockPayload({
      rows: [{ item: 'Kit', closing: 2 }],
      pricingHistory: { sales: [{ rate: 485 }] },
      tallyInvoices: [{ lineItems: [{ itemName: 'Kit', quantity: 2, rate: 485 }] }],
      nested: { purchaseCost: 300, grossMargin: 38, suggestedPrice: 520 },
    })).toEqual({
      rows: [{ item: 'Kit', closing: 2 }],
      tallyInvoices: [{ lineItems: [{ itemName: 'Kit', quantity: 2 }] }],
      nested: {},
    });
  });

  it('sanitizes proxied upstream JSON before returning it', async () => {
    const response = await makeHandler({ fetchFn: vi.fn(async () => Response.json({ rows: [1], pricingHistory: { sales: [{ rate: 485 }] } })) })();
    expect(await response.json()).toEqual({ rows: [1] });
  });
});
