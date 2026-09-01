import { describe, expect, it } from 'vitest';
import { filterOrders, orderAttentionReasons, orderStage, searchCatalog, searchCustomers, validateOrderCommand } from '../../lib/order-types';

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
    { action: 'reserve_order', payload: { orderId: 'id', expectedVersion: 1 } },
  ])('rejects malformed command %#', (command) => {
    expect(validateOrderCommand(command)).toBeNull();
  });

  it('accepts versioned transition commands and rejects removed reservations', () => {
    expect(
      validateOrderCommand({
        action: 'transition_order',
        payload: { orderId: 'order-id', expectedVersion: 2, toStatus: 'confirmed' },
      }),
    ).not.toBeNull();
    expect(validateOrderCommand({ action: 'reserve_order', payload: { orderId: 'order-id', expectedVersion: 2 } })).toBeNull();
  });

  it('validates atomic fulfilment updates and rejects negative quantities', () => {
    const command = { action: 'save_fulfilment', payload: { orderId: 'order-id', expectedVersion: 3, lines: [{ tallyKey: 'ITEM-1', fulfilledQuantity: 2, batchNumber: 'LOT-24', expiryDate: '2027-06-30' }] } };
    expect(validateOrderCommand(command)).not.toBeNull();
    expect(validateOrderCommand({ ...command, payload: { ...command.payload, lines: [{ tallyKey: 'ITEM-1', fulfilledQuantity: -1 }] } })).toBeNull();
  });

  it('validates safe order edits', () => {
    expect(validateOrderCommand({ action: 'edit_order', payload: { orderId: 'order-id', expectedVersion: 2, customerName: 'City Lab', reason: 'Corrected call entry', lines: [{ tallyKey: 'ITEM-1', quantity: 3 }] } })).not.toBeNull();
    expect(validateOrderCommand({ action: 'edit_order', payload: { orderId: 'order-id', expectedVersion: 2, customerName: 'A', lines: [] } })).toBeNull();
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

describe('Tally product search', () => {
  const catalog = [
    { tallyKey: 'SYS-FT3', item: 'Sys FT3', group: 'SYS Aurora', baseUnit: 'qty', closing: 1, active: true },
    { tallyKey: 'SYS-OLD', item: 'Old reagent', group: 'SYS Aurora', baseUnit: 'qty', closing: 2, active: false },
  ];

  it('returns active products from the first typed character', () => {
    expect(searchCatalog(catalog, 's')[0]?.tallyKey).toBe('SYS-FT3');
  });

  it('excludes products already added to the order', () => {
    expect(searchCatalog(catalog, 'sys', new Set(['SYS-FT3']))).toEqual([]);
  });
});

describe('order workflow and history', () => {
  const baseOrder = {
    id: '1', orderNumber: 'SF-001', customerName: 'City Hospital', customerPhone: '9876543210',
    status: 'awaiting_confirmation', source: 'phone', notes: null, version: 1,
    createdAt: '2026-08-31T10:00:00Z', updatedAt: '2026-08-31T10:00:00Z',
    lineCount: 1, totalQuantity: 2, reservedQuantity: 0, tallyInvoiceNumber: null,
    lines: [{ tallyKey: 'ITEM-1', itemName: 'Glucose Reagent', itemGroup: 'Reagents', baseUnit: 'box', quantity: 2, reservedQuantity: 0 }],
    events: [],
  };

  it('presents detailed statuses as six simple operational stages', () => {
    expect(orderStage('awaiting_confirmation')).toBe('Confirmation');
    expect(orderStage('confirmed')).toBe('Pick & pack');
    expect(orderStage('fully_reserved')).toBe('Pick & pack');
    expect(orderStage('picked')).toBe('Pick & pack');
    expect(orderStage('awaiting_tally_billing')).toBe('Tally billing');
    expect(orderStage('dispatched')).toBe('Dispatch');
    expect(orderStage('delivered')).toBe('Delivered');
  });

  it('separates active and old orders and searches product and invoice details', () => {
    const delivered = { ...baseOrder, id: '2', orderNumber: 'SF-002', status: 'delivered', tallyInvoiceNumber: 'INV-88' };
    expect(filterOrders([baseOrder, delivered], '', 'open')).toEqual([baseOrder]);
    expect(filterOrders([baseOrder, delivered], '', 'history')).toEqual([delivered]);
    expect(filterOrders([baseOrder, delivered], 'glucose', 'all')).toHaveLength(2);
    expect(filterOrders([baseOrder, delivered], 'INV-88', 'all')).toEqual([delivered]);
  });

  it('identifies operational exceptions for the attention queue', () => {
    const delayed = { ...baseOrder, updatedAt: '2026-08-31T01:00:00Z' };
    expect(orderAttentionReasons(delayed, new Date('2026-08-31T10:00:00Z'))).toContain('No progress for over 4 hours');
    expect(filterOrders([delayed], '', 'attention')).toEqual([delayed]);
  });

  it('does not treat a newly received untouched order as a back-order', () => {
    const fresh = { ...baseOrder, updatedAt: '2026-08-31T09:00:00Z' };
    expect(orderAttentionReasons(fresh, new Date('2026-08-31T10:00:00Z'))).toEqual([]);
  });
});
