import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ user: vi.fn(), session: vi.fn(), gateway: vi.fn() }));
vi.mock('@/app/chatgpt-auth', () => ({ getChatGPTUser: mocks.user }));
vi.mock('@/lib/stockflow-session', () => ({ getStockFlowSession: mocks.session }));
vi.mock('@/lib/order-gateway', async original => ({ ...await original<typeof import('@/lib/order-gateway')>(), callOrderGateway: mocks.gateway }));
import { GET, POST } from '@/app/api/growth/lab-months/route';
import { OrderGatewayError } from '@/lib/order-gateway';
const sample = {
  window: { from: '2025-11-01', to: '2026-11-01' },
  months: ['2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'],
  totalLabs: 2,
  rows: [{ labKey: 'c|1', customerId: null, name: 'Lab A', town: null, totalPaise: 1200, monthsPaise: Array(12).fill(100), buyingMonths: 12 }],
};
const get = (q = '') => GET(new Request('https://app.test/api/growth/lab-months' + (q ? `?${q}` : '')));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ email: 'manager@example.test' });
  mocks.session.mockResolvedValue({ email: 'manager@example.test', roles: ['management'] });
  mocks.gateway.mockResolvedValue({ ...sample, extra: 'ignored' });
});
describe('Growth lab months route', () => {
  it('requires sign in', async () => { mocks.user.mockResolvedValue(null); expect((await get()).status).toBe(401); expect(mocks.gateway).not.toHaveBeenCalled(); });
  it('denies a missing session', async () => { mocks.session.mockResolvedValue(null); expect((await get()).status).toBe(403); expect(mocks.gateway).not.toHaveBeenCalled(); });
  it.each(['operations', 'sales', 'accounts', 'warehouse'])('denies %s', async role => {
    mocks.session.mockResolvedValue({ email: 'x@example.test', roles: [role] });
    const response = await get();
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Growth is for management only.' });
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it.each(['a=1', 'page=1', 'q='])('rejects any query parameter %s', async q => {
    const response = await get(q);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid growth lab months parameters' });
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it.each(['management', 'administrator'])('returns normalized data for %s with the exact gateway call', async role => {
    mocks.session.mockResolvedValue({ email: 'manager@example.test', roles: [role] });
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual(sample);
    expect(mocks.gateway).toHaveBeenCalledWith('manager@example.test', 'get_growth_lab_months', {});
  });
  it.each([{}, null, { ...sample, rows: [{ ...sample.rows[0], totalPaise: 1.5 }] }])('returns 502 for malformed response %#', async value => {
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
