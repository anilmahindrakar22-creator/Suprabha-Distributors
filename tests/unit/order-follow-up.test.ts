import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { applyOrderAcknowledgement } from '../../lib/order-acknowledgement';
import { parseOrderListQuery } from '../../lib/order-list-query';
import { filterOrders, orderEventDescription, orderFollowUpReminder, orderNotificationGroups, validateOrderCommand, type OrderBootstrap, type OrderSummary } from '../../lib/order-types';

const migration = readFileSync(fileURLToPath(new URL('../../supabase/migrations/20260912150000_order_follow_up_queue.sql', import.meta.url)), 'utf8').toLowerCase();
const edge = readFileSync(fileURLToPath(new URL('../../supabase/functions/stockflow-orders/index.ts', import.meta.url)), 'utf8');
const order = { id: 'order-1', orderNumber: 'SF-1', customerName: 'City Lab', customerPhone: null, status: 'confirmed', source: 'phone', notes: null, version: 1, createdAt: '2026-09-11T10:00:00Z', updatedAt: '2026-09-11T10:00:00Z', lineCount: 1, totalQuantity: 1, reservedQuantity: 0, tallyInvoiceNumber: null, lines: [{ tallyKey: 'KIT-1', itemName: 'Kit', itemGroup: null, baseUnit: 'Nos', quantity: 1, reservedQuantity: 0 }], events: [], exceptions: [], installations: [] } satisfies OrderSummary;

describe('order follow-up queue', () => {
  it('classifies active reminders and excludes closed orders', () => {
    const now = new Date('2026-09-12T06:00:00Z');
    expect(orderFollowUpReminder({ ...order, followUpDate: '2026-09-11' }, now)).toBe('overdue');
    expect(orderFollowUpReminder({ ...order, followUpDate: '2026-09-12' }, now)).toBe('today');
    expect(orderFollowUpReminder({ ...order, followUpDate: '2026-09-13' }, now)).toBe('upcoming');
    expect(orderFollowUpReminder({ ...order, status: 'delivered', followUpDate: '2026-09-11' }, now)).toBeNull();
  });

  it('filters due and upcoming queues across the fallback list', () => {
    const due = { ...order, id: 'due', followUpDate: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) };
    const upcoming = { ...order, id: 'upcoming', followUpDate: '2099-01-01' };
    expect(filterOrders([due, upcoming], '', 'follow_up_due').map((item) => item.id)).toEqual(['due']);
    expect(filterOrders([due, upcoming], '', 'follow_up_upcoming').map((item) => item.id)).toEqual(['upcoming']);
    expect(parseOrderListQuery(new URLSearchParams('status=follow_up_due&page=1'))?.status).toBe('follow_up_due');
  });

  it('validates bounded versioned commands', () => {
    const base = { idempotencyKey: '1234567890abcdef', orderId: 'order-1', expectedVersion: 1 };
    expect(validateOrderCommand({ action: 'set_order_follow_up', payload: { ...base, followUpDate: '2026-09-15', followUpNote: 'Confirm order quantities' } })).not.toBeNull();
    expect(validateOrderCommand({ action: 'set_order_follow_up', payload: { ...base, followUpDate: 'bad', followUpNote: 'ok' } })).toBeNull();
    expect(validateOrderCommand({ action: 'complete_order_follow_up', payload: base })).not.toBeNull();
  });

  it('patches an acknowledged reminder without reloading all orders', () => {
    const data = { actor: { email: 'sales@example.com', role: 'sales' }, snapshot: { company: 'Suprabha', fetchedAt: '', catalog: [] }, customers: [], orders: [order], operations: {} } satisfies OrderBootstrap;
    const scheduled = applyOrderAcknowledgement(data, { action: 'set_order_follow_up', payload: { idempotencyKey: '1234567890abcdef', orderId: order.id, expectedVersion: 1, followUpDate: '2026-09-15', followUpNote: 'Confirm quantities' } }, { orderId: order.id, version: 2 });
    expect(scheduled?.orders[0]).toMatchObject({ followUpDate: '2026-09-15', followUpNote: 'Confirm quantities', version: 2 });
    const completed = scheduled && applyOrderAcknowledgement(scheduled, { action: 'complete_order_follow_up', payload: { idempotencyKey: '2234567890abcdef', orderId: order.id, expectedVersion: 2 } }, { orderId: order.id, version: 3 });
    expect(completed?.orders[0]).toMatchObject({ followUpDate: null, followUpNote: null, version: 3 });
  });

  it('keeps the database command atomic, audited, scoped and idempotent', () => {
    expect(migration).toContain("v_role not in ('administrator','sales','operations','accounts','management')");
    expect(migration).toContain('for update');
    expect(migration).toContain('begin_stockflow_command');
    expect(migration).toContain('finish_stockflow_command');
    expect(migration).toContain("'order_follow_up_completed'");
    expect(migration).toContain('stockflow_orders_active_follow_up_idx');
    expect(edge).toContain('stockflow_follow_up_gateway');
  });

  it('describes follow-up audit events for staff', () => {
    expect(orderEventDescription({ id: 1, eventType: 'order_follow_up_set', fromStatus: 'confirmed', toStatus: 'confirmed', reason: 'Call purchaser', actorEmail: 'sales@example.com', actorRole: 'sales', metadata: {}, createdAt: '' })).toBe('Follow-up scheduled: Call purchaser');
  });

  it('builds lightweight notification groups only for queues with work', () => {
    expect(orderNotificationGroups({ followUpsDue: 2, awaitingConfirmation: 0, awaitingTallyBilling: 3, deliveryAttention: 1 })).toEqual([
      { id: 'follow-ups', label: 'Customer follow-ups due', count: 2, status: 'follow_up_due' },
      { id: 'billing', label: 'Orders awaiting Tally billing', count: 3, status: 'billing' },
      { id: 'delivery', label: 'Deliveries needing attention', count: 1, status: 'delivery_attention' },
    ]);
  });
});
