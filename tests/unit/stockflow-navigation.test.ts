import { describe, expect, it } from 'vitest';
import { defaultOrderFilterForRole, readOrderDashboardMessage } from '../../lib/stockflow-navigation';

describe('stock dashboard order navigation', () => {
  it('opens each single-purpose role at its primary operational queue', () => {
    expect(defaultOrderFilterForRole('administrator')).toBe('awaiting_confirmation');
    expect(defaultOrderFilterForRole('management')).toBe('awaiting_confirmation');
    expect(defaultOrderFilterForRole('accounts')).toBe('billing');
    expect(defaultOrderFilterForRole('warehouse')).toBe('picking');
    expect(defaultOrderFilterForRole('operations')).toBe('open');
    expect(defaultOrderFilterForRole('sales')).toBe('open');
  });

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
