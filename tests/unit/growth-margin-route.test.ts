import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ user: vi.fn(), session: vi.fn(), gateway: vi.fn() }));
vi.mock('@/app/chatgpt-auth', () => ({ getChatGPTUser: mocks.user }));
vi.mock('@/lib/stockflow-session', () => ({ getStockFlowSession: mocks.session }));
vi.mock('@/lib/order-gateway', async original => ({ ...await original<typeof import('@/lib/order-gateway')>(), callOrderGateway: mocks.gateway }));
import { GET, POST } from '@/app/api/growth/margin/route';
import { OrderGatewayError } from '@/lib/order-gateway';
const sample = { view: 'labs', sort: 'sales', filter: 'all', q: null, page: 1, pageSize: 20, total: 0, thresholdPct: 14, consumablesMarginPct: 28, levers: { priceSpread: { items: 0, pairs: 0, paise: 0 }, lowMargin: { items: 0, paiseToThreshold: 0, examples: [] }, freeGoods: { lines: 0, costPaise: 0 }, instrumentsGpPaise: -100 }, rows: [] };
const itemDetail = { kind: 'item', itemKey: 'i', name: null, typicalPricePaise: null, labs: 0, marginPct: null, tallyItemKey: null, page: 1, pageSize: 20, total: 0, rows: [] };
const labDetail = { kind: 'lab', labKey: 'l', customerId: null, name: null, town: null, salesPaise: 0, gpPaise: 0, marginPct: null, page: 1, pageSize: 20, total: 0, rows: [] };
const get = (q: string) => GET(new Request('https://app.test/api/growth/margin?' + q));
const billed = { lines: 0, gapPaise: 0, unitMismatchLines: 0, approvedPricesInUse: 0, page: 1, pageSize: 20, total: 0, rows: [] };
beforeEach(() => { vi.clearAllMocks(); mocks.user.mockResolvedValue({ email: 'manager@example.test' }); mocks.session.mockResolvedValue({ email: 'manager@example.test', roles: ['management'] }); mocks.gateway.mockResolvedValue(sample); });
describe('Growth margin route', () => {
  it.each(['management', 'administrator'])('forwards billed below with only page for %s', async role => {
    mocks.session.mockResolvedValue({ email: 'manager@example.test', roles: [role] });
    mocks.gateway.mockResolvedValue({ ...billed, page: 2 });
    const response = await get('billedBelow=1&page=2');
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ ...billed, page: 2 });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.gateway).toHaveBeenCalledWith('manager@example.test', 'get_growth_billed_below', { page: 2 });
  });
  it.each(['billedBelow=0&page=1', 'billedBelow=true&page=1', 'billedBelow=1', 'billedBelow=1&page=0', 'billedBelow=1&page=01', 'billedBelow=1&page=1.5', 'billedBelow=1&page=9007199254740992', 'billedBelow=1&page=1&page=2', 'billedBelow=1&billedBelow=1&page=1', ...['view=items', 'itemKey=i', 'labKey=l', 'sort=sales', 'filter=all', 'q=a', 'unknown=1'].map(p => `billedBelow=1&page=1&${p}`)])('rejects invalid billed below query %s', async q => { expect((await get(q)).status).toBe(400); expect(mocks.gateway).not.toHaveBeenCalled(); });
  it.each(['sales', 'operations', 'accounts', 'warehouse'])('denies billed below for %s', async role => { mocks.session.mockResolvedValue({ roles: [role] }); expect((await get('billedBelow=1&page=1')).status).toBe(403); expect(mocks.gateway).not.toHaveBeenCalled(); });
  it('requires sign in for billed below', async () => { mocks.user.mockResolvedValue(null); expect((await get('billedBelow=1&page=1')).status).toBe(401); expect(mocks.gateway).not.toHaveBeenCalled(); });
  it.each([{}, { ...billed, page: 2 }, { ...billed, pageSize: 10 }, { ...billed, gapPaise: 1.5 }])('rejects malformed billed below response %#', async value => { mocks.gateway.mockResolvedValue(value); expect((await get('billedBelow=1&page=1')).status).toBe(502); });
  it('preserves billed below gateway failures', async () => { mocks.gateway.mockRejectedValue(new OrderGatewayError('Denied', 403)); expect((await get('billedBelow=1&page=1')).status).toBe(403); });
  it.each(['sales', 'operations', 'accounts', 'warehouse'])('denies %s before reads', async role => { mocks.session.mockResolvedValue({ roles: [role] }); expect((await get('view=labs&page=1')).status).toBe(403); expect(mocks.gateway).not.toHaveBeenCalled(); });
  it('requires sign in and a session', async () => { mocks.user.mockResolvedValue(null); expect((await get('view=labs&page=1')).status).toBe(401); mocks.user.mockResolvedValue({ email: 'x' }); mocks.session.mockResolvedValue(null); expect((await get('view=labs&page=1')).status).toBe(403); expect(mocks.gateway).not.toHaveBeenCalled(); });
  it.each(['management', 'administrator'])('allows %s and disables caching', async role => { mocks.session.mockResolvedValue({ email: 'manager@example.test', roles: [role] }); const r = await get('view=labs&page=1'); expect(r.status).toBe(200); expect(r.headers.get('cache-control')).toBe('private, no-store'); });
  it.each(['', 'view=labs', 'view=labs&page=0', 'view=labs&page=01', 'view=labs&page=1.5', 'view=labs&page=9007199254740992', 'view=labs&page=1&sort=spread', 'view=items&page=1&filter=unlinked', 'view=labs&page=1&filter=spread', 'view=labs&page=1&q=', 'view=labs&page=1&q=' + 'a'.repeat(61), 'view=labs&page=1&unknown=1', 'view=labs&page=1&page=2', 'view=labs&view=items&page=1', 'itemKey=i&labKey=l&page=1', 'itemKey=i&view=items&page=1', 'itemKey=i&page=1&sort=sales', 'itemKey=&page=1', 'labKey=l&page=1&q=a'])('rejects invalid parameters %s', async q => { expect((await get(q)).status).toBe(400); expect(mocks.gateway).not.toHaveBeenCalled(); });
  it.each([
    ['view=labs&page=1', { view: 'labs', page: 1 }, sample],
    ['view=labs&page=2&sort=margin_asc&filter=unlinked&q=Lab', { view: 'labs', page: 2, sort: 'margin_asc', filter: 'unlinked', q: 'Lab' }, { ...sample, page: 2, sort: 'margin_asc', filter: 'unlinked', q: 'Lab' }],
    ['view=items&page=1&sort=spread&filter=low', { view: 'items', page: 1, sort: 'spread', filter: 'low' }, { ...sample, view: 'items', sort: 'spread', filter: 'low' }],
  ] as const)('forwards exact list payload %s', async (q, payload, response) => { mocks.gateway.mockResolvedValue(response); expect((await get(q)).status).toBe(200); expect(mocks.gateway).toHaveBeenCalledWith('manager@example.test', 'get_growth_margin', payload); });
  it.each([['itemKey=i&page=1', { itemKey: 'i', page: 1 }, itemDetail], ['labKey=l&page=1', { labKey: 'l', page: 1 }, labDetail]] as const)('forwards exact detail payload %s', async (q, payload, response) => { mocks.gateway.mockResolvedValue(response); expect((await get(q)).status).toBe(200); expect(mocks.gateway).toHaveBeenCalledWith('manager@example.test', 'get_growth_margin_detail', payload); });
  it.each([{ ...sample, page: 2 }, { ...sample, view: 'items' }, { ...sample, sort: 'gp' }, { ...sample, filter: 'low' }, { ...sample, q: 'x' }, {}])('rejects malformed or mismatched list response %#', async response => { mocks.gateway.mockResolvedValue(response); expect((await get('view=labs&page=1')).status).toBe(502); });
  it.each([{ ...itemDetail, itemKey: 'other' }, { ...itemDetail, page: 2 }, labDetail])('rejects mismatched detail %#', async response => { mocks.gateway.mockResolvedValue(response); expect((await get('itemKey=i&page=1')).status).toBe(502); });
  it('preserves gateway status and maps other failures', async () => { mocks.gateway.mockRejectedValue(new OrderGatewayError('Denied', 403)); expect((await get('view=labs&page=1')).status).toBe(403); mocks.gateway.mockRejectedValue(new Error('bad')); expect((await get('view=labs&page=1')).status).toBe(502); });
  it('rejects writes', () => { const r = POST(); expect(r.status).toBe(405); expect(r.headers.get('allow')).toBe('GET'); expect(r.headers.get('cache-control')).toBe('private, no-store'); });
});
