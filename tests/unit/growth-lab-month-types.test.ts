import { describe, expect, it } from 'vitest';
import { normalizeGrowthLabMonths } from '@/lib/growth-lab-month-types';

const months = ['2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
const row = (n = 0) => ({ labKey: `c|${n}`, customerId: null, name: `Lab ${n}`, town: null, totalPaise: 1200, monthsPaise: Array(12).fill(100), buyingMonths: 12 });
const sample = () => ({ window: { from: '2025-11-01', to: '2026-11-01' }, months: [...months], totalLabs: 3, rows: [row(1), { ...row(2), customerId: 'uuid', town: 'Pune', monthsPaise: [0, ...Array(10).fill(100), -50], buyingMonths: 10 }] });

describe('normalizeGrowthLabMonths', () => {
  it('accepts a valid sample and ignores extra keys', () => {
    const value = { ...sample(), extra: 1, rows: sample().rows.map(r => ({ ...r, more: true })) };
    expect(normalizeGrowthLabMonths(value, 'top')).toEqual({ ...sample(), filter: 'top' });
  });
  it('accepts a null name and a labKey ending in a pipe', () => {
    const value = { ...sample(), rows: [{ ...row(), name: null, labKey: 'company|' }] };
    const out = normalizeGrowthLabMonths(value);
    expect(out?.rows[0].name).toBeNull();
    expect(out?.rows[0].labKey).toBe('company|');
  });
  it('accepts zero rows', () => {
    expect(normalizeGrowthLabMonths({ ...sample(), rows: [], totalLabs: 0 })?.rows).toEqual([]);
  });
  it('accepts lapsing fields and up to 50 labs, with the caller choosing the filter', () => {
    const enriched = { ...row(), lastPurchaseOn: '2026-09-14', usualMonthlyPaise: 3800000, monthsMissed: 2, phone: '+919876543210' };
    const value = { ...sample(), filter: 'top', totalLabs: 60, rows: Array.from({ length: 50 }, (_, i) => ({ ...enriched, labKey: `c|${i}` })) };
    const out = normalizeGrowthLabMonths(value, 'lapsing');
    expect(out?.filter).toBe('lapsing');
    expect(out?.rows).toEqual(value.rows);
    expect(normalizeGrowthLabMonths({ ...value, rows: [...value.rows, enriched] }, 'lapsing')).toBeNull();
    expect(normalizeGrowthLabMonths({ ...sample(), rows: [{ ...enriched, phone: null }] }, 'lapsing')?.rows[0].phone).toBeNull();
  });
  const bad: [string, (s: ReturnType<typeof sample>) => unknown][] = [
    ['null', () => null],
    ['bad window date', s => ({ ...s, window: { from: '2025-11', to: '2026-11-01' } })],
    ['missing window', s => ({ ...s, window: null })],
    ['11 months', s => ({ ...s, months: months.slice(1) })],
    ['bad month string', s => ({ ...s, months: [...months.slice(0, 11), '2026-13'] })],
    ['21 rows', s => ({ ...s, totalLabs: 30, rows: Array.from({ length: 21 }, (_, i) => row(i)) })],
    ['empty labKey', s => ({ ...s, rows: [{ ...row(), labKey: ' ' }] })],
    ['numeric customerId', s => ({ ...s, rows: [{ ...row(), customerId: 5 }] })],
    ['non-string name', s => ({ ...s, rows: [{ ...row(), name: 5 }] })],
    ['numeric town', s => ({ ...s, rows: [{ ...row(), town: 5 }] })],
    ['zero total', s => ({ ...s, rows: [{ ...row(), totalPaise: 0 }] })],
    ['fractional total', s => ({ ...s, rows: [{ ...row(), totalPaise: 1.5 }] })],
    ['11 month values', s => ({ ...s, rows: [{ ...row(), monthsPaise: Array(11).fill(1) }] })],
    ['fractional month value', s => ({ ...s, rows: [{ ...row(), monthsPaise: [...Array(11).fill(1), 0.5] }] })],
    ['buyingMonths 13', s => ({ ...s, rows: [{ ...row(), buyingMonths: 13 }] })],
    ['buyingMonths -1', s => ({ ...s, rows: [{ ...row(), buyingMonths: -1 }] })],
    ['totalLabs below rows', s => ({ ...s, totalLabs: 1 })],
    ['non-integer totalLabs', s => ({ ...s, totalLabs: 2.5 })],
    ['bad last purchase date', s => ({ ...s, rows: [{ ...row(), lastPurchaseOn: '2026-02-30' }] })],
    ['non-ISO last purchase date', s => ({ ...s, rows: [{ ...row(), lastPurchaseOn: '14 Sep 2026' }] })],
    ['negative monthsMissed', s => ({ ...s, rows: [{ ...row(), monthsMissed: -1 }] })],
    ['fractional monthsMissed', s => ({ ...s, rows: [{ ...row(), monthsMissed: 1.5 }] })],
    ['negative usual', s => ({ ...s, rows: [{ ...row(), usualMonthlyPaise: -1 }] })],
    ['fractional usual', s => ({ ...s, rows: [{ ...row(), usualMonthlyPaise: 1.5 }] })],
    ['numeric phone', s => ({ ...s, rows: [{ ...row(), phone: 123 }] })],
  ];
  it.each(bad)('rejects %s', (_name, make) => {
    expect(normalizeGrowthLabMonths(make(sample()))).toBeNull();
  });
});
