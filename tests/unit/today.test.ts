import { describe, expect, it } from 'vitest';
import { formatTodayPaise, parseToday, todayValueLabel } from '../../lib/today';

const order = { type: 'approve_price', title: 'Approve Apollo', subtitle: '2 lines · waiting 1 day', valuePaise: 4_800_000, approximate: true, since: '2026-10-29T09:00:00Z', rankReason: 'value_known', target: { kind: 'order', orderId: 'order-1' } };
const lab = { type: 'diagnose', title: 'Diagnose Care', subtitle: 'No diagnosis', valuePaisePerMonth: 6_000_000, valueKind: 'gap', due: null, rankReason: 'value_known', target: { kind: 'lab', customerId: 'lab-1' } };
const fixture = () => ({ policyVersion: 'today-v1', generatedAt: '2026-10-30T09:00:00Z', unblock: { total: 10, rows: [order] }, grow: { total: 1, rows: [lab] } });

describe('Today parser', () => {
  it('parses required fields and tolerates extra keys at every level', () => {
    const source = fixture();
    const result = parseToday({ ...source, extra: true, unblock: { ...source.unblock, extra: 1, rows: [{ ...order, extra: 2, target: { ...order.target, extra: 3 } }] } });
    expect(result.unblock.rows[0]).toEqual(order);
    expect(result.grow.rows[0]).toEqual(lab);
    expect(result.unblock.total).toBe(10);
  });
  it('accepts all six decision types and null monetary values', () => {
    const source = fixture();
    const result = parseToday({ ...source, coverageCertified: false, unblock: { total: 3, rows: [order, { ...order, type: 'stuck_order', valuePaise: null }, { ...order, type: 'stock_covers', target: { kind: 'stock', itemKey: 'GLU' } }] }, grow: { total: 3, rows: [lab, { ...lab, type: 'deadline', valuePaisePerMonth: null, valueKind: null, due: '2026-11-01' }, { ...lab, type: 'overdue_action', valueKind: 'expected' }] } });
    expect(result.unblock.rows).toHaveLength(3);
    expect(result.grow.rows).toHaveLength(3);
    expect(result.coverageCertified).toBe(false);
  });
  it.each([null, [], {}, { ...fixture(), policyVersion: 'today-v2' }, { ...fixture(), generatedAt: 'yesterday' }, { ...fixture(), coverageCertified: 'false' }, { ...fixture(), grow: { total: 0, rows: [lab] } }, { ...fixture(), unblock: { total: 6, rows: Array(6).fill(order) } }])('rejects malformed envelopes %#', input => {
    expect(() => parseToday(input)).toThrow('Invalid Today response');
  });
  it.each([
    { valuePaise: '4800000' }, { valuePaise: -1 }, { valuePaise: 1.5 }, { valuePaise: Number.MAX_SAFE_INTEGER + 1 }, { valuePaise: Infinity }, { approximate: 'true' }, { since: null }, { since: '2026-02-30' }, { title: '' }, { subtitle: null }, { rankReason: 'other' }, { type: 'diagnose' }, { target: { kind: 'lab', customerId: 'lab' } }, { target: { kind: 'order' } },
  ])('rejects malformed Unblock rows %#', change => {
    expect(() => parseToday({ ...fixture(), unblock: { total: 1, rows: [{ ...order, ...change }] } })).toThrow();
  });
  it.each([{ valueKind: 'revenue' }, { valueKind: null }, { valuePaisePerMonth: '6000' }, { due: 'not a date' }, { target: { kind: 'stock', itemKey: 'x' } }, { type: 'overdue_action', valueKind: 'gap' }])('rejects malformed Grow rows %#', change => {
    expect(() => parseToday({ ...fixture(), grow: { total: 1, rows: [{ ...lab, ...change }] } })).toThrow();
  });
});

describe('Indian short rupees from paise', () => {
  it.each([[95_000, '₹950'], [4_800_000, '₹48k'], [12_000_000, '₹1.2L'], [2_400_000_000, '₹2.4 cr'], [0, '₹0'], [100_000, '₹1k'], [10_000_000, '₹1L'], [1_000_000_000, '₹1 cr']])('formats %i as %s', (value, label) => expect(formatTodayPaise(value as number)).toBe(label));
  it.each([-1, NaN, Infinity, 0.5])('rejects invalid paise %s', value => expect(() => formatTodayPaise(value)).toThrow());
});

describe('Today value labels', () => {
  it('keeps one-off and recurring units and unknown values distinct', () => {
    const data = parseToday(fixture());
    const unblock = data.unblock.rows[0], grow = data.grow.rows[0];
    expect(todayValueLabel(unblock)).toBe('≈ ₹48k');
    expect(todayValueLabel({ ...unblock, approximate: false })).toBe('₹48k');
    expect(todayValueLabel({ ...unblock, valuePaise: null })).toBe('₹ ?');
    expect(todayValueLabel(grow)).toBe('₹60k/mo gap');
    expect(todayValueLabel({ ...grow, type: 'overdue_action', valueKind: 'expected', valuePaisePerMonth: 2_500_000 })).toBe('₹25k/mo expected');
    expect(todayValueLabel({ ...grow, valuePaisePerMonth: null })).toBe('₹ ?');
  });
});
