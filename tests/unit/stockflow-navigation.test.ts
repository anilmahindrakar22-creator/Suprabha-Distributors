import { describe, expect, it } from 'vitest';
import { readOrderDashboardMessage } from '../../lib/stockflow-navigation';

describe('stock dashboard order navigation', () => {
  it('accepts a known dashboard drill-down filter', () => {
    expect(readOrderDashboardMessage({ type: 'stockflow-open-orders', status: 'billing' }))
      .toEqual({ type: 'stockflow-open-orders', status: 'billing' });
  });

  it.each([
    null,
    {},
    { type: 'unknown', status: 'billing' },
    { type: 'stockflow-open-orders', status: 'administrator' },
  ])('rejects malformed or unapproved navigation messages %#', (message) => {
    expect(readOrderDashboardMessage(message)).toBeNull();
  });
});
