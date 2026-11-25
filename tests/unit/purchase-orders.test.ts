import { expect, it } from 'vitest';
import { batchReceiptTotals, correctionAppliesNow, parsePoCorrectionsWeek, parsePurchaseOrderTallyQuery, purchaseOrderShareText, stillDue, validatePurchaseOrderCommand, type PurchaseOrder, type PurchaseOrderLine } from '../../lib/purchase-orders';

const batchLine: PurchaseOrderLine = { itemKey: 'kit-1', itemName: 'Kit', quantity: 10, receivedQuantity: 6, unit: 'kit' };
it('adds this delivery to the previously received quantity', () => {
  expect(batchReceiptTotals([batchLine], { 'kit-1': '4' })).toEqual({ ok: true, lines: [{ itemKey: 'kit-1', receivedQuantity: 10 }] });
});
it('rejects a delivery larger than the quantity still due', () => {
  expect(batchReceiptTotals([batchLine], { 'kit-1': '5' })).toEqual({ ok: false, errors: { 'kit-1': 'More than still due (4)' } });
});
it('requires something to have arrived, treating blank, whitespace and missing inputs as zero', () => {
  const inputs: Record<string, string>[] = [{ 'kit-1': '' }, { 'kit-1': '   ' }, {}, { 'kit-1': '0' }];
  for (const now of inputs) {
    expect(batchReceiptTotals([batchLine], now)).toEqual({ ok: false, errors: { _: 'Enter what arrived in this delivery' } });
  }
});
it('rejects negative and non-finite delivery quantities', () => {
  for (const value of ['-1', 'Infinity', 'NaN', 'invalid']) {
    expect(batchReceiptTotals([batchLine], { 'kit-1': value })).toEqual({ ok: false, errors: { 'kit-1': 'Enter 0 or more' } });
  }
});
it('rounds fractional receipt totals to three decimal places', () => {
  expect(batchReceiptTotals([{ ...batchLine, quantity: 0.3, receivedQuantity: 0.1 }], { 'kit-1': '0.2' })).toEqual({ ok: true, lines: [{ itemKey: 'kit-1', receivedQuantity: 0.3 }] });
});
it('rounds the remaining quantity and reports fractional over-delivery cleanly', () => {
  const line = { ...batchLine, quantity: 0.3, receivedQuantity: 0.1 };
  expect(stillDue(line)).toBe(0.2);
  expect(batchReceiptTotals([line], { 'kit-1': '0.3' })).toEqual({ ok: false, errors: { 'kit-1': 'More than still due (0.2)' } });
});
it('returns untouched lines with unchanged totals in purchase order line order', () => {
  expect(batchReceiptTotals([batchLine, { ...batchLine, itemKey: 'kit-2', receivedQuantity: 2 }], { 'kit-1': '4' })).toEqual({
    ok: true, lines: [{ itemKey: 'kit-1', receivedQuantity: 10 }, { itemKey: 'kit-2', receivedQuantity: 2 }],
  });
});

const id = '35000000-0000-4000-8000-000000000001';
const create = { action: 'create_purchase_orders', payload: { idempotencyKey: id, lines: [{ itemKey: 'kit-1', quantity: 2, supplierName: 'Supplier A' }] } };
it('validates exact correction and supplier confirmation commands', () => {
  const request = { action: 'request_po_quantity_correction', payload: { id, expectedVersion: 1, itemKey: 'kit-1', quantity: 12, reasonCode: 'typing_mistake', note: '  Fix quantity  ', idempotencyKey: id } };
  const decide = { action: 'decide_po_quantity_correction', payload: { requestId: id, expectedVersion: 1, decision: 'approve', idempotencyKey: id } };
  const confirm = { action: 'confirm_purchase_order_supplier', payload: { id, expectedVersion: 1, idempotencyKey: id } };
  for (const command of [request, decide, confirm]) {
    expect(validatePurchaseOrderCommand(command)).toEqual(command);
    for (const patch of [{ extra: true }, { expectedVersion: 0 }, { expectedVersion: 1.5 }, { expectedVersion: 2_147_483_648 }, { idempotencyKey: 'bad' }]) {
      expect(validatePurchaseOrderCommand({ ...command, payload: { ...command.payload, ...patch } })).toBeNull();
    }
    expect(validatePurchaseOrderCommand({ ...command, payload: { ...command.payload, expectedVersion: 2_147_483_647 } })).not.toBeNull();
    for (const key of Object.keys(command.payload)) {
      const payload: Record<string, unknown> = { ...command.payload };
      delete payload[key];
      expect(validatePurchaseOrderCommand({ ...command, payload })).toBeNull();
    }
  }
  for (const patch of [{ reasonCode: 'bad' }, { note: 'ab' }, { note: '  ab  ' }, { note: 'x'.repeat(301) }, { quantity: 0 }, { quantity: -1 }, { quantity: 1_000_001 }, { quantity: Infinity }, { quantity: '12' }, { itemKey: '' }, { itemKey: 'x'.repeat(221) }, { id: 'bad' }]) {
    expect(validatePurchaseOrderCommand({ ...request, payload: { ...request.payload, ...patch } })).toBeNull();
  }
  for (const reasonCode of ['typing_mistake', 'supplier_changed', 'requirement_changed']) {
    expect(validatePurchaseOrderCommand({ ...request, payload: { ...request.payload, reasonCode, quantity: 1_000_000, note: 'x'.repeat(300), itemKey: 'x'.repeat(220) } })).not.toBeNull();
  }
  for (const decision of ['approve', 'reject']) expect(validatePurchaseOrderCommand({ ...decide, payload: { ...decide.payload, decision, note: 'x'.repeat(300) } })).not.toBeNull();
  for (const patch of [{ decision: 'bad' }, { requestId: 'bad' }, { note: '' }, { note: null }, { note: 'x'.repeat(301) }]) {
    expect(validatePurchaseOrderCommand({ ...decide, payload: { ...decide.payload, ...patch } })).toBeNull();
  }
  expect(validatePurchaseOrderCommand({ ...confirm, payload: { ...confirm.payload, note: 'x'.repeat(200) } })).not.toBeNull();
  for (const patch of [{ id: 'bad' }, { note: '' }, { note: null }, { note: 'x'.repeat(201) }]) {
    expect(validatePurchaseOrderCommand({ ...confirm, payload: { ...confirm.payload, ...patch } })).toBeNull();
  }
});
it('accepts only text or pdf when a share channel is present', () => {
  const command = { action: 'mark_purchase_order_shared', payload: { id, idempotencyKey: id, expectedVersion: 1 } };
  for (const channel of ['text', 'pdf']) expect(validatePurchaseOrderCommand({ ...command, payload: { ...command.payload, channel } })).not.toBeNull();
  for (const channel of ['email', '', null, undefined, 1]) expect(validatePurchaseOrderCommand({ ...command, payload: { ...command.payload, channel } })).toBeNull();
  expect(validatePurchaseOrderCommand({ ...command, payload: { ...command.payload, channel: 'text', extra: true } })).toBeNull();
});
it('uses the original quantity and share status for advisory correction timing', () => {
  const po: PurchaseOrder = { id, poNumber: 'PO1', supplierName: 'Supplier', status: 'open', sharedAt: null, version: 1, createdAt: '', createdByEmail: '', lines: [batchLine] };
  expect(correctionAppliesNow(po, batchLine, 9)).toBe(true);
  expect(correctionAppliesNow(po, batchLine, 12)).toBe(true);
  expect(correctionAppliesNow(po, batchLine, 12.1)).toBe(false);
  expect(correctionAppliesNow({ ...po, sharedAt: '2027-01-03' }, batchLine, 9)).toBe(false);
  const corrected = { ...batchLine, quantity: 11, originalQuantity: 10 };
  expect(correctionAppliesNow(po, corrected, 12)).toBe(true);
  expect(correctionAppliesNow(po, corrected, 12.1)).toBe(false);
});
it('strictly parses the bounded weekly corrections list and its counts and flags', () => {
  const item = { poId: id, poNumber: 'PO1', supplierName: 'Supplier', status: 'open', createdByEmail: 'sales@example.test', corrections: 0, pending: 1, flags: { byCreator: true, moreThanTwo: false, beforeReceipt: true, notResent: false } };
  const value = { view: 'po_corrections', since: '2027-01-01', items: [item] };
  expect(parsePoCorrectionsWeek(value)).toEqual(value);
  expect(parsePoCorrectionsWeek({ ...value, items: [] }).items).toEqual([]);
  expect(parsePoCorrectionsWeek({ ...value, items: Array(100).fill(item) }).items).toHaveLength(100);
  for (const invalid of [null, [], {}, { ...value, view: 'other' }, { ...value, since: null }, { ...value, items: {} }, { ...value, items: Array(101).fill(item) }]) {
    expect(() => parsePoCorrectionsWeek(invalid)).toThrow('Invalid corrections list');
  }
  for (const patch of [{ poId: 'bad' }, { poNumber: null }, { supplierName: 1 }, { status: 'bad' }, { createdByEmail: null }, { corrections: -1 }, { corrections: 0.5 }, { corrections: Infinity }, { pending: -1 }, { pending: 0.5 }, { pending: '1' }, { flags: null }, { flags: { ...item.flags, byCreator: 'true' } }]) {
    expect(() => parsePoCorrectionsWeek({ ...value, items: [{ ...item, ...patch }] })).toThrow('Invalid corrections list');
  }
  for (const key of Object.keys(item)) {
    const incomplete: Record<string, unknown> = { ...item };
    delete incomplete[key];
    expect(() => parsePoCorrectionsWeek({ ...value, items: [incomplete] })).toThrow('Invalid corrections list');
  }
  for (const key of Object.keys(item.flags)) {
    const flags: Record<string, unknown> = { ...item.flags };
    delete flags[key];
    expect(() => parsePoCorrectionsWeek({ ...value, items: [{ ...item, flags }] })).toThrow('Invalid corrections list');
  }
});
it('accepts a valid create command and enforces UUIDs, bounds, and distinct items', () => {
  expect(validatePurchaseOrderCommand(create)).toEqual(create);
  expect(validatePurchaseOrderCommand({ ...create, payload: { ...create.payload, idempotencyKey: [id] } })).toBeNull();
  expect(validatePurchaseOrderCommand({ ...create, payload: { idempotencyKey: id, lines: [{ itemKey: 'kit-1', quantity: 2 }] } })).not.toBeNull();
  expect(validatePurchaseOrderCommand({ ...create, payload: { ...create.payload, idempotencyKey: 'bad' } })).toBeNull();
  expect(validatePurchaseOrderCommand({ ...create, payload: { ...create.payload, lines: [...create.payload.lines, ...create.payload.lines] } })).toBeNull();
  expect(validatePurchaseOrderCommand({ ...create, payload: { ...create.payload, extra: true } })).toBeNull();
  expect(validatePurchaseOrderCommand({ ...create, payload: { ...create.payload, lines: [{ ...create.payload.lines[0], quantity: Infinity }] } })).toBeNull();
  expect(validatePurchaseOrderCommand({ ...create, payload: { ...create.payload, lines: [{ itemKey: 'kit-1', quantity: 0 }] } })).toBeNull();
  expect(validatePurchaseOrderCommand({ ...create, payload: { ...create.payload, lines: [{ itemKey: 'kit-1', quantity: 1_000_001 }] } })).toBeNull();
  expect(validatePurchaseOrderCommand({ ...create, payload: { ...create.payload, lines: Array.from({ length: 101 }, (_, i) => ({ itemKey: `item-${i}`, quantity: 1 })) } })).toBeNull();
  expect(validatePurchaseOrderCommand({ ...create, payload: { ...create.payload, lines: [{ itemKey: 'kit-1', quantity: '2' }] } })).toBeNull();
  expect(validatePurchaseOrderCommand({ ...create, payload: { ...create.payload, lines: [{ itemKey: 'kit-1', quantity: 1, itemName: 'client supplied' }] } })).toBeNull();
  expect(validatePurchaseOrderCommand({ ...create, payload: { idempotencyKey: id } })).toBeNull();
  expect(validatePurchaseOrderCommand({ ...create, payload: { ...create.payload, supplierName: 'payload level supplier' } })).toBeNull();
  expect(validatePurchaseOrderCommand({ ...create, payload: { ...create.payload, lines: [{ itemKey: 'kit-1', quantity: 1, supplierName: 4 }] } })).toBeNull();
  expect(validatePurchaseOrderCommand({ ...create, payload: { ...create.payload, lines: [{ itemKey: 'kit-1', quantity: 1, supplierName: 's'.repeat(221) }] } })).toBeNull();
});
it('validates receive, shared, and cancellation command requirements', () => {
  expect(validatePurchaseOrderCommand({ action: 'mark_purchase_order_shared', payload: { id, idempotencyKey: id, expectedVersion: 1 } })).not.toBeNull();
  expect(validatePurchaseOrderCommand({ action: 'mark_purchase_order_shared', payload: { id, idempotencyKey: id, expectedVersion: 2_147_483_647 } })).not.toBeNull();
  expect(validatePurchaseOrderCommand({ action: 'mark_purchase_order_shared', payload: { id, idempotencyKey: id, expectedVersion: 2_147_483_648 } })).toBeNull();
  expect(validatePurchaseOrderCommand({ action: 'receive_purchase_order', payload: { id, idempotencyKey: id, expectedVersion: 1, lines: [{ itemKey: 'kit-1', receivedQuantity: 0 }] } })).not.toBeNull();
  expect(validatePurchaseOrderCommand({ action: 'receive_purchase_order', payload: { id, idempotencyKey: id, expectedVersion: 1, lines: [{ itemKey: 'kit-1', receivedQuantity: 0 }, { itemKey: 'kit-1', receivedQuantity: 1 }] } })).toBeNull();
  expect(validatePurchaseOrderCommand({ action: 'cancel_purchase_order', payload: { id, idempotencyKey: id, expectedVersion: 1, reason: 'okay' } })).not.toBeNull();
  expect(validatePurchaseOrderCommand({ action: 'cancel_purchase_order', payload: { id, idempotencyKey: id, expectedVersion: 1, reason: 'x' } })).toBeNull();
});
it('validates bounded Tally receipt links and rejects malformed or duplicate tuples', () => {
  const sourceId = 'tally-voucher-123';
  const command = { action: 'receive_from_tally', payload: { id, expectedVersion: 1, idempotencyKey: id, links: [{ itemKey: 'item-1', sourceId, lineKey: 'line-1' }] } };
  expect(validatePurchaseOrderCommand(command)).toEqual(command);
  for (const payload of [
    { ...command.payload, id: 'bad' },
    { ...command.payload, idempotencyKey: 'bad' },
    { ...command.payload, expectedVersion: 0 },
    { ...command.payload, expectedVersion: 1.5 },
    { ...command.payload, links: [] },
    { ...command.payload, links: Array.from({ length: 101 }, (_, i) => ({ itemKey: `item-${i}`, sourceId, lineKey: `line-${i}` })) },
    { ...command.payload, links: [{ itemKey: 'x', sourceId: '', lineKey: 'line' }] },
    { ...command.payload, links: [{ itemKey: 'x', sourceId: 's'.repeat(241), lineKey: 'line' }] },
    { ...command.payload, links: [{ itemKey: 'x', sourceId, lineKey: '' }] },
    { ...command.payload, links: [{ itemKey: 'x'.repeat(241), sourceId, lineKey: 'line' }] },
    { ...command.payload, links: [{ itemKey: 'item-1', sourceId, lineKey: 'line-1' }, { itemKey: 'item-1', sourceId, lineKey: 'line-1' }] },
    { ...command.payload, links: [{ itemKey: 'item-1', sourceId, lineKey: 'line-1', extra: true }] },
  ]) expect(validatePurchaseOrderCommand({ ...command, payload })).toBeNull();
});
it('validates Tally receipt read queries and UUID count bounds', () => {
  const other = '35000000-0000-4000-8000-000000000003';
  expect(parsePurchaseOrderTallyQuery(new URLSearchParams(`tallyReceipts=${id}`))).toEqual({ action: 'get_tally_receipts', payload: { id } });
  expect(parsePurchaseOrderTallyQuery(new URLSearchParams(`tallyReceiptCounts=${id},${other}`))).toEqual({ action: 'get_tally_receipt_counts', payload: { ids: [id, other] } });
  for (const query of [`tallyReceipts=bad`, `tallyReceiptCounts=${id},bad`, `tallyReceiptCounts=${Array(21).fill(id).join(',')}`, `tallyReceipts=${id}&page=1`, `tallyReceipts=${id}&tallyReceipts=${id}`]) expect(parsePurchaseOrderTallyQuery(new URLSearchParams(query))).toBeNull();
});
it('formats plain text share content without exposing rates', () => {
  const po: PurchaseOrder = { id, poNumber: 'PO/26-27/0001', supplierName: 'Supplier', status: 'open', sharedAt: null, version: 1, createdAt: '', createdByEmail: '', lines: [{ itemKey: 'x', itemName: 'Reagent', quantity: 2, unit: 'kit', receivedQuantity: 0, rate: 456.78 }], totalValue: 913.56 };
  const message = purchaseOrderShareText(po);
  expect(message).toBe('Purchase order PO/26-27/0001\nSupplier: Supplier\nReagent — 2 kit\nSuprabha Distributors');
  expect(message).not.toMatch(/₹|\d+\.\d+|rate/i);
});
