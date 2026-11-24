import { describe, expect, it } from 'vitest';
import { derivedInstrumentFields, instrumentLabIdentities, instrumentLineLabel, instrumentPurchaseFilter, investmentLine, matchingSalesFilter, rentalLabs } from '../../lib/instrument-add';

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
  it('builds server purchase filters for the equipment threshold and word search', () => {
    expect(instrumentPurchaseFilter(false, 'sys analyzer')).toEqual({ kind: 'purchase', quantityOne: true, unusedOnly: true, minNetSalesPaise: '5000000', q: 'sys analyzer' });
    expect(instrumentPurchaseFilter(true)).toEqual({ kind: 'purchase', quantityOne: true, unusedOnly: true, minNetSalesPaise: '1', q: '' });
  });

  it('builds a same-company, product and unit sales filter after the purchase date', () => {
    expect(matchingSalesFilter(purchase)).toEqual({ kind: 'sale', companyId: purchase.companyId, productId: purchase.productId, unit: purchase.unit, quantityOne: true, minNetSalesPaise: '1', unusedOnly: true, dateFrom: purchase.date });
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
