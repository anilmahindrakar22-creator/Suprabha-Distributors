import { describe, expect, it } from 'vitest';
import { parseContractWindows, windowLabel, type ContractWindow } from '../../lib/contract-windows';

const row: ContractWindow = { customerId: '77111111-1111-4111-8111-111111111111', customerName: 'Example Lab', town: 'Bidar', opportunityId: '88111111-1111-4111-8111-111111111111', kind: 'capture', divisionName: null, category: 'competitor_lock_in', party: 'Other', endsOn: '2027-01-12', daysLeft: 74, confidence: 'high', source: 'document' };
const response = { rows: [row], total: 1, plannedCount: 0, page: 1, pageSize: 20 };
describe('parseContractWindows', () => {
  it('accepts a valid response and nullable fields', () => {
    expect(parseContractWindows(response)).toEqual(response);
    expect(parseContractWindows({ ...response, rows: [{ ...row, town: null }] }).rows[0].town).toBeNull();
  });
  it('tolerates extra keys', () => { expect(parseContractWindows({ ...response, extra: true, rows: [{ ...row, extra: true }] }).rows[0]).toMatchObject(row); });
  it('accepts an unknown deadline with its open question', () => {
    const unknown = { ...row, category: 'unknown', party: 'Who approves the purchase?', endsOn: '2026-11-05', daysLeft: 6 };
    expect(parseContractWindows({ ...response, rows: [unknown] }).rows[0]).toEqual(unknown);
  });
  it('rejects a bad category without returning valid rows', () => { expect(() => parseContractWindows({ ...response, total: 2, rows: [row, { ...row, category: 'price' }] })).toThrow(); });
  it('rejects non-integer daysLeft', () => { expect(() => parseContractWindows({ ...response, rows: [{ ...row, daysLeft: 1.5 }] })).toThrow(); });
  it.each([null, {}, { ...response, plannedCount: -1 }, { ...response, page: 0 }, { ...response, rows: [{ ...row, endsOn: '2027-02-30' }] }, { ...response, rows: [{ ...row, source: null }] }])('rejects malformed response %#', value => { expect(() => parseContractWindows(value)).toThrow(); });
});
describe('windowLabel', () => {
  it.each(['competitor_lock_in', 'contract_tender'] as const)('preserves %s contract wording', category => {
    for (const [daysLeft, expected] of [[74, 'Ends 12 Jan 2027 · 74 days left'], [1, 'Ends 12 Jan 2027 · 1 day left'], [0, 'Ends 12 Jan 2027 · ends today'], [-1, 'Ended 1 day ago'], [-10, 'Ended 10 days ago']] as const) expect(windowLabel({ ...row, category, daysLeft })).toBe(expected);
  });
  it.each([[6, 'Ask by 5 Nov 2026 · 6 days left'], [1, 'Ask by 5 Nov 2026 · 1 day left'], [0, 'Ask by 5 Nov 2026 · today'], [-1, 'Ask-by passed 1 day ago'], [-3, 'Ask-by passed 3 days ago']] as const)('formats unknown ask-by deadline with %i days left', (daysLeft, expected) => {
    expect(windowLabel({ ...row, category: 'unknown', endsOn: '2026-11-05', daysLeft })).toBe(expected);
  });
});
