import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ user: vi.fn(), session: vi.fn(), gateway: vi.fn() }));
vi.mock('@/app/chatgpt-auth', () => ({ getChatGPTUser: mocks.user }));
vi.mock('@/lib/stockflow-session', () => ({ getStockFlowSession: mocks.session }));
vi.mock('@/lib/order-gateway', async original => ({ ...await original<typeof import('@/lib/order-gateway')>(), callOrderGateway: mocks.gateway }));
import { GET, POST } from '@/app/api/growth/route';
import { OrderGatewayError } from '@/lib/order-gateway';
const sample = {
  companyCount: 1, window: { from: '2025-11-01', to: '2026-11-01', h1From: '2025-11-01', h2From: '2026-05-01' },
  confirmed: true, confirmedReason: null,
  scorecard: { regularLabs: 20, regularPct: 40, top10Pct: 35 },
  months: Array.from({ length: 12 }, (_, i) => ({ month: new Date(Date.UTC(2025, 10 + i, 1)).toISOString().slice(0, 7), labsBuying: 68, firstTime: 3, skippedRegulars: 12, salesPaise: 150000000, purchasesRegularPaise: 100000000, purchasesLargePaise: 20000000, largePurchaseInvoices: 1 })),
  tree: { revenuePaise: 1818000000, repeatPaise: 1367000000, bulkPaise: 451000000, bulkInvoices: 10, labsBuying: 164, buyingMonths: 760, perBuyingMonthPaise: 1799200 },
  halves: [
    { half: 'H1', revenuePaise: 715000000, repeatPaise: 579000000, bulkPaise: 136000000, bulkInvoices: 4, labsBuying: 121, buyingMonths: 374, perBuyingMonthPaise: 1548400 },
    { half: 'H2', revenuePaise: 1103000000, repeatPaise: 788000000, bulkPaise: 315000000, bulkInvoices: 6, labsBuying: 130, buyingMonths: 386, perBuyingMonthPaise: 2042200 },
  ],
  bridge: { h1Paise: 715000000, h2Paise: 1103000000, new: { labs: 43, paise: 179000000 }, stopped: { labs: 34, paise: 174000000 }, stoppedRegular: { labs: 4, paise: 21000000 }, grew: { labs: 41, paise: 483000000 }, fell: { labs: 46, paise: 100000000 }, same: { labs: 0, paise: 0 }, other: { labs: 0, paise: 0 } },
  health: { gp: { costedPct: 2, computedAt: null }, history: { firstSaleOn: '2025-10-01', monthsImported: 13 }, itemGroups: { unmappedPct: 21 }, reasons: { visitReasons180: 0, constraints: 0, openActions: 0, visits180: 4 }, catalog: { observedAt: '2026-11-09T00:00:00Z', groups: 30 } },
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ email: 'manager@example.test' });
  mocks.session.mockResolvedValue({ email: 'manager@example.test', roles: ['management'] });
  mocks.gateway.mockResolvedValue(sample);
});
describe('Growth route', () => {
  it.each(['management', 'administrator'])('allows %s and calls get_growth with empty payload', async role => {
    mocks.session.mockResolvedValue({ email: 'manager@example.test', roles: [role] });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual(sample);
    expect(mocks.gateway).toHaveBeenCalledWith('manager@example.test', 'get_growth', {});
  });
  it.each(['sales', 'operations', 'warehouse', 'accounts'])('refuses %s without reading data', async role => {
    mocks.session.mockResolvedValue({ email: 'staff@example.test', roles: [role] });
    expect((await GET()).status).toBe(403);
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it('requires a session', async () => {
    mocks.user.mockResolvedValue(null); expect((await GET()).status).toBe(401);
    mocks.user.mockResolvedValue({ email: 'x@example.test' }); mocks.session.mockResolvedValue(null);
    expect((await GET()).status).toBe(403); expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it('passes gateway 403 through', async () => {
    mocks.gateway.mockRejectedValue(new OrderGatewayError('Denied', 403));
    expect((await GET()).status).toBe(403);
  });
  it('recognizes the Edge PT403 response as forbidden', async () => {
    const actual = await vi.importActual<typeof import('@/lib/order-gateway')>('@/lib/order-gateway');
    vi.stubEnv('SUPABASE_URL', 'https://database.example.test');
    vi.stubEnv('STOCKFLOW_ORDER_GATEWAY_KEY', 'growth-gateway-test-key');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ message: 'Denied', code: 'PT403' }, { status: 400 })));
    try {
      await expect(actual.callOrderGateway('manager@example.test', 'get_growth', {})).rejects.toMatchObject({ status: 403 });
    } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
  });
  it('refuses POST', () => { expect(POST().status).toBe(405); expect(mocks.gateway).not.toHaveBeenCalled(); });
  it('rejects malformed data and hides unexpected errors', async () => {
    mocks.gateway.mockResolvedValue({ companyCount: 1 }); expect((await GET()).status).toBe(502);
    mocks.gateway.mockRejectedValue(new Error('private'));
    expect(await (await GET()).json()).toEqual({ error: 'Growth is unavailable. Try again.' });
  });
});

