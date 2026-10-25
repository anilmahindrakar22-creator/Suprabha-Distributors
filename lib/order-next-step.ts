import { canRoleTransitionOrder, orderNextOwnerLabel, type OrderSummary } from './order-types';
import type { OrderPricingWorkspace } from './pricing-types';
import { hasAnyStockFlowRole } from './user-types';

export const nextStatus: Record<string, { label: string; status: string }> = {
  phone_order_received: { label: 'Send for confirmation', status: 'awaiting_confirmation' },
  awaiting_confirmation: { label: 'Confirm order', status: 'confirmed' },
  awaiting_approval: { label: 'Approve order', status: 'confirmed' },
  confirmed: { label: 'Pick & pack complete', status: 'packed' },
  partially_reserved: { label: 'Pick & pack complete', status: 'packed' },
  fully_reserved: { label: 'Pick & pack complete', status: 'packed' },
  ready_for_picking: { label: 'Pick & pack complete', status: 'packed' },
  picked: { label: 'Pick & pack complete', status: 'packed' },
  packed: { label: 'Send to Tally billing', status: 'awaiting_tally_billing' },
  awaiting_tally_billing: { label: 'Mark billed', status: 'billed_in_tally' },
  billed_in_tally: { label: 'Ready for dispatch', status: 'ready_for_dispatch' },
};

export type OrderNextStep = { kind: 'advance' | 'pricing_apply' | 'pricing_enter' | 'pricing_approve' | 'pricing_waiting' | 'dispatch' | 'deliver' | 'waiting' | 'done' | 'none' | 'loading'; label: string; exception?: OrderPricingWorkspace['exceptions'][number] };

export function nextStepFor(order: OrderSummary, roles: readonly string[], pricing: OrderPricingWorkspace | null): OrderNextStep {
  if (order.status === 'cancelled') return { kind: 'none', label: '' };
  if (order.status === 'delivered') return { kind: 'done', label: `Delivered · received by ${order.receivedBy || 'customer'} on ${order.deliveredAt ? new Date(order.deliveredAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' }) : '—'}` };
  if (['ready_for_dispatch', 'dispatched'].includes(order.status)) {
    const label = order.status === 'ready_for_dispatch' ? 'Dispatch order' : 'Confirm delivery';
    return hasAnyStockFlowRole(roles, ['administrator', 'operations'])
      ? { kind: order.status === 'ready_for_dispatch' ? 'dispatch' : 'deliver', label }
      : { kind: 'waiting', label: `Next: ${label} · waiting for Operations` };
  }
  const action = nextStatus[order.status];
  if (!action) return { kind: 'none', label: '' };
  if (action.status === 'awaiting_tally_billing' && order.pricingState !== 'approved') {
    // Sales, warehouse and billing never read prices: they only see who the order is waiting for.
    if (!hasAnyStockFlowRole(roles, ['administrator', 'accounts', 'management'])) {
      return { kind: 'pricing_waiting', label: order.pricingState === 'approval_required' ? 'Waiting for management to approve the price' : 'Waiting for a price to be entered' };
    }
    if (!pricing) return { kind: 'loading', label: 'Checking price…' };
    const exception = pricing.exceptions[0];
    if (exception) {
      const rate = `₹${exception.enteredRate.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
      return hasAnyStockFlowRole(roles, ['administrator', 'management'])
        ? { kind: 'pricing_approve', label: `Approve ${rate}`, exception }
        : { kind: 'pricing_waiting', label: `Waiting for management to approve ${rate}` };
    }
    if (!hasAnyStockFlowRole(roles, ['administrator', 'accounts', 'management'])) return { kind: 'pricing_waiting', label: 'Waiting for a price to be entered' };
    const ready = Boolean(pricing.lines.length) && pricing.lines.every(line => line.governed && line.guardrail !== 'PRICE_REVIEW_REQUIRED' && Number(line.proposedRate) > 0);
    return ready ? { kind: 'pricing_apply', label: 'Apply prices' } : { kind: 'pricing_enter', label: 'Enter price' };
  }
  return canRoleTransitionOrder(roles, order.status, action.status)
    ? { kind: 'advance', label: action.label }
    : { kind: 'waiting', label: `Next: ${action.label} · waiting for ${orderNextOwnerLabel(order.status) || 'Operations'}` };
}
