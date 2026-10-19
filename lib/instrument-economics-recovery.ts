import { economicActions, type EconomicAction } from './instrument-economics-types';

export type EconomicRecoveryReference = { action: EconomicAction; key: string; actorEmail: string };
const storageKey = 'suprabha-economic-command-reference-v1';

export function readEconomicRecoveryReference(storage: Pick<Storage, 'getItem'>): EconomicRecoveryReference | null {
  const raw = storage.getItem(storageKey);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as EconomicRecoveryReference;
    if (value && economicActions.includes(value.action) && /^[a-zA-Z0-9_-]{16,200}$/.test(value.key) && typeof value.actorEmail === 'string' && value.actorEmail.length <= 320 && value.actorEmail.includes('@')) return { action: value.action, key: value.key, actorEmail: value.actorEmail };
  } catch { /* Invalid references require visible reconciliation, never a guessed replay. */ }
  throw new Error('The saved command reference is unreadable. Reconcile command history with Management before making another change.');
}

export function writeEconomicRecoveryReference(storage: Pick<Storage, 'setItem'>, reference: EconomicRecoveryReference) {
  storage.setItem(storageKey, JSON.stringify({ action: reference.action, key: reference.key, actorEmail: reference.actorEmail }));
}

export function clearEconomicRecoveryReference(storage: Pick<Storage, 'removeItem'>) {
  storage.removeItem(storageKey);
}
