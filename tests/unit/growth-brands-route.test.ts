import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ user: vi.fn(), session: vi.fn(), gateway: vi.fn() }));
vi.mock('@/app/chatgpt-auth', () => ({ getChatGPTUser: mocks.user }));
vi.mock('@/lib/stockflow-session', () => ({ getStockFlowSession: mocks.session }));
vi.mock('@/lib/order-gateway', async original => ({ ...await original<typeof import('@/lib/order-gateway')>(), callOrderGateway: mocks.gateway }));
import { GET, POST } from '@/app/api/growth/brands/route';
import { OrderGatewayError } from '@/lib/order-gateway';
const measures = { salesPaise: 1000, h1Paise: 400, h2Paise: 600, instrumentSalesPaise: 100, consumablesSalesPaise: 900, knownSalesPaise: 800, gpPaise: 200, marginPct: 25, items: 3 };
const sample = {
  window: { from: '2025-11-01', to: '2026-11-01', h2From: '2026-05-01' },
  totals: { salesPaise: 1000, instrumentSalesPaise: 100, consumablesSalesPaise: 900, knownSalesPaise: 800, gpPaise: 200, marginPct: 25 },
  rows: [
    { key: 'brand:ALPHA', kind: 'brand', brandCode: 'ALPHA', name: 'Alpha', ...measures, lines: [{ kind: 'line', group: 'Group A', areaCode: 'HAEM', ...measures }] },
    { key: 'none', kind: 'none', brandCode: null, name: 'Not a principal product', ...measures, lines: [] },
    { key: 'unmapped', kind: 'unmapped', brandCode: null, name: 'Not mapped', ...measures, lines: [] },
  ],
};
const get = (q = '') => GET(new Request('https://app.test/api/growth/brands' + (q ? `?${q}` : '')));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ email: 'manager@example.test' });
  mocks.session.mockResolvedValue({ email: 'manager@example.test', roles: ['management'] });
  mocks.gateway.mockResolvedValue({ ...sample, extra: 'ignored' });
});
describe('Growth brands route', () => {
  it('requires sign in', async () => { mocks.user.mockResolvedValue(null); expect((await get()).status).toBe(401); expect(mocks.gateway).not.toHaveBeenCalled(); });
  it('denies a missing session', async () => { mocks.session.mockResolvedValue(null); expect((await get()).status).toBe(403); expect(mocks.gateway).not.toHaveBeenCalled(); });
  it.each(['operations', 'sales', 'accounts', 'warehouse'])('denies %s', async role => {
    mocks.session.mockResolvedValue({ email: 'x@example.test', roles: [role] });
    const response = await get();
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Growth is for management only.' });
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it.each(['a=1', 'page=1', 'view=items&page=1', 'q='])('rejects any query parameter %s', async q => {
    const response = await get(q);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid growth brands parameters' });
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it.each(['management', 'administrator'])('returns normalized data for %s with the exact gateway call', async role => {
    mocks.session.mockResolvedValue({ email: 'manager@example.test', roles: [role] });
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual(sample);
    expect(mocks.gateway).toHaveBeenCalledWith('manager@example.test', 'get_growth_brands', {});
  });
  it.each([{}, null, { ...sample, rows: [{ ...sample.rows[0], salesPaise: 1.5 }] }])('returns 502 for malformed response %#', async value => {
    mocks.gateway.mockResolvedValue(value);
    const response = await get();
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'Growth is unavailable. Try again.' });
  });
  it('keeps the gateway error status and maps other failures to 502', async () => {
    mocks.gateway.mockRejectedValue(new OrderGatewayError('Denied', 403));
    expect((await get()).status).toBe(403);
    mocks.gateway.mockRejectedValue(new Error('bad'));
    expect((await get()).status).toBe(502);
  });
  it('rejects writes', () => {
    const response = POST();
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });
});
