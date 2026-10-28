import { describe, expect, it } from 'vitest';
import { readRequestsDashboardMessage } from '../../lib/stockflow-navigation';

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
