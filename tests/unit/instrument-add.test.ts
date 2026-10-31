import { describe, expect, it } from 'vitest';
import { derivedInstrumentFields, instrumentLabIdentities, instrumentLineLabel, instrumentPurchases, investmentLine, matchingInstrumentSales, rentalLabs } from '../../lib/instrument-add';

const purchase = {
  id: 'purchase-1', companyId: 'co-1', voucherId: 'v-1', voucherNumber: 'PUR-17', revision: '1', lineKey: 'line-1',
  date: '2026-07-23', kind: 'purchase' as const, customerSourceId: null, productId: 'machine', productName: 'Sys 240 Biochemistry Analyzer',
  quantity: '1', unit: 'Nos', netSalesPaise: '42000000', batchId: null, partyName: 'Acme Supplies',
};
const sale = {
  ...purchase, id: 'sale-1', voucherId: 'v-2', voucherNumber: 'SAL-3', lineKey: 'line-2', kind: 'sale' as const,
  customerSourceId: 'ledger-1', netSalesPaise: '30000000', partyName: 'City Lab',
};
const data = (sourceLines: unknown[] = [purchase, sale], identities: unknown[] = []) => ({
  sourceLines,
  customers: [{ id: 'lab-1', name: 'City Lab', city: 'Bengaluru' }, { id: 'lab-2', name: 'Other Lab' }].map(customer => ({
    ...customer,
    tallyIdentities: (identities as { companyId: string; customerId: string; customerSourceId: string }[])
      .filter(identity => identity.customerId === customer.id)
      .map(({ companyId, customerSourceId }) => ({ companyId, customerSourceId })),
  })),
}) as never;

describe('instrument add helpers', () => {
  it('filters purchase candidates by equipment threshold, usage, query, and date', () => {
    const rows = [purchase, { ...purchase, id: 'below', netSalesPaise: '4999999' }, { ...purchase, id: 'zero', netSalesPaise: '0' }, { ...purchase, id: 'negative', netSalesPaise: '-9000000' }, { ...purchase, id: 'used', usedByInstrument: true }, { ...purchase, id: 'fractional-qty', quantity: '1.01' }, { ...purchase, id: 'formatted-qty', quantity: '1.000000' }, { ...purchase, id: 'older', date: '2025-01-01' }];
    expect(instrumentPurchases(data(rows), 'sys')).toHaveLength(3);
    expect(instrumentPurchases(data(rows))[0].id).toBe('purchase-1');
    expect(instrumentPurchases(data(rows), '', true)).toHaveLength(4);
    expect(instrumentPurchases(data([{ ...purchase, id: 'threshold', netSalesPaise: '5000000' }]))[0].id).toBe('threshold');
  });

  it('finds only unused, qualifying sales for the same company and product', () => {
    const rows = [sale, { ...sale, id: 'other-company', companyId: 'co-2' }, { ...sale, id: 'other-product', productId: 'other' }, { ...sale, id: 'other-unit', unit: 'Box' }, { ...sale, id: 'early', date: '2026-07-22' }, { ...sale, id: 'small-positive', netSalesPaise: '1' }, { ...sale, id: 'formatted-qty', quantity: '1.000000' }, { ...sale, id: 'fractional-qty', quantity: '1.01' }, { ...sale, id: 'negative', netSalesPaise: '-30000000' }, { ...sale, id: 'used', usedByInstrument: true }];
    expect(matchingInstrumentSales(data(rows), purchase).map(row => row.id)).toEqual(['sale-1', 'small-positive', 'formatted-qty']);
    const cheaperPurchase = { ...purchase, netSalesPaise: '100' };
    expect(matchingInstrumentSales(data([{ ...sale, netSalesPaise: '1' }]), cheaperPurchase)).toHaveLength(1);
  });

  it('formats readable labels and investment arithmetic without identifiers', () => {
    const label = instrumentLineLabel(purchase);
    expect(label).toContain('Sys 240 Biochemistry Analyzer');
    expect(label).toContain('bought 23 Jul 2026');
    expect(label).toContain('Acme Supplies');
    expect(label).not.toContain('purchase-1');
    expect(investmentLine(purchase, sale)).toBe('Investment ₹1,20,000 = bought ₹4,20,000 − billed ₹3,00,000');
    expect(investmentLine(purchase)).toContain('billed ₹0');
    expect(investmentLine({ ...purchase, netSalesPaise: '900719925474099312345' }, { ...sale, netSalesPaise: '1' })).toBe('Investment ₹90,07,19,92,54,74,09,93,123.44 = bought ₹90,07,19,92,54,74,09,93,123.45 − billed ₹0.01');
    expect(investmentLine({ ...purchase, netSalesPaise: '100' }, { ...sale, netSalesPaise: '200' })).toBe('Investment -₹1 = bought ₹1 − billed ₹2');
  });

  it('limits rental labs to matching confirmed identities and derives hidden fields', () => {
    const rentalData = data([], [
      { companyId: 'co-1', customerId: 'lab-1', customerSourceId: 'ledger-1' },
      { companyId: 'co-1', customerId: 'lab-1', customerSourceId: 'ledger-1' },
      { companyId: 'co-2', customerId: 'lab-2', customerSourceId: 'ledger-2' },
      ...Array.from({ length: 24 }, (_, index) => ({ companyId: 'co-1', customerId: `lab-${index + 10}`, customerSourceId: `ledger-${index + 10}` })),
    ]);
    expect(rentalLabs(rentalData, 'c', 'co-1')).toEqual([]);
    expect(rentalLabs(rentalData, '  ', 'co-1')).toEqual([]);
    expect(rentalLabs(rentalData, 'other', 'co-1')).toEqual([]);
    const [lab] = rentalLabs(rentalData, 'ci', 'co-1');
    expect(lab).toEqual({ id: 'lab-1', name: 'City Lab', city: 'Bengaluru', customerSourceId: 'ledger-1' });
    expect(derivedInstrumentFields(purchase, lab, undefined, '2026-07-23')).toMatchObject({
      companyId: 'co-1', customerSourceId: 'ledger-1', siteId: 'Bengaluru', modelId: 'Sys 240 Biochemistry Analyzer',
      name: 'Sys 240 Biochemistry Analyzer · City Lab', effectiveFrom: '2026-07-23', capitalEvidence: 'Tally purchase PUR-17', kind: 'placement',
    });
    expect(rentalLabs(rentalData, 'city', 'co-1')).toHaveLength(1);
    const manyLabs = {
      sourceLines: [],
      customers: Array.from({ length: 24 }, (_, index) => ({
        id: `lab-${index}`, name: `Lab ${index}`,
        tallyIdentities: [{ companyId: 'co-1', customerSourceId: `ledger-${index}` }],
      })),
    } as never;
    expect(rentalLabs(manyLabs, 'lab', 'co-1')).toHaveLength(20);
    const nameFallbackLab = { id: 'lab-2', name: 'Other Lab', customerSourceId: 'ledger-2' };
    expect(derivedInstrumentFields(purchase, nameFallbackLab, { modelId: 'existing-model' }, '2026-07-23')).toMatchObject({ siteId: 'Other Lab', modelId: 'existing-model' });
  });

  it('flattens confirmed ledger identities from customer records', () => {
    expect(instrumentLabIdentities(data([], [
      { companyId: 'co-1', customerId: 'lab-1', customerSourceId: 'ledger-1' },
      { companyId: 'co-2', customerId: 'lab-2', customerSourceId: 'ledger-2' },
    ]))).toEqual([
      { customerId: 'lab-1', companyId: 'co-1', customerSourceId: 'ledger-1' },
      { customerId: 'lab-2', companyId: 'co-2', customerSourceId: 'ledger-2' },
    ]);
  });
});
