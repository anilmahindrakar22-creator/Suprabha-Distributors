import { expect, it } from 'vitest';
import { defaultSelection, parseTallyReceiptCounts, parseTallyReceipts } from '../../lib/po-tally-receipts';

const candidate = { sourceId: 'voucher-1', lineKey: '1', date: '2026-10-29', reference: 'Purchase 1234', quantity: 10, unit: 'Nos', selectable: true, reason: null };
const line = { itemKey: 'TEST-ITEM', itemName: 'Test item', unit: 'Nos', quantity: 13, receivedQuantity: 0, remaining: 13, candidates: [candidate] };
const response = { poId: '35000000-0000-4000-8000-000000000001', version: 1, lines: [line] };

it('parses valid counts and receipts and tolerates extra keys at every level', () => {
  expect(parseTallyReceiptCounts({ counts: { [response.poId]: 1 }, extra: true }).counts[response.poId]).toBe(1);
  expect(parseTallyReceipts({ ...response, extra: true, lines: [{ ...line, extra: true, candidates: [{ ...candidate, extra: true }] }] })).toEqual(response);
  expect(parseTallyReceipts({ ...response, lines: [] }).lines).toEqual([]);
});

it('rejects invalid counts and missing fields rather than returning partial data', () => {
  for (const value of [{}, { counts: null }, { counts: { po: -1 } }, { counts: { po: 1.5 } }, { counts: { po: '1' } }]) expect(() => parseTallyReceiptCounts(value)).toThrow();
  for (const field of Object.keys(response)) {
    const value: Record<string, unknown> = { ...response }; delete value[field];
    expect(() => parseTallyReceipts(value)).toThrow();
  }
  for (const field of Object.keys(line)) {
    const value: Record<string, unknown> = { ...line }; delete value[field];
    expect(() => parseTallyReceipts({ ...response, lines: [value] })).toThrow();
  }
  for (const field of Object.keys(candidate)) {
    const value: Record<string, unknown> = { ...candidate }; delete value[field];
    expect(() => parseTallyReceipts({ ...response, lines: [{ ...line, candidates: [candidate, value] }] })).toThrow();
  }
});

it('rejects a bad reason, invalid dates, nonfinite quantities and inconsistent selectability', () => {
  for (const change of [{ reason: 'unknown' }, { date: '2026-02-30' }, { date: 'yesterday' }, { quantity: Infinity }, { selectable: false }]) {
    expect(() => parseTallyReceipts({ ...response, lines: [{ ...line, candidates: [{ ...candidate, ...change }] }] })).toThrow();
  }
  expect(parseTallyReceipts({ ...response, lines: [{ ...line, candidates: [{ ...candidate, selectable: false, reason: 'exceeds_remaining' }] }] }).lines[0].candidates[0].reason).toBe('exceeds_remaining');
});

it('selects the single selectable candidate, but neither of two selectable candidates', () => {
  const parsed = parseTallyReceipts(response);
  const selected = [{ itemKey: line.itemKey, sourceId: candidate.sourceId, lineKey: candidate.lineKey }];
  expect(defaultSelection(parsed.lines)).toEqual(selected);
  const second = { ...candidate, lineKey: '2' };
  expect(defaultSelection(parseTallyReceipts({ ...response, lines: [{ ...line, candidates: [candidate, second] }] }).lines)).toEqual([]);
  expect(defaultSelection(parseTallyReceipts({ ...response, lines: [{ ...line, candidates: [candidate, { ...second, selectable: false, reason: 'unit_mismatch' }] }] }).lines)).toEqual(selected);
});
