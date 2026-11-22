import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { PoPdfContent } from './po-pdf-content';

export async function renderPoPdf(content: PoPdfContent, fontBytes: Uint8Array | ArrayBuffer): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(fontBytes, { subset: true });
  doc.setTitle(content.poNumber);
  doc.setCreator('StockFlow');
  const width = 595.28, height = 841.89, margin = 40, usable = width - margin * 2, bottom = 60;
  const ink = rgb(0.043, 0.231, 0.251), grey = rgb(0.40, 0.42, 0.43);
  const rules = rgb(0.82, 0.84, 0.85), zebra = rgb(0.961, 0.969, 0.969), white = rgb(1, 1, 1);
  const characters = new Set(font.getCharacterSet());
  const safe = (value: string) => Array.from(value, character => {
    try {
      font.encodeText(character);
      return characters.has(character.codePointAt(0)!) ? character : '?';
    } catch { return '?'; }
  }).join('');
  let page = doc.addPage([width, height]), y = height - margin;
  const band = () => page.drawRectangle({ x: 0, y: height - 6, width, height: 6, color: ink });
  band();
  const newPage = () => { page = doc.addPage([width, height]); y = height - margin; band(); };
  const ensure = (space: number) => { if (y - space < bottom) newPage(); };
  const text = (value: string, x: number, baseline: number, size: number, align: 'left' | 'right' | 'center' = 'left', color = ink) => {
    const cleaned = safe(value), measured = font.widthOfTextAtSize(cleaned, size);
    page.drawText(cleaned, { x: x - (align === 'right' ? measured : align === 'center' ? measured / 2 : 0), y: baseline, size, font, color });
  };
  const rule = (baseline: number, left = margin, right = width - margin, color = rules) => page.drawLine({
    start: { x: left, y: baseline }, end: { x: right, y: baseline }, thickness: 0.75, color,
  });
  const wrap = (value: string, size: number, maxWidth: number): string[] => {
    const result: string[] = [];
    for (const paragraph of value.split(/\r?\n/)) {
      let line = '';
      for (const word of safe(paragraph).split(/\s+/).filter(Boolean)) {
        const candidate = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(candidate, size) <= maxWidth) { line = candidate; continue; }
        if (line) { result.push(line); line = ''; }
        for (const character of word) {
          if (line && font.widthOfTextAtSize(line + character, size) > maxWidth) { result.push(line); line = ''; }
          line += character;
        }
      }
      result.push(line);
    }
    return result;
  };
  const flowing = (value: string, size: number, color = grey, maxWidth = usable) => {
    for (const line of wrap(value, size, maxWidth)) {
      ensure(size + 5);
      y -= size + 5;
      text(line, margin, y, size, 'left', color);
    }
  };

  const top = y, boxWidth = 190, boxX = width - margin - boxWidth;
  const numberLines = wrap(content.poNumber, 9, 116), dateLines = wrap(content.date, 9, 116);
  const metadataHeight = 38 + (numberLines.length + dateLines.length) * 14;
  page.drawRectangle({ x: boxX, y: top - metadataHeight, width: boxWidth, height: metadataHeight, borderWidth: 0.75, borderColor: ink });
  text('PURCHASE ORDER', boxX + 10, top - 21, 12.5);
  let metaY = top - 40;
  for (const [label, values] of [['PO number', numberLines], ['Date', dateLines]] as const) {
    text(label, boxX + 10, metaY, 9, 'left', grey);
    for (const value of values) { text(value, width - margin - 10, metaY, 9, 'right'); metaY -= 14; }
  }
  if (content.logo) {
    // Own the byte range: Node Buffers may be views into a larger pooled ArrayBuffer.
    const bytes = new Uint8Array(content.logo.bytes);
    const logo = content.logo.type === 'image/png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
    const scale = Math.min(120 / logo.width, 48 / logo.height);
    const logoWidth = logo.width * scale, logoHeight = logo.height * scale;
    page.drawImage(logo, { x: margin, y: y - logoHeight, width: logoWidth, height: logoHeight });
    y -= logoHeight + 8;
  }
  for (const line of wrap(content.companyName, 15, usable * 0.55)) {
    y -= 19;
    text(line, margin, y, 15);
  }
  for (const line of content.letterheadLines) flowing(line, 8.5, grey, usable * 0.55);
  y = Math.min(y, top - metadataHeight) - 18;

  const addressWidth = (usable - 12) / 2;
  const supplier = wrap(content.supplier, 10.5, addressWidth - 16);
  const delivery = content.deliveryTo.length ? content.deliveryTo.flatMap(line => wrap(line, 9.5, addressWidth - 16)) : ['—'];
  const addressHeight = 30 + Math.max(supplier.length * 14.5, delivery.length * 13.5);
  ensure(addressHeight + 18);
  for (const [index, label, lines, size, leading] of [
    [0, 'Supplier', supplier, 10.5, 14.5], [1, 'Deliver to', delivery, 9.5, 13.5],
  ] as const) {
    const x = margin + index * (addressWidth + 12);
    page.drawRectangle({ x, y: y - addressHeight, width: addressWidth, height: addressHeight, borderWidth: 0.75, borderColor: rules });
    text(label, x + 8, y - 17, 8.5, 'left', grey);
    lines.forEach((line, i) => text(line, x + 8, y - 33 - i * leading, size));
  }
  y -= addressHeight + 18;

  const widths = (content.showRates ? [0.06, 0.40, 0.10, 0.10, 0.16, 0.18] : [0.07, 0.63, 0.14, 0.16]).map(share => share * usable);
  const cell = (value: string, index: number, baseline: number, size: number, color = ink) => {
    const start = margin + widths.slice(0, index).reduce((sum, column) => sum + column, 0);
    const align = index === 0 ? 'center' : index === 2 || index >= 4 ? 'right' : 'left';
    const x = align === 'center' ? start + widths[index] / 2 : align === 'right' ? start + widths[index] - 6 : start + 6;
    text(value, x, baseline, size, align, color);
  };
  const header = () => {
    page.drawRectangle({ x: margin, y: y - 25, width: usable, height: 25, color: ink });
    content.columns.forEach((column, index) => cell(column, index, y - 16, 9, white));
    y -= 25;
  };
  const tablePage = () => { newPage(); header(); };
  ensure(51);
  header();
  content.rows.forEach((row, rowIndex) => {
    const values = [row.serial, row.item, row.quantity, row.unit, ...(content.showRates ? [row.rate ?? '', row.amount ?? ''] : [])];
    const lines = values.map((value, index) => wrap(value, 9.5, widths[index] - 12));
    const count = Math.max(...lines.map(column => column.length));
    if (y - (count * 14 + 12) < bottom && y < height - margin - 25) tablePage();
    let offset = 0;
    while (offset < count) {
      const capacity = Math.floor((y - bottom - 12) / 14);
      if (capacity < 1) { tablePage(); continue; }
      const take = Math.min(capacity, count - offset), rowHeight = take * 14 + 12;
      if (rowIndex % 2 === 1) page.drawRectangle({ x: margin, y: y - rowHeight, width: usable, height: rowHeight, color: zebra });
      for (let line = 0; line < take; line++) {
        lines.forEach((column, index) => { if (column[offset + line]) cell(column[offset + line], index, y - 17 - line * 14, 9.5); });
      }
      y -= rowHeight;
      offset += take;
      if (offset < count) tablePage();
    }
  });
  y -= 14;
  if (content.total !== undefined) {
    ensure(42);
    rule(y, width - margin - 220, width - margin, ink);
    y -= 23;
    text('Total', width - margin - 220, y, 10, 'left', grey);
    text(content.total, width - margin, y, 12, 'right');
    y -= 8;
    if (content.amountInWords) flowing(content.amountInWords, 9);
    y -= 10;
  }
  flowing(content.gstNote, 8.5);
  y -= 12;
  ensure(45);
  y -= 14;
  text('Instructions', margin, y, 9.5);
  content.instructions.forEach((instruction, index) => {
    const lines = wrap(instruction, 9, usable - 20);
    ensure(14);
    text(`${index + 1}.`, margin, y - 14, 9, 'left', grey);
    for (const line of lines) {
      ensure(14);
      y -= 14;
      text(line, margin + 20, y, 9, 'left', grey);
    }
    y -= 3;
  });

  const signatureLines = wrap(content.signature, 9.5, 170);
  const signatureTop = 94 + signatureLines.length * 14;
  ensure(signatureTop - bottom + 14);
  signatureLines.forEach((line, index) => text(line, width - margin - 170, signatureTop - index * 14, 9.5));
  rule(72, width - margin - 170);
  text('Authorised signatory', width - margin - 170, 56, 9, 'left', grey);
  const pages = doc.getPages();
  pages.forEach((entry, index) => {
    page = entry;
    text(`${content.footer || `Computer-generated purchase order · ${content.poNumber}`} · Page ${index + 1} of ${pages.length}`, width / 2, 24, 8, 'center', grey);
  });
  return doc.save();
}
