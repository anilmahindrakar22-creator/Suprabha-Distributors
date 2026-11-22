import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { buildPoPdfContent } from '../../lib/po-pdf-content';
import { renderPoPdf } from '../../lib/po-pdf-render';
import type { PurchaseOrder } from '../../lib/purchase-orders';
import type { Letterhead } from '../../lib/letterhead';

const font = readFileSync('public/fonts/noto-sans-po-subset.ttf');
const po: PurchaseOrder = {
  id: 'po-1', poNumber: 'PO/26-27/0001', supplierName: 'Acme Supply', status: 'open',
  sharedAt: null, version: 1, createdAt: '2026-11-04T20:00:00Z', createdByEmail: 'buyer@example.com',
  lines: [{ itemKey: 'A', itemName: 'Reagent A', quantity: 3, unit: 'pcs', receivedQuantity: 0, rate: 456.78 }],
  totalValue: 1370.34,
};
async function render(label: string, order = po, letterhead: Letterhead | null = null) {
  const bytes = await renderPoPdf(buildPoPdfContent(order, letterhead), font);
  expect(Buffer.from(bytes.subarray(0, 5)).toString()).toBe('%PDF-');
  console.info(`${label}: ${bytes.length} bytes`);
  return PDFDocument.load(bytes);
}

describe('renderPoPdf', () => {
  it('renders management prices with the PO title on one page', async () => {
    const doc = await render('management');
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getTitle()).toBe('PO/26-27/0001');
    expect(doc.getCreator()).toBe('StockFlow');
    expect(doc.getPage(0).getSize()).toEqual({ width: 595.28, height: 841.89 });
  });
  it('renders operations without rate or total keys', async () => {
    const order: PurchaseOrder = { ...po, lines: [{ itemKey: 'A', itemName: 'Reagent A', quantity: 3, unit: 'pcs', receivedQuantity: 0 }] };
    delete order.totalValue;
    expect((await render('operations', order)).getPageCount()).toBe(1);
  });
  it('paginates sixty lines', async () => {
    const order = { ...po, lines: Array.from({ length: 60 }, (_, index) => ({ ...po.lines[0], itemKey: String(index), itemName: `Reagent ${index}` })) };
    expect((await render('60 lines', order)).getPageCount()).toBeGreaterThan(1);
  });
  it('replaces unsupported emoji and Devanagari without throwing', async () => {
    await render('unsupported characters', { ...po, lines: [{ ...po.lines[0], itemName: 'Reagent 🧪 नमस्ते' }] });
  });
  it('wraps six address lines and a 300-character item name', async () => {
    await render('long address and item', { ...po, lines: [{ ...po.lines[0], itemName: 'A'.repeat(300) }] }, {
      companyName: 'Suprabha Distributors', address: Array.from({ length: 6 }, (_, index) => `Address line ${index + 1}`).join('\n'),
      gstin: null, phone: '9876543210', deliveryAddress: '', version: 1, updatedAt: '2026-11-01T00:00:00Z',
    });
  });
});
