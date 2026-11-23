import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ user: vi.fn(), session: vi.fn(), gateway: vi.fn() }));
vi.mock('@/app/chatgpt-auth', () => ({ getChatGPTUser: mocks.user }));
vi.mock('@/lib/stockflow-session', () => ({ getStockFlowSession: mocks.session }));
vi.mock('@/lib/order-gateway', async original => ({ ...await original<typeof import('@/lib/order-gateway')>(), callOrderGateway: mocks.gateway }));
import { GET as monthsGET } from '@/app/api/growth/lab-months/route';
import { GET as labsGET } from '@/app/api/growth/labs/route';
import { normalizeGrowthPeriodLabMonths, normalizeGrowthPeriodLabs } from '@/lib/growth-period-labs-types';

const period = { kind: 'quarter', fy: 2026, quarter: 3, label: 'Q3 FY 2026-27 to 22 Nov', from: '2026-10-01', to: '2026-11-22', running: true };
const identity = { labKey: 'co|lab', customerId: null, name: 'Lab', town: null };
const months = { window: { from: period.from, to: period.to }, months: ['2026-10', '2026-11'], totalLabs: 1,
  rows: [{ ...identity, totalPaise: 150, monthsPaise: [200, -50], buyingMonths: 1 }] };
const labs = { list: 'bridge_grew', comparison: 'previous', page: 1, pageSize: 20, total: 1, period,
  rows: [{ ...identity, valuePaise: 50, comparisonPaise: 100, currentPaise: 150, monthsBought: 1, lastBoughtOn: '2026-11-03' }] };
const getMonths = (q: string) => monthsGET(new Request('https://app.test/api/growth/lab-months?' + q));
const getLabs = (q: string) => labsGET(new Request('https://app.test/api/growth/labs?' + q));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ email: 'manager@test.local' });
  mocks.session.mockResolvedValue({ email: 'manager@test.local', roles: ['management'] });
});

describe('period lab normalizers', () => {
  it('accepts partial quarters, negative month net and twelve-month FY windows', () => {
    expect(normalizeGrowthPeriodLabMonths(months)).toEqual(months);
    const fyMonths = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(2026, i + 3, 1)).toISOString().slice(0, 7));
    expect(normalizeGrowthPeriodLabMonths({ window: { from: '2026-04-01', to: '2027-03-31' }, months: fyMonths, totalLabs: 0, rows: [] })).not.toBeNull();
  });
  it.each([
    { ...months, extra: true }, { ...months, window: { ...months.window, extra: 1 } },
    { ...months, months: ['2026-10', '2026-12'] }, { ...months, months: [] },
    { ...months, rows: [{ ...months.rows[0], extra: 1 }] },
    { ...months, rows: [{ ...months.rows[0], monthsPaise: [200] }] },
    { ...months, rows: [{ ...months.rows[0], totalPaise: Number.MAX_SAFE_INTEGER + 1 }] },
    { ...months, rows: [{ ...months.rows[0], buyingMonths: 3 }] },
    { ...months, window: { from: '2026-02-30', to: '2026-11-22' } },
  ])('rejects malformed month data %#', value => expect(normalizeGrowthPeriodLabMonths(value)).toBeNull());
  it('accepts bridges, window labs and empty no-history', () => {
    expect(normalizeGrowthPeriodLabs(labs)).toEqual(labs);
    const window = { ...labs, list: 'window_labs', comparison: null, rows: [{ ...labs.rows[0], comparisonPaise: null }] };
    expect(normalizeGrowthPeriodLabs(window)).toEqual(window);
    const empty = { ...labs, reason: 'no_history', total: 0, rows: [] };
    expect(normalizeGrowthPeriodLabs(empty)).toEqual(empty);
  });
  it.each([
    { ...labs, extra: 1 }, { ...labs, period: { ...period, extra: 1 } }, { ...labs, comparison: null }, { ...labs, comparison: { toString: 'previous' } },
    { ...labs, page: 1.5 }, { ...labs, page: 1001 }, { ...labs, pageSize: 50 },
    { ...labs, reason: 'other', rows: [] }, { ...labs, reason: 'no_history' },
    { ...labs, reason: 'no_history', rows: [], total: 1 },
    { ...labs, period: { ...period, kind: 'fy', quarter: null } },
    { ...labs, rows: [{ ...labs.rows[0], comparisonPaise: null }] },
    { ...labs, rows: [{ ...labs.rows[0], valuePaise: 1.5 }] },
    { ...labs, rows: [{ ...labs.rows[0], currentPaise: Number.MAX_SAFE_INTEGER + 1 }] },
    { ...labs, rows: [{ ...labs.rows[0], lastBoughtOn: '2026-02-30' }] },
    { ...labs, rows: [{ ...labs.rows[0], extra: true }] },
    { ...labs, list: 'window_labs', comparison: null },
  ])('rejects malformed list data %#', value => expect(normalizeGrowthPeriodLabs(value)).toBeNull());
});

describe('period growth routes', () => {
  it.each(['q3-2026', 'fy-2026'])('sends exact period months payload for %s', async selection => {
    mocks.gateway.mockResolvedValue(months);
    expect((await getMonths('period=' + selection)).status).toBe(200);
    expect(mocks.gateway).toHaveBeenCalledWith('manager@test.local', 'get_growth_lab_months_period', {
      period: selection === 'q3-2026' ? { kind: 'quarter', fy: 2026, quarter: 3 } : { kind: 'fy', fy: 2026 },
    });
  });
  it.each(['period=q5-2026', 'period=q3-2026&filter=lapsing', 'period=q3-2026&period=q3-2026', 'period=rolling12&page=1'])('rejects invalid month params %s', async q => {
    expect((await getMonths(q)).status).toBe(400); expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it.each(['bridge_new', 'bridge_stopped', 'bridge_grew', 'bridge_fell'])('sends exact bridge payload for %s', async list => {
    mocks.gateway.mockResolvedValue({ ...labs, list });
    expect((await getLabs(`period=q3-2026&list=${list}&page=1&comparison=previous`)).status).toBe(200);
    expect(mocks.gateway).toHaveBeenCalledWith('manager@test.local', 'get_growth_labs_period', { period: { kind: 'quarter', fy: 2026, quarter: 3 }, list, page: 1, comparison: 'previous' });
  });
  it('passes regularOnly as a boolean and supports last year', async () => {
    mocks.gateway.mockResolvedValue({ ...labs, list: 'bridge_stopped', comparison: 'last_year', page: 2 });
    expect((await getLabs('period=q3-2026&list=bridge_stopped&page=2&comparison=last_year&regularOnly=true')).status).toBe(200);
    expect(mocks.gateway).toHaveBeenCalledWith('manager@test.local', 'get_growth_labs_period', { period: { kind: 'quarter', fy: 2026, quarter: 3 }, list: 'bridge_stopped', page: 2, comparison: 'last_year', regularOnly: true });
  });
  it('omits comparison for window labs', async () => {
    mocks.gateway.mockResolvedValue({ ...labs, list: 'window_labs', comparison: null, rows: [] });
    expect((await getLabs('period=q3-2026&list=window_labs&page=1')).status).toBe(200);
    expect(mocks.gateway).toHaveBeenCalledWith('manager@test.local', 'get_growth_labs_period', { period: { kind: 'quarter', fy: 2026, quarter: 3 }, list: 'window_labs', page: 1 });
  });
  it.each([
    'period=q3-2026&list=bridge_new&page=1', 'period=fy-2026&list=bridge_new&page=1&comparison=previous',
    'period=q3-2026&list=window_labs&page=1&comparison=last_year', 'period=rolling12&list=window_labs&page=1',
    'period=q3-2026&list=regular_labs&page=1', 'period=q3-2026&list=window_labs&page=0',
    'period=q3-2026&list=window_labs&page=1.5', 'period=q3-2026&list=window_labs&page=1001',
    'period=q3-2026&list=window_labs&page=1&sort=value', 'period=q3-2026&list=bridge_new&page=1&comparison=previous&regularOnly=false',
    'period=q3-2026&list=bridge_stopped&page=1&comparison=previous&regularOnly=1',
    'period=q3-2026&list=window_labs&page=1&page=2',
  ])('rejects invalid list params %s', async q => {
    const response = await getLabs(q); expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid growth labs request' }); expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it.each(['sales', 'operations', 'accounts', 'warehouse'])('denies %s on both period routes', async role => {
    mocks.session.mockResolvedValue({ email: 'x@test.local', roles: [role] });
    expect((await getMonths('period=q3-2026')).status).toBe(403);
    expect((await getLabs('period=q3-2026&list=window_labs&page=1')).status).toBe(403);
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it('keeps the rolling months behavior for no period and rolling12', async () => {
    const rolling = { window: { from: '2025-11-01', to: '2026-11-01' }, months: Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(2025, i + 10, 1)).toISOString().slice(0, 7)), totalLabs: 0, rows: [] };
    mocks.gateway.mockResolvedValue(rolling);
    for (const q of ['', 'period=rolling12', 'filter=lapsing', 'filter=declining']) expect((await getMonths(q)).status).toBe(200);
    expect(mocks.gateway.mock.calls.map(c => c.slice(1))).toEqual([
      ['get_growth_lab_months', {}], ['get_growth_lab_months', {}], ['get_growth_lab_months', { filter: 'lapsing' }], ['get_growth_lab_months', { filter: 'declining' }],
    ]);
  });
  it('keeps legacy list payloads and validation', async () => {
    mocks.gateway.mockResolvedValue({ list: 'month_skipped', month: '2026-10', total: 0, page: 1, pageSize: 20, rows: [] });
    expect((await getLabs('list=month_skipped&month=2026-10&page=1')).status).toBe(200);
    expect(mocks.gateway).toHaveBeenCalledWith('manager@test.local', 'get_growth_labs', { list: 'month_skipped', month: '2026-10', page: 1 });
    expect((await getLabs('list=bridge_new&month=2026-10&page=1')).status).toBe(400);
  });
  it('rejects malformed or mismatched period responses', async () => {
    mocks.gateway.mockResolvedValue({ ...months, extra: 1 });
    expect((await getMonths('period=q3-2026')).status).toBe(502);
    mocks.gateway.mockResolvedValue({ ...labs, page: 2 });
    expect((await getLabs('period=q3-2026&list=bridge_grew&page=1&comparison=previous')).status).toBe(502);
  });
});
