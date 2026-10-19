import { describe, expect, it, vi } from 'vitest';
import { loadOrderPriceApprovals } from '@/lib/order-price-approvals';

const order = (id: string, pricingState: string, createdAt = '2026-10-01T00:00:00Z') => ({ id, orderNumber: `SO-${id}`, customerName: `Lab ${id}`, createdAt, pricingState });
const workspace = (id: string, exceptions: unknown[]) => ({ orderId: id, exceptions, lines: [], history: [] });

function fetchFrom(pages: unknown[][], pricing: Record<string, unknown[]>, pageCount = pages.length) {
  return vi.fn(async (url: string) => {
    const parsed = new URL(url, 'https://x.test');
    if (parsed.pathname === '/api/orders') return Response.json({ orders: pages[Number(parsed.searchParams.get('page')) - 1] ?? [], pagination: { pageCount } });
    const id = parsed.searchParams.get('orderId')!;
    return Response.json(workspace(id, pricing[id] ?? []));
  });
}

describe('loadOrderPriceApprovals', () => {
  it('pages active orders, loads pricing only for those awaiting approval, oldest first', async () => {
    const fetchFn = fetchFrom([[order('a', 'approved'), order('b', 'approval_required', '2026-10-05T00:00:00Z')], [order('c', 'approval_required', '2026-09-20T00:00:00Z'), order('d', 'approval_required')]], { b: [{ id: 'e1' }], c: [{ id: 'e2' }], d: [] });
    const result = await loadOrderPriceApprovals(fetchFn as unknown as typeof fetch);
    expect(result.items.map((item) => item.orderId)).toEqual(['c', 'b']);
    expect(result.truncated).toBe(false);
    const urls = fetchFn.mock.calls.map(([url]) => url);
    expect(urls).toContain('/api/orders?list=1&status=open&page=2');
    expect(urls.filter((url) => url.startsWith('/api/pricing'))).toHaveLength(3);
    expect(urls.some((url) => url.includes('orderId=a'))).toBe(false);
  });
  it('stops after ten pages and says the list is truncated', async () => {
    const fetchFn = fetchFrom(Array.from({ length: 12 }, () => []), {}, 12);
    const result = await loadOrderPriceApprovals(fetchFn as unknown as typeof fetch);
    expect(fetchFn).toHaveBeenCalledTimes(10);
    expect(result).toEqual({ items: [], truncated: true });
  });
  it('surfaces a failed read as a plain error', async () => {
    const fetchFn = vi.fn(async () => Response.json({ error: 'Access denied' }, { status: 403 }));
    await expect(loadOrderPriceApprovals(fetchFn as unknown as typeof fetch)).rejects.toThrow('Access denied');
  });
});
