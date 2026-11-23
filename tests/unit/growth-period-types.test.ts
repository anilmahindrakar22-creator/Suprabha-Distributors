import { describe, expect, it } from 'vitest';
import { formatGrowthPeriodParam, normalizeGrowthPeriod, parseGrowthPeriodParam } from '@/lib/growth-period-types';

function sample() {
  const tree = { revenuePaise: 100, repeatPaise: 100, bulkPaise: 0, bulkInvoices: 0, labsBuying: 1, buyingMonths: 1, perBuyingMonthPaise: 100 };
  const check = { days: 53, historyDays: 53, historySharePct: 100, coverageComplete: true, months: [{ month: '2026-10', state: 'matches' }], state: 'confirmed' };
  const contribution = { labs: 0, paise: 0 };
  const bridge = { h1Paise: 100, h2Paise: 100, new: contribution, stopped: contribution, stoppedRegular: contribution, grew: contribution, fell: contribution, same: { labs: 1, paise: 0 }, other: contribution };
  return {
    view: 'period',
    period: { kind: 'quarter', fy: 2026, quarter: 3, label: 'Q3 FY 2026-27 to 22 Nov', from: '2026-10-01', to: '2026-11-22', running: true },
    current: { key: 'current', label: 'Q3 FY 2026-27 to 22 Nov', from: '2026-10-01', to: '2026-11-22', tree, check },
    comparisons: [
      { key: 'last_year', label: 'Q3 FY 2025-26 (same days)', from: '2025-10-01', to: '2025-11-22', tree, bridge, check },
      { key: 'previous', label: 'Q2 FY 2026-27 (same days)', from: '2026-07-01', to: '2026-08-22', tree, bridge, check },
    ],
  };
}

describe('Growth period parameters', () => {
  it.each(['fy-2017', 'fy-2026', 'fy-2100', 'q1-2026', 'q2-2026', 'q3-2026', 'q4-2026', 'rolling12'])('round-trips %s', value => {
    const parsed = parseGrowthPeriodParam(value);
    expect(parsed).not.toBeNull();
    expect(formatGrowthPeriodParam(parsed!)).toBe(value);
  });
  it.each([null, '', 'q5-2026', 'fy-26', 'Q3-2026', 'fy-2026x', 'fy-2016', 'fy-2101', ' fy-2026', 'fy-2026\n'])('rejects %s', value => {
    expect(parseGrowthPeriodParam(value)).toBeNull();
  });
});

describe('Growth period normalization', () => {
  it('accepts a complete response', () => { const body = sample(); expect(normalizeGrowthPeriod(body)).toEqual(body); });
  it('accepts hidden comparisons only with no_history', () => {
    const body = sample();
    const hidden = { ...body.comparisons[0], tree: null, bridge: null, check: { ...body.comparisons[0].check, state: 'no_history' } };
    expect(normalizeGrowthPeriod({ ...body, comparisons: [hidden, body.comparisons[1]] })).not.toBeNull();
    expect(normalizeGrowthPeriod({ ...body, comparisons: [{ ...hidden, tree: body.current.tree }, body.comparisons[1]] })).toBeNull();
    expect(normalizeGrowthPeriod({ ...body, comparisons: [{ ...hidden, bridge: body.comparisons[0].bridge }, body.comparisons[1]] })).toBeNull();
    expect(normalizeGrowthPeriod({ ...body, comparisons: [{ ...hidden, check: body.current.check }, body.comparisons[1]] })).toBeNull();
  });
  it.each([
    (b: ReturnType<typeof sample>) => { b.current.tree.revenuePaise = 0.5; },
    (b: ReturnType<typeof sample>) => { b.current.tree.perBuyingMonthPaise = Number.MAX_SAFE_INTEGER + 1; },
    (b: ReturnType<typeof sample>) => { b.current.tree.bulkInvoices = -1; },
    (b: ReturnType<typeof sample>) => { b.current.check.state = 'invalid'; },
    (b: ReturnType<typeof sample>) => { Object.assign(b.current.check, { state: ['confirmed'] }); },
    (b: ReturnType<typeof sample>) => { b.current.check.months[0].state = 'confirmed'; },
    (b: ReturnType<typeof sample>) => { b.current.to = '2026-02-30'; },
    (b: ReturnType<typeof sample>) => { Object.assign(b, { extra: true }); },
    (b: ReturnType<typeof sample>) => { Object.assign(b.period, { extra: true }); },
    (b: ReturnType<typeof sample>) => { Object.assign(b.current.tree, { extra: true }); },
    (b: ReturnType<typeof sample>) => { Object.assign(b.current.check.months[0], { extra: true }); },
    (b: ReturnType<typeof sample>) => { Object.assign(b.comparisons[0].bridge.new, { extra: true }); },
    (b: ReturnType<typeof sample>) => { b.comparisons[0].bridge.new.paise = 1.5; },
  ])('rejects malformed or unknown fields (%#)', change => { const body = sample(); change(body); expect(normalizeGrowthPeriod(body)).toBeNull(); });
});
