import type { CustomerDirectoryEntry } from './order-types';

type CustomerStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

type CachedCustomers = {
  schemaVersion: 1;
  actorEmail: string;
  customerVersion: string;
  customers: CustomerDirectoryEntry[];
};

const prefix = 'stockflow:customers:v1:';

function key(actorEmail: string) {
  return `${prefix}${actorEmail.trim().toLocaleLowerCase('en-IN')}`;
}

export function readCustomerCache(storage: CustomerStorage, actorEmail: string, customerVersion: string) {
  try {
    const cacheKey = key(actorEmail);
    const cached = JSON.parse(storage.getItem(cacheKey) || 'null') as Partial<CachedCustomers> | null;
    if (!cached || cached.schemaVersion !== 1 || cached.actorEmail?.trim().toLocaleLowerCase('en-IN') !== actorEmail.trim().toLocaleLowerCase('en-IN') || cached.customerVersion !== customerVersion || !Array.isArray(cached.customers)) {
      storage.removeItem(cacheKey);
      return null;
    }
    return cached.customers as CustomerDirectoryEntry[];
  } catch {
    storage.removeItem(key(actorEmail));
    return null;
  }
}

export function writeCustomerCache(storage: CustomerStorage, actorEmail: string, customerVersion: string, customers: CustomerDirectoryEntry[]) {
  try {
    const cached: CachedCustomers = { schemaVersion: 1, actorEmail: actorEmail.trim().toLocaleLowerCase('en-IN'), customerVersion, customers };
    storage.setItem(key(actorEmail), JSON.stringify(cached));
    return true;
  } catch {
    return false;
  }
}

export function removeCustomerCache(storage: CustomerStorage, actorEmail: string) {
  try {
    storage.removeItem(key(actorEmail));
    return true;
  } catch {
    return false;
  }
}
