import { describe, expect, it } from 'vitest';
import { normalizeGrowth, normalizeGrowthLabs, type GrowthData, type GrowthProfitWindow } from '@/lib/growth-types';
const sample = (): GrowthData => ({
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
});
describe('Growth response validation', () => {
  const profitWindow = (gpPct: number | null, coveragePct: number | null): GrowthProfitWindow => ({ salesPaise: 1000000, knownSalesPaise: 900000, costPaise: 700000, gpPaise: 200000, gpPct, coveragePct });
  const profit = () => ({ method: 'average_purchase_cost_to_date', window: profitWindow(20, 90), halves: [{ half: 'H1', ...profitWindow(18, 85) }, { half: 'H2', ...profitWindow(22, 95) }], repeat: profitWindow(25, 95), bulk: profitWindow(-5, 80), months: sample().months.map(m => ({ month: m.month, salesPaise: 100000, knownSalesPaise: 90000, gpPaise: 20000 })) });
  it('normalizes a complete sample', () => { expect(normalizeGrowth(sample())).toEqual(sample()); });
  it('allows the optional gross profit key to be absent', () => { expect(normalizeGrowth(sample())).not.toBeNull(); });
  it('normalizes gross profit when present', () => { const v = { ...sample(), gp: profit() }; expect(normalizeGrowth(v)).toEqual(v); });
  it('accepts optional P3 windows and signed integer month segments', () => {
    const gp = { ...profit(), consumables: profitWindow(28, 90), instruments: profitWindow(-15, 85), months: profit().months.map(m => ({ ...m, consumablesKnownSalesPaise: -100, consumablesGpPaise: -30, instrumentsKnownSalesPaise: 500, instrumentsGpPaise: -200 })) };
    expect(normalizeGrowth({ ...sample(), gp })?.gp).toEqual(gp);
  });
  it.each(['consumables', 'instruments'])('strictly validates optional %s windows', key => {
    expect(normalizeGrowth({ ...sample(), gp: { ...profit(), [key]: null } })).toBeNull();
    expect(normalizeGrowth({ ...sample(), gp: { ...profit(), [key]: { ...profitWindow(20, 90), gpPaise: 1.1 } } })).toBeNull();
  });
  it.each(['consumablesKnownSalesPaise', 'consumablesGpPaise', 'instrumentsKnownSalesPaise', 'instrumentsGpPaise'])('rejects malformed optional %s', key => {
    for (const bad of [null, '100', 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      const gp = profit();
      gp.months[0] = { ...gp.months[0], [key]: bad };
      expect(normalizeGrowth({ ...sample(), gp })).toBeNull();
    }
  });
  it('accepts optional unreliable line count on the gross profit window', () => { const gp = profit(); gp.window.unreliableLines = 1; expect(normalizeGrowth({ ...sample(), gp })?.gp?.window.unreliableLines).toBe(1); });
  it('allows gross profit window without unreliable line count', () => { expect(normalizeGrowth({ ...sample(), gp: profit() })).not.toBeNull(); });
  it('rejects a negative unreliable line count', () => { const gp = profit(); gp.window.unreliableLines = -1; expect(normalizeGrowth({ ...sample(), gp })).toBeNull(); });
  it('rejects gross profit with a different method', () => { expect(normalizeGrowth({ ...sample(), gp: { ...profit(), method: 'other' } })).toBeNull(); });
  it('rejects non-integer gross profit paise', () => { const gp = profit(); gp.window.gpPaise = 1.5; expect(normalizeGrowth({ ...sample(), gp })).toBeNull(); });
  it('requires twelve gross profit months', () => { const gp = profit(); gp.months.pop(); expect(normalizeGrowth({ ...sample(), gp })).toBeNull(); });
  it('keeps large JSON money numbers and fractional per-month averages', () => {
    const v = sample();
    v.tree.revenuePaise = 1e16;
    v.tree.perBuyingMonthPaise = 1799200.25;
    expect(normalizeGrowth(v)).toEqual(v);
  });
  it('allows unknown GP', () => { const v = sample(); expect(normalizeGrowth({ ...v, health: { ...v.health, gp: { costedPct: null, computedAt: null } } })).not.toBeNull(); });
  it('allows null monthly spend when a half has no buying months', () => {
    const v = sample(); v.halves[0].buyingMonths = 0; v.halves[0].perBuyingMonthPaise = null;
    expect(normalizeGrowth(v)?.halves[0].perBuyingMonthPaise).toBeNull();
  });
  it('preserves unavailable scorecard percentages and monthly segments', () => {
    const v = sample(); v.scorecard.regularPct = null; v.scorecard.top10Pct = null;
    v.months[0].skippedRegulars = null; v.months[0].firstTime = null;
    expect(normalizeGrowth(v)).toEqual(v);
  });
  it.each([
    (v: GrowthData) => ({ ...v, scorecard: undefined }),
    (v: GrowthData) => ({ ...v, scorecard: { ...v.scorecard, regularLabs: -1 } }),
    (v: GrowthData) => ({ ...v, scorecard: { ...v.scorecard, regularPct: 101 } }),
    (v: GrowthData) => ({ ...v, scorecard: { ...v.scorecard, top10Pct: -1 } }),
    (v: GrowthData) => ({ ...v, months: v.months.slice(1) }),
    (v: GrowthData) => ({ ...v, months: [...v.months, v.months[11]] }),
    (v: GrowthData) => ({ ...v, months: v.months.map((m, i) => i === 4 ? { ...m, month: v.months[3].month } : m) }),
    (v: GrowthData) => ({ ...v, window: { ...v.window, to: '2026-12-01' } }),
    (v: GrowthData) => ({ ...v, months: v.months.map((m, i) => i === 0 ? { ...m, labsBuying: -1 } : m) }),
    (v: GrowthData) => ({ ...v, months: v.months.map((m, i) => i === 0 ? { ...m, firstTime: -1 } : m) }),
    (v: GrowthData) => ({ ...v, months: v.months.map((m, i) => i === 0 ? { ...m, skippedRegulars: -1 } : m) }),
    (v: GrowthData) => ({ ...v, months: v.months.map((m, i) => i === 0 ? { ...m, largePurchaseInvoices: -1 } : m) }),
  ])('rejects malformed scorecard or monthly data %#', mutate => { expect(normalizeGrowth(mutate(sample()))).toBeNull(); });
  it.each([
    (v: ReturnType<typeof sample>) => { const { companyCount: _count, ...rest } = v; return rest; },
    (v: ReturnType<typeof sample>) => ({ ...v, tree: { ...v.tree, labsBuying: -1 } }),
    (v: ReturnType<typeof sample>) => ({ ...v, tree: { ...v.tree, labsBuying: 1.5 } }),
    (v: ReturnType<typeof sample>) => ({ ...v, tree: { ...v.tree, revenuePaise: '1818000000' } }),
    (v: ReturnType<typeof sample>) => { const { stoppedRegular: _regular, ...bridge } = v.bridge; return { ...v, bridge }; },
    (v: ReturnType<typeof sample>) => ({ ...v, bridge: { ...v.bridge, stoppedRegular: { ...v.bridge.stoppedRegular, labs: v.bridge.stopped.labs + 1 } } }),
    (v: ReturnType<typeof sample>) => ({ ...v, halves: [{ ...v.halves[0], half: 'H2' }, v.halves[1]] }),
    (v: ReturnType<typeof sample>) => ({ ...v, health: { ...v.health, catalog: { groups: -1, observedAt: null } } }),
    (v: ReturnType<typeof sample>) => ({ ...v, window: { ...v.window, from: '2025-02-30' } }),
  ])('rejects malformed data %#', mutate => { expect(normalizeGrowth(mutate(sample()))).toBeNull(); });
});

describe('Growth lab response validation', () => {
  const row = { labKey: 'ledger-a', customerId: 'customer-a', name: 'Lab A', town: 'Town A', valuePaise: 123400, monthsBought: 10, lastBoughtOn: '2026-10-01', trend: 'up' };
  const labs = () => ({ list: 'month_buying', month: '2026-10', total: 1, page: 1, pageSize: 20, rows: [row] });
  it('normalizes linked labs and nullable ledger details', () => {
    expect(normalizeGrowthLabs(labs())).toEqual(labs());
    const v = { ...labs(), rows: [{ ...row, customerId: null, name: null, town: null, valuePaise: null, lastBoughtOn: null, trend: null }] };
    expect(normalizeGrowthLabs(v)).toEqual(v);
  });
  it('normalizes large purchases with nullable supplier names', () => {
    const v = { ...labs(), list: 'month_large_purchases', rows: [{ supplierName: null, valuePaise: 25000000, date: '2026-10-02' }] };
    expect(normalizeGrowthLabs(v)).toEqual(v);
  });
  it('accepts non-month lists with a null month', () => {
    expect(normalizeGrowthLabs({ ...labs(), list: 'regular_labs', month: null })).not.toBeNull();
  });
  it('normalizes window labs and invoice rows with optional half scope', () => {
    const window = { ...labs(), list: 'window_labs', month: null, half: 'H2' };
    expect(normalizeGrowthLabs(window)).toEqual(window);
    expect(normalizeGrowthLabs({ ...window, half: null })).not.toBeNull();
    const invoices = { ...labs(), list: 'bulk_invoices', month: null, half: 'H1', rows: [{ invoice: true, name: 'Lab A', customerId: 'customer-a', valuePaise: 25000000, date: '2026-02-02' }] };
    expect(normalizeGrowthLabs(invoices)).toEqual(invoices);
    const unlinked = { ...invoices, half: undefined, rows: [{ ...invoices.rows[0], name: null, customerId: null }] };
    delete unlinked.half;
    expect(normalizeGrowthLabs(unlinked)).toEqual(unlinked);
  });
  it.each([
    { list: 'unknown' }, { month: null }, { month: '2026-13' }, { total: -1 }, { page: 0 }, { pageSize: 21 },
    { rows: [{ ...row, monthsBought: 13 }] }, { rows: [{ ...row, monthsBought: -1 }] },
    { rows: [{ ...row, trend: 'sideways' }] }, { rows: [{ ...row, lastBoughtOn: '2026-02-30' }] },
    { rows: [{ supplierName: 'Supplier A', valuePaise: 100, date: '2026-10-02' }] },
    { list: 'month_large_purchases', rows: [row] },
    { list: 'window_labs', month: null, half: 'H3' },
    { half: 'H1' },
    { list: 'bulk_invoices', month: null, rows: [row] },
    { list: 'bulk_invoices', month: null, rows: [{ invoice: false, name: 'Lab A', customerId: null, valuePaise: 100, date: '2026-10-02' }] },
    { list: 'bulk_invoices', month: null, rows: [{ invoice: true, name: 'Lab A', customerId: null, valuePaise: 100, date: '2026-02-30' }] },
    { list: 'bulk_invoices', month: null, rows: [{ invoice: true, name: 'Lab A', valuePaise: 100, date: '2026-10-02' }] },
    { list: 'bulk_invoices', month: null, rows: [{ invoice: true, name: 'Lab A', customerId: null, valuePaise: Infinity, date: '2026-10-02' }] },
  ])('rejects malformed list response %#', patch => { expect(normalizeGrowthLabs({ ...labs(), ...patch })).toBeNull(); });
});

