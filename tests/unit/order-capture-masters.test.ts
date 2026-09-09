import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearOrderCaptureMasterCache, loadOrderCatalog, loadOrderCustomers } from '../../lib/order-capture-masters';

beforeEach(() => clearOrderCaptureMasterCache());

describe('order capture master prefetch', () => {
  it('deduplicates catalog and customer reads per account', async () => {
    const fetchFn: typeof fetch = vi.fn(async (input) => String(input).includes('catalog=1')
      ? Response.json({ catalogVersion: 'v1', catalog: [] })
      : Response.json({ customerVersion: 'v1', customers: [] }));
    const firstCatalog = loadOrderCatalog(' Sales@Example.com ', 'catalog-v1', fetchFn);
    const secondCatalog = loadOrderCatalog('sales@example.com', 'catalog-v1', fetchFn);
    const firstCustomers = loadOrderCustomers('sales@example.com', 'customer-v1', fetchFn);
    const secondCustomers = loadOrderCustomers('SALES@example.com', 'customer-v1', fetchFn);
    expect(firstCatalog).toBe(secondCatalog);
    expect(firstCustomers).toBe(secondCustomers);
    await Promise.all([firstCatalog, firstCustomers]);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('isolates accounts and permits a retry after a failed prefetch', async () => {
    const fetchFn: typeof fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ error: 'offline' }, { status: 503 }))
      .mockImplementation(async () => Response.json({ catalogVersion: 'v2', catalog: [] }));
    await expect(loadOrderCatalog('first@example.com', 'v2', fetchFn)).rejects.toThrow('offline');
    await expect(loadOrderCatalog('first@example.com', 'v2', fetchFn)).resolves.toMatchObject({ catalogVersion: 'v2' });
    await expect(loadOrderCatalog('second@example.com', 'v2', fetchFn)).resolves.toMatchObject({ catalogVersion: 'v2' });
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('loads fresh masters when the Tally version changes', async () => {
    const fetchFn: typeof fetch = vi.fn(async () => Response.json({ catalogVersion: 'current', catalog: [] }));
    await loadOrderCatalog('sales@example.com', 'catalog-v1', fetchFn);
    await loadOrderCatalog('sales@example.com', 'catalog-v2', fetchFn);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});
