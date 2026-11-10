import { describe, expect, it, vi } from 'vitest';
import { prefillPriceReview, priceBookDecision } from '@/components/customer-price-book';

const review = { customerId: 'lab-1', tallyItemKey: '\u0004 Reagent', suggestedPricePaise: 12345, reason: 'Review the unit selling price' };
describe('Growth price-book handoff', () => {
  it('prefills only the exact Tally key without posting any request', () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    try {
      const rows = [{ tallyKey: 'Reagent' }, { tallyKey: '\u0004 Reagent extra' }, { tallyKey: review.tallyItemKey }];
      expect(prefillPriceReview(rows, review)).toEqual({ row: rows[2], custom: '123.45', reason: review.reason });
      expect(prefillPriceReview(rows.slice(0, 2), review)).toBeNull();
      expect(fetch).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
  it('builds the existing submit shape using only price-book evidence', () => {
    const row = { customerId: 'lab-1', tallyKey: review.tallyItemKey, currentDecisionId: 'read-decision', evidenceHash: 'read-evidence', cost: 999, margin: 40 };
    expect(priceBookDecision(row, 'custom', '124.50', 'Edited reason', 'request-id')).toEqual({
      action: 'apply_price_book', payload: { customerId: 'lab-1', tallyKey: review.tallyItemKey, expectedDecisionId: 'read-decision', evidenceHash: 'read-evidence', choice: 'custom', price: 124.5, reason: 'Edited reason', idempotencyKey: 'request-id' },
    });
    expect(priceBookDecision(row, 'recommended', '124.50', 'Reviewed', 'request-id').payload).not.toHaveProperty('price');
  });
});
