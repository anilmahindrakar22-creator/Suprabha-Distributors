import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { PoPdfContent } from './po-pdf-content';

export async function renderPoPdf(content: PoPdfContent, fontBytes: Uint8Array | ArrayBuffer): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(fontBytes, { subset: true });
  doc.setTitle(content.poNumber);
  doc.setCreator('StockFlow');
  const width = 595.28, height = 841.89, margin = 40, usable = width - margin * 2;
  const ink = rgb(0.1, 0.1, 0.1), grey = rgb(0.4, 0.4, 0.4), ruleColor = rgb(0.75, 0.75, 0.75);
  const characters = new Set(font.getCharacterSet());
  const safe = (value: string) => Array.from(value, (character) => {
    try {
      font.encodeText(character);
      return characters.has(character.codePointAt(0)!) ? character : '?';
    } catch { return '?'; }
  }).join('');
  let page = doc.addPage([width, height]);
  let y = height - margin;
  const text = (value: string, x: number, baseline: number, size: number, align: 'left' | 'right' | 'center' = 'left', color = ink) => {
    const cleaned = safe(value);
    const measured = font.widthOfTextAtSize(cleaned, size);
    page.drawText(cleaned, { x: x - (align === 'right' ? measured : align === 'center' ? measured / 2 : 0), y: baseline, size, font, color });
  };
  const rule = (baseline: number, left = margin, right = width - margin) => page.drawLine({ start: { x: left, y: baseline }, end: { x: right, y: baseline }, thickness: 0.75, color: ruleColor });
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
  const newPage = () => { page = doc.addPage([width, height]); y = height - margin; };
  const flowingText = (value: string, size: number, maxWidth = usable) => {
    for (const line of wrap(value, size, maxWidth)) {
      if (y - size < margin + 140) newPage();
      y -= size + 4;
      text(line, margin, y, size);
    }
  };
  const top = y;
  flowingText(content.companyName, 14, usable * 0.6);
  for (const line of content.letterheadLines) flowingText(line, 9, usable * 0.6);
  text('Purchase order', width - margin, top - 18, 16, 'right');
  text(content.poNumber, width - margin, top - 36, 10, 'right');
  text(content.date, width - margin, top - 52, 10, 'right');
  y = Math.min(y, top - 60) - 12;
  rule(y);
  y -= 20;
  text('To', margin, y, 9, 'left', grey);
  flowingText(content.supplier, 11);
  y -= 16;

  const shares = content.showRates ? [0.46, 0.1, 0.12, 0.16, 0.16] : [0.64, 0.14, 0.22];
  const widths = shares.map((share) => share * usable);
  const rightAligned = (index: number) => index === 1 || index >= 3;
  const cell = (value: string, index: number, baseline: number, size: number) => {
    const start = margin + widths.slice(0, index).reduce((sum, column) => sum + column, 0);
    text(value, rightAligned(index) ? start + widths[index] - 6 : start + 6, baseline, size, rightAligned(index) ? 'right' : 'left');
  };
  const header = () => {
    page.drawRectangle({ x: margin, y: y - 25, width: usable, height: 25, color: rgb(0.94, 0.94, 0.94) });
    content.columns.forEach((column, index) => cell(column, index, y - 16, 9));
    y -= 25;
  };
  const tablePage = () => { newPage(); header(); };
  if (y < margin + 190) newPage();
  header();
  for (const row of content.rows) {
    const values = [row.item, row.quantity, row.unit, ...(content.showRates ? [row.rate ?? '', row.amount ?? ''] : [])];
    const lines = values.map((value, index) => wrap(value, 10, widths[index] - 12));
    const count = Math.max(...lines.map((column) => column.length));
    if (y - (count * 14 + 12) < margin + 140) tablePage();
    // Also split a single unusually tall row across pages rather than clipping it.
    for (let line = 0; line < count; line++) {
      if (y - 26 < margin + 140) tablePage();
      y -= line === 0 ? 17 : 14;
      lines.forEach((column, index) => { if (column[line]) cell(column[line], index, y, 10); });
    }
    y -= 9;
    rule(y);
  }
  if (content.total !== undefined) {
    if (y - 35 < margin + 140) tablePage();
    rule(y);
    y -= 23;
    text(`Total  ${content.total}`, width - margin - 6, y, 11, 'right');
    y -= 12;
  }
  if (content.deliveryTo.length) {
    if (y - 48 < margin + 140) newPage();
    y -= 24;
    text('Delivery to', margin, y, 9, 'left', grey);
    for (const line of content.deliveryTo) flowingText(line, 10);
  }
  rule(100, width - margin - 160);
  let signatureY = 85;
  for (const line of wrap(content.signature, 9, 160)) {
    text(line, width - margin - 160, signatureY, 9);
    signatureY -= 12;
  }
  text('Authorised signatory', width - margin - 160, signatureY, 9);
  const pages = doc.getPages();
  pages.forEach((entry, index) => {
    page = entry;
    text(`${content.poNumber} · Page ${index + 1} of ${pages.length}`, width / 2, 24, 8, 'center', grey);
  });
  return doc.save();
}
