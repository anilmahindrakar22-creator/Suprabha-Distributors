import { describe, expect, it } from 'vitest';
import { billingHandoffText, canRoleTransitionOrder, currentTallyFinancialYear, customerPhoneHref, filterOrders, isOrderBackOrdered, isOrderDeliveryDue, isOrderDeliveryOverdue, orderAttentionReasons, orderBackOrderedQuantity, orderDeliveryReminder, orderEventDescription, orderMatchesCaptureDate, orderMatchesCaptureDateRange, orderNeedsBillingAttention, orderNextOwnerLabel, orderOperationsText, ordersCsv, orderStage, pageItems, repeatOrderTemplate, searchCatalog, searchCustomers, tallyInvoiceLineReconciliation, tallyInvoiceReconciliation, tallyInvoiceReconciliationDetail, validateOrderCommand } from '../../lib/order-types';

describe('order command validation', () => {
  it('accepts a complete phone order', () => {
    expect(
      validateOrderCommand({
        action: 'create_order',
        payload: {
          idempotencyKey: '1234567890abcdef',
          customerName: 'City Diagnostic Lab',
          source: 'phone',
          expectedDeliveryDate: '2026-09-15',
          lines: [{ tallyKey: 'ITEM-1', quantity: 2 }],
        },
      }),
    ).not.toBeNull();
  });

  it.each(['phone', 'whatsapp', 'email', 'walk_in'] as const)('accepts %s as an order source', (source) => {
    expect(validateOrderCommand({ action: 'create_order', payload: { idempotencyKey: '1234567890abcdef', customerName: 'City Lab', source, lines: [{ tallyKey: 'ITEM-1', quantity: 1 }] } })).not.toBeNull();
  });

  it('bounds order capture text, sources, identifiers and quantities', () => {
    const base = { action: 'create_order', payload: { idempotencyKey: '1234567890abcdef', customerName: 'City Lab', source: 'phone', lines: [{ tallyKey: 'ITEM-1', quantity: 1 }] } };
    expect(validateOrderCommand({ ...base, payload: { ...base.payload, source: 'unknown' } })).toBeNull();
    expect(validateOrderCommand({ ...base, payload: { ...base.payload, customerName: 'X'.repeat(201) } })).toBeNull();
    expect(validateOrderCommand({ ...base, payload: { ...base.payload, notes: 'X'.repeat(2001) } })).toBeNull();
    expect(validateOrderCommand({ ...base, payload: { ...base.payload, priority: 'critical' } })).toBeNull();
    expect(validateOrderCommand({ ...base, payload: { ...base.payload, expectedDeliveryDate: '2026-02-31' } })).toBeNull();
    expect(validateOrderCommand({ ...base, payload: { ...base.payload, deliveryAddress: 'X'.repeat(1001) } })).toBeNull();
    expect(validateOrderCommand({ ...base, payload: { ...base.payload, lines: [{ tallyKey: 'ITEM-1', quantity: 1_000_001 }] } })).toBeNull();
  });

  it('validates versioned order priority changes', () => {
    const command = { action: 'set_order_priority', payload: { idempotencyKey: '1234567890abcdef', orderId: 'order-id', expectedVersion: 2, priority: 'urgent' } };
    expect(validateOrderCommand(command)).not.toBeNull();
    expect(validateOrderCommand({ ...command, payload: { ...command.payload, priority: 'critical' } })).toBeNull();
  });

  it('validates versioned order assignments', () => {
    const command = { action: 'set_order_assignee', payload: { idempotencyKey: '1234567890abcdef', orderId: 'order-id', expectedVersion: 2, assignedToEmail: 'ops@example.com' } };
    expect(validateOrderCommand(command)).not.toBeNull();
    expect(validateOrderCommand({ ...command, payload: { ...command.payload, assignedToEmail: 'not-an-email' } })).toBeNull();
    expect(validateOrderCommand({ ...command, payload: { ...command.payload, assignedToEmail: undefined } })).not.toBeNull();
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
    {
      action: 'create_order',
      payload: {
        idempotencyKey: '1234567890abcdef',
        customerName: 'Valid Customer',
        lines: [{ tallyKey: 'ITEM-1', quantity: 1.5 }],
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
    expect(validateOrderCommand({ action: 'transition_order', payload: { orderId: 'order-id', expectedVersion: 2, toStatus: 'invented_state', idempotencyKey: '1234567890abcdef' } })).toBeNull();
    expect(validateOrderCommand({ action: 'transition_order', payload: { orderId: 'order-id', expectedVersion: 2, toStatus: 'billed_in_tally', tallyInvoiceNumber: 'X'.repeat(161), idempotencyKey: '1234567890abcdef' } })).toBeNull();
    expect(validateOrderCommand({ action: 'transition_order', payload: { orderId: 'order-id', expectedVersion: 2, toStatus: 'cancelled', reason: 'X'.repeat(501), idempotencyKey: '1234567890abcdef' } })).toBeNull();
  });

  it('validates atomic fulfilment updates and rejects negative quantities', () => {
    const command = { action: 'save_fulfilment', payload: { idempotencyKey: '1234567890abcdef', orderId: 'order-id', expectedVersion: 3, lines: [{ tallyKey: 'ITEM-1', fulfilledQuantity: 2 }] } };
    expect(validateOrderCommand(command)).not.toBeNull();
    expect(validateOrderCommand({ ...command, payload: { ...command.payload, lines: [{ tallyKey: 'ITEM-1', fulfilledQuantity: -1 }] } })).toBeNull();
    expect(validateOrderCommand({ ...command, payload: { ...command.payload, lines: [{ tallyKey: 'ITEM-1', fulfilledQuantity: 1.5 }] } })).toBeNull();
    expect(validateOrderCommand({ ...command, payload: { ...command.payload, lines: [] } })).toBeNull();
    expect(validateOrderCommand({ ...command, payload: { ...command.payload, deliveryAddress: 'X'.repeat(1001) } })).toBeNull();
    expect(validateOrderCommand({ ...command, payload: { ...command.payload, expectedDeliveryDate: '2026-02-31' } })).toBeNull();
  });

  it('validates dispatch and delivery evidence', () => {
    const dispatch = { action: 'save_dispatch', payload: { idempotencyKey: '1234567890abcdef', orderId: 'order-id', expectedVersion: 3, courierName: 'Local courier', trackingNumber: 'LR-100', dispatchDate: '2026-09-03' } };
    expect(validateOrderCommand(dispatch)).not.toBeNull();
    expect(validateOrderCommand({ ...dispatch, payload: { ...dispatch.payload, trackingNumber: '' } })).toBeNull();
    expect(validateOrderCommand({ ...dispatch, payload: { ...dispatch.payload, vehicleNumber: 'X'.repeat(41) } })).toBeNull();
    expect(validateOrderCommand({ ...dispatch, payload: { ...dispatch.payload, dispatchDate: '2026-13-01' } })).toBeNull();

    const delivery = { action: 'confirm_delivery', payload: { idempotencyKey: '1234567890abcdef', orderId: 'order-id', expectedVersion: 4, deliveredAt: '2026-09-03T10:30:00.000Z', receivedBy: 'Dr Rao' } };
    expect(validateOrderCommand(delivery)).not.toBeNull();
    expect(validateOrderCommand({ ...delivery, payload: { ...delivery.payload, deliveredAt: 'not-a-date' } })).toBeNull();
    expect(validateOrderCommand({ ...delivery, payload: { ...delivery.payload, podReference: 'X'.repeat(161) } })).toBeNull();
    expect(validateOrderCommand({ ...delivery, payload: { ...delivery.payload, deliveredAt: '2026-09-03' } })).toBeNull();
  });

  it('validates safe order edits', () => {
    expect(validateOrderCommand({ action: 'edit_order', payload: { idempotencyKey: '1234567890abcdef', orderId: 'order-id', expectedVersion: 2, customerName: 'City Lab', reason: 'Corrected call entry', lines: [{ tallyKey: 'ITEM-1', quantity: 3 }] } })).not.toBeNull();
    expect(validateOrderCommand({ action: 'edit_order', payload: { orderId: 'order-id', expectedVersion: 2, customerName: 'A', lines: [] } })).toBeNull();
    expect(validateOrderCommand({ action: 'edit_order', payload: { idempotencyKey: '1234567890abcdef', orderId: 'order-id', expectedVersion: 2, customerName: 'City Lab', lines: [{ tallyKey: 'ITEM-1', quantity: 2.5 }] } })).toBeNull();
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
    expect(validateOrderCommand({ action: 'schedule_installation', payload: { idempotencyKey: '1234567890abcdef', orderId: 'order-id', expectedVersion: 4, tallyKey: 'EQUIPMENT-1', scheduledDate: '2026-02-30' } })).toBeNull();
    expect(validateOrderCommand({ action: 'complete_installation', payload: { idempotencyKey: '1234567890abcdef', orderId: 'order-id', expectedVersion: 5, installationId: 'installation-id', serialNumber: 'SN-1002', commissioningNotes: 'Installed and quality checks passed' } })).not.toBeNull();
  });

  it('validates bounded billing reconciliation reviews', () => {
    const valid = { action: 'record_billing_review', payload: { idempotencyKey: '1234567890abcdef', orderId: 'order-id', expectedVersion: 2, outcome: 'tally_corrected', note: 'Corrected billed quantity in Tally' } };
    expect(validateOrderCommand(valid)).not.toBeNull();
    expect(validateOrderCommand({ ...valid, payload: { ...valid.payload, outcome: 'ignored' } })).toBeNull();
    expect(validateOrderCommand({ ...valid, payload: { ...valid.payload, note: 'x' } })).toBeNull();
  });

  it('validates bounded immutable order notes', () => {
    const valid = { action: 'add_order_note', payload: { idempotencyKey: '1234567890abcdef', orderId: 'order-id', expectedVersion: 2, note: 'Customer asked for a morning delivery call' } };
    expect(validateOrderCommand(valid)).toEqual(valid);
    expect(validateOrderCommand({ ...valid, payload: { ...valid.payload, note: '  ' } })).toBeNull();
    expect(validateOrderCommand({ ...valid, payload: { ...valid.payload, note: 'x'.repeat(1001) } })).toBeNull();
  });
});

describe('customer phone actions', () => {
  it('builds safe dial links only from plausible phone numbers', () => {
    expect(customerPhoneHref('+91 98765-43210')).toBe('tel:+919876543210');
    expect(customerPhoneHref('(080) 2345 6789')).toBe('tel:08023456789');
    expect(customerPhoneHref('Call 9876543210')).toBeNull();
    expect(customerPhoneHref('123')).toBeNull();
    expect(customerPhoneHref(null)).toBeNull();
  });
});

describe('order list pagination', () => {
  it('returns the requested page without rendering the full collection', () => {
    expect(pageItems(Array.from({ length: 45 }, (_, index) => index + 1), 2, 20)).toEqual({
      page: 2,
      pageCount: 3,
      items: Array.from({ length: 20 }, (_, index) => index + 21),
    });
  });

  it('clamps a page that disappeared after an order transition', () => {
    expect(pageItems(['remaining'], 4, 20)).toEqual({ page: 1, pageCount: 1, items: ['remaining'] });
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
  it('shows workflow actions only to roles accepted by the server policy', () => {
    expect(canRoleTransitionOrder('sales', 'phone_order_received', 'awaiting_confirmation')).toBe(true);
    expect(canRoleTransitionOrder('accounts', 'phone_order_received', 'awaiting_confirmation')).toBe(false);
    expect(canRoleTransitionOrder('warehouse', 'confirmed', 'packed')).toBe(true);
    expect(canRoleTransitionOrder('sales', 'confirmed', 'packed')).toBe(false);
    expect(canRoleTransitionOrder('accounts', 'awaiting_tally_billing', 'billed_in_tally')).toBe(true);
    expect(canRoleTransitionOrder('warehouse', 'awaiting_tally_billing', 'billed_in_tally')).toBe(false);
    expect(canRoleTransitionOrder('operations', 'billed_in_tally', 'ready_for_dispatch')).toBe(true);
    expect(canRoleTransitionOrder('viewer', 'billed_in_tally', 'ready_for_dispatch')).toBe(false);
    expect(canRoleTransitionOrder('operations', 'invented', 'packed')).toBe(false);
  });

  it('identifies the team responsible for the next visible workflow step', () => {
    expect(orderNextOwnerLabel('phone_order_received')).toBe('Sales or operations');
    expect(orderNextOwnerLabel('confirmed')).toBe('Warehouse or operations');
    expect(orderNextOwnerLabel('awaiting_tally_billing')).toBe('Accounts');
    expect(orderNextOwnerLabel('billed_in_tally')).toBe('Operations');
    expect(orderNextOwnerLabel('delivered')).toBeNull();
  });

  it('describes assignment and priority audit events with their before and after values', () => {
    const event = { id: 1, eventType: 'order_assignment_changed', fromStatus: 'confirmed', toStatus: 'confirmed', reason: null, actorEmail: 'admin@example.com', actorRole: 'administrator', metadata: { before: 'sales@example.com', after: 'ops@example.com' }, createdAt: '2026-09-10T10:00:00Z' };
    expect(orderEventDescription(event)).toBe('Changed owner from sales@example.com to ops@example.com');
    expect(orderEventDescription({ ...event, metadata: { before: 'ops@example.com', after: null } })).toBe('Cleared order owner (ops@example.com)');
    expect(orderEventDescription({ ...event, eventType: 'order_priority_changed', metadata: { before: 'normal', after: 'urgent' } })).toBe('Changed priority from normal to urgent');
    expect(orderEventDescription({ ...event, eventType: 'status_changed', fromStatus: 'confirmed', toStatus: 'packed', metadata: {} })).toBe('confirmed → packed');
  });
  const baseOrder = {
    id: '1', orderNumber: 'SF-001', customerName: 'City Hospital', customerPhone: '9876543210',
    status: 'awaiting_confirmation', source: 'phone', notes: null, version: 1,
    createdAt: '2026-08-31T10:00:00Z', updatedAt: '2026-08-31T10:00:00Z',
    lineCount: 1, totalQuantity: 2, reservedQuantity: 0, tallyInvoiceNumber: null,
    lines: [{ tallyKey: 'ITEM-1', itemName: 'Glucose Reagent', itemGroup: 'Reagents', baseUnit: 'box', quantity: 2, reservedQuantity: 0 }],
    events: [], exceptions: [], installations: [],
  };

  it('copies only reusable customer and product details into a new order template', () => {
    expect(repeatOrderTemplate({ ...baseOrder, notes: 'Old urgent instruction', status: 'delivered' })).toEqual({
      customerName: 'City Hospital',
      customerPhone: '9876543210',
      source: 'phone',
      lines: [{ tallyKey: 'ITEM-1', quantity: 2 }],
    });
  });

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
    const billing = { ...baseOrder, status: 'awaiting_tally_billing', assignedToEmail: 'ops@example.com', deliveryAddress: 'Market Road', notes: 'Call before delivery' };
    expect(filterOrders([baseOrder, billing], '', 'billing')).toEqual([billing]);
    expect(billingHandoffText(billing)).toBe([
      'Order: SF-001',
      'Customer: City Hospital',
      'Phone: 9876543210',
      'Owner: ops@example.com',
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

  it('builds a copyable operational summary from existing order evidence', () => {
    const dispatched = { ...baseOrder, status: 'dispatched', assignedToEmail: 'ops@example.com', expectedDeliveryDate: '2026-09-10', deliveryAddress: 'Market Road', tallyInvoiceNumber: 'SD/26-27/0552', courierName: 'Local delivery', trackingNumber: 'LR-22', vehicleNumber: 'KA01AB1234', notes: 'Call before delivery' };
    expect(orderOperationsText(dispatched)).toBe([
      'SF-001 · Dispatch',
      'Customer: City Hospital',
      'Phone: 9876543210',
      'Owner: ops@example.com',
      'Products:',
      '- Glucose Reagent: 2 box',
      'Promised delivery: 2026-09-10',
      'Delivery address: Market Road',
      'Tally invoice: SD/26-27/0552',
      'Dispatch: Local delivery · LR-22 · KA01AB1234',
      'Notes: Call before delivery',
    ].join('\n'));
  });

  it('finds exact customer order history without product-name collisions', () => {
    const sameCustomer = { ...baseOrder, id: '2', customerName: 'City Hospital' };
    const productCollision = { ...baseOrder, id: '3', customerName: 'Other Lab', lines: [{ ...baseOrder.lines[0], itemName: 'City Hospital Control' }] };
    expect(filterOrders([sameCustomer, productCollision], 'customer: city hospital ', 'all')).toEqual([sameCustomer]);
  });

  it('finds only work assigned to the requested user', () => {
    const mine = { ...baseOrder, id: '2', assignedToEmail: 'ops@example.com' };
    const another = { ...baseOrder, id: '3', assignedToEmail: 'sales@example.com' };
    const unassigned = { ...baseOrder, id: '4', assignedToEmail: null };
    expect(filterOrders([mine, another, unassigned], 'assignee:OPS@example.com', 'open')).toEqual([mine]);
    expect(filterOrders([mine, another, unassigned], 'assignee:unassigned', 'open')).toEqual([unassigned]);
  });

  it('finds orders by immutable activity-note text when events are available', () => {
    const noted = { ...baseOrder, events: [{ id: 9, eventType: 'order_note_added', fromStatus: baseOrder.status, toStatus: baseOrder.status, reason: 'Customer requested morning delivery', actorEmail: 'ops@example.com', actorRole: 'operations', metadata: {}, createdAt: '2026-09-10T10:00:00Z' }] };
    expect(filterOrders([noted], 'morning delivery', 'all')).toEqual([noted]);
    expect(filterOrders([noted], 'evening delivery', 'all')).toEqual([]);
  });

  it('filters active high and urgent orders without surfacing closed work', () => {
    const high = { ...baseOrder, id: '2', priority: 'high' as const };
    const urgent = { ...baseOrder, id: '3', priority: 'urgent' as const };
    const closed = { ...urgent, id: '4', status: 'delivered' };
    expect(filterOrders([baseOrder, high, urgent, closed], '', 'priority_high')).toEqual([high, urgent]);
    expect(filterOrders([baseOrder, high, urgent, closed], '', 'priority_urgent')).toEqual([urgent]);
  });

  it('reconciles invoice numbers with Tally voucher numbers and references', () => {
    const billed = { ...baseOrder, tallyInvoiceNumber: ' INV-88 ' };
    const invoices = [{ voucherNumber: 'INV-88', reference: 'SF-001', party: 'City Hospital', date: '20260903', masterId: '44' }];
    expect(tallyInvoiceReconciliation(billed, invoices)).toBe('verified');
    expect(tallyInvoiceReconciliation({ ...billed, tallyInvoiceNumber: 'SF-001' }, invoices)).toBe('unmatched');
    expect(tallyInvoiceReconciliation(billed, [{ ...invoices[0], party: 'Different Hospital' }])).toBe('customer_mismatch');
    expect(tallyInvoiceReconciliation(billed, [{ ...invoices[0], party: ' city   hospital ' }])).toBe('verified');
    expect(tallyInvoiceReconciliation(billed, [invoices[0], { ...invoices[0], masterId: '45' }])).toBe('ambiguous');
    expect(tallyInvoiceReconciliation({ ...billed, tallyInvoiceNumber: '552' }, [{ ...invoices[0], voucherNumber: '552' }])).toBe('unmatched');
    expect(tallyInvoiceReconciliation({ ...billed, tallyInvoiceNumber: 'INV-99' }, invoices)).toBe('unmatched');
    expect(tallyInvoiceReconciliation(billed)).toBe('awaiting_sync');
    const currentDate = new Date('2026-09-03T06:00:00Z');
    expect(currentTallyFinancialYear(currentDate)).toBe('26-27');
    expect(tallyInvoiceReconciliation({ ...billed, tallyInvoiceNumber: '552' }, [{ ...invoices[0], voucherNumber: 'SD/26-27/0552' }], currentDate)).toBe('verified');
    expect(tallyInvoiceReconciliationDetail({ ...billed, tallyInvoiceNumber: '552' }, [{ ...invoices[0], voucherNumber: ' SD/26-27/0552 ' }], currentDate)).toEqual({ state: 'verified', matchedVoucherNumber: 'SD/26-27/0552' });
    expect(tallyInvoiceReconciliation({ ...billed, tallyInvoiceNumber: '552' }, [{ ...invoices[0], voucherNumber: 'SD/25-26/0552' }], currentDate)).toBe('unmatched');
    expect(tallyInvoiceReconciliation({ ...billed, tallyInvoiceNumber: 'SD/25-26/0552' }, [{ ...invoices[0], voucherNumber: 'SD/26-27/0552' }])).toBe('unmatched');
    expect(tallyInvoiceReconciliation(billed, invoices, new Date('2026-09-03T06:21:00Z'), '2026-09-03T06:00:00Z')).toBe('verification_stale');
    expect(tallyInvoiceReconciliation(billed, invoices, new Date('2026-09-03T06:19:59Z'), '2026-09-03T06:00:00Z')).toBe('verified');
    expect(tallyInvoiceReconciliation(billed, invoices, new Date('2026-09-03T06:01:00Z'), 'invalid')).toBe('verification_stale');
    expect(tallyInvoiceReconciliation(billed, invoices, new Date('2026-09-03T06:00:00Z'), '2026-09-03T06:06:00Z')).toBe('verification_stale');
  });

  it('compares aggregated order lines with cached Tally invoice details', () => {
    const billed = { ...baseOrder, tallyInvoiceNumber: 'INV-88' };
    const invoice = { voucherNumber: 'INV-88', reference: null, party: 'City Hospital', date: '20260903', masterId: '44', lineItems: [{ itemName: ' glucose   reagent ', quantity: 1 }, { itemName: 'Glucose Reagent', quantity: 1 }] };
    expect(tallyInvoiceLineReconciliation(billed, [invoice])).toEqual({ state: 'matched', differences: [] });
    expect(tallyInvoiceLineReconciliation(billed, [{ ...invoice, lineItems: [{ itemName: 'Glucose Reagent', quantity: 1 }, { itemName: 'Extra item', quantity: 3 }] }])).toEqual({ state: 'mismatch', differences: [
      { itemName: 'Glucose Reagent', orderedQuantity: 2, invoicedQuantity: 1 },
      { itemName: 'Extra item', orderedQuantity: 0, invoicedQuantity: 3 },
    ] });
    expect(tallyInvoiceLineReconciliation(billed, [{ ...invoice, lineItems: undefined }]).state).toBe('awaiting_detail');
    expect(tallyInvoiceLineReconciliation({ ...billed, customerName: 'Other Lab' }, [invoice]).state).toBe('identity_unverified');
  });

  it('reconciles combined quantities across split Tally invoices', () => {
    const billed = { ...baseOrder, tallyInvoiceNumber: '551, 552' };
    const first = { voucherNumber: 'SD/26-27/0551', reference: null, party: 'City Hospital', date: '20260903', masterId: '51', lineItems: [{ itemName: 'Glucose Reagent', quantity: 1 }] };
    const second = { ...first, voucherNumber: 'SD/26-27/0552', masterId: '52' };
    const now = new Date('2026-09-03T06:00:00Z');
    expect(tallyInvoiceReconciliationDetail(billed, [first, second], now)).toEqual({ state: 'verified', matchedVoucherNumber: 'SD/26-27/0551, SD/26-27/0552' });
    expect(tallyInvoiceLineReconciliation(billed, [first, second], now)).toEqual({ state: 'matched', differences: [] });
    expect(tallyInvoiceReconciliationDetail({ ...billed, tallyInvoiceNumber: '551, 551' }, [first], now).state).toBe('ambiguous');
    expect(tallyInvoiceReconciliationDetail(billed, [first], now).state).toBe('unmatched');
  });

  it('routes only actionable Tally reconciliation failures to billing attention', () => {
    const now = new Date('2026-09-03T10:00:00+05:30');
    const fresh = '2026-09-03T09:55:00+05:30';
    const billed = { ...baseOrder, tallyInvoiceNumber: '552' };
    const matching = [{ voucherNumber: 'SD/26-27/0552', reference: null, party: 'City Hospital', date: '20260903', masterId: '52', lineItems: [{ itemName: 'Glucose Reagent', quantity: 2 }] }];
    expect(orderNeedsBillingAttention(baseOrder, matching, now, fresh)).toBe(false);
    expect(orderNeedsBillingAttention(billed, matching, now, fresh)).toBe(false);
    expect(orderNeedsBillingAttention(billed, [{ ...matching[0], party: 'Other Hospital' }], now, fresh)).toBe(true);
    expect(orderNeedsBillingAttention(billed, [{ ...matching[0], lineItems: [{ itemName: 'Glucose Reagent', quantity: 1 }] }], now, fresh)).toBe(true);
    expect(orderNeedsBillingAttention(billed, matching, now, '2026-09-03T09:00:00+05:30')).toBe(true);
  });

  it('filters capture dates using the India business date', () => {
    expect(orderMatchesCaptureDate({ ...baseOrder, createdAt: '2026-09-02T20:00:00Z' }, '2026-09-03')).toBe(true);
    expect(orderMatchesCaptureDate(baseOrder, '')).toBe(true);
    expect(orderMatchesCaptureDateRange({ ...baseOrder, createdAt: '2026-09-04T20:00:00Z' }, '2026-09-03', '2026-09-05')).toBe(true);
    expect(orderMatchesCaptureDateRange({ ...baseOrder, createdAt: '2026-09-05T20:00:00Z' }, '2026-09-03', '2026-09-05')).toBe(false);
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
    expect(filterOrders([exceptionOrder], '', 'delivery_exception')).toEqual([exceptionOrder]);
    expect(filterOrders([{ ...exceptionOrder, exceptions: [{ ...exceptionOrder.exceptions[0], status: 'resolved' as const }] }], '', 'delivery_exception')).toEqual([]);
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

  it('combines due deliveries and serious delivery exceptions into one active queue', () => {
    const today = { ...baseOrder, id: 'due', expectedDeliveryDate: '2020-01-01' };
    const failed = { ...baseOrder, id: 'failed', exceptions: [{ id: 'x1', category: 'failed_delivery' as const, status: 'open' as const, summary: 'Customer site closed', ownerEmail: null, resolution: null, createdBy: 'ops@example.com', createdAt: '2026-08-31T09:00:00Z', resolvedBy: null, resolvedAt: null }] };
    const later = { ...baseOrder, id: 'later', expectedDeliveryDate: '2099-01-01' };
    const closed = { ...today, id: 'closed', status: 'delivered' };
    expect(filterOrders([today, failed, later, closed], '', 'delivery_attention')).toEqual([today, failed]);
  });

  it('exports operational orders as spreadsheet-safe CSV', () => {
    const order = { ...baseOrder, customerName: '=Unsafe formula', priority: 'urgent' as const, expectedDeliveryDate: '2026-09-02', deliveryAddress: 'Market Road', dispatchDate: '2026-09-02', vehicleNumber: 'KA01AB1234', deliveredAt: '2026-09-02T12:30:00Z', receivedBy: 'Lab manager', podReference: 'POD-42', notes: 'Call before delivery' };
    const csv = ordersCsv([order]);
    expect(csv).toContain('"\'=Unsafe formula"');
    expect(csv).toContain('"Glucose Reagent (2 box)"');
    expect(csv).toContain('"Priority","Source"');
    expect(csv).toContain('"urgent","phone"');
    expect(csv).toContain('"Market Road"');
    expect(csv).toContain('"KA01AB1234","2026-09-02T12:30:00Z","Lab manager","POD-42","Call before delivery"');
    expect(csv.split('\r\n')).toHaveLength(2);
  });

  it('queues only active orders whose fulfilment has a real shortage', () => {
    const partial = { ...baseOrder, status: 'confirmed', lines: [{ ...baseOrder.lines[0], quantity: 5, fulfilledQuantity: 3 }] };
    const untouched = { ...baseOrder, lines: [{ ...baseOrder.lines[0], quantity: 5, fulfilledQuantity: 0 }] };
    const complete = { ...partial, id: '3', lines: [{ ...baseOrder.lines[0], quantity: 5, fulfilledQuantity: 5 }] };
    const cancelled = { ...partial, id: '4', status: 'cancelled' };
    expect(orderBackOrderedQuantity(partial)).toBe(2);
    expect(isOrderBackOrdered(partial)).toBe(true);
    expect(isOrderBackOrdered(untouched)).toBe(false);
    expect(isOrderBackOrdered(complete)).toBe(false);
    expect(isOrderBackOrdered(cancelled)).toBe(false);
    expect(filterOrders([partial, untouched, complete, cancelled], '', 'back_ordered')).toEqual([partial]);
  });

  it('builds delivery queues from the India business date', () => {
    const now = new Date('2026-09-08T20:00:00Z');
    const today = { ...baseOrder, expectedDeliveryDate: '2026-09-09' };
    const withinWeek = { ...baseOrder, id: '2', expectedDeliveryDate: '2026-09-15' };
    const later = { ...baseOrder, id: '3', expectedDeliveryDate: '2026-09-16' };
    const overdue = { ...baseOrder, id: '4', expectedDeliveryDate: '2026-09-08' };
    const delivered = { ...today, id: '5', status: 'delivered' };
    expect(isOrderDeliveryDue(today, 0, now)).toBe(true);
    expect(isOrderDeliveryDue(withinWeek, 6, now)).toBe(true);
    expect(isOrderDeliveryDue(later, 6, now)).toBe(false);
    expect(isOrderDeliveryDue(overdue, 6, now)).toBe(false);
    expect(isOrderDeliveryDue(delivered, 6, now)).toBe(false);
    expect(orderDeliveryReminder(overdue, now)).toBe('overdue');
    expect(orderDeliveryReminder(today, now)).toBe('today');
    expect(orderDeliveryReminder(withinWeek, now)).toBe('soon');
    expect(orderDeliveryReminder(later, now)).toBeNull();
  });

  it('exports invoice identity and exact line differences for Accounts', () => {
    const order = { ...baseOrder, tallyInvoiceNumber: 'INV-88' };
    const invoice = { voucherNumber: 'INV-88', reference: null, party: 'City Hospital', date: '20260903', masterId: '44', lineItems: [{ itemName: 'Glucose Reagent', quantity: 1 }] };
    const csv = ordersCsv([order], { invoices: [invoice] });
    expect(csv).toContain('"Invoice identity"');
    expect(csv).toContain('"verified"');
    expect(csv).toContain('"mismatch"');
    expect(csv).toContain('"Glucose Reagent: ordered 2; invoiced 1"');
  });
});
