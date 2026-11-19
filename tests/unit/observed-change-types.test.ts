import { describe, expect, it } from 'vitest';
import { normalizeObservedChanges, type ObservedChanges } from '../../lib/observed-change-types';

const valid: ObservedChanges = {
  view: 'observed_changes', asOf: '2026-11-19', salesThrough: '2026-11-19', page: 1, pageSize: 10, total: 12,
  summary: { changes: 78, increases: 65, decreases: 13, increasesFell: 12, increasesHeld: 16, increasesRose: 37, labs: 26, unitChanges: 0 },
  rows: [{ customerName: 'Test Lab A', itemKey: 'Reagent A', changedOn: '2026-06-01', windowDays: 90,
    direction: 'up', volume: 'fell', beforeRatePaise: 10000, afterRatePaise: 11000, changePct: 10,
    beforeQty: 30, afterQty: 15, beforeRevenuePaise: 300000, afterRevenuePaise: 165000,
    beforeGpPaise: 60000, afterGpPaise: null }],
};

describe('observed changes response boundary', () => {
  it('normalizes the contract example and accepts null GP and sales freshness', () => {
    expect(normalizeObservedChanges(valid)).toEqual(valid);
    expect(normalizeObservedChanges({ ...valid, salesThrough: null, rows: [{ ...valid.rows[0], beforeGpPaise: null }] })).not.toBeNull();
  });
  it.each([
    ['view', 'price_outcomes'], ['asOf', '2026-02-30'], ['salesThrough', 'yesterday'],
    ['page', 0], ['page', 101], ['pageSize', 20], ['total', -1], ['rows', null],
    ['summary', { ...valid.summary, labs: 1.5 }],
  ])('rejects invalid response %s', (field, value) => {
    expect(normalizeObservedChanges({ ...valid, [field]: value })).toBeNull();
  });
  it.each([
    ['beforeRatePaise', 100.5], ['afterRevenuePaise', -1], ['beforeGpPaise', 0.5], ['afterGpPaise', undefined],
    ['volume', 'unknown'], ['direction', 'unknown'], ['changedOn', '2026-02-30'], ['windowDays', 1.5],
    ['customerName', ''], ['itemKey', null], ['changePct', Number.NaN], ['afterQty', Infinity],
  ])('rejects invalid row %s', (field, value) => {
    expect(normalizeObservedChanges({ ...valid, rows: [{ ...valid.rows[0], [field]: value }] })).toBeNull();
  });
  it('accepts fractional quantities, signed percentages and signed integer GP', () => {
    expect(normalizeObservedChanges({ ...valid, rows: [{ ...valid.rows[0], beforeQty: 1.5, changePct: -4.2, beforeGpPaise: -100 }] })).not.toBeNull();
  });
  it('accepts negative net quantities after returns', () => {
    expect(normalizeObservedChanges({ ...valid, rows: [{ ...valid.rows[0], beforeQty: -1, afterQty: -2 }] })).not.toBeNull();
  });
  it('strips unexpected response and row data', () => {
    expect(normalizeObservedChanges({ ...valid, internal: 'hidden', rows: [{ ...valid.rows[0], internal: 'hidden' }] })).toEqual(valid);
  });
});
