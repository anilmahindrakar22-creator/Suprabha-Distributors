import { describe, expect, it } from 'vitest';
import { priceApprovalSummaries } from '@/lib/price-approval-summary';
import type { OrderPricingWorkspace } from '@/lib/pricing-types';

// Shape taken from a real pending approval (values anonymised where needed).
function workspace(overrides: Partial<OrderPricingWorkspace['lines'][number]> = {}, rate = 4450): OrderPricingWorkspace {
  return {
    orderId: 'o1', orderNumber: 'SF-260920-00034', customerId: 'c1', customerName: 'Hospital', orderVersion: 3, pricingState: 'approval_required', currentSnapshotId: null,
    lines: [{
      lineId: 'l1', tallyKey: 'STROMATOLYSER', itemName: 'Stromatolyser WH 500 Ml 3 Part Sysmex', quantity: 2, fixed: false,
      lastRate: null, historicCost: 3465, currentCost: 3465, costChange: 0, continuityPrice: null, targetMarginPrice: null, recommendedPrice: null, recommendationReason: '',
      continuityGP: null, continuityMargin: null, recommendedGP: null, recommendedMargin: null, differenceToCustomer: null, additionalGP: null, evidenceHash: 'x',
      resolution: 'PRICE_REVIEW_REQUIRED', guardrail: 'PRICE_REVIEW_REQUIRED', proposedRate: null,
      source: { type: 'LAST_TALLY_INVOICE', reference: 'SD/26-27/0715', date: '2026-10-15', version: null },
      recentRates: [
        { rate: 4450, invoiceDate: '2026-09-19', invoiceReference: 'SD/26-27/0622', sourceVersion: 'a' },
        { rate: 4510, invoiceDate: '2026-10-15', invoiceReference: 'SD/26-27/0715', sourceVersion: 'b' },
        { rate: 4450, invoiceDate: '2026-10-15', invoiceReference: 'SD/26-27/0715', sourceVersion: 'c' },
        { rate: 4450, invoiceDate: '2026-09-19', invoiceReference: 'SD/26-27/0622', sourceVersion: 'd' },
        { rate: 4450, invoiceDate: '2026-08-15', invoiceReference: 'SD/26-27/0475', sourceVersion: 'e' },
      ],
      cost: { id: 'k', amount: 3465, kind: 'purchase_price', effectiveAt: '2026-09-26', sourceReference: '222/26-27', sourceVersion: 'v', previousAmount: 3465, changeAmount: 0, changePercent: 0 },
      margin: { grossProfitAmount: null, grossMarginPercent: null, previousGrossMarginPercent: null, erosionPercentagePoints: null },
      suggestion: null, warnings: ['AMBIGUOUS_SALES_HISTORY'],
      policy: { version: 'general-gross-margin-25-v1', minimumMarginPercent: 25, targetMarginPercent: null },
      ...overrides,
    }],
    exceptions: [{ id: 'e1', lineId: 'l1', referenceRate: 4450, enteredRate: rate, differenceAmount: 0, differencePercent: 0, reason: 'Preserve the last customer rate.', state: 'pending', requestedBy: 'sales@example.test', requestedAt: '2026-09-20T06:57:01Z', version: 1 }],
    history: [],
  };
}

describe('priceApprovalSummaries', () => {
  it('shows the item, price, recent distinct bills, cost and margin below the minimum', () => {
    const [summary] = priceApprovalSummaries(workspace());
    expect(summary).toMatchObject({ itemName: 'Stromatolyser WH 500 Ml 3 Part Sysmex', quantity: 2, rate: 4450, lineTotal: 8900, belowLatestBill: 60, marginPercent: 22.1, marginAmount: 985, minimumMarginPercent: 25, marginTone: 'below_minimum', mixedHistory: true, requestedBy: 'sales@example.test' });
    expect(summary.recentBills).toEqual([
      { rate: 4510, date: '2026-10-15', reference: 'SD/26-27/0715' },
      { rate: 4450, date: '2026-10-15', reference: 'SD/26-27/0715' },
      { rate: 4450, date: '2026-09-19', reference: 'SD/26-27/0622' },
    ]);
    expect(summary.cost).toEqual({ amount: 3465, date: '2026-09-26', reference: '222/26-27' });
  });
  it('marks a loss and a healthy margin, and copes with missing cost and history', () => {
    expect(priceApprovalSummaries(workspace({}, 3000))[0].marginTone).toBe('loss');
    expect(priceApprovalSummaries(workspace({}, 5000))[0]).toMatchObject({ marginTone: 'ok', belowLatestBill: null });
    const bare = priceApprovalSummaries(workspace({ cost: null, currentCost: null, recentRates: [], warnings: [], policy: null }))[0];
    expect(bare).toMatchObject({ cost: null, marginPercent: null, marginTone: 'unknown', recentBills: [], belowLatestBill: null, mixedHistory: false });
  });
  it('returns nothing without a workspace', () => {
    expect(priceApprovalSummaries(null)).toEqual([]);
  });
});
