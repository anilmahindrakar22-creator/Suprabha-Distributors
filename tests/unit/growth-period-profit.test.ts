import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ user: vi.fn(), session: vi.fn(), gateway: vi.fn() }));
vi.mock('@/app/chatgpt-auth', () => ({ getChatGPTUser: mocks.user }));
vi.mock('@/lib/stockflow-session', () => ({ getStockFlowSession: mocks.session }));
vi.mock('@/lib/order-gateway', async original => ({ ...await original<typeof import('@/lib/order-gateway')>(), callOrderGateway: mocks.gateway }));
import { GET as marginGET } from '@/app/api/growth/margin/route';
import { GET as brandsGET } from '@/app/api/growth/brands/route';
import { normalizeGrowthPeriodBrands, normalizeGrowthPeriodGp } from '@/lib/growth-period-profit-types';

const period = { kind: 'quarter', fy: 2026, quarter: 3, label: 'Q3 FY 2026-27 to 22 Nov', from: '2026-10-01', to: '2026-11-22', running: true };
const selection = { kind: 'quarter', fy: 2026, quarter: 3 };
const margin = { view: 'items', sort: 'spread', filter: 'low', q: 'Item', page: 2, pageSize: 20, total: 0, thresholdPct: 14, consumablesMarginPct: 28,
  levers: { priceSpread: { items: 0, pairs: 0, paise: 0 }, lowMargin: { items: 0, paiseToThreshold: 0, examples: [] }, freeGoods: { lines: 0, costPaise: 0 }, instrumentsGpPaise: -100 }, rows: [] };
const detail = { kind: 'item', itemKey: 'i', name: null, typicalPricePaise: null, labs: 0, marginPct: null, tallyItemKey: null, pricePolicy: null, page: 2, pageSize: 20, total: 0, rows: [] };
const billed = { lines: 0, gapPaise: 0, unitMismatchLines: 0, approvedPricesInUse: 0, page: 2, pageSize: 20, total: 0, rows: [] };
const measures = { salesPaise: 1000, h1Paise: 400, h2Paise: 1000, instrumentSalesPaise: 100, consumablesSalesPaise: 900, knownSalesPaise: 800, gpPaise: 200, marginPct: 25, items: 3 };
const brands = { window: { from: '2026-10-01', to: '2026-11-23', h2From: '2026-10-01' },
  totals: { salesPaise: 1000, instrumentSalesPaise: 100, consumablesSalesPaise: 900, knownSalesPaise: 800, gpPaise: 200, marginPct: 25 },
  rows: [{ key: 'brand:A', kind: 'brand', brandCode: 'A', name: 'A', ...measures, lines: [{ kind: 'direct', group: null, areaCode: null, ...measures }] }] };
const periodBrands = { ...brands, period, comparison: { key: 'last_year', label: 'Q3 last year', state: 'no_history' }, comparisonWindow: { from: '2025-10-01', to: '2025-11-23' } };
const profitWindow = { salesPaise: 1000, knownSalesPaise: 800, costPaise: 600, gpPaise: 200, gpPct: 25, coveragePct: 80, unreliableLines: 0 };
const gp = { method: 'average_purchase_cost_to_date', window: profitWindow, repeat: profitWindow, bulk: profitWindow,
  consumables: profitWindow, instruments: profitWindow, halves: [{ ...profitWindow, half: 'H1' }, { ...profitWindow, half: 'H2' }],
  months: ['2026-10', '2026-11'].map(month => ({ month, salesPaise: 1000, knownSalesPaise: 800, gpPaise: 200 })), period };
const getMargin = (q: string) => marginGET(new Request('https://app.test/api/growth/margin?' + q));
const getBrands = (q = '') => brandsGET(new Request('https://app.test/api/growth/brands?' + q));
beforeEach(() => {
  vi.clearAllMocks(); mocks.user.mockResolvedValue({ email: 'manager@test.local' });
  mocks.session.mockResolvedValue({ email: 'manager@test.local', roles: ['management'] });
});

describe('period profit normalizers', () => {
  it('accepts brands and every comparison state, including no history', () => {
    for (const state of ['no_history', 'differs', 'unconfirmed', 'confirmed']) {
      const value = { ...periodBrands, comparison: { ...periodBrands.comparison, state } };
      expect(normalizeGrowthPeriodBrands(value)).toEqual(value);
    }
    expect(normalizeGrowthPeriodBrands({ ...periodBrands, extra: true })).toEqual(periodBrands);
  });
  it.each([
    { ...periodBrands, period: null }, { ...periodBrands, period: { ...period, extra: true } },
    { ...periodBrands, period: { ...period, to: '2026-02-30' } }, { ...periodBrands, comparison: { ...periodBrands.comparison, key: 'x' } },
    { ...periodBrands, comparison: { ...periodBrands.comparison, label: 1 } }, { ...periodBrands, comparison: { ...periodBrands.comparison, state: 'x' } },
    { ...periodBrands, comparison: { ...periodBrands.comparison, extra: 1 } },
    { ...periodBrands, comparisonWindow: { from: '2026-02-30', to: '2026-03-01' } },
    { ...periodBrands, comparisonWindow: { from: '2026-03-01', to: '2026-02-01' } },
    { ...periodBrands, rows: [{ ...brands.rows[0], gpPaise: 0.5 }] },
    { ...periodBrands, period: { ...period, kind: 'fy', quarter: null }, comparison: { ...periodBrands.comparison, key: 'previous' } },
  ])('rejects malformed brands %#', value => expect(normalizeGrowthPeriodBrands(value)).toBeNull());
  it('accepts strict GP for partial quarters and FY month arrays', () => {
    expect(normalizeGrowthPeriodGp(gp)).toEqual(gp);
    const months = Array.from({ length: 12 }, (_, i) => ({ ...gp.months[0], month: new Date(Date.UTC(2026, i + 3, 1)).toISOString().slice(0, 7) }));
    const value = { ...gp, months, period: { ...period, kind: 'fy', quarter: null, from: '2026-04-01', to: '2027-03-31', running: false } };
    expect(normalizeGrowthPeriodGp(value)).toEqual(value);
  });
  it.each([
    { ...gp, extra: 1 }, { ...gp, method: 'x' }, { ...gp, window: { ...profitWindow, gpPaise: 1.5 } },
    { ...gp, window: { ...profitWindow, coveragePct: 101 } }, { ...gp, window: { ...profitWindow, extra: 1 } },
    { ...gp, repeat: { ...profitWindow, unreliableLines: -1 } }, { ...gp, halves: [] },
    { ...gp, halves: [{ ...profitWindow, half: 'H2' }, { ...profitWindow, half: 'H1' }] },
    { ...gp, months: [gp.months[0]] }, { ...gp, months: [...gp.months].reverse() },
    { ...gp, months: [{ ...gp.months[0], instrumentsGpPaise: 1.5 }, gp.months[1]] },
    { ...gp, months: [{ ...gp.months[0], extra: true }, gp.months[1]] },
    { ...gp, period: { ...period, from: '2026-02-30' } },
  ])('rejects malformed GP %#', value => expect(normalizeGrowthPeriodGp(value)).toBeNull());
});

describe('period profit routes', () => {
  it.each([
    ['view=items&page=2&sort=spread&filter=low&q=Item', 'margin', { view: 'items', page: 2, sort: 'spread', filter: 'low', q: 'Item' }, margin],
    ['itemKey=i&page=2', 'detail', { itemKey: 'i', page: 2 }, detail],
    ['tallyItemKey=X&page=2', 'detail', { tallyItemKey: 'X', page: 2 }, { ...detail, tallyItemKey: 'X' }],
    ['billedBelow=1&page=2', 'billed_below', { page: 2 }, billed],
  ] as const)('sends exact period margin payload for %s', async (q, read, payload, body) => {
    mocks.gateway.mockResolvedValue({ ...body, period });
    const response = await getMargin('period=q3-2026&' + q);
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ ...body, period });
    expect(mocks.gateway).toHaveBeenCalledWith('manager@test.local', 'get_growth_margin_period', { period: selection, read, ...payload });
  });
  it('sends GP without a page', async () => {
    mocks.gateway.mockResolvedValue(gp);
    const response = await getMargin('period=q3-2026&gp=1');
    expect(response.status).toBe(200); expect(await response.json()).toEqual(gp);
    expect(mocks.gateway).toHaveBeenCalledWith('manager@test.local', 'get_growth_margin_period', { period: selection, read: 'gp' });
  });
  it.each(['last_year', 'previous'])('sends exact period brands payload for %s', async comparison => {
    mocks.gateway.mockResolvedValue({ ...periodBrands, comparison: { ...periodBrands.comparison, key: comparison } });
    expect((await getBrands('period=q3-2026&comparison=' + comparison)).status).toBe(200);
    expect(mocks.gateway).toHaveBeenCalledWith('manager@test.local', 'get_growth_brands_period', { period: selection, comparison });
  });
  it.each(['period=x&view=items&page=1', 'period=q3-2026&view=items&page=1&extra=1', 'period=q3-2026&gp=1&page=1',
    'period=q3-2026&gp=0', 'period=q3-2026&gp=1&billedBelow=1', 'period=q3-2026&period=q3-2026&gp=1',
    'period=q3-2026&billedBelow=1&page=0', 'period=q3-2026&itemKey=i&page=1&view=items'])('rejects invalid margin params %s', async q => {
    expect((await getMargin(q)).status).toBe(400); expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it.each(['period=fy-2026&comparison=previous', 'period=q3-2026', 'period=rolling12&comparison=last_year',
    'period=q3-2026&comparison=x', 'period=q3-2026&comparison=last_year&extra=1', 'period=q3-2026&comparison=last_year&comparison=previous'])('rejects invalid brands params %s', async q => {
    const response = await getBrands(q); expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid growth brands parameters' }); expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it.each(['sales', 'operations', 'accounts', 'warehouse'])('denies %s', async role => {
    mocks.session.mockResolvedValue({ roles: [role] });
    expect((await getMargin('period=q3-2026&gp=1')).status).toBe(403);
    expect((await getBrands('period=q3-2026&comparison=last_year')).status).toBe(403); expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it('keeps no-period and rolling12 margin and no-period brands calls unchanged', async () => {
    mocks.gateway.mockResolvedValue(margin);
    for (const p of ['', 'period=rolling12&']) expect((await getMargin(p + 'view=items&page=2&sort=spread&filter=low&q=Item')).status).toBe(200);
    expect(mocks.gateway).toHaveBeenCalledWith('manager@test.local', 'get_growth_margin', { view: 'items', page: 2, sort: 'spread', filter: 'low', q: 'Item' });
    mocks.gateway.mockResolvedValue(brands); expect((await getBrands()).status).toBe(200);
    expect(mocks.gateway).toHaveBeenLastCalledWith('manager@test.local', 'get_growth_brands', {});
  });
  it('retains response consistency and rejects invalid period metadata', async () => {
    mocks.gateway.mockResolvedValue({ ...margin, period, page: 1 });
    expect((await getMargin('period=q3-2026&view=items&page=2&sort=spread&filter=low&q=Item')).status).toBe(502);
    mocks.gateway.mockResolvedValue({ ...billed, period: { ...period, quarter: 5 } });
    expect((await getMargin('period=q3-2026&billedBelow=1&page=2')).status).toBe(502);
    mocks.gateway.mockResolvedValue({ ...gp, months: [] }); expect((await getMargin('period=q3-2026&gp=1')).status).toBe(502);
  });
});
