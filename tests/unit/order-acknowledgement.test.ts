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
});
