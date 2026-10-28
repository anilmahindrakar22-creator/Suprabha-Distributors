import type { CustomerPriceContract, OrderPricingWorkspace, PricingLineResolution, PricingPolicy } from '../../lib/pricing-types';
import type { OrderBootstrap, OrderLineSummary, OrderSummary } from '../../lib/order-types';
import type { BillingSheet } from '../../lib/billing-sheet';
import type { RateCheck, RateExceptions } from '../../lib/rate-check';
import type { ToOrderItem, ToOrderResponse } from '../../lib/to-order';

const timestamp = '2026-10-01T06:00:00Z';

export function toOrderItem(o: Partial<ToOrderItem> = {}): ToOrderItem {
  return {
    itemKey: 'TEST-ITEM', itemName: 'Test item', group: 'Reagents', closing: 2,
    reorderLevel: 5, minimumOrder: null, tallyOpenPurchase: 0, openDemand: 10,
    waitingOrders: 3, oldestOrderAt: timestamp, reasons: ['waiting_orders', 'below_reorder'],
    state: 'order', suggestedQty: 13, ...o,
  } satisfies ToOrderItem;
}

export function toOrderResponse(o: Partial<ToOrderResponse> = {}): ToOrderResponse {
  return { view: 'to_order', page: 1, pageSize: 25, total: 1, waitingCount: 1,
    unknownCount: 0, items: [toOrderItem()], ...o } satisfies ToOrderResponse;
}

export function pricingLine(o: Partial<PricingLineResolution> = {}): PricingLineResolution {
  return {
    lineId: 'line-1', tallyKey: 'TEST-ITEM', itemName: 'Test item', quantity: 1,
    fixed: false, lastRate: null, historicCost: null, currentCost: null, costChange: null,
    continuityPrice: null, targetMarginPrice: null, recommendedPrice: null,
    recommendationReason: 'No eligible customer history', continuityGP: null, continuityMargin: null,
    recommendedGP: null, recommendedMargin: null, differenceToCustomer: null, additionalGP: null,
    evidenceHash: 'a'.repeat(64), resolution: 'NO_PRICE_HISTORY', guardrail: 'PRICE_REVIEW_REQUIRED',
    proposedRate: null, source: { type: 'NONE', reference: null, date: null, version: null },
    recentRates: [], cost: null,
    margin: { grossProfitAmount: null, grossMarginPercent: null, previousGrossMarginPercent: null, erosionPercentagePoints: null },
    suggestion: null, warnings: [], ...o,
  } satisfies PricingLineResolution;
}

export function pricingWorkspace(o: Partial<OrderPricingWorkspace> = {}): OrderPricingWorkspace {
  return {
    orderId: 'order-1', orderNumber: 'SF-TEST-001', customerId: null, customerName: 'Test laboratory',
    orderVersion: 1, pricingState: 'review_required', currentSnapshotId: null,
    lines: [pricingLine()], exceptions: [], history: [], ...o,
  } satisfies OrderPricingWorkspace;
}

export function orderLine(o: Partial<OrderLineSummary> = {}): OrderLineSummary {
  return {
    tallyKey: 'TEST-ITEM', itemName: 'Test item', itemGroup: null, baseUnit: 'Nos',
    quantity: 1, reservedQuantity: 0, ...o,
  } satisfies OrderLineSummary;
}

export function orderSummary(o: Partial<OrderSummary> = {}): OrderSummary {
  return {
    id: 'order-1', orderNumber: 'SF-TEST-001', customerName: 'Test laboratory', customerPhone: null,
    status: 'packed', source: 'phone', notes: null, version: 1, createdAt: timestamp, updatedAt: timestamp,
    lineCount: 1, totalQuantity: 1, reservedQuantity: 0, tallyInvoiceNumber: null,
    lines: [orderLine()], events: [], exceptions: [], installations: [], ...o,
  } satisfies OrderSummary;
}

/** The full bootstrap/list envelope returned by /api/orders, including pagination. */
export function orderBootstrap(o: Partial<OrderBootstrap> = {}): OrderBootstrap {
  return {
    actor: { email: 'management@example.test', role: 'management', roles: ['management'] },
    snapshot: { company: 'TEST', fetchedAt: timestamp, catalog: [] },
    customers: [], orders: [orderSummary()], operations: {},
    pagination: { page: 1, pageCount: 1, pageSize: 20, total: 1 }, ...o,
  } satisfies OrderBootstrap;
}

export function billingSheet(o: Partial<BillingSheet> = {}): BillingSheet {
  return {
    view: 'billing', orderId: 'order-1', orderNumber: 'SF-TEST-001', customerName: 'Test laboratory',
    status: 'awaiting_tally_billing', ready: false, ...o,
  } satisfies BillingSheet;
}

export function rateCheck(o: Partial<RateCheck> = {}): RateCheck {
  return {
    view: 'rate_check', orderId: 'order-1', orderNumber: 'SF-TEST-001', customerName: 'Test laboratory',
    status: 'packed', tolerance: 1, state: 'not_billed', ...o,
    lines: (o.lines ?? []).map((line) => ({ invoiceUnits: [], orderUnit: 'Nos', ...line })),
  } satisfies RateCheck;
}

export function rateExceptions(o: Partial<RateExceptions> = {}): RateExceptions {
  return { view: 'rate_exceptions', tolerance: 1, checkedCount: 0, orders: [], ...o } satisfies RateExceptions;
}

export function priceContract(o: Partial<CustomerPriceContract> = {}): CustomerPriceContract {
  return {
    id: 'contract-1', customerId: 'customer-1', customerName: 'Test laboratory', tallyKey: 'TEST-ITEM',
    price: 0, currency: 'INR', validFrom: '2026-10-01', validTo: null, status: 'draft',
    source: 'manual_governed', sourceReference: null, reason: 'Test customer agreement', approvedBy: null,
    approvedAt: null, version: 1, supersedesPriceId: null, createdBy: 'management@example.test', createdAt: timestamp, ...o,
  } satisfies CustomerPriceContract;
}

export function pricingPolicy(o: Partial<PricingPolicy> = {}): PricingPolicy {
  return {
    id: 'policy-1', policyVersion: 'test-policy-v1', minimumMarginPercent: 0, targetMarginPercent: null,
    overrideApprovalPercent: 0, roundingIncrement: 1, roundingRuleVersion: 'test-rounding-v1',
    effectiveFrom: '2026-10-01', effectiveTo: null, active: true,
    createdBy: 'management@example.test', createdAt: timestamp, ...o,
  } satisfies PricingPolicy;
}
