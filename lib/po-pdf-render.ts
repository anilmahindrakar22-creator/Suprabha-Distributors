import { PDFDocument, rgb, type Color, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { PoPdfContent } from './po-pdf-content';

const FOOTER_RESERVE = 44;
const SIGNATURE_HEIGHT = 96;

// The origin is the top left; SVG coordinates run downwards inside the path.
function roundedRect(page: PDFPage, x: number, y: number, w: number, h: number, r: number,
  { fill, border }: { fill?: Color; border?: Color }) {
  page.drawSvgPath(`M ${r} 0 H ${w - r} Q ${w} 0 ${w} ${r} V ${h - r} Q ${w} ${h} ${w - r} ${h} H ${r} Q 0 ${h} 0 ${h - r} V ${r} Q 0 0 ${r} 0 Z`, {
    x, y, color: fill, borderColor: border, borderWidth: border ? 0.75 : 0,
  });
}

export async function renderPoPdf(content: PoPdfContent, fontBytes: Uint8Array | ArrayBuffer,
  boldFontBytes?: Uint8Array | ArrayBuffer | null): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(fontBytes, { subset: true });
  const bold = boldFontBytes ? await doc.embedFont(boldFontBytes, { subset: true }) : font;
  doc.setTitle(content.poNumber);
  doc.setCreator('StockFlow');
  const width = 595.28, height = 841.89, margin = 34, usable = width - margin * 2;
  const forest = rgb(0x09 / 255, 0x2f / 255, 0x36 / 255);
  const mint = rgb(0x64 / 255, 0xd4 / 255, 0xad / 255);
  const mintsoft = rgb(0xe2 / 255, 0xf8 / 255, 0xef / 255);
  const soft = rgb(0xf4 / 255, 0xf8 / 255, 0xf6 / 255);
  const line = rgb(0xdc / 255, 0xe7 / 255, 0xe5 / 255);
  const ink = rgb(0x17 / 255, 0x32 / 255, 0x39 / 255);
  const body = rgb(0x31 / 255, 0x58 / 255, 0x5d / 255);
  const muted = rgb(0x6b / 255, 0x7e / 255, 0x81 / 255);
  const pill = rgb(0xea / 255, 0xf8 / 255, 0xf1 / 255);
  const pilltext = rgb(0x12 / 255, 0x60 / 255, 0x44 / 255);
  const white = rgb(1, 1, 1);
  const characterSets = new Map([font, bold].map(face => [face, new Set(face.getCharacterSet())]));
  const encodedCharacters = new Map([font, bold].map(face => [face, new Map<string, string>()]));
  const safe = (value: string, face = font) => Array.from(value, character => {
    const cache = encodedCharacters.get(face)!;
    const cached = cache.get(character);
    if (cached !== undefined) return cached;
    let encoded = '?';
    try {
      face.encodeText(character);
      if (characterSets.get(face)!.has(character.codePointAt(0)!)) encoded = character;
    } catch { /* Unsupported characters retain the replacement. */ }
    cache.set(character, encoded);
    return encoded;
  }).join('');
  const measure = (value: string, size: number, face = font) => face.widthOfTextAtSize(safe(value, face), size);
  let page = doc.addPage([width, height]), y = height - margin;
  const text = (value: string, x: number, baseline: number, size: number, face = font, color = ink,
    align: 'left' | 'right' = 'left', opacity = 1) => {
    page.drawText(safe(value, face), { x: x - (align === 'right' ? measure(value, size, face) : 0),
      y: baseline, size, font: face, color, opacity });
  };
  const rule = (baseline: number, left = margin, right = width - margin, color = line, thickness = 0.75) => {
    page.drawLine({ start: { x: left, y: baseline }, end: { x: right, y: baseline }, color, thickness });
  };
  const wrap = (value: string, size: number, maxWidth: number, face: PDFFont = font): string[] => {
    const result: string[] = [];
    for (const paragraph of value.split(/\r?\n/)) {
      let current = '';
      for (const word of safe(paragraph, face).split(/\s+/).filter(Boolean)) {
        const candidate = current ? `${current} ${word}` : word;
        if (measure(candidate, size, face) <= maxWidth + 0.01) { current = candidate; continue; }
        if (current) { result.push(current); current = ''; }
        for (const character of word) {
          if (current && measure(current + character, size, face) > maxWidth + 0.01) { result.push(current); current = ''; }
          current += character;
        }
      }
      result.push(current);
    }
    return result;
  };
  const newPage = () => {
    page = doc.addPage([width, height]);
    y = height - margin;
    const lines = wrap(`Purchase order · ${content.poNumber}`, 10, usable - 24, bold);
    const barHeight = Math.max(30, lines.length * 14 + 16);
    roundedRect(page, margin, y, usable, barHeight, 10, { fill: forest });
    lines.forEach((value, index) => text(value, margin + 12, y - 19 - index * 14, 10, bold, white));
    y -= barHeight + 14;
  };
  const ensure = (space: number, bottom = 180) => { if (y - space < bottom) newPage(); };

  const headerHeight = content.logo ? 116 : 96;
  roundedRect(page, margin, y, usable, headerHeight, 14, { fill: forest });
  const headerTop = y, right = width - margin - 18;
  const numberWidth = Math.min(usable * 0.43, measure(content.poNumber, 10.5, bold) + 20);
  const numberLines = wrap(content.poNumber, 10.5, numberWidth - 20, bold);
  const numberHeight = numberLines.length * 14 + 8;
  roundedRect(page, right - numberWidth, y - 16, numberWidth, numberHeight, numberHeight / 2, { fill: mint });
  numberLines.forEach((value, index) => text(value, right - numberWidth + 10, y - 30 - index * 14, 10.5, bold, forest));
  text(content.date, right, y - 16 - numberHeight - 17, 9.5, font, white, 'right', 0.8);
  let brandX = margin + 18;
  if (content.logo) {
    // Own the byte range: Node Buffers can be views into a pooled ArrayBuffer.
    const bytes = new Uint8Array(content.logo.bytes);
    const logo = content.logo.type === 'image/png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
    const tileSize = 38, tileX = brandX, tileY = headerTop - 57;
    roundedRect(page, tileX, tileY + tileSize, tileSize, tileSize, 9, { fill: white });
    const scale = Math.min((tileSize - 8) / logo.width, (tileSize - 8) / logo.height);
    page.drawImage(logo, { x: tileX + (tileSize - logo.width * scale) / 2,
      y: tileY + (tileSize - logo.height * scale) / 2, width: logo.width * scale, height: logo.height * scale });
    brandX += tileSize + 10;
  }
  wrap(content.companyName.toUpperCase(), 8.5, right - numberWidth - brandX - 14, bold)
    .forEach((value, index, values) => {
      const textY = brandX === margin + 18 ? headerTop - 29 : headerTop - 38 + (values.length - 1) * 5.5;
      text(value, brandX, textY - index * 11, 8.5, bold, white);
    });
  text('Purchase order', margin + 18, headerTop - (content.logo ? 98 : 77), 24, bold, white);
  y -= headerHeight + 8;
  if (content.letterheadLines.length) {
    for (const value of wrap(content.letterheadLines.join(' · '), 8.5, usable)) {
      ensure(12); y -= 12; text(value, margin, y, 8.5, font, muted);
    }
  }
  y -= 16;
  const cardWidth = (usable - 10) / 2;
  const supplier = wrap(content.supplier, 10, cardWidth - 24, bold);
  const delivery = wrap(content.deliveryTo.join(', ') || '—', 10, cardWidth - 24, bold);
  const cardHeight = 37 + Math.max(supplier.length, delivery.length) * 14;
  ensure(cardHeight + 14);
  for (const [index, label, values] of [[0, 'SUPPLIER', supplier], [1, 'DELIVER TO', delivery]] as const) {
    const x = margin + index * (cardWidth + 10);
    roundedRect(page, x, y, cardWidth, cardHeight, 10, { fill: soft, border: line });
    text(label, x + 12, y - 19, 7.5, bold, muted);
    values.forEach((value, i) => text(value, x + 12, y - 35 - i * 14, 10, bold));
  }
  y -= cardHeight + 14;

  let panelTop = y;
  const openPanel = (continued = false) => {
    ensure(70, 210);
    panelTop = y;
    text(continued ? 'Items (continued)' : 'Items', margin + 12, y - 22, 11, bold);
    text(`${content.rows.length} items`, width - margin - 12, y - 22, 9, font, muted, 'right');
    y -= 36;
    rule(y);
  };
  const closePanel = () => roundedRect(page, margin, panelTop, usable, panelTop - y, 12, { border: line });
  const continuePanel = () => { closePanel(); newPage(); openPanel(true); };
  openPanel();
  for (const [rowIndex, row] of content.rows.entries()) {
    const quantity = [row.quantity, row.unit].filter(Boolean).join(' ');
    const pillWidth = Math.min(120, measure(quantity, 9, bold) + 18);
    const quantityLines = wrap(quantity, 9, pillWidth - 18, bold);
    const amountWidth = content.showRates ? Math.max(80, Math.min(130, measure(row.amount ?? '', 10, bold))) : 0;
    const pillRight = width - margin - 12 - (content.showRates ? amountWidth + 14 : 0);
    const nameWidth = pillRight - pillWidth - margin - 26;
    const nameLines = wrap(row.item, 10, nameWidth);
    const rateLines = content.showRates && row.rate !== undefined
      ? wrap(`${row.rate}${row.unit ? ` per ${row.unit}` : ''}`, 8.5, nameWidth) : [];
    const leftLines = [...nameLines.map(value => ({ value, size: 10, color: ink })),
      ...rateLines.map(value => ({ value, size: 8.5, color: muted }))];
    const amountLines = content.showRates ? wrap(row.amount ?? '', 10, amountWidth, bold) : [];
    const count = Math.max(leftLines.length, quantityLines.length, amountLines.length);
    if (y - (count * 14 + 20) < 210 && y < panelTop - 36) continuePanel();
    let offset = 0;
    while (offset < count) {
      const capacity = Math.floor((y - 210 - 20) / 14);
      if (capacity < 1) { continuePanel(); continue; }
      const take = Math.min(capacity, count - offset), rowHeight = take * 14 + 20;
      const qty = quantityLines.slice(offset, offset + take);
      if (qty.length) {
        const pillHeight = qty.length * 14 + 6, pillTop = y - (rowHeight - pillHeight) / 2;
        roundedRect(page, pillRight - pillWidth, pillTop, pillWidth, pillHeight, pillHeight / 2, { fill: pill });
        qty.forEach((value, i) => text(value, pillRight - pillWidth + 9, pillTop - 13 - i * 14, 9, bold, pilltext));
      }
      for (let i = 0; i < take; i++) {
        const entry = leftLines[offset + i];
        if (entry) text(entry.value, margin + 12, y - 20 - i * 14, entry.size, font, entry.color);
        if (amountLines[offset + i]) {
          const baseline = amountLines.length === 1 ? y - rowHeight / 2 - 3.5 : y - 20 - i * 14;
          text(amountLines[offset + i], width - margin - 12, baseline, 10, bold, ink, 'right');
        }
      }
      y -= rowHeight;
      offset += take;
      if (offset < count) continuePanel();
    }
    if (rowIndex < content.rows.length - 1) rule(y, margin + 1, width - margin - 1);
  }
  closePanel();
  y -= 14;
  if (content.showRates && content.total !== undefined) {
    const words = wrap(content.amountInWords ?? '', 8.5, (usable - 28) * 0.6);
    const totalHeight = Math.max(50, words.length * 12 + 28);
    ensure(totalHeight);
    roundedRect(page, margin, y, usable, totalHeight, 12, { fill: forest });
    words.forEach((value, i) => text(value, margin + 14, y - 22.5 - i * 12, 8.5, font, white, 'left', 0.8));
    text(content.total, width - margin - 14, y - totalHeight / 2 - 6, 18, bold, white, 'right');
    y -= totalHeight;
  }
  y -= 6;
  for (const value of wrap(content.gstNote, 8.5, usable)) {
    ensure(12); y -= 12; text(value, margin + 2, y, 8.5, font, muted);
  }
  y -= 14;
  const instructions = content.instructions.flatMap((value, index) => wrap(`${index + 1}. ${value}`, 9, usable - 24));
  const signatureLines = wrap(content.signature, 9.5, 190);
  const signatureExtra = (signatureLines.length - 1) * 14;
  const signatureHeight = SIGNATURE_HEIGHT + signatureExtra;
  const contentBottom = margin + FOOTER_RESERVE;
  const continuationTop = height - margin - Math.max(30,
    wrap(`Purchase order · ${content.poNumber}`, 10, usable - 24, bold).length * 14 + 16) - 14;
  let instructionOffset = 0;
  const drawInstructions = (take: number) => {
    const panelHeight = 44 + take * 14;
    roundedRect(page, margin, y, usable, panelHeight, 12, { fill: mintsoft });
    text(instructionOffset ? 'Instructions (continued)' : 'Instructions', margin + 12, y - 21, 9.5, bold);
    instructions.slice(instructionOffset, instructionOffset + take).forEach((value, i) => text(value, margin + 12, y - 39 - i * 14, 9, font, body));
    y -= panelHeight;
    instructionOffset += take;
  };
  do {
    const remaining = instructions.length - instructionOffset;
    const panelHeight = 44 + remaining * 14;
    if (y - panelHeight - signatureHeight >= contentBottom) {
      drawInstructions(remaining);
      break;
    }
    if (y - panelHeight >= contentBottom) {
      drawInstructions(remaining);
      newPage();
      break;
    }
    // Keep a panel intact when it fits on a fresh page, rather than orphaning its last line.
    if (continuationTop - panelHeight >= contentBottom) {
      newPage();
      continue;
    }
    const take = Math.max(0, Math.floor((y - contentBottom - 44) / 14));
    if (take > 0) drawInstructions(take);
    newPage();
  } while (instructionOffset < instructions.length);

  // In PDF coordinates the lower of these positions leaves the signature low on the page,
  // while preserving at least 24 pt below the instructions panel.
  const signatureTop = Math.min(140 + signatureExtra, y - 24);
  signatureLines.forEach((value, i) => text(value, width - margin - 190, signatureTop - i * 14, 9.5, font, body));
  const signatureRule = signatureTop - signatureExtra - 50;
  rule(signatureRule, width - margin - 190, width - margin, forest, 1.5);
  text('Authorised signatory', width - margin - 190, signatureRule - 16, 8.5, font, muted);
  const footer = content.footer || 'Computer-generated purchase order';
  const brandedFooter = /StockFlow/i.test(footer) ? footer : `${footer} · StockFlow`;
  const pages = doc.getPages();
  pages.forEach((entry, index) => {
    page = entry;
    rule(42);
    text(brandedFooter, margin, 26, 7.5, font, muted);
    text(`Page ${index + 1} of ${pages.length}`, width - margin, 26, 7.5, font, muted, 'right');
  });
  return doc.save();
}
