import { openOfflineVault, sealOfflineVault, type OfflineVaultEnvelope } from './offline-pin-vault';

type VaultStorage = Pick<Storage, 'getItem' | 'setItem'>;
const storageKey = 'stockflow:encrypted-offline:v1';
type RecordValue = { revision: string; envelope: OfflineVaultEnvelope };

/** A revision is required for every save, including the first save (null). */
export async function saveOfflineVault(storage: VaultStorage, value: unknown, pin: string, expectedRevision: string | null) {
  if (typeof navigator === 'undefined' || !navigator.locks) throw new Error('This browser cannot safely save offline orders.');
  const envelope = await sealOfflineVault(value, pin);
  return navigator.locks.request(storageKey, () => {
  const existing = storage.getItem(storageKey);
  const current = existing === null ? null : JSON.parse(existing) as RecordValue;
  if ((current?.revision ?? null) !== expectedRevision) throw new Error('Offline data changed. Unlock the latest saved draft before continuing.');
  const record: RecordValue = { revision: crypto.randomUUID(), envelope };
  // One storage write: failed/quota-limited writes leave the prior vault intact.
  storage.setItem(storageKey, JSON.stringify(record));
  return record.revision;
  });
}

export async function loadOfflineVault(storage: VaultStorage, pin: string) {
  const raw = storage.getItem(storageKey);
  if (raw === null) return null;
  const record = JSON.parse(raw) as RecordValue;
  if (!record || typeof record.revision !== 'string' || !record.envelope) throw new Error('Saved offline data is unavailable.');
  return { revision: record.revision, value: await openOfflineVault(record.envelope, pin) };
}
