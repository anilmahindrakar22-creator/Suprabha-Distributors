import { describe, expect, it } from 'vitest';
import { buildPoPdfContent } from '../../lib/po-pdf-content';
import type { PurchaseOrder } from '../../lib/purchase-orders';
import type { Letterhead } from '../../lib/letterhead';
import { formatPaise } from '../../lib/wallet-format';

const basePo = (lines: PurchaseOrder['lines'], totalValue?: number | null): PurchaseOrder => ({
  id: 'po-1', poNumber: 'PO/26-27/0001', supplierName: 'Acme Supply', status: 'open', sharedAt: null,
  version: 1, createdAt: '2026-11-04T20:00:00Z', createdByEmail: 'buyer@example.com', lines,
  ...(totalValue === undefined ? {} : { totalValue }),
});
const line = (itemName: string, quantity: number, rate?: number | null): PurchaseOrder['lines'][number] => ({
  itemKey: itemName, itemName, quantity, unit: 'pcs', receivedQuantity: 0,
  ...(rate === undefined ? {} : { rate }),
});
const managementLines = [line('Widget A', 3, 456.78), line('Widget B', 2.5, 123.45)];
const letterhead: Letterhead = {
  companyName: 'Suprabha Distributors', address: '  12 Market Road  \nKolkata', gstin: '19ABCDE1234F1Z5',
  phone: '9876543210', deliveryAddress: '', version: 1, updatedAt: '2026-11-01T00:00:00Z',
};

describe('buildPoPdfContent', () => {
  it('adds serials, words, GST, footer and optional logo', () => {
    const logo = { type: 'image/png' as const, bytes: new Uint8Array([1, 2]) };
    const content = buildPoPdfContent(basePo(managementLines, 990.05), letterhead, { logo, terms: [] });
    expect(content.rows.map(row => row.serial)).toEqual(['1', '2']);
    expect(content.columns[0]).toBe('#');
    expect(content.amountInWords).toBe('Rupees Nine Hundred Ninety and Five Paise Only');
    expect(content.logo).toBe(logo);
    expect(content.gstNote).toBe('Rates are exclusive of GST; GST as applicable.');
    expect(content.footer).toBe('Computer-generated purchase order · PO/26-27/0001');
    expect(content.signature).toBe('For Suprabha Distributors');
    expect(buildPoPdfContent(basePo(managementLines), null, null).logo).toBeNull();
    expect(buildPoPdfContent(basePo(managementLines), null)).not.toHaveProperty('amountInWords');
  });

  it('keeps the fixed instruction first and takes five nonempty trimmed terms', () => {
    const content = buildPoPdfContent(basePo(managementLines), null, {
      logo: null, terms: ['  First  ', '', '  ', 'Second', '\nThird\n', 'Fourth', 'Fifth', 'Sixth'],
    });
    expect(content.instructions).toEqual([
      'Please quote PO/26-27/0001 on your invoice and delivery challan.', 'First', 'Second', 'Third', 'Fourth', 'Fifth',
    ]);
    expect(buildPoPdfContent(basePo(managementLines), null).instructions).toEqual([content.instructions[0]]);
  });

  it('keeps operations free of monetary fields even when the order has a total', () => {
    const content = buildPoPdfContent(basePo([line('Widget', 1)], 990.05), null);
    expect(content.columns).toEqual(['#', 'Item', 'Qty', 'Unit']);
    expect(content.gstNote).toBeNull();
    expect(content).not.toHaveProperty('total');
    expect(JSON.stringify(content)).not.toContain('amountInWords');
    expect(JSON.stringify(content)).not.toContain('₹');
  });

  it('uses the explicit delivery address when present', () => {
    expect(buildPoPdfContent(basePo(managementLines), { ...letterhead, deliveryAddress: ' Warehouse \n Dock 2 ' }).deliveryTo)
      .toEqual(['Warehouse', 'Dock 2']);
  });
  it('builds management rows and totals using integer paise formatting', () => {
    const content = buildPoPdfContent(basePo(managementLines, 1678.965), null);
    expect(content.showRates).toBe(true);
    expect(content.gstNote).toBe('Rates are exclusive of GST; GST as applicable.');
    expect(content.columns).toEqual(['#', 'Item', 'Qty', 'Unit', 'Rate', 'Amount']);
    expect(content.rows[0].rate).toBe(formatPaise(45678));
    expect(content.rows[0].amount).toBe(formatPaise(Math.round(3 * 456.78 * 100)));
    expect(content.rows[1].amount).toBe(formatPaise(Math.round(2.5 * 123.45 * 100)));
    expect(content.total).toBe(formatPaise(Math.round(1678.965 * 100)));
    expect(content.rows[0].rate).toBe('₹456.78');
    expect(content.rows[0].amount).toBe('₹1,370.34');
  });

  it('omits all price data for operations and mixed visibility lines', () => {
    const operations = buildPoPdfContent(basePo([line('Widget A', 3), line('Widget B', 2.5)]), null);
    expect(operations.showRates).toBe(false);
    expect(operations.rows.every((row) => !Object.hasOwn(row, 'rate') && !Object.hasOwn(row, 'amount'))).toBe(true);
    expect(Object.hasOwn(operations, 'total')).toBe(false);
    expect(JSON.stringify(operations)).not.toContain('₹');
    const mixed = buildPoPdfContent(basePo([line('Widget A', 3, 456.78), line('Widget B', 2.5)]), null);
    expect(mixed.showRates).toBe(false);
    expect(JSON.stringify(mixed)).not.toContain('₹');
  });

  it('prints em dashes for null rates when rates are visible', () => {
    const content = buildPoPdfContent(basePo([line('Widget A', 3, null)]), null);
    expect(content.showRates).toBe(true);
    expect(content.rows[0].rate).toBe('—');
    expect(content.rows[0].amount).toBe('—');
  });

  it('uses default company details without a letterhead', () => {
    const content = buildPoPdfContent(basePo(managementLines), null);
    expect(content.companyName).toBe('Suprabha Distributors');
    expect(content.letterheadLines).toEqual([]);
    expect(content.deliveryTo).toEqual([]);
  });

  it('orders letterhead metadata and falls back to the address for delivery', () => {
    const content = buildPoPdfContent(basePo(managementLines), letterhead);
    expect(content.letterheadLines).toEqual(['12 Market Road', 'Kolkata', 'GSTIN: 19ABCDE1234F1Z5', 'Phone: 9876543210']);
    expect(content.deliveryTo).toEqual(['12 Market Road', 'Kolkata']);
  });

  it('formats dates in Kolkata and creates the PDF file name', () => {
    const content = buildPoPdfContent(basePo(managementLines), null);
    expect(content.date).toBe('05 Nov 2026');
    expect(content.fileName).toBe('PO-26-27-0001.pdf');
    expect(buildPoPdfContent(basePo(managementLines), null).date).toBe('05 Nov 2026');
    expect(buildPoPdfContent({ ...basePo(managementLines), createdAt: 'not a date' }, null).date).toBe('');
  });
});
