import { describe, expect, it } from 'vitest';
import { buildGrowthMarginPayload, buildGrowthMarginDetailPayload, normalizeGrowthMargin, normalizeGrowthMarginDetail, buildGrowthBilledBelowPayload, normalizeGrowthBilledBelow } from '@/lib/growth-margin-types';
const lab = { labKey: 'l', customerId: null, name: null, town: null, salesPaise: -100, knownSalesPaise: -100, gpPaise: -20, marginPct: -20, coveragePct: 100, low: true };
const item = { itemKey: 'i', name: 'Item', salesPaise: 100, knownSalesPaise: 100, gpPaise: -20, marginPct: -20, labs: 2, priceLowPaise: 10, typicalPricePaise: 20, priceHighPaise: 30, spreadPaise: 20, low: true, belowCost: true };
const levers = { priceSpread: { items: 2, pairs: 3, paise: 100 }, lowMargin: { items: 1, paiseToThreshold: 20, examples: [{ name: 'Item', marginPct: -20, salesPaise: 100, labs: 2 }] }, freeGoods: { lines: 1, costPaise: 30 }, instrumentsGpPaise: -40 };
const list = () => ({ view: 'labs', sort: 'sales', filter: 'all', q: null, page: 1, pageSize: 20, total: 1, thresholdPct: 14, consumablesMarginPct: 28, levers, rows: [lab] });
const detailRow = { labKey: 'l', customerId: null, name: null, town: null, unitPricePaise: 10, quantity: 1.5, salesPaise: 15, belowTypical: true, packDifference: false, approvedPricePaise: null };
const detail = () => ({ kind: 'item', itemKey: 'i', name: 'Item', typicalPricePaise: 20, labs: 2, marginPct: 20, tallyItemKey: null, page: 1, pageSize: 20, total: 1, rows: [detailRow] });
const billedRow = { date: '2026-10-02', customerId: 'customer-a', name: null, town: null, itemName: 'Reagent', quantity: 1.5, billedRatePaise: 100, approvedRatePaise: 200, gapPaise: 150, voucherRef: 'INV-1' };
const billed = { lines: 1, gapPaise: 150, unitMismatchLines: 2, approvedPricesInUse: 3, page: 1, pageSize: 20, total: 1, rows: [billedRow] };

describe('Growth billed below contract', () => {
  it('builds only a positive safe integer page', () => { expect(buildGrowthBilledBelowPayload({ page: 2 })).toEqual({ page: 2 }); });
  it.each([null, {}, { page: 0 }, { page: -1 }, { page: 1.5 }, { page: '1' }, { page: Infinity }, { page: 9007199254740992 }, { page: 1, view: 'items' }, { page: 1, billedBelow: '1' }])('rejects invalid payload %#', value => { expect(buildGrowthBilledBelowPayload(value)).toBeNull(); });
  it('normalizes nullable evidence, fractional quantities and strips incidental fields', () => {
    expect(normalizeGrowthBilledBelow({ ...billed, secret: true, rows: [{ ...billedRow, cost: 10 }] })).toEqual(billed);
    const zero = { ...billed, lines: 0, gapPaise: 0, approvedPricesInUse: 0, total: 0, rows: [] };
    expect(normalizeGrowthBilledBelow(zero)).toEqual(zero);
  });
  it.each([{ lines: -1 }, { gapPaise: 0.5 }, { unitMismatchLines: NaN }, { approvedPricesInUse: undefined }, { page: 0 }, { pageSize: 10 }, { total: 0 }, { rows: Array(21).fill(billedRow), total: 21 }])('rejects malformed summary %#', patch => { expect(normalizeGrowthBilledBelow({ ...billed, ...patch })).toBeNull(); });
  it.each([{ date: null }, { customerId: null }, { name: undefined }, { town: 2 }, { itemName: '' }, { quantity: Infinity }, { billedRatePaise: 0.1 }, { approvedRatePaise: undefined }, { gapPaise: NaN }, { voucherRef: null }])('rejects malformed line %#', patch => { expect(normalizeGrowthBilledBelow({ ...billed, rows: [{ ...billedRow, ...patch }] })).toBeNull(); });
});
describe('Growth margin payload builders', () => {
  it('returns only the exact permitted keys', () => {
    expect(buildGrowthMarginPayload({ view: 'items', page: 2, sort: 'spread', filter: 'low', q: 'Reagent' })).toEqual({ view: 'items', page: 2, sort: 'spread', filter: 'low', q: 'Reagent' });
    expect(buildGrowthMarginPayload({ view: 'labs', page: 1 })).toEqual({ view: 'labs', page: 1 });
    expect(buildGrowthMarginDetailPayload({ itemKey: 'i', page: 1 })).toEqual({ itemKey: 'i', page: 1 });
    expect(buildGrowthMarginDetailPayload({ labKey: 'l', page: 2 })).toEqual({ labKey: 'l', page: 2 });
  });
  it.each([{ view: 'labs', page: 0 }, { view: 'labs', page: 1.5 }, { view: 'labs', page: '1' }, { view: 'labs', page: 1, sort: 'spread' }, { view: 'labs', page: 1, filter: 'below_cost' }, { view: 'items', page: 1, filter: 'unlinked' }, { view: 'items', page: 1, q: '' }, { view: 'items', page: 1, q: ' '.repeat(2) }, { view: 'items', page: 1, q: 'a'.repeat(61) }, { view: 'items', page: 1, cost: true }, { view: 'items', page: 1, sort: undefined }])('rejects invalid list input %#', v => { expect(buildGrowthMarginPayload(v)).toBeNull(); });
  it.each([{ itemKey: '', page: 1 }, { itemKey: 'i', labKey: 'l', page: 1 }, { labKey: 'l', page: 1, q: 'x' }, { itemKey: 'i', page: -1 }, { itemKey: 'i', page: Infinity }])('rejects invalid detail input %#', v => { expect(buildGrowthMarginDetailPayload(v)).toBeNull(); });
});
describe('Growth margin normalizers', () => {
  it('accepts negative integer paise and nullable figures', () => {
    expect(normalizeGrowthMargin(list())).toEqual(list());
    const v = { ...list(), view: 'items', sort: 'spread', rows: [{ ...item, marginPct: null, typicalPricePaise: null }] };
    expect(normalizeGrowthMargin(v)).toEqual(v);
  });
  it('strips incidental gateway fields', () => { expect(normalizeGrowthMargin({ ...list(), secret: 'x', rows: [{ ...lab, cost: 20 }] })).toEqual(list()); });
  it.each([{ rows: [{ ...lab, gpPaise: 1.5 }] }, { rows: [{ ...lab, marginPct: Infinity }] }, { rows: [{ ...lab, coveragePct: 101 }] }, { rows: [{ ...lab, low: 'true' }] }, { rows: [{ ...lab, customerId: undefined }] }, { page: 0 }, { pageSize: 10 }, { total: 0 }, { levers: { ...levers, freeGoods: { lines: -1, costPaise: 20 } } }, { levers: { ...levers, priceSpread: { items: 2, pairs: 3, paise: 0.1 } } }, { sort: 'spread' }, { filter: 'below_cost' }, { q: '' }, { consumablesMarginPct: NaN }])('rejects malformed list %#', patch => { expect(normalizeGrowthMargin({ ...list(), ...patch })).toBeNull(); });
  it('normalizes both detail kinds and strips extra data', () => {
    expect(normalizeGrowthMarginDetail({ ...detail(), ignored: true })).toEqual(detail());
    const v = { kind: 'lab', labKey: 'l', customerId: null, name: null, town: null, salesPaise: 100, gpPaise: -20, marginPct: -20, page: 1, pageSize: 20, total: 1, rows: [{ itemKey: 'i', name: null, tallyItemKey: null, unitPricePaise: 10, typicalPricePaise: null, quantity: 1.5, salesPaise: 100, gpPaise: -20, marginPct: -20, belowTypical: false, packDifference: true, approvedPricePaise: 0 }] };
    expect(normalizeGrowthMarginDetail(v)).toEqual(v);
  });
  it.each([{ rows: [{ ...detailRow, quantity: NaN }] }, { rows: [{ ...detailRow, unitPricePaise: 1.5 }] }, { rows: [{ ...detailRow, approvedPricePaise: undefined }] }, { rows: [{ ...detailRow, packDifference: 1 }] }, { typicalPricePaise: Infinity }, { labs: -1 }, { tallyItemKey: undefined }, { kind: 'other' }, { pageSize: 0 }, { rows: [item] }])('rejects malformed detail %#', patch => { expect(normalizeGrowthMarginDetail({ ...detail(), ...patch })).toBeNull(); });
});
