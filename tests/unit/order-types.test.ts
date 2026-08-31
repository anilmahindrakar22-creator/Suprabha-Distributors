import { describe, expect, it } from 'vitest';
import { searchCustomers, validateOrderCommand } from '../../lib/order-types';

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

describe('Tally customer search', () => {
  const customers = [
    { id: '1', name: 'Aster Diagnostic Centre', phone: '9876543210', city: 'Belagavi', tallyKey: 'Aster Diagnostic Centre' },
    { id: '2', name: 'City Hospital', phone: null, city: 'Hubballi', tallyKey: 'City Hospital' },
  ];

  it('suggests ledgers by name, phone, or city without case sensitivity', () => {
    expect(searchCustomers(customers, 'ASTER')).toHaveLength(1);
    expect(searchCustomers(customers, '9876')[0]?.name).toBe('Aster Diagnostic Centre');
    expect(searchCustomers(customers, 'hubballi')[0]?.name).toBe('City Hospital');
  });

  it('does not open suggestions for an empty value and respects the result limit', () => {
    expect(searchCustomers(customers, '  ')).toEqual([]);
    expect(searchCustomers(customers, 'i', 1)).toHaveLength(1);
  });
});
