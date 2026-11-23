import { describe, expect, it } from 'vitest';
import { readRequestsDashboardMessage, readStockPoDraftMessage, STOCK_PO_DRAFT_MAX } from '../../lib/stockflow-navigation';

describe('Stock Requests navigation message', () => {
  it('accepts the exact to-order message', () => {
    expect(readRequestsDashboardMessage({ type: 'stockflow-open-requests', section: 'to-order' }))
      .toEqual({ type: 'stockflow-open-requests', section: 'to-order' });
  });

  it.each([
    null, undefined, true, 1, 'stockflow-open-requests', [],
    {}, { type: 'stockflow-open-requests' }, { section: 'to-order' },
    { type: 'stockflow-open-orders', section: 'to-order' },
    { type: 'stockflow-open-requests', section: 'all' },
    { type: 'stockflow-open-requests', section: 1 },
    { type: 'stockflow-open-requests', section: 'to-order', extra: true },
    Object.create({ type: 'stockflow-open-requests', section: 'to-order' }),
  ])('rejects malformed or unrelated value %#', (value) => {
    expect(readRequestsDashboardMessage(value)).toBeNull();
  });
});

describe('readStockPoDraftMessage', () => {
  const item = { itemKey: 'Test Reagent A', quantity: 4.2 };
  const draft = (items: unknown) => ({ type: 'stockflow-create-po', items });
  it.each([1, STOCK_PO_DRAFT_MAX])('accepts %i items and copies the input', (count) => {
    const input = draft(Array.from({ length: count }, (_, index) => ({ ...item, itemKey: `Item ${index}` })));
    const result = readStockPoDraftMessage(input);
    expect(result).toEqual(input);
    expect(result).not.toBe(input);
    expect(result!.items).not.toBe(input.items);
    expect(result!.items[0]).not.toBe((input.items as unknown[])[0]);
  });
  it.each([
    null, undefined, [], true, 1, 'stockflow-create-po',
    draft([]), draft(Array.from({ length: 51 }, (_, index) => ({ ...item, itemKey: String(index) }))),
    draft([item, item]), draft([{ ...item, itemKey: '' }]), draft([{ ...item, itemKey: '  ' }]),
    draft([{ ...item, itemKey: 'x'.repeat(221) }]),
    ...[0, -1, NaN, Infinity, 1_000_001, '1', null].map(quantity => draft([{ ...item, quantity }])),
    { ...draft([item]), extra: true }, draft([{ ...item, extra: true }]),
    draft({}), draft(null), { type: 'wrong', items: [item] },
    Object.create(draft([item])), Object.assign(Object.create({ inherited: true }), draft([item])),
    draft([Object.create(item)]), draft([null]),
    Object.assign(draft([item]), { [Symbol('extra')]: true }),
  ])('rejects malformed draft %#', value => {
    expect(readStockPoDraftMessage(value)).toBeNull();
  });
});
