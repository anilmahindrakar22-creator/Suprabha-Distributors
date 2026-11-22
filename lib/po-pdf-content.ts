import type { PurchaseOrder } from './purchase-orders';
import type { Letterhead } from './letterhead';
import { formatPaise } from './wallet-format';

export type PoPdfRow = { item: string; quantity: string; unit: string; rate?: string; amount?: string };
export type PoPdfContent = {
  companyName: string; letterheadLines: string[]; title: 'Purchase order';
  poNumber: string; date: string; supplier: string; showRates: boolean;
  columns: string[]; rows: PoPdfRow[]; total?: string;
  deliveryTo: string[]; signature: string; fileName: string;
};

const lines = (value: string) => value.split('\n').map((line) => line.trim()).filter(Boolean);

export function buildPoPdfContent(po: PurchaseOrder, letterhead: Letterhead | null): PoPdfContent {
  const companyName = letterhead?.companyName || 'Suprabha Distributors';
  const letterheadLines = letterhead ? [
    ...lines(letterhead.address),
    ...(letterhead.gstin ? [`GSTIN: ${letterhead.gstin}`] : []),
    ...(letterhead.phone ? [`Phone: ${letterhead.phone}`] : []),
  ] : [];
  const parsedDate = new Date(po.createdAt);
  const date = Number.isFinite(parsedDate.getTime())
    ? new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }).format(parsedDate)
    : '';
  const showRates = po.lines.length > 0 && po.lines.every((line) => Object.hasOwn(line, 'rate'));
  const columns = ['Item', 'Qty', 'Unit', ...(showRates ? ['Rate', 'Amount'] : [])];
  const rows = po.lines.map((line): PoPdfRow => {
    const row: PoPdfRow = {
      item: line.itemName,
      quantity: String(Math.round(line.quantity * 1000) / 1000),
      unit: line.unit ?? '',
    };
    if (showRates) {
      if (line.rate === null) {
        row.rate = '—';
        row.amount = '—';
      } else if (typeof line.rate === 'number' && Number.isFinite(line.rate)) {
        row.rate = formatPaise(Math.round(line.rate * 100));
        row.amount = formatPaise(Math.round(line.quantity * line.rate * 100));
      }
    }
    return row;
  });
  const content: PoPdfContent = {
    companyName, letterheadLines, title: 'Purchase order', poNumber: po.poNumber, date,
    supplier: po.supplierName, showRates, columns, rows,
    deliveryTo: letterhead ? (lines(letterhead.deliveryAddress).length ? lines(letterhead.deliveryAddress) : lines(letterhead.address)) : [],
    signature: `For ${companyName}`,
    fileName: `${po.poNumber.replaceAll('/', '-')}.pdf`,
  };
  if (showRates && typeof po.totalValue === 'number' && Number.isFinite(po.totalValue)) {
    content.total = formatPaise(Math.round(po.totalValue * 100));
  }
  return content;
}
