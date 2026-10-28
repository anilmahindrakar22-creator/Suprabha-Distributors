import { expect, it } from 'vitest';
import { purchaseOrderShareText, validatePurchaseOrderCommand, type PurchaseOrder } from '../../lib/purchase-orders';

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
it('formats plain text share content without exposing rates', () => {
  const po: PurchaseOrder = { id, poNumber: 'PO/26-27/0001', supplierName: 'Supplier', status: 'open', sharedAt: null, version: 1, createdAt: '', createdByEmail: '', lines: [{ itemKey: 'x', itemName: 'Reagent', quantity: 2, unit: 'kit', receivedQuantity: 0, rate: 456.78 }], total: 913.56 };
  const message = purchaseOrderShareText(po);
  expect(message).toBe('Purchase order PO/26-27/0001\nSupplier: Supplier\nReagent — 2 kit\nSuprabha Distributors');
  expect(message).not.toMatch(/₹|\d+\.\d+|rate/i);
});
