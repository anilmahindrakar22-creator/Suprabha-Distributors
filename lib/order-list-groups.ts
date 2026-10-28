import type { OrderSummary } from './order-types';
import { orderAttentionReasons, orderDeliveryReminder, orderStage } from './order-types';

// Presentation only: how the Orders list groups and labels rows. No order rule lives here.

export type OrderListGroupId = 'priority' | 'today' | 'yesterday' | 'earlier' | 'delivered';
export type OrderListGroup = { id: OrderListGroupId; label: string; orders: OrderSummary[] };
export type OrderFlag = { label: string; tone: 'alert' | 'watch' };

const istDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' });

export function istDateKey(value: string | Date) {
  const date = typeof value === 'string' ? new Date(value) : value;
  return Number.isFinite(date.getTime()) ? istDay.format(date) : '';
}

/** Delivered orders stay on the Active list only on the day they were delivered (IST). */
export function deliveredTodayOrders(orders: readonly OrderSummary[], now = new Date()) {
  const today = istDateKey(now);
  return orders.filter((order) => order.status === 'delivered' && istDateKey(order.deliveredAt || order.updatedAt) === today);
}

/** At most one flag per row: the most serious problem wins. */
export function orderListFlag(order: OrderSummary, now = new Date()): OrderFlag | null {
  if (['delivered', 'cancelled'].includes(order.status)) return null;
  if (order.priority === 'urgent') return { label: 'Urgent', tone: 'alert' };
  if (orderDeliveryReminder(order, now) === 'overdue') return { label: 'Overdue', tone: 'alert' };
  if (order.pricingState === 'approval_required') return { label: 'Price approval', tone: 'watch' };
  const reasons = orderAttentionReasons(order, now);
  if (reasons.includes('Open delivery exception')) return { label: 'Delivery issue', tone: 'alert' };
  if (reasons.some((reason) => reason.startsWith('No progress'))) return { label: 'Stalled', tone: 'watch' };
  if (reasons.includes('Installation overdue')) return { label: 'Installation due', tone: 'alert' };
  if (reasons.includes('Partial fulfilment or back-order')) return { label: 'Back-order', tone: 'watch' };
  if (reasons.includes('Dispatch details missing')) return { label: 'Dispatch details', tone: 'watch' };
  if (reasons.includes('Delivery confirmation pending')) return { label: 'Confirm delivery', tone: 'watch' };
  if (reasons.length) return { label: 'Check order', tone: 'watch' };
  if (order.priority === 'high') return { label: 'High priority', tone: 'watch' };
  if (orderDeliveryReminder(order, now) === 'today') return { label: 'Due today', tone: 'watch' };
  return null;
}

/** High priority first, then by capture day; orders delivered today sit at the bottom. Keeps server order within a group. */
export function groupOrdersForList(orders: readonly OrderSummary[], deliveredToday: readonly OrderSummary[] = [], now = new Date()): OrderListGroup[] {
  const today = istDateKey(now);
  const yesterday = istDateKey(new Date(now.getTime() - 86_400_000));
  const groups: Record<OrderListGroupId, OrderSummary[]> = { priority: [], today: [], yesterday: [], earlier: [], delivered: [] };
  const seen = new Set<string>();
  for (const order of orders) {
    seen.add(order.id);
    const day = istDateKey(order.createdAt);
    if (!['delivered', 'cancelled'].includes(order.status) && (order.priority === 'urgent' || order.priority === 'high')) groups.priority.push(order);
    else if (day === today) groups.today.push(order);
    else if (day === yesterday) groups.yesterday.push(order);
    else groups.earlier.push(order);
  }
  for (const order of deliveredToday) if (!seen.has(order.id)) groups.delivered.push(order);
  const labels: Record<OrderListGroupId, string> = { priority: 'Urgent & high', today: 'Today', yesterday: 'Yesterday', earlier: 'Earlier', delivered: 'Delivered today' };
  return (Object.keys(groups) as OrderListGroupId[]).filter((id) => groups[id].length).map((id) => ({ id, label: labels[id], orders: groups[id] }));
}

export type StageKey = 'confirm' | 'pack' | 'bill' | 'dispatch' | 'done' | 'cancelled' | 'other';

export function orderStageKey(status: string): StageKey {
  const stage = orderStage(status);
  if (stage === 'Confirmation') return 'confirm';
  if (stage === 'Pick & pack') return 'pack';
  if (stage === 'Tally billing') return 'bill';
  if (stage === 'Dispatch') return 'dispatch';
  if (stage === 'Delivered') return 'done';
  if (stage === 'Cancelled') return 'cancelled';
  return 'other';
}

export const orderProgressSteps = ['Confirm', 'Pack', 'Bill', 'Dispatch', 'Delivered'] as const;

/** Index of the current step in orderProgressSteps, or -1 for cancelled/unknown. */
export function orderProgressIndex(status: string) {
  return (['confirm', 'pack', 'bill', 'dispatch', 'done'] as StageKey[]).indexOf(orderStageKey(status));
}

/** Builds the five-step progress display, placing challan billing after delivery. */
export function orderProgressModel(status: string, challan?: { billed: boolean }): { steps: readonly string[]; current: number; tones: StageKey[]; complete: boolean[] } {
  if (!challan) {
    const current = orderProgressIndex(status);
    return { steps: orderProgressSteps, current, tones: ['confirm', 'pack', 'bill', 'dispatch', 'done'], complete: orderProgressSteps.map((_, index) => index < current) };
  }
  const steps = ['Confirm', 'Pack', 'Dispatch', 'Delivered', 'Bill'];
  const tones: StageKey[] = ['confirm', 'pack', 'dispatch', 'done', 'bill'];
  const stage = orderStageKey(status);
  let current = stage === 'confirm' ? 0 : stage === 'pack' ? 1 : stage === 'dispatch' ? 2 : stage === 'done' ? 3 : -1;
  if (stage === 'done') current = 4;
  if (stage === 'done' && challan.billed) tones[4] = 'done';
  const complete = steps.map((_, index) => index < current);
  if (challan.billed && current < 4) complete[4] = true;
  return { steps, current, tones, complete };
}
