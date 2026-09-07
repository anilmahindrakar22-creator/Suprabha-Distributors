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
    writeOfflineDraftConsent(persistentStorage, previous, false);
    persistentStorage.setItem(activeAccountKey, current);
    return { switched: true, retainedPreviousDraft };
  } catch {
    return { switched: false, retainedPreviousDraft: false };
  }
}
