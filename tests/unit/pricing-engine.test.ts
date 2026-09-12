import { describe, expect, it } from 'vitest';
import { canAccessRestrictedPricing, resolveCustomerPrice, type PricingResolutionInput } from '../../lib/pricing-engine';

const policy = {
  minimumGrossMarginPercent: 20,
  targetGrossMarginPercent: 30,
  roundingIncrement: 1,
  policyVersion: 'policy-1',
  roundingRuleVersion: 'ceil-rupee-1',
};

const base: PricingResolutionInput = {
  pricingDate: '2026-09-12',
  contracts: [],
  sellingHistory: [{ rate: 485, invoiceDate: '2026-08-18', invoiceReference: 'SD/26-27/0485', sourceId: 'sale-485' }],
  latestCost: { amount: 310, effectiveAt: '2026-08-01', sourceReference: 'PUR-310', sourceVersion: 'cost-310', kind: 'purchase_price' },
  previousCost: { amount: 310, effectiveAt: '2026-07-01', sourceReference: 'PUR-300', sourceVersion: 'cost-300', kind: 'purchase_price' },
  policy,
};

describe('customer pricing engine', () => {
  it('allows restricted values only for Accounts, Admin, and Management', () => {
    expect(['administrator', 'accounts', 'management'].every(canAccessRestrictedPricing)).toBe(true);
    expect(['sales', 'operations', 'warehouse', 'service', 'viewer'].some(canAccessRestrictedPricing)).toBe(false);
  });

  it('uses one valid approved contract before Tally history', () => {
    const result = resolveCustomerPrice({ ...base, contracts: [{ id: 'contract-1', price: 720, validFrom: '2026-04-01', validTo: null, status: 'approved', version: 3 }] });
    expect(result).toMatchObject({ resolution: 'APPROVED_CONTRACT_PRICE', proposedRate: 720, source: { type: 'APPROVED_CONTRACT', reference: 'contract-1', version: '3' } });
  });

  it('ignores expired and future contracts', () => {
    for (const contract of [
      { id: 'expired', price: 700, validFrom: '2025-04-01', validTo: '2026-03-31', status: 'approved' as const, version: 1 },
      { id: 'future', price: 700, validFrom: '2026-10-01', validTo: null, status: 'approved' as const, version: 1 },
    ]) expect(resolveCustomerPrice({ ...base, contracts: [contract] }).source.type).toBe('LAST_TALLY_INVOICE');
  });

  it('fails closed on conflicting active contracts', () => {
    const contract = { id: 'one', price: 700, validFrom: '2026-01-01', validTo: null, status: 'approved' as const, version: 1 };
    expect(() => resolveCustomerPrice({ ...base, contracts: [contract, { ...contract, id: 'two' }] })).toThrow('Conflicting approved price contracts');
  });

  it('uses the latest eligible Tally sale and exposes bounded recent context without averaging', () => {
    const result = resolveCustomerPrice({ ...base, sellingHistory: [
      { rate: 450, invoiceDate: '2026-01-01', invoiceReference: 'OLD', sourceId: 'old' },
      ...base.sellingHistory,
      { rate: 999, invoiceDate: '2026-09-15', invoiceReference: 'FUTURE', sourceId: 'future' },
    ] });
    expect(result).toMatchObject({ resolution: 'LAST_TALLY_INVOICE_PRICE', proposedRate: 485, source: { reference: 'SD/26-27/0485' } });
    expect(result.recentRates.map((entry) => entry.rate)).toEqual([485, 450]);
  });

  it('never treats FOC, zero-rate, or exceptional history as a proposed price', () => {
    const result = resolveCustomerPrice({ ...base, sellingHistory: [
      { rate: 0, invoiceDate: '2026-09-01', invoiceReference: 'FOC', sourceId: 'foc' },
      { rate: 50, invoiceDate: '2026-08-31', invoiceReference: 'SCHEME', sourceId: 'scheme', exceptional: true, exceptionType: 'scheme' },
    ] });
    expect(result).toMatchObject({ resolution: 'PRICE_REVIEW_REQUIRED', proposedRate: null, guardrail: 'PRICE_REVIEW_REQUIRED' });
  });

  it('returns NO_PRICE_HISTORY when there is no contract or Tally history', () => {
    expect(resolveCustomerPrice({ ...base, sellingHistory: [] })).toMatchObject({ resolution: 'NO_PRICE_HISTORY', proposedRate: null });
  });

  it('marks unchanged and decreased cost as PRICE_OK', () => {
    expect(resolveCustomerPrice(base).guardrail).toBe('PRICE_OK');
    expect(resolveCustomerPrice({ ...base, latestCost: { ...base.latestCost!, amount: 300 } }).guardrail).toBe('PRICE_OK');
  });

  it('warns on a cost increase, preserves the historical selling rate, and computes margin erosion', () => {
    const result = resolveCustomerPrice({ ...base, latestCost: { ...base.latestCost!, amount: 350, sourceVersion: 'cost-350' } });
    expect(result).toMatchObject({
      resolution: 'LAST_TALLY_INVOICE_PRICE', guardrail: 'COST_INCREASE', proposedRate: 485,
      cost: { changeAmount: 40, changePercent: 12.9 },
      margin: { grossProfitAmount: 135, grossMarginPercent: 27.84, previousGrossMarginPercent: 36.08, erosionPercentagePoints: -8.25 },
      suggestion: { amount: 500, unroundedAmount: 500, costSourceVersion: 'cost-350' },
    });
    expect(result.warnings).toContain('PURCHASE_PRICE_INCREASED');
  });

  it('requires review when cost breaches minimum margin or makes the sale loss-making', () => {
    expect(resolveCustomerPrice({ ...base, latestCost: { ...base.latestCost!, amount: 400 } })).toMatchObject({ resolution: 'PRICE_REVIEW_REQUIRED', guardrail: 'PRICE_REVIEW_REQUIRED' });
    const loss = resolveCustomerPrice({ ...base, latestCost: { ...base.latestCost!, amount: 500 } });
    expect(loss.warnings).toEqual(expect.arrayContaining(['LOSS_MAKING', 'BELOW_MINIMUM_MARGIN']));
  });

  it('requires review and does not invent cost or margin when purchase evidence is missing', () => {
    const result = resolveCustomerPrice({ ...base, latestCost: null });
    expect(result).toMatchObject({ guardrail: 'PRICE_REVIEW_REQUIRED', suggestion: null, margin: { grossProfitAmount: null, grossMarginPercent: null } });
    expect(result.warnings).toContain('MISSING_PURCHASE_COST');
  });

  it('does not fabricate a suggestion without a configured target margin', () => {
    const result = resolveCustomerPrice({ ...base, latestCost: { ...base.latestCost!, amount: 350 }, policy: { ...policy, targetGrossMarginPercent: null } });
    expect(result.suggestion).toBeNull();
  });

  it('applies the versioned round-up rule to suggested prices', () => {
    const result = resolveCustomerPrice({ ...base, latestCost: { ...base.latestCost!, amount: 351, sourceVersion: 'cost-351' }, policy: { ...policy, roundingIncrement: 5 } });
    expect(result.suggestion).toEqual({ amount: 505, unroundedAmount: 501.43, targetMarginPercent: 30, policyVersion: 'policy-1', roundingRuleVersion: 'ceil-rupee-1', costSourceVersion: 'cost-351' });
  });
});
