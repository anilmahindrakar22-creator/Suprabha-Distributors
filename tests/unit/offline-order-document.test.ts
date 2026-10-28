import { describe, expect, it } from 'vitest';
import { offlineOrderDocument } from '../../lib/offline-order-document';
const value = () => ({
  version: 1, actorEmail: 'staff@example.com', preparedAt: '2026-10-07T10:00:00Z',
  products: [{ tallyKey: 'p', item: 'Product', group: 'Group', baseUnit: 'Nos', closing: 55, cost: 10 }],
  customers: [{ id: 'c', name: 'Customer', tallyBalance: 50 }],
  drafts: [{ schemaVersion: 1, actorEmail: 'staff@example.com', state: 'pending', updatedAt: '2026-10-07T10:00:00Z',
    command: { action: 'create_order', payload: { idempotencyKey: 'original-idempotency-key', customerName: 'Customer', source: 'phone', sellingPrice: 20, lines: [{ tallyKey: 'p', quantity: 2, cost: 10 }] } } }],
});
describe('offline document boundary', () => {
  it('preserves pending command identity and strips restricted extras', () => {
    const result = offlineOrderDocument(value(), 'staff@example.com');
    expect(result.drafts[0].state).toBe('pending');
    expect(result.drafts[0].command.payload.idempotencyKey).toBe('original-idempotency-key');
    expect(result.drafts[0].command.payload.lines).toEqual([{ tallyKey: 'p', quantity: 2 }]);
    for (const field of ['cost', 'closing', 'tallyBalance', 'sellingPrice']) expect(JSON.stringify(result)).not.toContain(field);
  });
  it('rejects another account rather than relabelling its data', () => {
    expect(() => offlineOrderDocument(value(), 'other@example.com')).toThrow('this account');
    const input = value(); input.drafts[0].actorEmail = 'other@example.com';
    expect(() => offlineOrderDocument(input, 'staff@example.com')).toThrow('saved offline order');
  });
  it('rejects invalid commands rather than losing their pending state', () => {
    const input = value(); input.drafts[0].command.payload.lines[0].quantity = -1;
    expect(() => offlineOrderDocument(input, 'staff@example.com')).toThrow('saved offline order');
  });
  it('rejects unsupported document versions and malformed directories', () => {
    expect(() => offlineOrderDocument({ ...value(), version: 2 }, 'staff@example.com')).toThrow();
    expect(() => offlineOrderDocument({ ...value(), customers: [null] }, 'staff@example.com')).toThrow();
  });
});
