import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toOrderReasonText, toOrderStockText } from '../../lib/to-order';
import { toOrderItem, toOrderResponse } from '../fixtures/api-builders';
import { GET } from '../../app/api/requirements/route';
import { callOrderGateway } from '../../lib/order-gateway';

vi.mock('../../app/chatgpt-auth', () => ({ getChatGPTUser: async () => ({ email: 'test@example.test' }) }));
vi.mock('../../lib/order-gateway', async (original) => ({
  ...await original<typeof import('../../lib/order-gateway')>(), callOrderGateway: vi.fn(),
}));

describe('to order API pass-through', () => {
  beforeEach(() => vi.mocked(callOrderGateway).mockReset());

  it('passes only the authenticated actor, page and view and preserves the response', async () => {
    const body = toOrderResponse({ page: 2 });
    vi.mocked(callOrderGateway).mockResolvedValue(body);
    const response = await GET(new Request('http://local/api/requirements?view=to_order&page=2&actorEmail=other'));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual(body);
    expect(callOrderGateway).toHaveBeenCalledWith('test@example.test', 'get_requirements', { page: 2, view: 'to_order' });
  });

  it.each(['view=other&page=1', 'view=&page=1', 'view=to_order', 'view=to_order&page=',
    'view=to_order&page=0', 'view=to_order&page=1&alerts=1', 'view=to_order&page=1&itemKey=kit'])('rejects invalid view query %s', async (query) => {
    expect((await GET(new Request(`http://local/api/requirements?${query}`))).status).toBe(400);
    expect(callOrderGateway).not.toHaveBeenCalled();
  });
});

describe('to order text', () => {
  it('joins waiting and reorder reasons', () => {
    expect(toOrderReasonText(toOrderItem())).toBe('3 customer orders waiting · Below reorder level');
    expect(toOrderReasonText(toOrderItem({ waitingOrders: 1, reasons: ['waiting_orders'] }))).toBe('1 customer order waiting');
    expect(toOrderReasonText(toOrderItem({ waitingOrders: 0, reasons: ['below_reorder'] }))).toBe('Below reorder level');
    expect(toOrderReasonText(toOrderItem({ reasons: [] }))).toBe('');
  });

  it('shows stock and reorder values, including zero, without inventing null values', () => {
    expect(toOrderStockText(toOrderItem())).toBe('In stock 2 · reorder level 5');
    expect(toOrderStockText(toOrderItem({ closing: 0, reorderLevel: null }))).toBe('In stock 0');
    expect(toOrderStockText(toOrderItem({ closing: null, reorderLevel: 0 }))).toBe('reorder level 0');
    expect(toOrderStockText(toOrderItem({ closing: null, reorderLevel: null }))).toBe('');
    expect(toOrderStockText(toOrderItem({ closing: -2.5, reorderLevel: 1.5 }))).toBe('In stock -2.5 · reorder level 1.5');
  });

  it('keeps unknown stock explicit even when other stock fields are present', () => {
    expect(toOrderStockText(toOrderItem({ state: 'stock_unknown', suggestedQty: null }))).toBe('Stock unknown, check Tally');
  });

  it('builds complete envelopes and independent defaults with explicit overrides', () => {
    const response = toOrderResponse();
    expect(Object.keys(response).sort()).toEqual(['view', 'page', 'pageSize', 'total', 'waitingCount', 'unknownCount', 'items'].sort());
    expect(Object.values(response.items[0])).not.toContain(undefined);
    response.items[0].reasons.push('below_reorder');
    expect(toOrderResponse().items[0].reasons).toHaveLength(2);
    expect(toOrderResponse({ items: [], total: 0 }).items).toEqual([]);
  });
});
