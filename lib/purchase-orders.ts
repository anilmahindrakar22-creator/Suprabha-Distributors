export type CorrectionReason = 'typing_mistake' | 'supplier_changed' | 'requirement_changed';
export type PendingCorrection = { requestId: string; itemKey: string; fromQuantity: number; toQuantity: number; reasonCode: CorrectionReason; note: string; requestedByEmail: string; requestedAt: string };
export type AppliedCorrection = { itemKey: string; fromQuantity: number; toQuantity: number; reasonCode: CorrectionReason; note: string; requestedByEmail: string; approvedByEmail: string | null; recordedAt: string };
export type PoCorrectionsWeek = { view: 'po_corrections'; since: string; items: Array<{ poId: string; poNumber: string; supplierName: string; status: PurchaseOrder['status']; createdByEmail: string; corrections: number; pending: number; flags: { byCreator: boolean; moreThanTwo: boolean; beforeReceipt: boolean; notResent: boolean } }> };
export type PurchaseOrderLine = { itemKey: string; itemName: string; quantity: number; unit: string | null; receivedQuantity: number; rate?: number | null; originalQuantity?: number; locked?: boolean };
export type PurchaseOrder = { id: string; poNumber: string; supplierName: string; status: 'open' | 'received' | 'cancelled'; sharedAt: string | null; version: number; createdAt: string; createdByEmail: string; lines: PurchaseOrderLine[]; totalValue?: number | null; revisionCount?: number; resendNeeded?: boolean; supplierConfirmedAt?: string | null; pendingCorrections?: PendingCorrection[]; corrections?: AppliedCorrection[] };
export type SupplierOption = { supplierName: string; effectiveAt: string; lowest: boolean; rate?: number };

export const CORRECTION_REASONS: ReadonlyArray<{ code: CorrectionReason; label: string }> = [
  { code: 'typing_mistake', label: 'Typing mistake' },
  { code: 'supplier_changed', label: 'Supplier changed quantity' },
  { code: 'requirement_changed', label: 'Requirement changed' },
];
export function correctionAppliesNow(po: PurchaseOrder, line: PurchaseOrderLine, quantity: number): boolean {
  return !po.sharedAt && (quantity < line.quantity || quantity <= (line.originalQuantity ?? line.quantity) * 1.2);
}

export type BatchReceiptResult =
  | { ok: true; lines: Array<{ itemKey: string; receivedQuantity: number }> }
  | { ok: false; errors: Record<string, string> };

export function stillDue(line: PurchaseOrderLine): number {
  return Math.round((line.quantity - line.receivedQuantity) * 1000) / 1000;
}

export function batchReceiptTotals(lines: PurchaseOrderLine[], now: Record<string, string>): BatchReceiptResult {
  const errors: Record<string, string> = {};
  let allZero = true;
  const totals = lines.map((line) => {
    const still = stillDue(line);
    const value = Number(now[line.itemKey]?.trim() || 0);
    if (value !== 0) allZero = false;
    const total = Math.round((line.receivedQuantity + value) * 1000) / 1000;
    if (!Number.isFinite(value) || value < 0) errors[line.itemKey] = 'Enter 0 or more';
    else if (total > line.quantity) errors[line.itemKey] = `More than still due (${still})`;
    return { itemKey: line.itemKey, receivedQuantity: total };
  });
  if (Object.keys(errors).length) return { ok: false, errors };
  if (allZero) return { ok: false, errors: { _: 'Enter what arrived in this delivery' } };
  return { ok: true, lines: totals };
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isUuid = (value: unknown) => typeof value === 'string' && uuid.test(value);
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).every((k) => keys.includes(k));
const text = (v: unknown, max: number, min = 1) => typeof v === 'string' && v.trim().length >= min && v.trim().length <= max;
const qty = (v: unknown, positive = false) => typeof v === 'number' && Number.isFinite(v) && v >= (positive ? Number.MIN_VALUE : 0) && v <= 1_000_000;
export function parsePoCorrectionsWeek(value: unknown): PoCorrectionsWeek {
  const count = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 0;
  if (!record(value) || value.view !== 'po_corrections' || typeof value.since !== 'string' || !Array.isArray(value.items) || value.items.length > 100 || !value.items.every((item) =>
    record(item) && isUuid(item.poId) && typeof item.poNumber === 'string' && typeof item.supplierName === 'string' &&
    ['open', 'received', 'cancelled'].includes(item.status as string) && typeof item.createdByEmail === 'string' && count(item.corrections) && count(item.pending) &&
    record(item.flags) && typeof item.flags.byCreator === 'boolean' && typeof item.flags.moreThanTwo === 'boolean' && typeof item.flags.beforeReceipt === 'boolean' && typeof item.flags.notResent === 'boolean'
  )) throw new Error('Invalid corrections list');
  return value as PoCorrectionsWeek;
}
export function parsePurchaseOrderTallyQuery(params: URLSearchParams): { action: 'get_tally_receipts' | 'get_tally_receipt_counts'; payload: Record<string, unknown> } | null {
  if (params.size !== 1) return null;
  const ids = params.getAll('tallyReceiptCounts');
  if (ids.length === 1) {
    const values = ids[0].split(',');
    if (values.length < 1 || values.length > 20 || !values.every(isUuid)) return null;
    return { action: 'get_tally_receipt_counts', payload: { ids: values } };
  }
  const receiptIds = params.getAll('tallyReceipts');
  if (receiptIds.length !== 1 || !isUuid(receiptIds[0])) return null;
  return { action: 'get_tally_receipts', payload: { id: receiptIds[0] } };
}
function distinctLines(value: unknown, kind: 'create' | 'receive') {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) return false;
  const seen = new Set<string>();
  return value.every((line) => {
    if (!record(line) || !exact(line, kind === 'create' ? ['itemKey', 'quantity', 'supplierName'] : ['itemKey', 'receivedQuantity'])) return false;
    if (!text(line.itemKey, 220) || seen.has(line.itemKey as string)) return false;
    seen.add(line.itemKey as string);
    return kind === 'create' ? qty(line.quantity, true) && (line.supplierName === undefined || text(line.supplierName, 220)) : qty(line.receivedQuantity);
  });
}

export function validatePurchaseOrderCommand(value: unknown): { action: string; payload: Record<string, unknown> } | null {
  if (!record(value) || !exact(value, ['action', 'payload']) || !record(value.payload)) return null;
  const { action, payload } = value;
  if (action === 'create_purchase_orders') {
    if (!exact(payload, ['idempotencyKey', 'lines']) || !isUuid(payload.idempotencyKey) || !distinctLines(payload.lines, 'create')) return null;
  } else if (action === 'receive_from_tally') {
    if (!exact(payload, ['id', 'idempotencyKey', 'expectedVersion', 'links']) || !isUuid(payload.id) || !isUuid(payload.idempotencyKey) || !Number.isInteger(payload.expectedVersion) || (payload.expectedVersion as number) < 1 || (payload.expectedVersion as number) > 2_147_483_647 || !Array.isArray(payload.links) || payload.links.length < 1 || payload.links.length > 100) return null;
    const seen = new Set<string>();
    for (const link of payload.links) {
      if (!record(link) || !exact(link, ['itemKey', 'sourceId', 'lineKey']) || !text(link.itemKey, 240) || !text(link.sourceId, 240) || !text(link.lineKey, 240)) return null;
      const tuple = JSON.stringify([link.itemKey, link.sourceId, link.lineKey]);
      if (seen.has(tuple)) return null;
      seen.add(tuple);
    }
  } else if (action === 'request_po_quantity_correction' || action === 'decide_po_quantity_correction' || action === 'confirm_purchase_order_supplier') {
    const keys = action === 'request_po_quantity_correction' ? ['id', 'expectedVersion', 'itemKey', 'quantity', 'reasonCode', 'note', 'idempotencyKey'] : action === 'decide_po_quantity_correction' ? ['requestId', 'expectedVersion', 'decision', 'note', 'idempotencyKey'] : ['id', 'expectedVersion', 'note', 'idempotencyKey'];
    if (!exact(payload, keys) || !isUuid(action === 'decide_po_quantity_correction' ? payload.requestId : payload.id) || !isUuid(payload.idempotencyKey) || !Number.isInteger(payload.expectedVersion) || (payload.expectedVersion as number) < 1 || (payload.expectedVersion as number) > 2_147_483_647) return null;
    if (action === 'request_po_quantity_correction') {
      if (!text(payload.itemKey, 220) || !qty(payload.quantity, true) || !CORRECTION_REASONS.some(reason => reason.code === payload.reasonCode) || !text(payload.note, 300, 3)) return null;
    } else {
      if (action === 'decide_po_quantity_correction' && payload.decision !== 'approve' && payload.decision !== 'reject') return null;
      if ('note' in payload && !text(payload.note, action === 'confirm_purchase_order_supplier' ? 200 : 300)) return null;
    }
  } else if (action === 'mark_purchase_order_shared' || action === 'receive_purchase_order' || action === 'cancel_purchase_order') {
    const keys = action === 'mark_purchase_order_shared' ? ['id', 'idempotencyKey', 'expectedVersion', 'channel'] : action === 'receive_purchase_order' ? ['id', 'idempotencyKey', 'expectedVersion', 'lines'] : ['id', 'idempotencyKey', 'expectedVersion', 'reason'];
    if (!exact(payload, keys) || !isUuid(payload.id) || !isUuid(payload.idempotencyKey) || !Number.isInteger(payload.expectedVersion) || (payload.expectedVersion as number) < 1 || (payload.expectedVersion as number) > 2_147_483_647) return null;
    if (action === 'receive_purchase_order' && !distinctLines(payload.lines, 'receive')) return null;
    if (action === 'mark_purchase_order_shared' && 'channel' in payload && payload.channel !== 'text' && payload.channel !== 'pdf') return null;
    if (action === 'cancel_purchase_order' && !text(payload.reason, 300, 3)) return null;
  } else return null;
  return { action, payload };
}

export function purchaseOrderShareText(po: PurchaseOrder) {
  return [`Purchase order ${po.poNumber}`, `Supplier: ${po.supplierName}`, ...po.lines.map((line) => `${line.itemName} — ${line.quantity} ${line.unit ?? ''}`), 'Suprabha Distributors'].join('\n');
}
