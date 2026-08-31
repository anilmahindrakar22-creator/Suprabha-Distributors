import { describe, expect, it } from 'vitest';
import { validateOrderCommand } from '../../lib/order-types';

describe('order command validation', () => {
  it('accepts a complete phone order', () => {
    expect(
      validateOrderCommand({
        action: 'create_order',
        payload: {
          idempotencyKey: '1234567890abcdef',
          customerName: 'City Diagnostic Lab',
          source: 'phone',
          lines: [{ tallyKey: 'ITEM-1', quantity: 2 }],
        },
      }),
    ).not.toBeNull();
  });

  it.each([
    null,
    {},
    { action: 'unknown', payload: {} },
    { action: 'create_order', payload: { customerName: 'A', lines: [] } },
    {
      action: 'create_order',
      payload: {
        idempotencyKey: '1234567890abcdef',
        customerName: 'Valid Customer',
        lines: [{ tallyKey: 'ITEM-1', quantity: 0 }],
      },
    },
    { action: 'reserve_order', payload: { orderId: 'id' } },
  ])('rejects malformed command %#', (command) => {
    expect(validateOrderCommand(command)).toBeNull();
  });

  it('accepts versioned transition and reservation commands', () => {
    expect(
      validateOrderCommand({
        action: 'transition_order',
        payload: { orderId: 'order-id', expectedVersion: 2, toStatus: 'confirmed' },
      }),
    ).not.toBeNull();
    expect(
      validateOrderCommand({
        action: 'reserve_order',
        payload: { orderId: 'order-id', expectedVersion: 2 },
      }),
    ).not.toBeNull();
  });
});
