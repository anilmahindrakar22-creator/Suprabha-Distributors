import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ user: vi.fn(), session: vi.fn(), gateway: vi.fn() }));
vi.mock('@/app/chatgpt-auth', () => ({ getChatGPTUser: mocks.user }));
vi.mock('@/lib/stockflow-session', () => ({ getStockFlowSession: mocks.session }));
vi.mock('@/lib/order-gateway', async original => ({ ...await original<typeof import('@/lib/order-gateway')>(), callOrderGateway: mocks.gateway }));
import { normalizeGrowthCohorts, normalizeGrowthCohortLabs } from '@/lib/growth-cohort-types';
import { GET, POST } from '@/app/api/growth/cohorts/route';
import { OrderGatewayError } from '@/lib/order-gateway';

const counts = { labs: 114, active: 61, activePct: 54, stopped: 40, lostPaise: 173000000 };
const grid = { asOf: '2026-11-25', historyFrom: '2023-08-01', reconciled: false, rows: [{ cohort: 'existing', label: 'Buying when records start (Aug 2023–Oct 2023)', ...counts }], totals: counts };
const lab = { labKey: 'c|1', customerId: 'customer-1', name: 'Lab A', town: 'Pune', firstPurchaseOn: '2025-01-10', lastPurchaseOn: '2025-12-11', lostPaise: 1200037 };
const list = { cohort: '2025', label: '2025', totalLabs: 1, rows: [lab] };

describe('cohort normalizers', () => {
  it('accepts both contracts and nullable lab fields', () => {
    expect(normalizeGrowthCohorts(grid)).toEqual(grid);
    expect(normalizeGrowthCohorts({ ...grid, reconciled: true })).toEqual({ ...grid, reconciled: true });
    expect(normalizeGrowthCohortLabs(list)).toEqual(list);
    const nullable = { ...list, rows: [{ ...lab, customerId: null, town: null }] };
    expect(normalizeGrowthCohortLabs(nullable)).toEqual(nullable);
  });
  it('requires every field', () => {
    for (const key of Object.keys(grid)) { const raw: Record<string, unknown> = { ...grid }; delete raw[key]; expect(normalizeGrowthCohorts(raw)).toBeNull(); }
    for (const key of Object.keys(counts)) { const raw: Record<string, unknown> = { ...counts }; delete raw[key]; expect(normalizeGrowthCohorts({ ...grid, totals: raw })).toBeNull(); expect(normalizeGrowthCohorts({ ...grid, rows: [{ ...raw, cohort: '2025', label: '2025' }] })).toBeNull(); }
    for (const key of ['cohort', 'label']) { const raw: Record<string, unknown> = { ...grid.rows[0] }; delete raw[key]; expect(normalizeGrowthCohorts({ ...grid, rows: [raw] })).toBeNull(); }
    for (const key of Object.keys(list)) { const raw: Record<string, unknown> = { ...list }; delete raw[key]; expect(normalizeGrowthCohortLabs(raw)).toBeNull(); }
    for (const key of Object.keys(lab)) { const raw: Record<string, unknown> = { ...lab }; delete raw[key]; expect(normalizeGrowthCohortLabs({ ...list, rows: [raw] })).toBeNull(); }
  });
  it.each(Object.keys(counts))('rejects negative or fractional %s', key => {
    for (const value of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(normalizeGrowthCohorts({ ...grid, rows: [{ ...grid.rows[0], [key]: value }] })).toBeNull();
      expect(normalizeGrowthCohorts({ ...grid, totals: { ...counts, [key]: value } })).toBeNull();
    }
  });
  it('rejects negative list numbers and percentages over 100', () => {
    expect(normalizeGrowthCohortLabs({ ...list, totalLabs: -1 })).toBeNull();
    expect(normalizeGrowthCohortLabs({ ...list, rows: [{ ...lab, lostPaise: -1 }] })).toBeNull();
    expect(normalizeGrowthCohorts({ ...grid, rows: [{ ...grid.rows[0], activePct: 101 }] })).toBeNull();
    expect(normalizeGrowthCohorts({ ...grid, totals: { ...counts, activePct: 101 } })).toBeNull();
  });
  it('enforces row limits', () => {
    expect(normalizeGrowthCohorts({ ...grid, rows: Array(31).fill(grid.rows[0]) })).toBeNull();
    expect(normalizeGrowthCohortLabs({ ...list, totalLabs: 51, rows: Array(51).fill(lab) })).toBeNull();
    expect(normalizeGrowthCohortLabs({ ...list, totalLabs: 50, rows: Array(50).fill(lab) })).not.toBeNull();
  });
  it.each(['202', '20255', '2025x', 'all', '', ' 2025'])('rejects invalid cohort %s', cohort => {
    expect(normalizeGrowthCohorts({ ...grid, rows: [{ ...grid.rows[0], cohort }] })).toBeNull();
    expect(normalizeGrowthCohortLabs({ ...list, cohort })).toBeNull();
  });
  it('rejects invalid dates and malformed containers', () => {
    for (const value of [null, [], {}]) { expect(normalizeGrowthCohorts(value)).toBeNull(); expect(normalizeGrowthCohortLabs(value)).toBeNull(); }
    expect(normalizeGrowthCohorts({ ...grid, asOf: '2026-02-30' })).toBeNull();
    for (const reconciled of [null, undefined, 'false', 'true', 0, 1, [], {}]) {
      expect(normalizeGrowthCohorts({ ...grid, reconciled })).toBeNull();
    }
    expect(normalizeGrowthCohortLabs({ ...list, rows: [{ ...lab, lastPurchaseOn: 'bad' }] })).toBeNull();
  });
});

const get = (query = '') => GET(new Request(`https://app.test/api/growth/cohorts${query ? `?${query}` : ''}`));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ email: 'manager@example.test' });
  mocks.session.mockResolvedValue({ email: 'manager@example.test', roles: ['management'] });
  mocks.gateway.mockResolvedValue(grid);
});
describe('cohorts route', () => {
  it.each(['management', 'administrator'])('forwards the grid payload for %s', async role => {
    mocks.session.mockResolvedValue({ email: 'manager@example.test', roles: [role] });
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual(grid);
    expect(mocks.gateway).toHaveBeenCalledWith('manager@example.test', 'get_growth_cohorts', {});
  });
  it.each(['2025', 'existing'])('forwards the list payload %s', async cohort => {
    mocks.gateway.mockResolvedValue({ ...list, cohort });
    const response = await get(`cohort=${cohort}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ...list, cohort });
    expect(mocks.gateway).toHaveBeenCalledWith('manager@example.test', 'get_growth_cohorts', { cohort });
  });
  it.each(['a=1', 'cohort=', 'cohort=202', 'cohort=all', 'cohort=2025&a=1', 'cohort=2025&cohort=2025'])('rejects %s', async query => {
    const response = await get(query);
    expect(response.status).toBe(400);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it.each(['sales', 'operations', 'accounts', 'warehouse'])('denies %s', async role => {
    mocks.session.mockResolvedValue({ email: 'x@example.test', roles: [role] });
    for (const query of ['', 'cohort=2025']) {
      const response = await get(query);
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: 'Growth is for management only.' });
    }
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it('requires authentication and a session', async () => {
    mocks.user.mockResolvedValue(null); expect((await get()).status).toBe(401);
    mocks.user.mockResolvedValue({ email: 'x@example.test' }); mocks.session.mockResolvedValue(null);
    expect((await get()).status).toBe(403); expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it.each(['', 'cohort=2025'])('maps malformed data to 502 (%s)', async query => {
    mocks.gateway.mockResolvedValue({});
    const response = await get(query);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'Growth is unavailable. Try again.' });
  });
  it('rejects a list for another cohort', async () => { mocks.gateway.mockResolvedValue(list); expect((await get('cohort=2024')).status).toBe(502); });
  it('mirrors gateway errors', async () => {
    mocks.gateway.mockRejectedValue(new OrderGatewayError('Denied', 403)); expect((await get()).status).toBe(403);
    mocks.gateway.mockRejectedValue(new Error('Failed')); expect((await get()).status).toBe(502);
  });
  it('rejects writes', () => { const response = POST(); expect(response.status).toBe(405); expect(response.headers.get('allow')).toBe('GET'); });
});
