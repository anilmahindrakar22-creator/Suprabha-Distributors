import { describe, expect, it } from 'vitest';
import { billingSheetText, type BillingSheet } from '@/lib/billing-sheet';
import { canRoleTransitionOrder, orderNextOwnerLabel } from '@/lib/order-types';
import { normalizeStockFlowRoles } from '@/lib/user-types';
import { queueOrdersFilter, workQueuesForRoles } from '@/lib/work-notifications';

describe('billing role', () => {
  it('is a valid role that may only mark orders billed', () => {
    expect(normalizeStockFlowRoles(['billing'])).toEqual(['billing']);
    expect(canRoleTransitionOrder(['billing'], 'awaiting_tally_billing', 'billed_in_tally')).toBe(true);
    expect(canRoleTransitionOrder(['billing'], 'packed', 'awaiting_tally_billing')).toBe(false);
    expect(canRoleTransitionOrder(['billing'], 'billed_in_tally', 'ready_for_dispatch')).toBe(false);
    expect(orderNextOwnerLabel('awaiting_tally_billing')).toBe('Billing');
    expect(orderNextOwnerLabel('packed')).toBe('Accounts');
  });
  it('is notified only of packed and priced orders, opening the Bill queue', () => {
    const queues = workQueuesForRoles(['billing']);
    expect(queues.map((queue) => queue.id)).toEqual(['bill-ready']);
    expect(queues[0].statuses).toEqual(['awaiting_tally_billing']);
    expect(queueOrdersFilter(queues[0])).toBe('billing');
    // Accounts keeps the wider queue that also covers "Send to Tally billing".
    expect(workQueuesForRoles(['accounts']).map((queue) => queue.id)).toEqual(['bill']);
  });
  it('copies the approved prices for Tally, and nothing when not ready', () => {
    const sheet: BillingSheet = { view: 'billing', orderId: 'o', orderNumber: 'SO/26-27/0060', customerName: 'Vaatsalya Life Hospital', status: 'awaiting_tally_billing', ready: true, total: 8900,
      lines: [{ lineId: 'l', itemName: 'Stromatolyser WH 500 Ml', unit: 'Nos', orderedQuantity: 3, packedQuantity: 2, billQuantity: 2, approvedRate: 4450, amount: 8900 }] };
    expect(billingSheetText(sheet)).toBe('Order: SO/26-27/0060\nCustomer: Vaatsalya Life Hospital\n- Stromatolyser WH 500 Ml: 2 Nos × ₹4,450 = ₹8,900\nTotal before GST: ₹8,900');
    expect(billingSheetText({ ...sheet, ready: false, lines: undefined })).toBe('');
  });
});
