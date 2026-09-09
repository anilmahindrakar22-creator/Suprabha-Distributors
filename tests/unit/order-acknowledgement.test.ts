import { describe, expect, it } from 'vitest';
import { applyOrderAcknowledgement } from '../../lib/order-acknowledgement';
import type { OrderBootstrap, OrderSummary } from '../../lib/order-types';

const order = { id: 'order-1', orderNumber: 'SF-1', customerName: 'City Lab', customerPhone: null, status: 'awaiting_confirmation', source: 'phone', notes: null, version: 1, createdAt: '2026-09-06T10:00:00Z', updatedAt: '2026-09-06T10:00:00Z', lineCount: 1, totalQuantity: 2, reservedQuantity: 0, tallyInvoiceNumber: null, lines: [{ tallyKey: 'KIT-1', itemName: 'Kit', itemGroup: 'Kits', baseUnit: 'Nos', quantity: 2, reservedQuantity: 0 }], events: [], exceptions: [], installations: [] } satisfies OrderSummary;
const data = { actor: { email: 'sales@example.com', role: 'sales' }, snapshot: { company: 'Suprabha', fetchedAt: '', catalog: [] }, customers: [], orders: [order], operations: { awaitingConfirmation: 1, awaitingTallyBilling: 0 } } satisfies OrderBootstrap;

describe('targeted order acknowledgement', () => {
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
});
