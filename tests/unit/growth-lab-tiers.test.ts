import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ user: vi.fn(), session: vi.fn(), gateway: vi.fn() }));
vi.mock('@/app/chatgpt-auth', () => ({ getChatGPTUser: mocks.user }));
vi.mock('@/lib/stockflow-session', () => ({ getStockFlowSession: mocks.session }));
vi.mock('@/lib/order-gateway', async original => ({ ...await original<typeof import('@/lib/order-gateway')>(), callOrderGateway: mocks.gateway }));
import { growthTierOrder, normalizeGrowthTiers, normalizeGrowthTierLabs } from '@/lib/growth-tier-types';
import { GET, POST } from '@/app/api/growth/tiers/route';
import { OrderGatewayError } from '@/lib/order-gateway';

const summary = {
  month: '2026-11-01', stale: false,
  bands: { diamond: 100000000, platinum: 30000000, gold: 10000000, silver: 2500000 },
  tiers: growthTierOrder.map(tier => ({ tier, labs: 3, consumablesPaise: 335000000, sharePct: 24, withInstrument: 2 })),
  movers: { up: 4, down: 2 }, placement: { labs: 21, consumablesPaise: 470000000 },
};
const lab = { labKey: 'c|1', customerId: 'customer-1', name: 'Lab A', town: 'Pune', phone: '+919876543210', tier: 'gold', consumablesPaise: 1200037, hasInstrument: false, previousTier: 'silver', change: 'up' };
const list = { list: 'gold', totalLabs: 1, rows: [lab] };

describe('tier normalizers', () => {
  it('accepts summary, lists, fractional shares, and nullable fields', () => {
    expect(normalizeGrowthTiers(summary)).toEqual(summary);
    expect(normalizeGrowthTiers({ ...summary, stale: true, tiers: summary.tiers.map(row => ({ ...row, sharePct: 24.5 })) })).not.toBeNull();
    expect(normalizeGrowthTierLabs(list)).toEqual(list);
    const nullable = { ...list, rows: [{ ...lab, customerId: null, name: null, town: null, phone: null, previousTier: null, change: 'new' }] };
    expect(normalizeGrowthTierLabs(nullable)).toEqual(nullable);
    expect(normalizeGrowthTierLabs({ ...list, rows: [{ ...lab, previousTier: null }] })).not.toBeNull();
    for (const key of [...growthTierOrder, 'movers', 'placement']) expect(normalizeGrowthTierLabs({ ...list, list: key })).not.toBeNull();
  });
  it('rejects bad tiers, lists, changes, and wrong tier order', () => {
    expect(normalizeGrowthTiers({ ...summary, tiers: summary.tiers.map(row => ({ ...row, tier: 'bronze' })) })).toBeNull();
    expect(normalizeGrowthTiers({ ...summary, tiers: [...summary.tiers].reverse() })).toBeNull();
    expect(normalizeGrowthTiers({ ...summary, tiers: summary.tiers.slice(1) })).toBeNull();
    expect(normalizeGrowthTierLabs({ ...list, list: 'bronze' })).toBeNull();
    for (const field of ['tier', 'previousTier', 'change']) expect(normalizeGrowthTierLabs({ ...list, rows: [{ ...lab, [field]: 'bad' }] })).toBeNull();
  });
  it('rejects missing fields', () => {
    for (const key of Object.keys(summary)) { const raw: Record<string, unknown> = { ...summary }; delete raw[key]; expect(normalizeGrowthTiers(raw)).toBeNull(); }
    for (const key of Object.keys(summary.bands)) { const bands: Record<string, unknown> = { ...summary.bands }; delete bands[key]; expect(normalizeGrowthTiers({ ...summary, bands })).toBeNull(); }
    for (const key of Object.keys(summary.tiers[0])) { const row: Record<string, unknown> = { ...summary.tiers[0] }; delete row[key]; expect(normalizeGrowthTiers({ ...summary, tiers: [row, ...summary.tiers.slice(1)] })).toBeNull(); }
    for (const key of Object.keys(list)) { const raw: Record<string, unknown> = { ...list }; delete raw[key]; expect(normalizeGrowthTierLabs(raw)).toBeNull(); }
    for (const key of Object.keys(lab)) { const row: Record<string, unknown> = { ...lab }; delete row[key]; expect(normalizeGrowthTierLabs({ ...list, rows: [row] })).toBeNull(); }
  });
  it('rejects negative numbers and invalid numeric ranges', () => {
    for (const value of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      for (const field of ['labs', 'consumablesPaise', 'withInstrument']) expect(normalizeGrowthTiers({ ...summary, tiers: summary.tiers.map(row => ({ ...row, [field]: value })) })).toBeNull();
      expect(normalizeGrowthTierLabs({ ...list, totalLabs: value })).toBeNull();
      expect(normalizeGrowthTierLabs({ ...list, rows: [{ ...lab, consumablesPaise: value }] })).toBeNull();
      expect(normalizeGrowthTiers({ ...summary, movers: { up: value, down: 2 } })).toBeNull();
      expect(normalizeGrowthTiers({ ...summary, movers: { up: 4, down: value } })).toBeNull();
      for (const field of ['labs', 'consumablesPaise']) expect(normalizeGrowthTiers({ ...summary, placement: { ...summary.placement, [field]: value } })).toBeNull();
      for (const field of Object.keys(summary.bands)) expect(normalizeGrowthTiers({ ...summary, bands: { ...summary.bands, [field]: value } })).toBeNull();
    }
    for (const sharePct of [-1, 101, NaN, Infinity, '24']) expect(normalizeGrowthTiers({ ...summary, tiers: summary.tiers.map(row => ({ ...row, sharePct })) })).toBeNull();
    expect(normalizeGrowthTiers({ ...summary, tiers: summary.tiers.map(row => ({ ...row, withInstrument: 4 })) })).toBeNull();
  });
  it('limits lists to 100 rows and checks totals', () => {
    expect(normalizeGrowthTierLabs({ ...list, totalLabs: 101, rows: Array(101).fill(lab) })).toBeNull();
    expect(normalizeGrowthTierLabs({ ...list, totalLabs: 101, rows: Array(100).fill(lab) })).not.toBeNull();
    expect(normalizeGrowthTierLabs({ ...list, totalLabs: 0 })).toBeNull();
  });
  it('rejects invalid containers, dates, booleans and text fields', () => {
    for (const raw of [null, [], {}]) { expect(normalizeGrowthTiers(raw)).toBeNull(); expect(normalizeGrowthTierLabs(raw)).toBeNull(); }
    for (const month of ['2026-02-30', '2026-13-01', '2026-11-02', 'bad']) expect(normalizeGrowthTiers({ ...summary, month })).toBeNull();
    expect(normalizeGrowthTiers({ ...summary, stale: 'false' })).toBeNull();
    expect(normalizeGrowthTierLabs({ ...list, rows: [{ ...lab, hasInstrument: 'false' }] })).toBeNull();
    for (const field of ['labKey', 'customerId', 'name', 'town', 'phone']) expect(normalizeGrowthTierLabs({ ...list, rows: [{ ...lab, [field]: 5 }] })).toBeNull();
  });
});

const get = (query = '') => GET(new Request(`https://app.test/api/growth/tiers${query ? `?${query}` : ''}`));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ email: 'manager@example.test' });
  mocks.session.mockResolvedValue({ email: 'manager@example.test', roles: ['management'] });
  mocks.gateway.mockResolvedValue(summary);
});
describe('tiers route', () => {
  it.each(['management', 'administrator'])('forwards summary for %s with private no-store caching', async role => {
    mocks.session.mockResolvedValue({ email: 'manager@example.test', roles: [role] });
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual(summary);
    expect(mocks.gateway).toHaveBeenCalledWith('manager@example.test', 'get_growth_lab_tiers', {});
  });
  it.each(growthTierOrder)('forwards tier %s', async tier => {
    mocks.gateway.mockResolvedValue({ ...list, list: tier });
    const response = await get(`tier=${tier}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ...list, list: tier });
    expect(mocks.gateway).toHaveBeenCalledWith('manager@example.test', 'get_growth_lab_tiers', { tier });
  });
  it.each(['movers', 'placement'])('forwards list %s', async selected => {
    mocks.gateway.mockResolvedValue({ ...list, list: selected });
    expect((await get(`list=${selected}`)).status).toBe(200);
    expect(mocks.gateway).toHaveBeenCalledWith('manager@example.test', 'get_growth_lab_tiers', { list: selected });
  });
  it.each(['a=1', 'tier=', 'tier=Gold', 'tier=bronze', 'list=gold', 'list=', 'tier=gold&a=1', 'tier=gold&list=movers', 'tier=gold&tier=gold', 'list=movers&list=movers'])('rejects %s', async query => {
    const response = await get(query);
    expect(response.status).toBe(400);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it.each(['sales', 'operations', 'accounts', 'warehouse'])('denies %s', async role => {
    mocks.session.mockResolvedValue({ email: 'x@example.test', roles: [role] });
    for (const query of ['', 'tier=gold', 'list=movers', 'list=placement']) expect((await get(query)).status).toBe(403);
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it('requires authentication and a session', async () => {
    mocks.user.mockResolvedValue(null); expect((await get()).status).toBe(401);
    mocks.user.mockResolvedValue({ email: 'x@example.test' }); mocks.session.mockResolvedValue(null);
    expect((await get()).status).toBe(403); expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it.each(['', 'tier=gold', 'list=movers', 'list=placement'])('returns 502 for malformed data (%s)', async query => {
    mocks.gateway.mockResolvedValue({});
    const response = await get(query);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'Growth is unavailable. Try again.' });
  });
  it('rejects a list for another selection', async () => { mocks.gateway.mockResolvedValue(list); expect((await get('tier=silver')).status).toBe(502); expect((await get('list=movers')).status).toBe(502); });
  it('preserves gateway error status and hides error details', async () => {
    mocks.gateway.mockRejectedValue(new OrderGatewayError('Denied', 403)); expect((await get()).status).toBe(403);
    mocks.gateway.mockRejectedValue(new Error('Private failure')); expect((await get()).status).toBe(502);
  });
  it('rejects writes', () => { const response = POST(); expect(response.status).toBe(405); expect(response.headers.get('allow')).toBe('GET'); });
});
