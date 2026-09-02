import { describe, expect, it } from 'vitest';
import { validateInventoryCommand } from '../../lib/inventory-types';

const requestId = 'inventory-request-0001';

describe('inventory command validation', () => {
  it('accepts a batch receipt and a reasoned adjustment', () => {
    expect(validateInventoryCommand({ action: 'receive_stock', payload: { idempotencyKey: requestId, tallyKey: 'ITEM-1', batchNumber: 'LOT-10', expiryDate: '2027-12-31', quantity: 12, locationCode: 'MAIN' } })).not.toBeNull();
    expect(validateInventoryCommand({ action: 'adjust_stock', payload: { idempotencyKey: requestId, tallyKey: 'ITEM-1', batchNumber: 'LOT-10', quantityDelta: -2, reason: 'Damaged during handling', locationCode: 'MAIN' } })).not.toBeNull();
  });

  it('accepts versioned allocation and release commands', () => {
    expect(validateInventoryCommand({ action: 'allocate_order', payload: { idempotencyKey: requestId, orderId: '4f63e20e-f286-4ec4-aa4b-6063f4fa4301', expectedVersion: 2 } })).not.toBeNull();
    expect(validateInventoryCommand({ action: 'release_order', payload: { idempotencyKey: requestId, orderId: '4f63e20e-f286-4ec4-aa4b-6063f4fa4301', expectedVersion: 3, reason: 'Warehouse correction' } })).not.toBeNull();
  });

  it.each([
    { action: 'receive_stock', payload: { idempotencyKey: 'short', tallyKey: 'ITEM-1', batchNumber: 'LOT-10', quantity: 2 } },
    { action: 'receive_stock', payload: { idempotencyKey: requestId, tallyKey: 'ITEM-1', batchNumber: 'LOT-10', quantity: 0 } },
    { action: 'adjust_stock', payload: { idempotencyKey: requestId, tallyKey: 'ITEM-1', batchNumber: 'LOT-10', quantityDelta: -2 } },
    { action: 'adjust_stock', payload: { idempotencyKey: requestId, tallyKey: 'ITEM-1', batchNumber: 'LOT-10', quantityDelta: 0, reason: 'Counted' } },
    { action: 'delete_stock', payload: {} },
  ])('rejects unsafe inventory command %#', (command) => {
    expect(validateInventoryCommand(command)).toBeNull();
  });
});
