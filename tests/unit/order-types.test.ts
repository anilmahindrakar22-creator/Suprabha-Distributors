import { describe, expect, it } from 'vitest';
import { billingHandoffText, filterOrders, isOrderDeliveryOverdue, orderAttentionReasons, ordersCsv, orderStage, searchCatalog, searchCustomers, tallyInvoiceReconciliation, validateOrderCommand } from '../../lib/order-types';

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
        payload: { orderId: 'order-id', expectedVersion: 2, toStatus: 'confirmed', idempotencyKey: '1234567890abcdef' },
      }),
    ).not.toBeNull();
    expect(validateOrderCommand({ action: 'transition_order', payload: { orderId: 'order-id', expectedVersion: 2, toStatus: 'confirmed' } })).toBeNull();
    expect(validateOrderCommand({ action: 'reserve_order', payload: { orderId: 'order-id', expectedVersion: 2 } })).toBeNull();
  });

  it('validates atomic fulfilment updates and rejects negative quantities', () => {
    const command = { action: 'save_fulfilment', payload: { idempotencyKey: '1234567890abcdef', orderId: 'order-id', expectedVersion: 3, lines: [{ tallyKey: 'ITEM-1', fulfilledQuantity: 2 }] } };
    expect(validateOrderCommand(command)).not.toBeNull();
    expect(validateOrderCommand({ ...command, payload: { ...command.payload, lines: [{ tallyKey: 'ITEM-1', fulfilledQuantity: -1 }] } })).toBeNull();
  });

  it('validates dispatch and delivery evidence', () => {
    const dispatch = { action: 'save_dispatch', payload: { idempotencyKey: '1234567890abcdef', orderId: 'order-id', expectedVersion: 3, courierName: 'Local courier', trackingNumber: 'LR-100', dispatchDate: '2026-09-03' } };
    expect(validateOrderCommand(dispatch)).not.toBeNull();
    expect(validateOrderCommand({ ...dispatch, payload: { ...dispatch.payload, trackingNumber: '' } })).toBeNull();

    const delivery = { action: 'confirm_delivery', payload: { idempotencyKey: '1234567890abcdef', orderId: 'order-id', expectedVersion: 4, deliveredAt: '2026-09-03T10:30:00.000Z', receivedBy: 'Dr Rao' } };
    expect(validateOrderCommand(delivery)).not.toBeNull();
    expect(validateOrderCommand({ ...delivery, payload: { ...delivery.payload, deliveredAt: 'not-a-date' } })).toBeNull();
  });

  it('validates safe order edits', () => {
    expect(validateOrderCommand({ action: 'edit_order', payload: { idempotencyKey: '1234567890abcdef', orderId: 'order-id', expectedVersion: 2, customerName: 'City Lab', reason: 'Corrected call entry', lines: [{ tallyKey: 'ITEM-1', quantity: 3 }] } })).not.toBeNull();
    expect(validateOrderCommand({ action: 'edit_order', payload: { orderId: 'order-id', expectedVersion: 2, customerName: 'A', lines: [] } })).toBeNull();
  });

  it('validates delivery exception creation and resolution', () => {
    expect(validateOrderCommand({ action: 'create_exception', payload: { idempotencyKey: '1234567890abcdef', orderId: 'order-id', expectedVersion: 2, category: 'delayed', summary: 'Courier missed the route' } })).not.toBeNull();
    expect(validateOrderCommand({ action: 'create_exception', payload: { orderId: 'order-id', expectedVersion: 2, category: 'return', summary: 'Not supported' } })).toBeNull();
    expect(validateOrderCommand({ action: 'resolve_exception', payload: { idempotencyKey: '1234567890abcdef', orderId: 'order-id', expectedVersion: 3, exceptionId: 'exception-id', resolution: 'Delivered on the next route' } })).not.toBeNull();
    expect(validateOrderCommand({ action: 'resolve_exception', payload: { orderId: 'order-id', expectedVersion: 3, exceptionId: 'exception-id', resolution: '' } })).toBeNull();
  });

  it('validates installation scheduling and commissioning', () => {
    expect(validateOrderCommand({ action: 'schedule_installation', payload: { idempotencyKey: '1234567890abcdef', orderId: 'order-id', expectedVersion: 4, tallyKey: 'EQUIPMENT-1', scheduledDate: '2026-09-10' } })).not.toBeNull();
    expect(validateOrderCommand({ action: 'schedule_installation', payload: { orderId: 'order-id', expectedVersion: 4, tallyKey: '', scheduledDate: '10/09/2026' } })).toBeNull();
    expect(validateOrderCommand({ action: 'complete_installation', payload: { idempotencyKey: '1234567890abcdef', orderId: 'order-id', expectedVersion: 5, installationId: 'installation-id', serialNumber: 'SN-1002', commissioningNotes: 'Installed and quality checks passed' } })).not.toBeNull();
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
    events: [], exceptions: [], installations: [],
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

  it('builds a concise Tally billing handoff and isolates the billing queue', () => {
    const billing = { ...baseOrder, status: 'awaiting_tally_billing', deliveryAddress: 'Market Road', notes: 'Call before delivery' };
    expect(filterOrders([baseOrder, billing], '', 'billing')).toEqual([billing]);
    expect(billingHandoffText(billing)).toBe([
      'Order: SF-001',
      'Customer: City Hospital',
      'Phone: 9876543210',
      'Products:',
      '- Glucose Reagent: 2 box',
      'Delivery: Market Road',
      'Notes: Call before delivery',
    ].join('\n'));
  });

  it('maps dashboard drill-downs to combined operational queues', () => {
    const picking = { ...baseOrder, id: '2', status: 'ready_for_picking' };
    const dispatchReady = { ...baseOrder, id: '3', status: 'billed_in_tally' };
    expect(filterOrders([baseOrder, picking, dispatchReady], '', 'picking')).toEqual([picking]);
    expect(filterOrders([baseOrder, picking, dispatchReady], '', 'dispatch_ready')).toEqual([dispatchReady]);
  });

  it('identifies operational exceptions for the attention queue', () => {
    const delayed = { ...baseOrder, updatedAt: '2026-08-31T01:00:00Z' };
    expect(orderAttentionReasons(delayed, new Date('2026-08-31T10:00:00Z'))).toContain('No progress for over 4 hours');
    expect(filterOrders([delayed], '', 'attention')).toEqual([delayed]);
  });

  it('reconciles invoice numbers with Tally voucher numbers and references', () => {
    const billed = { ...baseOrder, tallyInvoiceNumber: ' INV-88 ' };
    const invoices = [{ voucherNumber: 'INV-88', reference: 'SF-001', party: 'City Hospital', date: '20260903', masterId: '44' }];
    expect(tallyInvoiceReconciliation(billed, invoices)).toBe('verified');
    expect(tallyInvoiceReconciliation({ ...billed, tallyInvoiceNumber: 'SF-001' }, invoices)).toBe('verified');
    expect(tallyInvoiceReconciliation({ ...billed, tallyInvoiceNumber: 'INV-99' }, invoices)).toBe('unmatched');
    expect(tallyInvoiceReconciliation(billed)).toBe('awaiting_sync');
  });

  it('tracks missing dispatch and delivery confirmation without requiring batch data', () => {
    const ready = { ...baseOrder, status: 'ready_for_dispatch', updatedAt: '2026-08-31T09:00:00Z' };
    const dispatched = { ...baseOrder, status: 'dispatched', courierName: 'Local courier', trackingNumber: 'LR-100', dispatchDate: '2026-08-31', updatedAt: '2026-08-31T09:00:00Z' };
    expect(orderAttentionReasons(ready, new Date('2026-08-31T10:00:00Z'))).toContain('Dispatch details missing');
    expect(orderAttentionReasons(dispatched, new Date('2026-08-31T10:00:00Z'))).toContain('Delivery confirmation pending');
    expect(orderAttentionReasons(ready, new Date('2026-08-31T10:00:00Z')).join(' ')).not.toMatch(/batch|expiry/i);
  });

  it('puts orders with an open delivery exception in the attention queue', () => {
    const exceptionOrder = { ...baseOrder, exceptions: [{ id: 'x1', category: 'damaged' as const, status: 'open' as const, summary: 'Outer carton damaged', ownerEmail: null, resolution: null, createdBy: 'ops@example.com', createdAt: '2026-08-31T09:00:00Z', resolvedBy: null, resolvedAt: null }] };
    expect(orderAttentionReasons(exceptionOrder, new Date('2026-08-31T10:00:00Z'))).toContain('Open delivery exception');
    expect(filterOrders([exceptionOrder], '', 'attention')).toEqual([exceptionOrder]);
  });

  it('flags overdue equipment installations', () => {
    const installationOrder = { ...baseOrder, installations: [{ id: 'i1', tallyKey: 'EQUIPMENT-1', itemName: 'Analyzer', status: 'scheduled' as const, scheduledDate: '2026-08-30', engineerEmail: null, siteContact: null, serialNumber: null, commissioningNotes: null, createdBy: 'ops@example.com', createdAt: '2026-08-29T09:00:00Z', completedBy: null, completedAt: null }] };
    expect(orderAttentionReasons(installationOrder, new Date(2026, 7, 31, 10))).toContain('Installation overdue');
  });

  it('does not treat a newly received untouched order as a back-order', () => {
    const fresh = { ...baseOrder, updatedAt: '2026-08-31T09:00:00Z' };
    expect(orderAttentionReasons(fresh, new Date('2026-08-31T10:00:00Z'))).toEqual([]);
  });

  it('flags only active orders whose expected delivery date has passed', () => {
    const overdue = { ...baseOrder, expectedDeliveryDate: '2026-08-30' };
    const delivered = { ...overdue, status: 'delivered' };
    const today = new Date(2026, 7, 31, 10, 0, 0);
    expect(isOrderDeliveryOverdue(overdue, today)).toBe(true);
    expect(isOrderDeliveryOverdue(delivered, today)).toBe(false);
    expect(orderAttentionReasons(overdue, today)).toContain('Delivery overdue');
  });

  it('exports operational orders as spreadsheet-safe CSV', () => {
    const order = { ...baseOrder, customerName: '=Unsafe formula', expectedDeliveryDate: '2026-09-02' };
    const csv = ordersCsv([order]);
    expect(csv).toContain('"\'=Unsafe formula"');
    expect(csv).toContain('"Glucose Reagent (2 box)"');
    expect(csv.split('\r\n')).toHaveLength(2);
  });
});
