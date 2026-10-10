import { describe, expect, it } from 'vitest';
import { buildAllocationShares, buildPurchaseAllocations, compatiblePurchaseLines, costVerificationSaleLines, purchaseMatchKind } from '@/lib/instrument-economics-forms';
import type { EconomicsWorkspaceData } from '@/lib/instrument-economics-types';
type Line = NonNullable<EconomicsWorkspaceData['sourceLines']>[number];
const sale: Line = { id: 'sale', companyId: 'company', voucherId: 'invoice', revision: '1', lineKey: '1', date: '2026-09-10', kind: 'sale', customerSourceId: 'customer', productId: 'product', quantity: '10', unit: 'pack', netSalesPaise: '10000', batchId: 'batch' };
const purchase: Line = { ...sale, id: 'purchase-a', kind: 'purchase', date: '2026-09-01', quantity: '6', netSalesPaise: '2000' };
const lines = [sale, purchase, { ...purchase, id: 'purchase-b', quantity: '5' }];
const raw = { sourceLineId: 'sale', purchaseLineId0: 'purchase-a', purchaseQuantity0: '4.25', purchaseLineId1: 'purchase-b', purchaseQuantity1: '5.75' };

describe('purchase evidence form contract', () => {
  it('submits full exact quantities from multiple sources without client cost guesses', () => {
    expect(buildPurchaseAllocations({ ...raw, purchaseQuantity0: '5.25', purchaseQuantity1: '4.75' }, lines)).toEqual([
      { purchaseLineId: 'purchase-a', quantity: '5.25' }, { purchaseLineId: 'purchase-b', quantity: '4.75' },
    ]);
  });
  it('conserves six-decimal quantities exactly', () => {
    expect(buildPurchaseAllocations({ ...raw, purchaseQuantity0: '0.000001', purchaseQuantity1: '0.299999' }, [{ ...sale, quantity: '0.3' }, purchase, lines[2]])).toHaveLength(2);
  });
  it('rejects duplicate sources, incomplete quantity, precision loss and source over-allocation', () => {
    expect(() => buildPurchaseAllocations({ ...raw, purchaseLineId1: 'purchase-a' }, lines)).toThrow('only once');
    expect(() => buildPurchaseAllocations({ ...raw, purchaseQuantity0: '1', purchaseQuantity1: '2' }, lines)).toThrow('complete sale quantity');
    expect(() => buildPurchaseAllocations({ ...raw, purchaseQuantity0: '1.0000001' }, lines)).toThrow('six decimal');
    expect(() => buildPurchaseAllocations(raw, lines)).toThrow('exceeds the source quantity');
  });
  it('only offers compatible same-company/product/unit/batch evidence dated by the sale', () => {
    const variants = [{ ...purchase, id: 'late', date: '2026-09-11' }, { ...purchase, id: 'company', companyId: 'other' }, { ...purchase, id: 'product', productId: 'other' }, { ...purchase, id: 'unit', unit: 'test' }, { ...purchase, id: 'batch', batchId: 'other' }];
    expect(compatiblePurchaseLines(sale, [purchase, ...variants])).toEqual([purchase]);
    expect(() => buildPurchaseAllocations({ sourceLineId: 'sale', purchaseLineId0: 'late', purchaseQuantity0: '10' }, [sale, ...variants])).toThrow('compatible historical');
    expect(compatiblePurchaseLines(undefined, lines)).toEqual([]);
  });
  it('lists only current mapped sale lines whose actual cost is unavailable', () => {
    const otherSale = { ...sale, id: 'sale-known', productName: 'Known cost reagent' };
    const pendingSale = { ...sale, id: 'sale-pending', productName: 'Pending cost reagent' };
    const attribution = [
      { id: 'result-pending', sourceLineId: pendingSale.id, targetId: 'target-1', status: 'cost_unavailable', reason: 'Purchase link required', shareBasisPoints: 10000, quantity: '10', revenuePaise: '10000', costPaise: null, gpPaise: null, date: pendingSale.date, voucherId: pendingSale.voucherId, revision: '1', productId: pendingSale.productId, productName: pendingSale.productName!, unit: pendingSale.unit, costEvidence: null },
      { id: 'result-known', sourceLineId: otherSale.id, targetId: 'target-1', status: 'verified', reason: 'Verified', shareBasisPoints: 10000, quantity: '10', revenuePaise: '10000', costPaise: '5000', gpPaise: '5000', date: otherSale.date, voucherId: otherSale.voucherId, revision: '1', productId: otherSale.productId, productName: otherSale.productName!, unit: otherSale.unit, costEvidence: 'Purchase evidence' },
      { id: 'result-unattributed', sourceLineId: sale.id, targetId: null, status: 'cost_unavailable', reason: 'Unattributed', shareBasisPoints: 10000, quantity: '10', revenuePaise: '10000', costPaise: null, gpPaise: null, date: sale.date, voucherId: sale.voucherId, revision: '1', productId: sale.productId, productName: sale.productId, unit: sale.unit, costEvidence: null },
    ];
    expect(costVerificationSaleLines([sale, otherSale, pendingSale, purchase], attribution)).toEqual([pendingSale]);
  });
  it('separates zero-value supplier entries and short purchase quantity from usable matches', () => {
    const zero = { ...purchase, id: 'zero', quantity: '10', netSalesPaise: '0' };
    expect(purchaseMatchKind(sale, [sale])).toBe('none');
    expect(purchaseMatchKind(sale, [sale, zero])).toBe('zero_value_only');
    expect(purchaseMatchKind(sale, [sale, purchase])).toBe('short_quantity');
    expect(purchaseMatchKind(sale, [sale, { ...purchase, quantity: '10' }])).toBe('single');
    expect(purchaseMatchKind(sale, lines)).toBe('multiple');
    expect(purchaseMatchKind(sale, [sale, zero, purchase])).toBe('multiple');
  });
});

describe('complete placement allocation form contract', () => {
  const shares = { allocationTargetId0: 'a', allocationPercent0: '33.33', allocationTargetId1: 'b', allocationPercent1: '33.33', allocationTargetId2: 'c', allocationPercent2: '33.34' };
  it('supports three placements with exact basis points totaling 100%', () => {
    expect(buildAllocationShares(shares)).toEqual([{ targetId: 'a', basisPoints: 3333 }, { targetId: 'b', basisPoints: 3333 }, { targetId: 'c', basisPoints: 3334 }]);
  });
  it('requires a complete total and unique nonzero shares without rounding', () => {
    expect(() => buildAllocationShares({ ...shares, allocationPercent2: '33.33' })).toThrow('exactly 100%');
    expect(() => buildAllocationShares({ ...shares, allocationTargetId2: 'b' })).toThrow('different placement');
    expect(() => buildAllocationShares({ ...shares, allocationPercent0: '0' })).toThrow('greater than zero');
    expect(() => buildAllocationShares({ ...shares, allocationPercent0: '33.333' })).toThrow('two decimal');
    expect(() => buildAllocationShares({ allocationTargetId0: 'a', allocationPercent0: '100' })).toThrow('exactly 100%');
  });
  it('rejects missing, discontinuous and oversized row sets', () => {
    expect(() => buildAllocationShares({})).toThrow('complete evidence rows');
    expect(() => buildAllocationShares({ ...shares, allocationTargetId5: 'd' })).toThrow('complete evidence rows');
    expect(() => buildAllocationShares(Object.fromEntries(Array.from({ length: 21 }, (_, index) => [`allocationTargetId${index}`, `${index}`])))).toThrow('complete evidence rows');
  });
});
