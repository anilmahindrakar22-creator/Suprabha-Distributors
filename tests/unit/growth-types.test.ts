import { describe, expect, it } from 'vitest';
import { normalizeGrowth, type GrowthData } from '@/lib/growth-types';
const sample = (): GrowthData => ({
  companyCount: 1, window: { from: '2025-11-01', to: '2026-11-01', h1From: '2025-11-01', h2From: '2026-05-01' },
  confirmed: true, confirmedReason: null,
  tree: { revenuePaise: 1818000000, repeatPaise: 1367000000, bulkPaise: 451000000, bulkInvoices: 10, labsBuying: 164, buyingMonths: 760, perBuyingMonthPaise: 1799200 },
  halves: [
    { half: 'H1', revenuePaise: 715000000, repeatPaise: 579000000, bulkPaise: 136000000, bulkInvoices: 4, labsBuying: 121, buyingMonths: 374, perBuyingMonthPaise: 1548400 },
    { half: 'H2', revenuePaise: 1103000000, repeatPaise: 788000000, bulkPaise: 315000000, bulkInvoices: 6, labsBuying: 130, buyingMonths: 386, perBuyingMonthPaise: 2042200 },
  ],
  bridge: { h1Paise: 715000000, h2Paise: 1103000000, new: { labs: 43, paise: 179000000 }, stopped: { labs: 34, paise: 174000000 }, stoppedRegular: { labs: 4, paise: 21000000 }, grew: { labs: 41, paise: 483000000 }, fell: { labs: 46, paise: 100000000 }, same: { labs: 0, paise: 0 }, other: { labs: 0, paise: 0 } },
  health: { gp: { costedPct: 2, computedAt: null }, history: { firstSaleOn: '2025-10-01', monthsImported: 13 }, itemGroups: { unmappedPct: 21 }, reasons: { visitReasons180: 0, constraints: 0, openActions: 0, visits180: 4 }, catalog: { observedAt: '2026-11-09T00:00:00Z', groups: 30 } },
});
describe('Growth response validation', () => {
  it('normalizes a complete sample', () => { expect(normalizeGrowth(sample())).toEqual(sample()); });
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

