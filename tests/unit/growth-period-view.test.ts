import { describe, expect, it } from 'vitest';
import { changeFinancialYear, currentFinancialYear, periodChangeLabel, quarterDisabled } from '@/components/growth-period';

describe('Growth period picker rules', () => {
  it.each([['2026-03-31', 2025], ['2026-04-01', 2026], ['2027-01-01', 2026]] as const)('FY on %s is %s', (today, fy) => {
    expect(currentFinancialYear(today)).toBe(fy);
  });
  it('disables only quarters whose start is after today', () => {
    expect(([1, 2, 3, 4] as const).map(q => quarterDisabled(2026, q, '2026-11-24'))).toEqual([false, false, false, true]);
    expect(quarterDisabled(2026, 4, '2027-01-01')).toBe(false);
    expect(quarterDisabled(2026, 1, '2026-03-31')).toBe(true);
    expect(quarterDisabled(2026, 1, '2026-04-01')).toBe(false);
    expect(quarterDisabled(2025, 4, '2026-11-24')).toBe(false);
  });
  it('keeps the FY chip and available quarters on FY change', () => {
    expect(changeFinancialYear({ kind: 'fy', fy: 2025 }, 2026, '2026-11-24')).toEqual({ kind: 'fy', fy: 2026 });
    expect(changeFinancialYear({ kind: 'quarter', fy: 2025, quarter: 3 }, 2026, '2026-11-24')).toEqual({ kind: 'quarter', fy: 2026, quarter: 3 });
  });
  it('falls back to FY for a future quarter and ignores FY for rolling', () => {
    expect(changeFinancialYear({ kind: 'quarter', fy: 2025, quarter: 4 }, 2026, '2026-11-24')).toEqual({ kind: 'fy', fy: 2026 });
    expect(changeFinancialYear('rolling12', 2025, '2026-11-24')).toBe('rolling12');
  });
});

describe('period change labels', () => {
  it.each(['no_history', 'differs'] as const)('hides every change for %s', state => {
    expect(periodChangeLabel(state, 100, 150)).toBe('—');
    expect(periodChangeLabel(state, -100, 150)).toBe('—');
  });
  it.each(['confirmed', 'unconfirmed'] as const)('shows changes for %s using the shared rules', state => {
    expect(periodChangeLabel(state, 100, 150)).toBe('+50%');
    expect(periodChangeLabel(state, 100, 50)).toBe('−50%');
    expect(periodChangeLabel(state, -100, -50)).toBe('+50%');
    expect(periodChangeLabel(state, 0, 150)).toBe('—');
    expect(periodChangeLabel(state, null, 150)).toBe('—');
    expect(periodChangeLabel(state, 100, null)).toBe('—');
  });
});
