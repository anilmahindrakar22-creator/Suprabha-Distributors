import { offlineOrderDocument, type OfflineOrderDocument } from './offline-order-document';
import { saveOfflineVault } from './offline-vault-storage';

export function saveOfflineOrderDocument(storage: Pick<Storage, 'getItem' | 'setItem'>, value: OfflineOrderDocument, pin: string, revision: string | null, preparing = false) {
  const document = offlineOrderDocument(value, value.actorEmail);
  return saveOfflineVault(storage, document, pin, revision, {
    retainedValue: { ...document, products: [], customers: [] }, requireEnabled: !preparing,
  });
}
