import { describe, expect, it } from 'vitest';
import type { OrderSummary } from '@/lib/order-types';
import { deliveredTodayOrders, groupOrdersForList, istDateKey, orderListFlag, orderProgressIndex } from '@/lib/order-list-groups';
import { stageStyles } from '@/components/order-list';

// 11 Oct 2026, 15:00 IST.
const now = new Date('2026-10-11T09:30:00Z');
const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 3_600_000).toISOString();

function order(id: string, overrides: Partial<OrderSummary> = {}): OrderSummary {
  return {
    id, orderNumber: `SF-${id}`, customerName: `Lab ${id}`, customerPhone: null, status: 'confirmed', source: 'phone', notes: null,
    version: 1, createdAt: hoursAgo(1), updatedAt: hoursAgo(1), lineCount: 1, totalQuantity: 2, tallyInvoiceNumber: null,
    lines: [], events: [], exceptions: [], installations: [], ...overrides,
  } as OrderSummary;
}

describe('Orders list grouping', () => {
  it('uses the Bill stage colour instead of warning for its chip', () => {
    expect(stageStyles.bill.chip).toContain('sf-stage-bill');
    expect(stageStyles.bill.chip).not.toContain('sf-warning');
  });

  it('uses the India calendar day', () => {
    expect(istDateKey('2026-10-10T19:00:00Z')).toBe('2026-10-11');
    expect(istDateKey('2026-10-10T18:00:00Z')).toBe('2026-10-10');
  });

  it('keeps delivered orders only on the day of delivery', () => {
    const today = order('a', { status: 'delivered', deliveredAt: hoursAgo(2) });
    const yesterday = order('b', { status: 'delivered', deliveredAt: hoursAgo(30) });
    const cancelled = order('c', { status: 'cancelled', updatedAt: hoursAgo(1) });
    expect(deliveredTodayOrders([today, yesterday, cancelled], now).map((item) => item.id)).toEqual(['a']);
  });

  it('puts urgent and high first, then today, yesterday, earlier and delivered today', () => {
    const urgent = order('urgent', { priority: 'urgent', createdAt: hoursAgo(30), updatedAt: hoursAgo(1) });
    const high = order('high', { priority: 'high', createdAt: hoursAgo(80) });
    const stalled = order('stalled', { priority: 'normal', updatedAt: hoursAgo(240), createdAt: hoursAgo(240) });
    const fresh = order('fresh');
    const old = order('old', { createdAt: hoursAgo(80), updatedAt: hoursAgo(2) });
    const yesterdays = order('yday', { createdAt: hoursAgo(20), updatedAt: hoursAgo(2) });
    const delivered = order('done', { status: 'delivered', deliveredAt: hoursAgo(1) });
    const groups = groupOrdersForList([high, fresh, old, urgent, stalled, yesterdays], [delivered, fresh], now);
    expect(groups[0].label).toBe('Urgent & high');
    expect(orderListFlag(stalled, now)?.label).toBe('Stalled');
    expect(groups.map((group) => [group.id, group.orders.map((item) => item.id)])).toEqual([
      ['priority', ['high', 'urgent']],
      ['today', ['fresh']],
      ['yesterday', ['yday']],
      ['earlier', ['old', 'stalled']],
      ['delivered', ['done']],
    ]);
  });

  it('groups delivered urgent and cancelled high orders by capture day', () => {
    const delivered = order('done', { status: 'delivered', priority: 'urgent' });
    const cancelled = order('cancelled', { status: 'cancelled', priority: 'high' });
    expect(groupOrdersForList([delivered, cancelled], [], now).map((group) => [group.id, group.orders.map((item) => item.id)])).toEqual([
      ['today', ['done', 'cancelled']],
    ]);
  });

  it('shows at most one flag, most serious first', () => {
    expect(orderListFlag(order('a', { priority: 'urgent', expectedDeliveryDate: '2026-10-01' }), now)?.label).toBe('Urgent');
    expect(orderListFlag(order('approval', { pricingState: 'approval_required' }), now)).toEqual({ label: 'Price approval', tone: 'watch' });
    expect(orderListFlag(order('urgent-approval', { pricingState: 'approval_required', priority: 'urgent' }), now)?.label).toBe('Urgent');
    expect(orderListFlag(order('b', { expectedDeliveryDate: '2026-10-01' }), now)?.label).toBe('Overdue');
    expect(orderListFlag(order('c', { priority: 'high' }), now)?.label).toBe('High priority');
    expect(orderListFlag(order('d'), now)).toBeNull();
    expect(orderListFlag(order('e', { status: 'delivered', priority: 'urgent' }), now)).toBeNull();
  });

  it('maps statuses to the five progress steps', () => {
    expect(orderProgressIndex('awaiting_confirmation')).toBe(0);
    expect(orderProgressIndex('picked')).toBe(1);
    expect(orderProgressIndex('awaiting_tally_billing')).toBe(2);
    expect(orderProgressIndex('dispatched')).toBe(3);
    expect(orderProgressIndex('delivered')).toBe(4);
    expect(orderProgressIndex('cancelled')).toBe(-1);
  });
});
