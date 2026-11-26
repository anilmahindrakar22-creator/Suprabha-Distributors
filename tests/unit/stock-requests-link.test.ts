import { describe, expect, it } from 'vitest';
import { readOpenCustomerMessage, readRequestsDashboardMessage } from '../../lib/stockflow-navigation';

describe('readOpenCustomerMessage', () => {
  const valid = { type: 'stockflow-open-customer', customerId: 'abcdef01-1234-5678-90ab-abcdef012345' };
  it('accepts an exact customer navigation message', () => {
    expect(readOpenCustomerMessage(valid)).toEqual(valid);
  });
  it.each([
    { ...valid, customerId: valid.customerId.toUpperCase() },
    { ...valid, customerId: 'not-a-uuid' }, { ...valid, extra: true },
    { type: valid.type }, Object.create(valid), Object.assign(Object.create({ inherited: true }), valid),
    Object.assign({ ...valid }, { [Symbol('extra')]: true }), null, [],
  ])('rejects malformed customer navigation %#', value => {
    expect(readOpenCustomerMessage(value)).toBeNull();
  });
});

describe('Stock Purchase navigation message', () => {
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
