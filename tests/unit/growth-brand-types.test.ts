import { describe, expect, it } from 'vitest';
import { normalizeGrowthBrands } from '@/lib/growth-brand-types';

const measures = { salesPaise: 1000, h1Paise: 400, h2Paise: 600, instrumentSalesPaise: 100, consumablesSalesPaise: 900, knownSalesPaise: 800, gpPaise: 200, marginPct: 25, items: 3 };
const line = { kind: 'line', group: 'Group A', areaCode: 'BIOCHEM', ...measures };
const sample = () => ({
  window: { from: '2025-11-01', to: '2026-11-01', h2From: '2026-05-01' },
  totals: { salesPaise: 1000, instrumentSalesPaise: 100, consumablesSalesPaise: 900, knownSalesPaise: 800, gpPaise: 200, marginPct: 25 },
  rows: [
    { key: 'brand:ALPHA', kind: 'brand', brandCode: 'ALPHA', name: 'Alpha', ...measures, lines: [line] },
    { key: 'none', kind: 'none', brandCode: null, name: 'Not a principal product', ...measures, marginPct: null, lines: [] },
    { key: 'unmapped', kind: 'unmapped', brandCode: null, name: 'Not mapped', ...measures, lines: [] },
  ],
});
type Sample = ReturnType<typeof sample>;
const mutate = (fn: (s: Sample) => void) => { const s = sample(); fn(s); return s; };

describe('normalizeGrowthBrands', () => {
  it('accepts a valid contract sample', () => {
    const data = normalizeGrowthBrands(sample());
    expect(data?.rows).toHaveLength(3);
    expect(data?.rows[0].lines[0].areaCode).toBe('BIOCHEM');
    expect(data?.rows[1].marginPct).toBeNull();
  });
  it('tolerates unknown extra keys and drops them', () => {
    const value = mutate(s => { Object.assign(s, { extra: 1 }); Object.assign(s.rows[0], { later: true }); Object.assign(s.rows[0].lines[0], { more: 'x' }); });
    const data = normalizeGrowthBrands(value);
    expect(data).not.toBeNull();
    expect(data).not.toHaveProperty('extra');
    expect(data?.rows[0]).not.toHaveProperty('later');
  });
  it('accepts null group and null area on lines', () => {
    expect(normalizeGrowthBrands(mutate(s => { Object.assign(s.rows[0].lines[0], { kind: 'direct', group: null, areaCode: null }); }))).not.toBeNull();
  });
  it.each([
    ['non-integer paise', (s: Sample) => { s.rows[0].salesPaise = 10.5; }],
    ['unsafe paise', (s: Sample) => { s.totals.gpPaise = 2 ** 60; }],
    ['non-integer line paise', (s: Sample) => { s.rows[0].lines[0].h1Paise = 0.1; }],
    ['bad margin', (s: Sample) => { Object.assign(s.rows[0], { marginPct: '25' }); }],
    ['negative items', (s: Sample) => { s.rows[0].items = -1; }],
    ['fractional items', (s: Sample) => { s.rows[0].items = 1.5; }],
    ['bad row kind', (s: Sample) => { Object.assign(s.rows[0], { kind: 'other' }); }],
    ['brand without code', (s: Sample) => { Object.assign(s.rows[0], { brandCode: null }); }],
    ['brand with empty code', (s: Sample) => { Object.assign(s.rows[0], { brandCode: ' ' }); }],
    ['brandCode on a none row', (s: Sample) => { Object.assign(s.rows[1], { brandCode: 'ALPHA' }); }],
    ['bad line kind', (s: Sample) => { Object.assign(s.rows[0].lines[0], { kind: 'other' }); }],
    ['bad group', (s: Sample) => { Object.assign(s.rows[0].lines[0], { group: 5 }); }],
    ['bad area', (s: Sample) => { Object.assign(s.rows[0].lines[0], { areaCode: 'XRAY' }); }],
    ['bad window date', (s: Sample) => { s.window.from = '2025-13-01'; }],
    ['non-date window', (s: Sample) => { s.window.h2From = '01/05/2026'; }],
    ['missing totals', (s: Sample) => { Object.assign(s, { totals: null }); }],
    ['rows not array', (s: Sample) => { Object.assign(s, { rows: {} }); }],
  ])('rejects %s', (_name, fn) => { expect(normalizeGrowthBrands(mutate(fn))).toBeNull(); });
  it.each([null, undefined, 5, 'x', [], {}])('rejects non-contract value %#', value => { expect(normalizeGrowthBrands(value)).toBeNull(); });
});
