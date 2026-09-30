import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStockHandler, sanitizeStockPayload } from '../../lib/stock-handler';

const user = { email: 'approved@example.com' };
afterEach(() => vi.restoreAllMocks());

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
      signal: expect.any(AbortSignal),
    });
  });

  it('preserves separate stock, catalog, and customer source timestamps', async () => {
    const sourceFetchedAtIso = {
      stock: '2026-09-29T12:00:00Z',
      catalog: '2026-09-29T08:00:00Z',
      customers: '2026-09-29T04:00:00Z',
    };
    const response = await makeHandler({ fetchFn: vi.fn(async () => Response.json({ fetchedAtIso: sourceFetchedAtIso.stock, sourceFetchedAtIso })) })();
    expect(await response.json()).toEqual({ fetchedAtIso: sourceFetchedAtIso.stock, sourceFetchedAtIso });
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

  it('sends only Stock dashboard fields for its opt-in lightweight view', async () => {
    const sourceFetchedAtIso = { stock: '2026-09-29T12:00:00Z', catalog: '2026-09-29T08:00:00Z', sales: '2026-09-29T11:00:00Z' };
    const fetchFn = vi.fn(async () => Response.json({
      company: 'TEST', fetchedAt: '29 Sep', fetchedAtIso: sourceFetchedAtIso.stock,
      sourceFetchedAtIso, groups: ['Sysmex'], rows: [{ item: 'Kit', closing: 2, purchaseCost: 300 }],
      catalog: [{ tallyKey: 'Kit' }], customers: [{ name: 'Hospital' }],
      tallyInvoices: [{ voucherNumber: '99' }], pricingHistory: { secret: true },
    }));
    const response = await makeHandler({ fetchFn })(new Request('https://stock.example/api/stock?view=dashboard'));
    expect(await response.json()).toEqual({
      company: 'TEST', fetchedAt: '29 Sep', fetchedAtIso: sourceFetchedAtIso.stock,
      sourceFetchedAtIso, groups: ['Sysmex'], rows: [{ item: 'Kit', closing: 2 }],
    });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(fetchFn).toHaveBeenCalledWith('https://stock.example/snapshot?view=dashboard', {
      cache: 'no-store',
      headers: { 'x-dashboard-key': 'server-only-key' },
      signal: expect.any(AbortSignal),
    });
  });

  it('preserves controlled upstream errors in the lightweight view', async () => {
    const response = await makeHandler({ fetchFn: vi.fn(async () => Response.json({ error: 'Stock sync unavailable' }, { status: 503 })) })(new Request('https://stock.example/api/stock?view=dashboard'));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'Stock sync unavailable' });
  });

  it('shares concurrent authorized reads but does not cache a settled response', async () => {
    let release!: (response: Response) => void;
    const fetchFn = vi.fn<typeof fetch>(() => new Promise(resolve => { release = resolve; }));
    const handler = makeHandler({ fetchFn });
    const first = handler();
    const second = handler();
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1));
    release(Response.json({ rows: [1], pricingHistory: { rate: 50 } }));
    const responses = await Promise.all([first, second]);
    for (const response of responses) expect(await response.json()).toEqual({ rows: [1] });
    fetchFn.mockResolvedValueOnce(Response.json({ rows: [2] }));
    expect(await (await handler()).json()).toEqual({ rows: [2] });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('checks each caller before sharing work and keeps different views separate', async () => {
    const hasAccess = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const fetchFn = vi.fn<typeof fetch>(async () => Response.json({ rows: [], catalog: ['legacy'] }));
    const handler = makeHandler({ hasAccess, fetchFn });
    const [legacy, denied, dashboard] = await Promise.all([
      handler(), handler(), handler(new Request('https://stock.example/api/stock?view=dashboard')),
    ]);
    expect(denied.status).toBe(403);
    expect(await legacy.json()).toEqual({ rows: [], catalog: ['legacy'] });
    expect(await dashboard.json()).toEqual({ rows: [] });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(hasAccess).toHaveBeenCalledTimes(3);
  });

  it('does not share an old credential request after key rotation', async () => {
    let key = 'old-key';
    let release!: (response: Response) => void;
    const fetchFn = vi.fn<typeof fetch>(() => new Promise(resolve => { release = resolve; }));
    const handler = makeHandler({ fetchFn, readKey: () => key });
    const oldRequest = handler();
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1));
    key = 'new-key';
    fetchFn.mockResolvedValueOnce(Response.json({ rows: ['new'] }));
    expect(await (await handler()).json()).toEqual({ rows: ['new'] });
    release(Response.json({ rows: ['old'] }));
    expect(await (await oldRequest).json()).toEqual({ rows: ['old'] });
    expect(fetchFn.mock.calls[1][1]?.headers).toEqual({ 'x-dashboard-key': 'new-key' });
  });

  it('bounds a stalled upstream read and allows the next refresh after abort', async () => {
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    const fetchFn = vi.fn<typeof fetch>((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Timed out', 'TimeoutError')), { once: true });
    }));
    const handler = makeHandler({ fetchFn });
    const pending = handler();
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledOnce());
    controller.abort();
    const failed = await pending;
    expect(failed.status).toBe(502);
    expect(timeout).toHaveBeenCalledWith(15_000);
    fetchFn.mockResolvedValueOnce(Response.json({ rows: ['recovered'] }));
    expect(await (await handler()).json()).toEqual({ rows: ['recovered'] });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});
