import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ user: vi.fn(), session: vi.fn(), gateway: vi.fn() }));
vi.mock('@/app/chatgpt-auth', () => ({ getChatGPTUser: mocks.user }));
vi.mock('@/lib/stockflow-session', () => ({ getStockFlowSession: mocks.session }));
vi.mock('@/lib/order-gateway', async (original) => ({ ...await original<typeof import('@/lib/order-gateway')>(), callOrderGateway: mocks.gateway }));
import { GET } from '@/app/api/offline-catalog/route';
const request = (query = 'kind=products') => new Request(`https://staff.example/api/offline-catalog?${query}`);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ email: 'staff@example.com' });
  mocks.session.mockResolvedValue({ email: 'staff@example.com', role: 'sales', roles: ['sales'] });
  mocks.gateway.mockResolvedValue({ catalogVersion: 'v1', catalog: [{ tallyKey: 'p1', item: 'Product', group: 'Group', baseUnit: 'Nos', active: true, closing: 99, price: 123, cost: 20 }] });
});
describe('offline catalogue authorization and projection', () => {
  it('requires online verified identity', async () => {
    mocks.user.mockResolvedValue(null);
    expect((await GET(request())).status).toBe(401);
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it.each([null, { roles: ['viewer'] }, { roles: ['unknown', 'sales'] }])('denies missing or unauthorized membership', async (session) => {
    mocks.session.mockResolvedValue(session);
    expect((await GET(request())).status).toBe(403);
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it('allows combined order-entry roles and excludes commercial/stock values', async () => {
    mocks.session.mockResolvedValue({ email: 'staff@example.com', roles: ['warehouse', 'sales'] });
    const response = await GET(request());
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual({ actorEmail: 'staff@example.com', version: 'v1', rows: [{ tallyKey: 'p1', item: 'Product', group: 'Group', baseUnit: 'Nos' }] });
  });
  it('excludes customer balances and contact details', async () => {
    mocks.gateway.mockResolvedValue({ customerVersion: 'c1', customers: [{ id: 'c', name: 'Customer', phone: '123', tallyBalance: 900 }] });
    const body = await (await GET(request('kind=customers'))).json() as { rows: unknown[] };
    expect(body.rows).toEqual([{ id: 'c', name: 'Customer' }]);
  });
  it('rejects oversized downloads without silently truncating data', async () => {
    mocks.gateway.mockResolvedValue({ catalogVersion: 'v2', catalog: Array.from({ length: 10_001 }, (_, i) => ({ tallyKey: String(i), item: 'P', active: true })) });
    expect((await GET(request())).status).toBe(413);
    expect(mocks.gateway).toHaveBeenCalledTimes(1);
  });
  it('rejects invalid requests before loading directory data', async () => {
    expect((await GET(request('kind=prices'))).status).toBe(400);
    expect((await GET(request('kind=products&offset=-1'))).status).toBe(400);
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it('does not leak upstream exception details', async () => {
    mocks.gateway.mockRejectedValue(new Error('private token and price'));
    const response = await GET(request());
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain('private token');
  });
});
