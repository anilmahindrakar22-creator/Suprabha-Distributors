import { describe, expect, it } from 'vitest';
import {
  billingSheet, orderBootstrap, orderLine, orderSummary, priceContract,
  pricingLine, pricingPolicy, pricingWorkspace, rateCheck, rateExceptions,
} from '../fixtures/api-builders';

describe('API builder key-set snapshots', () => {
  const cases = [
    [pricingLine, [
      'lineId', 'tallyKey', 'itemName', 'quantity', 'fixed', 'lastRate', 'historicCost', 'currentCost',
      'costChange', 'continuityPrice', 'targetMarginPrice', 'recommendedPrice', 'recommendationReason',
      'continuityGP', 'continuityMargin', 'recommendedGP', 'recommendedMargin', 'differenceToCustomer',
      'additionalGP', 'evidenceHash', 'resolution', 'guardrail', 'proposedRate', 'source', 'recentRates',
      'cost', 'margin', 'suggestion', 'warnings',
    ]],
    [pricingWorkspace, [
      'orderId', 'orderNumber', 'customerId', 'customerName', 'orderVersion', 'pricingState',
      'currentSnapshotId', 'lines', 'exceptions', 'history',
    ]],
    [orderLine, ['tallyKey', 'itemName', 'itemGroup', 'baseUnit', 'quantity', 'reservedQuantity']],
    [orderSummary, [
      'id', 'orderNumber', 'customerName', 'customerPhone', 'status', 'source', 'notes', 'version',
      'createdAt', 'updatedAt', 'lineCount', 'totalQuantity', 'reservedQuantity', 'tallyInvoiceNumber',
      'lines', 'events', 'exceptions', 'installations',
    ]],
    [orderBootstrap, ['actor', 'snapshot', 'customers', 'orders', 'operations', 'pagination']],
    [billingSheet, ['view', 'orderId', 'orderNumber', 'customerName', 'status', 'ready']],
    [rateCheck, ['view', 'orderId', 'orderNumber', 'customerName', 'status', 'tolerance', 'state', 'lines']],
    [rateExceptions, ['view', 'tolerance', 'checkedCount', 'orders']],
    [priceContract, [
      'id', 'customerId', 'customerName', 'tallyKey', 'price', 'currency', 'validFrom', 'validTo',
      'status', 'source', 'sourceReference', 'reason', 'approvedBy', 'approvedAt', 'version',
      'supersedesPriceId', 'createdBy', 'createdAt',
    ]],
    [pricingPolicy, [
      'id', 'policyVersion', 'minimumMarginPercent', 'targetMarginPercent', 'overrideApprovalPercent',
      'roundingIncrement', 'roundingRuleVersion', 'effectiveFrom', 'effectiveTo', 'active', 'createdBy', 'createdAt',
    ]],
  ] as const;

  for (const [build, keys] of cases) {
    it(`${build.name} includes every required key`, () => {
      const result = build();
      expect(Object.keys(result).sort()).toEqual([...keys].sort());
      expect(Object.values(result)).not.toContain(undefined);
    });
  }

  it('includes complete nested defaults and the orders response envelope', () => {
    expect(pricingWorkspace().lines).toEqual([pricingLine()]);
    expect(orderSummary().lines).toEqual([orderLine()]);
    expect(orderBootstrap().orders).toEqual([orderSummary()]);
    expect(Object.keys(pricingLine().source).sort()).toEqual(['date', 'reference', 'type', 'version']);
    expect(Object.keys(pricingLine().margin).sort()).toEqual([
      'erosionPercentagePoints', 'grossMarginPercent', 'grossProfitAmount', 'previousGrossMarginPercent',
    ]);
    expect(Object.keys(orderBootstrap().actor).sort()).toEqual(['email', 'role', 'roles']);
    expect(Object.keys(orderBootstrap().snapshot).sort()).toEqual(['catalog', 'company', 'fetchedAt']);
    expect(Object.keys(orderBootstrap().pagination!).sort()).toEqual(['page', 'pageCount', 'pageSize', 'total']);
  });

  it('preserves explicit overrides and isolates mutable defaults', () => {
    const line = pricingLine({ currentCost: 310, recentRates: [] });
    expect(pricingWorkspace({ lines: [line] }).lines).toEqual([line]);
    const bootstrap = orderBootstrap();
    bootstrap.orders[0].lines[0].quantity = 9;
    bootstrap.snapshot.catalog.push({ tallyKey: 'X', item: 'X', group: '', baseUnit: 'Nos', closing: 0, active: true });
    expect(orderBootstrap().orders[0].lines[0].quantity).toBe(1);
    expect(orderBootstrap().snapshot.catalog).toEqual([]);
  });
});
