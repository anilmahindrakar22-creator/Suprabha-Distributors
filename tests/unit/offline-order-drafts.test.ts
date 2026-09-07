import { describe, expect, it } from 'vitest';
import { readOfflineDraftConsent, readOfflineOrderDraft, removeOfflineOrderDraft, restoreOfflineDraftLines, updateOfflineDraftState, writeOfflineDraftConsent, writeOfflineOrderDraft, type OfflineOrderDraft } from '../../lib/offline-order-drafts';

function memoryStorage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) };
}

const draft: OfflineOrderDraft = {
  schemaVersion: 1,
  actorEmail: 'sales@example.com',
  state: 'draft',
  updatedAt: new Date().toISOString(),
  command: { action: 'create_order', payload: { idempotencyKey: '1234567890abcdef', customerName: 'City Lab', source: 'phone', lines: [{ tallyKey: 'KIT-1', quantity: 2 }] } },
};

describe('offline order drafts', () => {
  it('restores only the signed-in account draft with its original request ID', () => {
    const storage = memoryStorage();
    writeOfflineOrderDraft(storage, draft);
    expect(readOfflineOrderDraft(storage, ' SALES@example.com ')?.command.payload.idempotencyKey).toBe('1234567890abcdef');
    expect(readOfflineOrderDraft(storage, 'other@example.com')).toBeNull();
  });

  it('retains the command while moving through pending and error states', () => {
    const storage = memoryStorage();
    writeOfflineOrderDraft(storage, draft);
    expect(updateOfflineDraftState(storage, draft.actorEmail, 'pending')?.state).toBe('pending');
    const failed = updateOfflineDraftState(storage, draft.actorEmail, 'error', 'Customer is invalid');
    expect(failed).toMatchObject({ state: 'error', error: 'Customer is invalid' });
    expect(failed?.command).toEqual(draft.command);
  });

  it('ignores corrupt data and removes a completed draft', () => {
    const storage = memoryStorage();
    storage.setItem('stockflow:order-draft:v1:sales@example.com', '{broken');
    expect(readOfflineOrderDraft(storage, draft.actorEmail)).toBeNull();
    writeOfflineOrderDraft(storage, draft);
    removeOfflineOrderDraft(storage, draft.actorEmail);
    expect(readOfflineOrderDraft(storage, draft.actorEmail)).toBeNull();
  });

  it('expires device data after seven days', () => {
    const storage = memoryStorage();
    writeOfflineOrderDraft(storage, { ...draft, updatedAt: new Date(Date.now() - 8 * 86_400_000).toISOString() });
    expect(readOfflineOrderDraft(storage, draft.actorEmail)).toBeNull();
  });

  it('stores explicit device consent per account', () => {
    const storage = memoryStorage();
    expect(readOfflineDraftConsent(storage, draft.actorEmail)).toBe(false);
    expect(writeOfflineDraftConsent(storage, draft.actorEmail, true)).toBe(true);
    expect(readOfflineDraftConsent(storage, ' SALES@example.com ')).toBe(true);
    writeOfflineDraftConsent(storage, draft.actorEmail, false);
    expect(readOfflineDraftConsent(storage, draft.actorEmail)).toBe(false);
  });

  it('reports storage quota failures without losing control of the screen', () => {
    const storage = { getItem: () => null, removeItem: () => {}, setItem: () => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); } };
    expect(writeOfflineOrderDraft(storage, draft)).toBe(false);
    expect(writeOfflineDraftConsent(storage, draft.actorEmail, true)).toBe(false);
    expect(removeOfflineOrderDraft({ ...storage, removeItem: () => { throw new DOMException('Storage denied', 'SecurityError'); } }, draft.actorEmail)).toBe(false);
  });

  it('preserves unavailable Tally lines for visible correction instead of dropping them', () => {
    const restored = restoreOfflineDraftLines(
      [{ tallyKey: 'KIT-1', item: 'Current kit', group: 'Kits', baseUnit: 'Nos', closing: 4, active: true }],
      [{ tallyKey: 'KIT-1', quantity: 2 }, { tallyKey: 'OLD-1', quantity: 3 }],
    );
    expect(restored[0]?.item?.item).toBe('Current kit');
    expect(restored[1]).toEqual({ tallyKey: 'OLD-1', quantity: 3, item: null });
  });
});
