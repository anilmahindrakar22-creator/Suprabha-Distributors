import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearOrderBootstrapCache, loadOrderBootstrap } from '../../lib/order-bootstrap-cache';

const bootstrap = {
  actor: { email: 'ops@example.com', role: 'operations' },
  snapshot: { company: 'Suprabha', fetchedAt: '', catalog: [] },
  customers: [],
  orders: [],
  operations: {},
};

afterEach(clearOrderBootstrapCache);

describe('order bootstrap cache', () => {
  it('shares one in-flight and resolved request for the same signed-in account', async () => {
    const fetchFn = vi.fn(async () => Response.json(bootstrap));
    const first = loadOrderBootstrap('OPS@example.com', false, fetchFn as typeof fetch);
    const second = loadOrderBootstrap(' ops@example.com ', false, fetchFn as typeof fetch);
    expect(await first).toEqual(bootstrap);
    expect(await second).toEqual(bootstrap);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledWith('/api/orders?list=1', { cache: 'no-store' });
  });

  it('allows an explicit refresh and retries after a failed preload', async () => {
    const failedFetch = vi.fn(async () => Response.json({ error: 'Temporary failure' }, { status: 502 }));
    await expect(loadOrderBootstrap('ops@example.com', false, failedFetch as typeof fetch)).rejects.toThrow('Temporary failure');
    const recoveredFetch = vi.fn(async () => Response.json(bootstrap));
    await loadOrderBootstrap('ops@example.com', false, recoveredFetch as typeof fetch);
    await loadOrderBootstrap('ops@example.com', true, recoveredFetch as typeof fetch);
    expect(recoveredFetch).toHaveBeenCalledTimes(2);
  });
});
