import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ user: vi.fn(), session: vi.fn(), gateway: vi.fn() }));
vi.mock('@/app/chatgpt-auth', () => ({ getChatGPTUser: mocks.user }));
vi.mock('@/lib/stockflow-session', () => ({ getStockFlowSession: mocks.session }));
vi.mock('@/lib/order-gateway', async original => ({ ...await original<typeof import('@/lib/order-gateway')>(), callOrderGateway: mocks.gateway }));
import { GET } from '@/app/api/growth/labs/route';
import { OrderGatewayError } from '@/lib/order-gateway';
const sample = { list: 'month_skipped', month: '2026-10', total: 1, page: 1, pageSize: 20, rows: [{ labKey: 'ledger-a', customerId: 'customer-a', name: 'Lab A', town: null, valuePaise: null, monthsBought: 10, lastBoughtOn: '2026-09-02', trend: 'down' }] };
const get = (query: string) => GET(new Request('https://app.example.test/api/growth/labs?' + query));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ email: 'manager@example.test' });
  mocks.session.mockResolvedValue({ email: 'manager@example.test', roles: ['management'] });
  mocks.gateway.mockResolvedValue(sample);
});
describe('Growth labs route', () => {
  it.each([
    '', 'list=regular_labs', 'list=nope&page=1', 'list=month_buying&page=1', 'list=month_buying&month=2026-13&page=1',
    'list=month_buying&month=2026-1&page=1', 'list=month_buying&month=2026-10-01&page=1',
    'list=bridge_new&month=2026-10&page=1', 'list=regular_labs&month=2026-10&page=1',
    'list=month_skipped&month=2026-10&page=1&regularOnly=true', 'list=bridge_new&page=1&regularOnly=false',
    'list=bridge_stopped&page=1&regularOnly=1', 'list=bridge_stopped&page=1&regularOnly=',
    'list=regular_labs&page=0', 'list=regular_labs&page=-1', 'list=regular_labs&page=1.5',
    'list=regular_labs&page=abc', 'list=regular_labs&page=1&sort=name',
    'list=regular_labs&page=1&unknown=true', 'list=regular_labs&list=bridge_new&page=1',
  ])('rejects invalid parameters without calling the gateway: %s', async query => {
    expect((await get(query)).status).toBe(400);
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it.each<[string, Record<string, unknown>]>([
    ['list=month_skipped&month=2026-10&page=1', { list: 'month_skipped', month: '2026-10', page: 1 }],
    ['list=month_buying&month=2026-10&page=2&sort=value', { list: 'month_buying', month: '2026-10', page: 2, sort: 'value' }],
    ['list=month_first&month=2026-10&page=1&sort=last', { list: 'month_first', month: '2026-10', page: 1, sort: 'last' }],
    ['list=month_large_purchases&month=2026-10&page=1', { list: 'month_large_purchases', month: '2026-10', page: 1 }],
    ['list=bridge_stopped&page=1&regularOnly=true&sort=months', { list: 'bridge_stopped', page: 1, regularOnly: true, sort: 'months' }],
    ['list=bridge_stopped&page=1&regularOnly=false', { list: 'bridge_stopped', page: 1, regularOnly: false }],
    ...['bridge_new', 'bridge_grew', 'bridge_fell', 'regular_labs'].map(list => [`list=${list}&page=1`, { list, page: 1 }] as [string, Record<string, unknown>]),
  ])('passes only the exact validated payload: %s', async (query, payload) => {
    const params = new URLSearchParams(query as string);
    const responseSample = { ...sample, list: params.get('list'), month: params.get('month'), page: Number(params.get('page')), rows: params.get('list') === 'month_large_purchases' ? [{ supplierName: 'Supplier A', valuePaise: 10000000, date: '2026-10-02' }] : sample.rows };
    mocks.gateway.mockResolvedValue(responseSample);
    const response = await get(query as string);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual(responseSample);
    expect(mocks.gateway).toHaveBeenCalledWith('manager@example.test', 'get_growth_labs', payload);
  });
  it.each(['sales', 'operations', 'accounts', 'warehouse'])('rejects %s before gateway access', async role => {
    mocks.session.mockResolvedValue({ email: 'staff@example.test', roles: [role] });
    expect((await get('list=regular_labs&page=1')).status).toBe(403);
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it('requires sign in', async () => {
    mocks.user.mockResolvedValue(null);
    expect((await get('list=regular_labs&page=1')).status).toBe(401);
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it('passes through gateway 403', async () => {
    mocks.gateway.mockRejectedValue(new OrderGatewayError('Denied', 403));
    expect((await get('list=regular_labs&page=1')).status).toBe(403);
  });
  it('rejects malformed gateway data', async () => {
    mocks.gateway.mockResolvedValue({ rows: [] });
    expect((await get('list=regular_labs&page=1')).status).toBe(502);
  });
});
