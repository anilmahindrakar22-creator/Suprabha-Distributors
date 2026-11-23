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
    const mappings = new Map<string, Map<string, string>>();
    for (const key of fonts.keys()) {
      const mapping = new Map<string, string>();
      mappings.set(key.toString(), mapping);
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
    let activeFont = '';
    for (let i = 0; i < contents.size(); i++) {
      const source = Buffer.from(decodePDFRawStream(contents.lookup(i, PDFRawStream)).decode()).toString();
      for (const match of source.matchAll(/(\/[^\s]+)\s+[\d.]+\s+Tf|<([\da-f]+)>\s*Tj/gi)) {
        if (match[1]) { activeFont = match[1]; continue; }
        result += (match[2].match(/.{4}/g) ?? []).map(code => mappings.get(activeFont)?.get(code.toUpperCase()) ?? '?').join('') + '\n';
      }
    }
    return result;
  });
}

async function render(label: string, order = po, letterhead: Letterhead | null = null, extras?: Parameters<typeof buildPoPdfContent>[2]) {
  const content = buildPoPdfContent(order, letterhead, extras);
  let doc!: PDFDocument;
  let regularTexts: string[] | undefined;
  for (const boldFont of [undefined, font]) {
    const bytes = await renderPoPdf(content, font, boldFont);
    expect(Buffer.from(bytes.subarray(0, 5)).toString()).toBe('%PDF-');
    process.stdout.write(`${label} (${boldFont ? 'two fonts' : 'regular only'}): ${bytes.length} bytes\n`);
    doc = await PDFDocument.load(bytes);
    const texts = pageTexts(doc);
    texts.forEach((text, index) => {
      expect(text).toContain(`${content.footer} · StockFlow`);
      expect(text).toContain(`Page ${index + 1} of ${doc.getPageCount()}`);
    });
    if (regularTexts) expect(texts).toEqual(regularTexts);
    else regularTexts = texts;
  }
  return doc;
}

describe('renderPoPdf', () => {
  it.each([
    ['3:1 PNG', 'image/png', 'iVBORw0KGgoAAAANSUhEUgAAAAMAAAABCAYAAAAb4BS0AAAAFElEQVR4nGP4z8DAwMDAwMDAxAADAAH4AQHqehRlAAAAAElFTkSuQmCC'],
    ['1:1 JPEG', 'image/jpeg', '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAHYAP/EABQQAQAAAAAAAAAAAAAAAAAAACD/2gAIAQEAAQUCcf/EABQRAQAAAAAAAAAAAAAAAAAAACD/2gAIAQMBAT8B/8QAFBEBAAAAAAAAAAAAAAAAAAAAIP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAIP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAIP/aAAgBAQABPyF//9oADAMBAAIAAwAAABAD/8QAFBEBAAAAAAAAAAAAAAAAAAAAIP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAIP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAIP/aAAgBAQABPxB//9k='],
  ] as const)('renders a %s logo fixture', async (label, type, encoded) => {
    const bytes = Buffer.from(encoded, 'base64');
    const fixtureDoc = await PDFDocument.create();
    const image = type === 'image/png' ? await fixtureDoc.embedPng(new Uint8Array(bytes)) : await fixtureDoc.embedJpg(new Uint8Array(bytes));
    expect(image.width / image.height).toBe(type === 'image/png' ? 3 : 1);
    const doc = await render(`${label} logo`, po, null, { logo: { type, bytes }, terms: [] });
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
    tablePages.forEach(text => expect(text).toMatch(/Items(?: \(continued\))?\n/));
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
    expect(buildPoPdfContent(order, null).gstNote).toBeNull();
    const doc = await render('operations', order);
    expect(doc.getPageCount()).toBe(1);
    const text = pageTexts(doc).join('\n');
    expect(text).toContain('3 pcs');
    expect(text).not.toContain('₹');
    expect(text).not.toContain('1,370.34');
    expect(text).not.toContain('per pcs');
    expect(text).not.toContain('exclusive of GST');
  });
  it('paginates sixty lines', async () => {
    const order = { ...po, lines: Array.from({ length: 60 }, (_, index) => ({ ...po.lines[0], itemKey: String(index), itemName: `Reagent ${index}` })) };
    expect((await render('60 lines', order)).getPageCount()).toBeGreaterThan(1);
  });
  it('keeps four priced items, two instructions and the logo on one page', async () => {
    const order = { ...po, lines: Array.from({ length: 4 }, (_, index) => ({ ...po.lines[0], itemKey: String(index), itemName: `Reagent ${index}` })) };
    const doc = await render('4 lines, logo and 2 instructions', order, {
      companyName: 'Example Distributors', address: '12 Market Road, Bengaluru 560001',
      gstin: null, phone: '', deliveryAddress: '', version: 1, updatedAt: '2026-11-01T00:00:00Z',
    }, { logo: { type: 'image/png', bytes: readFileSync('tests/fixtures/po-logo.png') }, terms: ['Payment within 30 days of invoice.'] });
    expect(doc.getPageCount()).toBe(1);
    expect(pageTexts(doc)[0]).toContain('2. Payment within 30 days of invoice.');
    expect(pageTexts(doc)[0]).toContain('Authorised signatory');
  });
  it('keeps five long terms after 25 items with the signature on the final instructions page', async () => {
    const order = { ...po, lines: Array.from({ length: 25 }, (_, index) => ({ ...po.lines[0], itemKey: String(index), itemName: `Reagent ${index}` })) };
    const terms = Array.from({ length: 5 }, (_, index) => `Term ${index + 1}: ${'Deliver carefully and confirm the schedule. '.repeat(8)}`);
    const doc = await render('25 lines and 5 long terms', order, null, { logo: null, terms });
    // Each priced row is 48 pt: 7 fit on the first page, 10 on each continuation.
    // The intact instructions panel needs one further page and shares it with the signature.
    const expectedPages = 1 + Math.ceil((25 - 7) / 10) + 1;
    expect(doc.getPageCount()).toBe(expectedPages);
    const texts = pageTexts(doc);
    expect(texts.at(-1)).toContain('Instructions');
    expect(texts.at(-1)).toContain('Term 5:');
    expect(texts.at(-1)).toContain('Authorised signatory');
    texts.slice(0, -1).forEach(text => expect(text).not.toContain('Authorised signatory'));
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
  it('wraps a long supplier name and five terms', async () => {
    const supplierName = 'Example Diagnostics Supplies Private Limited Regional Distribution and Procurement Division';
    const terms = Array.from({ length: 5 }, (_, index) => `Supplier term ${index + 1}: Please confirm delivery.`);
    const doc = await render('long supplier and 5 terms', { ...po, supplierName }, null, { logo: null, terms });
    const text = pageTexts(doc).join('\n');
    expect(text).toContain('Regional');
    expect(text).toContain('Supplier term 5:');
  });
});
