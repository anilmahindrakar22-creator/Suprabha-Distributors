import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
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
function pageTexts(doc: PDFDocument): string[] {
  return doc.getPages().map(page => {
    const fonts = page.node.Resources()!.lookup(PDFName.of('Font'), PDFDict);
    const mapping = new Map<string, string>();
    for (const key of fonts.keys()) {
      const face = fonts.lookup(key, PDFDict);
      const cmap = face.lookup(PDFName.of('ToUnicode')) as PDFRawStream;
      const source = Buffer.from(decodePDFRawStream(cmap).decode()).toString();
      for (const block of source.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
        for (const pair of block[1].matchAll(/<([\da-f]+)>\s*<([\da-f]+)>/gi)) {
          mapping.set(pair[1].toUpperCase(), (pair[2].match(/.{4}/g) ?? []).map(code => String.fromCharCode(parseInt(code, 16))).join(''));
        }
      }
    }
    const contents = page.node.Contents() as PDFArray;
    let result = '';
    for (let i = 0; i < contents.size(); i++) {
      const source = Buffer.from(decodePDFRawStream(contents.lookup(i, PDFRawStream)).decode()).toString();
      for (const match of source.matchAll(/<([\da-f]+)>\s*Tj/gi)) {
        result += (match[1].match(/.{4}/g) ?? []).map(code => mapping.get(code.toUpperCase()) ?? '?').join('') + '\n';
      }
    }
    return result;
  });
}

async function render(label: string, order = po, letterhead: Letterhead | null = null, extras?: Parameters<typeof buildPoPdfContent>[2]) {
  const content = buildPoPdfContent(order, letterhead, extras);
  const bytes = await renderPoPdf(content, font);
  expect(Buffer.from(bytes.subarray(0, 5)).toString()).toBe('%PDF-');
  process.stdout.write(`${label}: ${bytes.length} bytes\n`);
  const doc = await PDFDocument.load(bytes);
  pageTexts(doc).forEach((text, index) => {
    expect(text).toContain(`${content.footer} · Page ${index + 1} of ${doc.getPageCount()}`);
  });
  return doc;
}

describe('renderPoPdf', () => {
  it.each([['png', 'image/png'], ['jpg', 'image/jpeg']] as const)('renders a %s logo fixture', async (extension, type) => {
    const bytes = readFileSync(`tests/fixtures/po-logo.${extension}`);
    const fixtureDoc = await PDFDocument.create();
    const image = type === 'image/png' ? await fixtureDoc.embedPng(new Uint8Array(bytes)) : await fixtureDoc.embedJpg(new Uint8Array(bytes));
    expect(image.width).toBeGreaterThan(0);
    expect(image.height).toBeGreaterThan(0);
    const doc = await render(`${extension} logo`, po, null, { logo: { type, bytes }, terms: [] });
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getPage(0).node.Resources()!.lookup(PDFName.of('XObject'), PDFDict).keys()).toHaveLength(1);
  });

  it('paginates sixty lines with five terms and accurate footers on every page', async () => {
    const order = { ...po, lines: Array.from({ length: 60 }, (_, index) => ({ ...po.lines[0], itemKey: String(index), itemName: `Reagent ${index}` })) };
    const terms = Array.from({ length: 5 }, (_, index) => `Term ${index + 1}: ${'Deliver carefully and confirm the schedule. '.repeat(8)}`);
    const doc = await render('60 lines and 5 terms', order, null, { logo: null, terms });
    expect(doc.getPageCount()).toBeGreaterThan(1);
    const texts = pageTexts(doc);
    expect(texts.join('\n')).toContain('Term 5:');
    expect(texts.at(-1)).toContain('Authorised signatory');
    texts.slice(0, -1).forEach(text => expect(text).not.toContain('Authorised signatory'));
  });

  it('splits a single very tall row and long instructions safely', async () => {
    const doc = await render('tall row', { ...po, lines: [{ ...po.lines[0], itemName: 'Long item description '.repeat(300) }] }, null,
      { logo: null, terms: ['Long instruction '.repeat(600)] });
    const texts = pageTexts(doc);
    expect(doc.getPageCount()).toBeGreaterThan(2);
    const tablePages = texts.filter(text => text.includes('Long item'));
    expect(tablePages.length).toBeGreaterThan(1);
    tablePages.forEach(text => expect(text).toContain('Item\n'));
    expect(texts.at(-1)).toContain('Authorised signatory');
  });
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
