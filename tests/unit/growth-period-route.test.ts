import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ user: vi.fn(), session: vi.fn(), gateway: vi.fn() }));
vi.mock('@/app/chatgpt-auth', () => ({ getChatGPTUser: mocks.user }));
vi.mock('@/lib/stockflow-session', () => ({ getStockFlowSession: mocks.session }));
vi.mock('@/lib/order-gateway', async original => ({ ...await original<typeof import('@/lib/order-gateway')>(), callOrderGateway: mocks.gateway }));
// Legacy response normalization is covered by growth-route.test.ts.
vi.mock('@/lib/growth-types', () => ({ normalizeGrowth: (value: unknown) => value }));
import { GET } from '@/app/api/growth/route';

const tree = { revenuePaise: 0, repeatPaise: 0, bulkPaise: 0, bulkInvoices: 0, labsBuying: 0, buyingMonths: 0, perBuyingMonthPaise: null };
const check = { days: 1, historyDays: 0, historySharePct: 0, coverageComplete: false, months: [{ month: '2026-04', state: 'no_control' }], state: 'no_history' };
const period = { kind: 'fy', fy: 2026, quarter: null, label: 'FY 2026-27', from: '2026-04-01', to: '2027-03-31', running: false };
const sample = {
  view: 'period', period,
  current: { key: 'current', label: period.label, from: period.from, to: period.to, tree, check },
  comparisons: [{ key: 'last_year', label: 'FY 2025-26', from: '2025-04-01', to: '2026-03-31', tree: null, bridge: null, check }],
};
const request = (query = '') => new Request(`http://localhost/api/growth${query}`);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ email: 'manager@example.test' });
  mocks.session.mockResolvedValue({ email: 'manager@example.test', roles: ['management'] });
  mocks.gateway.mockResolvedValue(sample);
});

describe('Growth period route', () => {
  it('sends the exact FY payload and returns a validated response', async () => {
    const response = await GET(request('?period=fy-2026'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(sample);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.gateway).toHaveBeenCalledWith('manager@example.test', 'get_growth_period', { period: { kind: 'fy', fy: 2026 } });
  });
  it('sends the exact quarter payload', async () => {
    await GET(request('?period=q3-2026'));
    expect(mocks.gateway).toHaveBeenCalledWith('manager@example.test', 'get_growth_period', { period: { kind: 'quarter', fy: 2026, quarter: 3 } });
  });
  it.each(['?other=x', '?period=fy-2026&other=x', '?period=fy-2026&period=q3-2026', '?period=', '?period=q5-2026', '?period=fy-26', '?period=Q3-2026', '?period=fy-2026x'])('rejects %s before reading', async query => {
    const response = await GET(request(query));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid growth period' });
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it('refuses a sales-only session', async () => {
    mocks.session.mockResolvedValue({ email: 'sales@example.test', roles: ['sales'] });
    expect((await GET(request('?period=fy-2026'))).status).toBe(403);
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it.each(['', '?period=rolling12'])('retains get_growth for %s', async query => {
    mocks.gateway.mockResolvedValue({ legacy: true });
    expect((await GET(request(query))).status).toBe(200);
    expect(mocks.gateway).toHaveBeenCalledWith('manager@example.test', 'get_growth', {});
  });
  it('rejects malformed period responses', async () => {
    mocks.gateway.mockResolvedValue({ view: 'period' });
    expect((await GET(request('?period=fy-2026'))).status).toBe(502);
  });
});
