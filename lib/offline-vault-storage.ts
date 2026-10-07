import { openOfflineVault, sealOfflineVault, type OfflineVaultEnvelope } from './offline-pin-vault';

type VaultStorage = Pick<Storage, 'getItem' | 'setItem'>;
const storageKey = 'stockflow:encrypted-offline:v1';
type RecordValue = { revision: string; envelope: OfflineVaultEnvelope; retainedEnvelope?: OfflineVaultEnvelope; enabled?: boolean };

/** A revision is required for every save, including the first save (null). */
export async function saveOfflineVault(storage: VaultStorage, value: unknown, pin: string, expectedRevision: string | null, options?: { retainedValue: unknown; requireEnabled?: boolean }) {
  if (typeof navigator === 'undefined' || !navigator.locks) throw new Error('This browser cannot safely save offline orders.');
  const envelope = await sealOfflineVault(value, pin);
  const retainedEnvelope = options ? await sealOfflineVault(options.retainedValue, pin) : undefined;
  return navigator.locks.request(storageKey, () => {
  const existing = storage.getItem(storageKey);
  const current = existing === null ? null : JSON.parse(existing) as RecordValue;
  if ((current?.revision ?? null) !== expectedRevision) throw new Error('Offline data changed. Unlock the latest saved draft before continuing.');
  if (options?.requireEnabled && current?.enabled !== true) throw new Error('Offline access was disabled. Sign in and prepare this device again.');
  const record: RecordValue = { revision: crypto.randomUUID(), envelope, ...(retainedEnvelope ? { retainedEnvelope, enabled: true } : {}) };
  // One storage write: failed/quota-limited writes leave the prior vault intact.
  storage.setItem(storageKey, JSON.stringify(record));
  return record.revision;
  });
}

export async function loadOfflineVault(storage: VaultStorage, pin: string, requireEnabled = false) {
  const raw = storage.getItem(storageKey);
  if (raw === null) return null;
  const record = JSON.parse(raw) as RecordValue;
  if (!record || typeof record.revision !== 'string' || !record.envelope) throw new Error('Saved offline data is unavailable.');
  if (requireEnabled && record.enabled !== true) throw new Error('Sign in and prepare offline orders on this device first.');
  return { revision: record.revision, value: await openOfflineVault(record.envelope, pin) };
}

/** Retain only encrypted drafts; remove the encrypted directory without needing its PIN. */
export async function revokeOfflineVault(storage: VaultStorage) {
  if (storage.getItem(storageKey) === null) return;
  if (!navigator.locks) throw new Error('Unable to lock offline data safely.');
  return navigator.locks.request(storageKey, () => {
    const raw = storage.getItem(storageKey);
    if (raw === null) return;
    const current = JSON.parse(raw) as RecordValue;
    if (!current.retainedEnvelope) throw new Error('Prepare offline data before changing accounts.');
    storage.setItem(storageKey, JSON.stringify({ revision: crypto.randomUUID(), envelope: current.retainedEnvelope, retainedEnvelope: current.retainedEnvelope, enabled: false }));
  });
}

export async function resetOfflineVault(storage: Pick<Storage, 'removeItem'>) {
  if (!navigator.locks) throw new Error('Unable to reset offline data safely.');
  await navigator.locks.request(storageKey, () => storage.removeItem(storageKey));
}
