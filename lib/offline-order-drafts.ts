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

export function pinProtectedOfflineDevice(storage: Pick<Storage, 'getItem'>) {
  try { return storage.getItem('stockflow:encrypted-offline:v1') !== null; }
  catch { return true; }
}

export type ProductRequestPayload = { productName: string; customerId?: string; details: string; idempotencyKey: string };
const productRequestPrefix = 'stockflow:product-request-retry:v1:';
const requestUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function validProductRequest(value: unknown): value is ProductRequestPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const payload = value as Record<string, unknown>;
  return Object.keys(payload).every((name) => ['productName', 'customerId', 'details', 'idempotencyKey'].includes(name))
    && typeof payload.productName === 'string' && payload.productName.trim().length >= 2 && payload.productName.length <= 200
    && typeof payload.details === 'string' && payload.details.length <= 1000
    && typeof payload.idempotencyKey === 'string' && requestUuid.test(payload.idempotencyKey)
    && (payload.customerId === undefined || typeof payload.customerId === 'string' && requestUuid.test(payload.customerId));
}
export function readPendingProductRequest(storage: DraftStorage, actorEmail: string): ProductRequestPayload | null {
  try {
    const email = actorEmail.trim().toLocaleLowerCase('en-IN');
    if (!email) return null;
    const value = JSON.parse(storage.getItem(`${productRequestPrefix}${email}`) || 'null');
    if (!value || value.schemaVersion !== 1 || typeof value.actorEmail !== 'string'
      || value.actorEmail.trim().toLocaleLowerCase('en-IN') !== email || !validProductRequest(value.payload)) return null;
    return value.payload;
  } catch { return null; }
}
export function writePendingProductRequest(storage: DraftStorage, actorEmail: string, payload: ProductRequestPayload) {
  try {
    const email = actorEmail.trim().toLocaleLowerCase('en-IN');
    if (!email || !validProductRequest(payload)) return false;
    const existing = storage.getItem(`${productRequestPrefix}${email}`);
    if (existing !== null) {
      const saved = readPendingProductRequest(storage, email);
      if (!saved || saved.idempotencyKey !== payload.idempotencyKey || saved.productName !== payload.productName
        || saved.customerId !== payload.customerId || saved.details !== payload.details) return false;
    }
    storage.setItem(`${productRequestPrefix}${email}`, JSON.stringify({ schemaVersion: 1, actorEmail: email, payload }));
    return true;
  } catch { return false; }
}
export function removePendingProductRequest(storage: DraftStorage, actorEmail: string, expectedKey?: string) {
  try {
    const storageKey = `${productRequestPrefix}${actorEmail.trim().toLocaleLowerCase('en-IN')}`;
    if (expectedKey && storage.getItem(storageKey) !== null && readPendingProductRequest(storage, actorEmail)?.idempotencyKey !== expectedKey) return false;
    storage.removeItem(storageKey); return true;
  }
  catch { return false; }
}

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

export function offlineDraftRecoveryError(draft: OfflineOrderDraft | null, hasUnavailableProduct: boolean) {
  if (hasUnavailableProduct) return 'A saved product is no longer in the current Tally catalogue. Remove it and select the correct product before saving.';
  return draft?.state === 'error' ? draft.error || 'Check the saved order details and retry.' : '';
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
    if (!Number.isFinite(updatedAt) || (value.state === 'draft' && updatedAt < Date.now() - retentionMs)) {
      storage.removeItem(key(actorEmail));
      return null;
    }
    return value as OfflineOrderDraft;
  } catch {
    try {
      storage.removeItem(key(actorEmail));
    } catch {
      // Storage may be unavailable; the caller still receives a safe empty result.
    }
    return null;
  }
}

export function writeOfflineOrderDraft(storage: DraftStorage, draft: OfflineOrderDraft) {
  try {
    if (pinProtectedOfflineDevice(storage)) return false;
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
    if (pinProtectedOfflineDevice(storage)) return false;
    return storage.getItem(`${consentPrefix}${actorEmail.trim().toLocaleLowerCase('en-IN')}`) === 'yes';
  } catch {
    return false;
  }
}

export function writeOfflineDraftConsent(storage: DraftStorage, actorEmail: string, allowed: boolean) {
  try {
    if (allowed && pinProtectedOfflineDevice(storage)) return false;
    const consentKey = `${consentPrefix}${actorEmail.trim().toLocaleLowerCase('en-IN')}`;
    if (allowed) storage.setItem(consentKey, 'yes');
    else storage.removeItem(consentKey);
    return true;
  } catch {
    return false;
  }
}

/** Call only after decrypt/read-back verification. Never delete a changed original. */
export function finishEncryptedDraftMigration(storage: DraftStorage, actorEmail: string, original: OfflineOrderDraft | null) {
  if (!pinProtectedOfflineDevice(storage)) throw new Error('Encrypted copy is missing. Original draft retained.');
  const current = readOfflineOrderDraft(storage, actorEmail);
  if (JSON.stringify(current) !== JSON.stringify(original)) throw new Error('Original draft changed during preparation. Both copies retained.');
  if (original && !removeOfflineOrderDraft(storage, actorEmail)) throw new Error('Original draft cleanup failed. Both copies retained.');
  if (!writeOfflineDraftConsent(storage, actorEmail, false)) throw new Error('Could not disable unencrypted draft storage.');
}
