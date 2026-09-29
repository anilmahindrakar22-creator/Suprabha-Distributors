import { removeCatalogCache } from './catalog-cache';
import { removeCustomerCache } from './customer-cache';
import { readOfflineOrderDraft, writeOfflineDraftConsent } from './offline-order-drafts';

type DeviceStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const activeAccountKey = 'stockflow:active-account:v1';

function normalize(email: string) {
  return email.trim().toLocaleLowerCase('en-IN');
}

export function prepareDeviceForAccount(
  persistentStorage: DeviceStorage,
  sessionStorage: DeviceStorage,
  actorEmail: string,
) {
  const current = normalize(actorEmail);
  try {
    // The old unscoped Stock cache could be shown to a different signed-in user.
    persistentStorage.removeItem('stockflow-last-snapshot-v2');
    const previous = normalize(persistentStorage.getItem(activeAccountKey) || '');
    if (!previous || previous === current) {
      persistentStorage.setItem(activeAccountKey, current);
      return { switched: false, retainedPreviousDraft: false };
    }

    const retainedPreviousDraft = Boolean(readOfflineOrderDraft(persistentStorage, previous));
    removeCatalogCache(persistentStorage, previous);
    removeCustomerCache(persistentStorage, previous);
    removeCatalogCache(sessionStorage, previous);
    removeCustomerCache(sessionStorage, previous);
    persistentStorage.removeItem(`stockflow-last-snapshot-v3:${encodeURIComponent(previous)}`);
    writeOfflineDraftConsent(persistentStorage, previous, false);
    persistentStorage.setItem(activeAccountKey, current);
    return { switched: true, retainedPreviousDraft };
  } catch {
    return { switched: false, retainedPreviousDraft: false };
  }
}
