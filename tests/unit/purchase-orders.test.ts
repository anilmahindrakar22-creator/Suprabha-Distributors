import { expect, it } from 'vitest';
import { parsePurchaseOrderTallyQuery, purchaseOrderShareText, validatePurchaseOrderCommand, type PurchaseOrder } from '../../lib/purchase-orders';

const id = '35000000-0000-4000-8000-000000000001';
const create = { action: 'create_purchase_orders', payload: { idempotencyKey: id, lines: [{ itemKey: 'kit-1', quantity: 2, supplierName: 'Supplier A' }] } };
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
