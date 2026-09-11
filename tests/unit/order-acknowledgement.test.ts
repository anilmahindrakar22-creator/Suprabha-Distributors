import { describe, expect, it } from 'vitest';
import { applyCreatedOrderAcknowledgement, applyOrderAcknowledgement } from '../../lib/order-acknowledgement';
import type { OrderBootstrap, OrderCommand, OrderSummary } from '../../lib/order-types';

const order = { id: 'order-1', orderNumber: 'SF-1', customerName: 'City Lab', customerPhone: null, status: 'awaiting_confirmation', source: 'phone', notes: null, version: 1, createdAt: '2026-09-06T10:00:00Z', updatedAt: '2026-09-06T10:00:00Z', lineCount: 1, totalQuantity: 2, reservedQuantity: 0, tallyInvoiceNumber: null, lines: [{ tallyKey: 'KIT-1', itemName: 'Kit', itemGroup: 'Kits', baseUnit: 'Nos', quantity: 2, reservedQuantity: 0 }], events: [], exceptions: [], installations: [] } satisfies OrderSummary;
const data = { actor: { email: 'sales@example.com', role: 'sales' }, snapshot: { company: 'Suprabha', fetchedAt: '', catalog: [] }, customers: [], orders: [order], operations: { awaitingConfirmation: 1, awaitingTallyBilling: 0 } } satisfies OrderBootstrap;

describe('targeted order acknowledgement', () => {
  it('prepends a newly acknowledged order without reloading the list', () => {
    const withCatalog = { ...data, snapshot: { ...data.snapshot, catalog: [{ tallyKey: 'KIT-1', item: 'Kit', group: 'Kits', baseUnit: 'Nos', closing: 8, active: true }] }, pagination: { page: 1, pageCount: 1, pageSize: 20, total: 1 }, operations: { ...data.operations, unassignedOpen: 1 } } satisfies OrderBootstrap;
    const next = applyCreatedOrderAcknowledgement(withCatalog, { action: 'create_order', payload: { idempotencyKey: '1234567890abcdef', customerName: 'New Lab', source: 'phone', priority: 'high', lines: [{ tallyKey: 'KIT-1', quantity: 3 }] } }, { orderId: 'order-2', orderNumber: 'SF-2', status: 'phone_order_received' }, '2026-09-11T12:00:00Z');
    expect(next?.orders[0]).toMatchObject({ id: 'order-2', orderNumber: 'SF-2', customerName: 'New Lab', priority: 'high', version: 1, totalQuantity: 3 });
    expect(next?.orders[0].lines[0]).toMatchObject({ itemName: 'Kit', quantity: 3, fulfilledQuantity: 0 });
    expect(next?.pagination?.total).toBe(2);
    expect(next?.operations.unassignedOpen).toBe(2);
  });

  it('preserves the server page size while advancing pagination totals', () => {
    const catalog = [{ tallyKey: 'KIT-1', item: 'Kit', group: 'Kits', baseUnit: 'Nos', closing: 8, active: true }];
    const page = { ...data, snapshot: { ...data.snapshot, catalog }, orders: [order, { ...order, id: 'order-old', orderNumber: 'SF-OLD' }], pagination: { page: 1, pageCount: 1, pageSize: 2, total: 2 } } satisfies OrderBootstrap;
    const next = applyCreatedOrderAcknowledgement(page, { action: 'create_order', payload: { idempotencyKey: '1234567890abcdef', customerName: 'New Lab', source: 'phone', lines: [{ tallyKey: 'KIT-1', quantity: 1 }] } }, { orderId: 'order-2', orderNumber: 'SF-2' });
    expect(next?.orders.map((item) => item.id)).toEqual(['order-2', 'order-1']);
    expect(next?.pagination).toMatchObject({ total: 3, pageCount: 2, pageSize: 2 });
  });

  it('requires authoritative identity and current catalogue details before applying a created order', () => {
    const command: Extract<OrderCommand, { action: 'create_order' }> = { action: 'create_order', payload: { idempotencyKey: '1234567890abcdef', customerName: 'New Lab', source: 'phone', lines: [{ tallyKey: 'MISSING', quantity: 1 }] } };
    expect(applyCreatedOrderAcknowledgement(data, command, { orderId: 'order-2', orderNumber: 'SF-2' })).toBeNull();
    expect(applyCreatedOrderAcknowledgement(data, command, { orderId: 'order-2' })).toBeNull();
  });

  it('updates a confirmed order and operational counts without a bootstrap reload', () => {
    const next = applyOrderAcknowledgement(data, { action: 'transition_order', payload: { idempotencyKey: '1234567890abcdef', orderId: order.id, expectedVersion: 1, toStatus: 'confirmed' } }, { orderId: order.id, status: 'confirmed', version: 2 }, '2026-09-06T11:00:00Z');
    expect(next?.orders[0]).toMatchObject({ status: 'confirmed', version: 2, updatedAt: '2026-09-06T11:00:00Z' });
    expect(next?.operations.awaitingConfirmation).toBe(0);
  });

  it('updates an edited order from a successful server acknowledgement', () => {
    const next = applyOrderAcknowledgement(data, { action: 'edit_order', payload: { idempotencyKey: '1234567890abcdef', orderId: order.id, expectedVersion: 1, customerName: 'City Hospital', customerPhone: '123', lines: [{ tallyKey: 'KIT-1', quantity: 4 }] } }, { orderId: order.id, version: 2 });
    expect(next?.orders[0]).toMatchObject({ customerName: 'City Hospital', customerPhone: '123', totalQuantity: 4, version: 2 });
  });

  it('falls back when the acknowledgement cannot safely identify the changed row', () => {
    expect(applyOrderAcknowledgement(data, { action: 'transition_order', payload: { idempotencyKey: '1234567890abcdef', orderId: order.id, expectedVersion: 1, toStatus: 'confirmed' } }, { orderId: 'other', version: 2 })).toBeNull();
  });

  it('adds and resolves delivery exceptions from authoritative IDs', () => {
    const opened = applyOrderAcknowledgement(data, { action: 'create_exception', payload: { idempotencyKey: '1234567890abcdef', orderId: order.id, expectedVersion: 1, category: 'delayed', summary: 'Courier delayed' } }, { orderId: order.id, exceptionId: 'issue-1', version: 2 }, '2026-09-06T11:00:00Z');
    expect(opened?.orders[0].exceptions[0]).toMatchObject({ id: 'issue-1', status: 'open', createdBy: 'sales@example.com' });
    const resolved = opened && applyOrderAcknowledgement(opened, { action: 'resolve_exception', payload: { idempotencyKey: '2234567890abcdef', orderId: order.id, expectedVersion: 2, exceptionId: 'issue-1', resolution: 'Delivered next run' } }, { orderId: order.id, exceptionId: 'issue-1', version: 3 }, '2026-09-06T12:00:00Z');
    expect(resolved?.orders[0].exceptions[0]).toMatchObject({ status: 'resolved', resolution: 'Delivered next run', resolvedBy: 'sales@example.com' });
  });

  it('adds and completes equipment installations from authoritative IDs', () => {
    const scheduled = applyOrderAcknowledgement(data, { action: 'schedule_installation', payload: { idempotencyKey: '1234567890abcdef', orderId: order.id, expectedVersion: 1, tallyKey: 'KIT-1', scheduledDate: '2026-09-10', engineerEmail: 'engineer@example.com' } }, { orderId: order.id, installationId: 'install-1', version: 2 }, '2026-09-06T11:00:00Z');
    expect(scheduled?.orders[0].installations[0]).toMatchObject({ id: 'install-1', itemName: 'Kit', status: 'scheduled' });
    const completed = scheduled && applyOrderAcknowledgement(scheduled, { action: 'complete_installation', payload: { idempotencyKey: '2234567890abcdef', orderId: order.id, expectedVersion: 2, installationId: 'install-1', serialNumber: 'SN-1', commissioningNotes: 'Commissioned successfully' } }, { orderId: order.id, installationId: 'install-1', version: 3 }, '2026-09-11T11:00:00Z');
    expect(completed?.orders[0].installations[0]).toMatchObject({ status: 'completed', serialNumber: 'SN-1', completedBy: 'sales@example.com' });
  });

  it('advances the local version after recording a billing review', () => {
    const next = applyOrderAcknowledgement(data, { action: 'record_billing_review', payload: { idempotencyKey: '1234567890abcdef', orderId: order.id, expectedVersion: 1, outcome: 'investigating', note: 'Checking invoice line' } }, { orderId: order.id, status: order.status, version: 2 });
    expect(next?.orders[0].version).toBe(2);
  });

  it('updates priority without reloading the full workspace', () => {
    const next = applyOrderAcknowledgement(data, { action: 'set_order_priority', payload: { idempotencyKey: '1234567890abcdef', orderId: order.id, expectedVersion: 1, priority: 'urgent' } }, { orderId: order.id, version: 2 });
    expect(next?.orders[0]).toMatchObject({ priority: 'urgent', version: 2 });
  });

  it('updates assignment without reloading the full workspace', () => {
    const assigned = applyOrderAcknowledgement(data, { action: 'set_order_assignee', payload: { idempotencyKey: '1234567890abcdef', orderId: order.id, expectedVersion: 1, assignedToEmail: 'ops@example.com' } }, { orderId: order.id, version: 2 });
    expect(assigned?.orders[0]).toMatchObject({ assignedToEmail: 'ops@example.com', version: 2 });
    const cleared = assigned && applyOrderAcknowledgement(assigned, { action: 'set_order_assignee', payload: { idempotencyKey: '2234567890abcdef', orderId: order.id, expectedVersion: 2 } }, { orderId: order.id, version: 3 });
    expect(cleared?.orders[0]).toMatchObject({ assignedToEmail: null, version: 3 });
  });

  it('advances the local version after an activity note is acknowledged', () => {
    const next = applyOrderAcknowledgement(data, { action: 'add_order_note', payload: { idempotencyKey: '1234567890abcdef', orderId: order.id, expectedVersion: 1, note: 'Customer requested a delivery call' } }, { orderId: order.id, version: 2 });
    expect(next?.orders[0].version).toBe(2);
  });
});
