import { describe, expect, it } from 'vitest';
import { findPossibleRepeat } from '../../components/order-workspace';
import type { OrderSummary } from '../../lib/order-types';

const today = new Date('2026-10-14T12:00:00Z');
const lines = ['A', 'B', 'C'].map((tallyKey) => ({ tallyKey }));
function order(id: string, keys: string[], createdAt = '2026-10-13T12:00:00Z', status = 'confirmed'): OrderSummary {
  return {
    id, orderNumber: `SO-${id}`, customerName: 'Lab', customerPhone: null, status,
    source: 'phone', notes: null, version: 1, createdAt, updatedAt: createdAt,
    lineCount: keys.length, totalQuantity: keys.length, reservedQuantity: 0, tallyInvoiceNumber: null,
    lines: keys.map((tallyKey) => ({ tallyKey, itemName: tallyKey, itemGroup: 'Reagents', baseUnit: 'Nos', quantity: 1, reservedQuantity: 0 })),
    events: [], exceptions: [], installations: [],
  };
}

describe('findPossibleRepeat', () => {
  it('returns no warning without a selected customer or selected items', () => {
    expect(findPossibleRepeat(null, [order('1', ['A'])], today)).toBeNull();
    expect(findPossibleRepeat([], [order('1', ['A'])], today)).toBeNull();
  });
  it('ignores orders without overlapping items', () => {
    expect(findPossibleRepeat(lines, [order('1', ['D'])], today)).toBeNull();
  });
  it('ignores an order from eight days ago', () => {
    expect(findPossibleRepeat(lines, [order('1', ['A'], '2026-10-06T12:00:00Z')], today)).toBeNull();
  });
  it.each(['cancelled', 'delivered'])('ignores %s orders', (status) => {
    expect(findPossibleRepeat(lines, [order('1', ['A'], undefined, status)], today)).toBeNull();
  });
  it('chooses most overlapping distinct items and newest on ties', () => {
    const best = order('best', ['A', 'B'], '2026-10-12T12:00:00Z');
    const result = findPossibleRepeat(lines, [order('newest', ['A', 'A'], '2026-10-14T11:00:00Z'), order('older', ['A', 'C'], '2026-10-11T12:00:00Z'), best], today);
    expect(result?.order).toBe(best);
    expect(result?.items.map((item) => item.tallyKey)).toEqual(['A', 'B']);
    expect(findPossibleRepeat(lines, [best, order('older', ['A', 'C'], '2026-10-11T12:00:00Z')], today)?.order).toBe(best);
  });
  it('includes the seven-day boundary and rejects future or invalid dates', () => {
    expect(findPossibleRepeat(lines, [order('boundary', ['A'], '2026-10-07T12:00:00Z')], today)?.order.id).toBe('boundary');
    expect(findPossibleRepeat(lines, [order('future', ['A'], '2026-10-15T12:00:00Z'), order('invalid', ['A'], 'invalid')], today)).toBeNull();
  });
});
