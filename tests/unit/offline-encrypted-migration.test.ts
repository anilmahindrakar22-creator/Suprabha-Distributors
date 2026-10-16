import { describe, expect, it } from 'vitest';
import { finishEncryptedDraftMigration, readOfflineOrderDraft, writeOfflineOrderDraft, writeOfflineDraftConsent, type OfflineOrderDraft } from '../../lib/offline-order-drafts';
import { writeCatalogCache } from '../../lib/catalog-cache';
import { writeCustomerCache } from '../../lib/customer-cache';
function storage() {
  const map = new Map<string, string>();
  return { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); }, removeItem: (key: string) => { map.delete(key); } };
}
const draft: OfflineOrderDraft = { schemaVersion: 1, actorEmail: 'staff@example.test', state: 'pending', updatedAt: '2026-10-07T00:00:00Z', command: { action: 'create_order', payload: { idempotencyKey: 'original-command-key', customerName: 'Customer', source: 'phone', lines: [{ tallyKey: 'P', quantity: 1 }] } } };
describe('verified encrypted migration cleanup', () => {
  it('refuses deletion without an encrypted copy', () => {
    const device = storage(); writeOfflineOrderDraft(device, draft);
    expect(() => finishEncryptedDraftMigration(device, draft.actorEmail, draft)).toThrow('missing');
    expect(readOfflineOrderDraft(device, draft.actorEmail)).toEqual(draft);
  });
  it('retains a concurrently changed original', () => {
    const device = storage(); writeOfflineOrderDraft(device, { ...draft, command: { ...draft.command, payload: { ...draft.command.payload, notes: 'changed' } } });
    device.setItem('stockflow:encrypted-offline:v1', 'verified by caller');
    expect(() => finishEncryptedDraftMigration(device, draft.actorEmail, draft)).toThrow('changed');
    expect(readOfflineOrderDraft(device, draft.actorEmail)?.command.payload.notes).toBe('changed');
  });
  it('removes only the matching legacy draft and prevents new plaintext writes', () => {
    const device = storage(); writeOfflineOrderDraft(device, draft);
    device.setItem('stockflow:encrypted-offline:v1', 'verified by caller');
    finishEncryptedDraftMigration(device, draft.actorEmail, draft);
    expect(readOfflineOrderDraft(device, draft.actorEmail)).toBeNull();
    expect(writeOfflineOrderDraft(device, draft)).toBe(false);
    expect(writeOfflineDraftConsent(device, draft.actorEmail, true)).toBe(false);
    expect(writeCatalogCache(device, draft.actorEmail, 'v1', [])).toBe(false);
    expect(writeCustomerCache(device, draft.actorEmail, 'v1', [])).toBe(false);
  });
});
