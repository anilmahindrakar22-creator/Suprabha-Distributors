import type { CatalogItem, OrderCommand } from './order-types';

export type OfflineDraftState = 'draft' | 'pending' | 'error';
export type OfflineOrderDraft = {
  schemaVersion: 1;
  actorEmail: string;
  state: OfflineDraftState;
  command: Extract<OrderCommand, { action: 'create_order' }>;
  updatedAt: string;
  error?: string;
};

type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const prefix = 'stockflow:order-draft:v1:';
const consentPrefix = 'stockflow:order-draft-consent:v1:';
const retentionMs = 7 * 24 * 60 * 60 * 1000;

export function restoreOfflineDraftLines(
  catalog: CatalogItem[],
  lines: Array<{ tallyKey: string; quantity: number }>,
) {
  const byKey = new Map(catalog.map((item) => [item.tallyKey, item]));
  return lines.map((line) => ({
    tallyKey: line.tallyKey,
    quantity: line.quantity,
    item: byKey.get(line.tallyKey) || null,
  }));
}

function key(email: string) {
  return `${prefix}${email.trim().toLocaleLowerCase('en-IN')}`;
}

export function readOfflineOrderDraft(storage: DraftStorage, actorEmail: string): OfflineOrderDraft | null {
  try {
    const value = JSON.parse(storage.getItem(key(actorEmail)) || 'null') as Partial<OfflineOrderDraft> | null;
    if (!value || value.schemaVersion !== 1 || typeof value.actorEmail !== 'string' || value.actorEmail.toLocaleLowerCase('en-IN') !== actorEmail.trim().toLocaleLowerCase('en-IN')) return null;
    if (!['draft', 'pending', 'error'].includes(String(value.state)) || value.command?.action !== 'create_order' || typeof value.command.payload?.idempotencyKey !== 'string') return null;
    const updatedAt = Date.parse(String(value.updatedAt));
    if (!Number.isFinite(updatedAt) || updatedAt < Date.now() - retentionMs) {
      storage.removeItem(key(actorEmail));
      return null;
    }
    return value as OfflineOrderDraft;
  } catch {
    return null;
  }
}

export function writeOfflineOrderDraft(storage: DraftStorage, draft: OfflineOrderDraft) {
  try {
    storage.setItem(key(draft.actorEmail), JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

export function removeOfflineOrderDraft(storage: DraftStorage, actorEmail: string) {
  try {
    storage.removeItem(key(actorEmail));
    return true;
  } catch {
    return false;
  }
}

export function updateOfflineDraftState(storage: DraftStorage, actorEmail: string, state: OfflineDraftState, error?: string) {
  const current = readOfflineOrderDraft(storage, actorEmail);
  if (!current) return null;
  const updated: OfflineOrderDraft = { ...current, state, updatedAt: new Date().toISOString(), ...(error ? { error } : { error: undefined }) };
  return writeOfflineOrderDraft(storage, updated) ? updated : null;
}

export function readOfflineDraftConsent(storage: DraftStorage, actorEmail: string) {
  try {
    return storage.getItem(`${consentPrefix}${actorEmail.trim().toLocaleLowerCase('en-IN')}`) === 'yes';
  } catch {
    return false;
  }
}

export function writeOfflineDraftConsent(storage: DraftStorage, actorEmail: string, allowed: boolean) {
  try {
    const consentKey = `${consentPrefix}${actorEmail.trim().toLocaleLowerCase('en-IN')}`;
    if (allowed) storage.setItem(consentKey, 'yes');
    else storage.removeItem(consentKey);
    return true;
  } catch {
    return false;
  }
}
