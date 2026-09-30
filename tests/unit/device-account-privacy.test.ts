import { describe, expect, it } from 'vitest';
import { writeCatalogCache, readCatalogCache } from '../../lib/catalog-cache';
import { writeCustomerCache, readCustomerCache } from '../../lib/customer-cache';
import { prepareDeviceForAccount } from '../../lib/device-account-privacy';
import { readOfflineDraftConsent, readOfflineOrderDraft, writeOfflineDraftConsent, writeOfflineOrderDraft, type OfflineOrderDraft } from '../../lib/offline-order-drafts';

function memoryStorage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => void values.set(key, value), removeItem: (key: string) => void values.delete(key) };
}

const catalog = [{ tallyKey: 'KIT-1', item: 'Kit', group: 'Kits', baseUnit: 'Nos', closing: 4, active: true }];
const customers = [{ id: '1', name: 'City Lab', phone: null, city: null, tallyKey: 'CITY' }];
const pending: OfflineOrderDraft = { schemaVersion: 1, actorEmail: 'first@example.com', state: 'pending', updatedAt: new Date().toISOString(), command: { action: 'create_order', payload: { idempotencyKey: '1234567890abcdef', customerName: 'City Lab', source: 'phone', lines: [{ tallyKey: 'KIT-1', quantity: 1 }] } } };

describe('trusted-device account switching', () => {
  it('clears the previous account directories and consent without deleting its unsent draft', () => {
    const local = memoryStorage();
    const session = memoryStorage();
    prepareDeviceForAccount(local, session, pending.actorEmail);
    writeCatalogCache(local, pending.actorEmail, 'v1', catalog);
    writeCatalogCache(session, pending.actorEmail, 'v1', catalog);
    writeCustomerCache(local, pending.actorEmail, 'v1', customers);
    writeCustomerCache(session, pending.actorEmail, 'v1', customers);
    writeOfflineDraftConsent(local, pending.actorEmail, true);
    writeOfflineOrderDraft(local, pending);
    local.setItem('stockflow-last-snapshot-v2', 'legacy shared Stock payload');
    local.setItem('stockflow-last-snapshot-v3:first%40example.com', 'first account Stock payload');
    local.setItem('stockflow-history-daily-v1', 'shared chart history');
    local.setItem('stockflow-history-v2', 'legacy chart history');
    local.setItem('stockflow-history-daily-v2:first%40example.com', 'first account chart history');

    expect(prepareDeviceForAccount(local, session, 'second@example.com')).toEqual({ switched: true, retainedPreviousDraft: true });
    expect(readCatalogCache(local, pending.actorEmail, 'v1')).toBeNull();
    expect(readCatalogCache(session, pending.actorEmail, 'v1')).toBeNull();
    expect(readCustomerCache(local, pending.actorEmail, 'v1')).toBeNull();
    expect(readCustomerCache(session, pending.actorEmail, 'v1')).toBeNull();
    expect(readOfflineDraftConsent(local, pending.actorEmail)).toBe(false);
    expect(local.getItem('stockflow-last-snapshot-v2')).toBeNull();
    expect(local.getItem('stockflow-last-snapshot-v3:first%40example.com')).toBeNull();
    expect(local.getItem('stockflow-history-daily-v1')).toBeNull();
    expect(local.getItem('stockflow-history-v2')).toBeNull();
    expect(local.getItem('stockflow-history-daily-v2:first%40example.com')).toBeNull();
    expect(readOfflineOrderDraft(local, pending.actorEmail)?.command.payload.idempotencyKey).toBe('1234567890abcdef');
    expect(readOfflineOrderDraft(local, 'second@example.com')).toBeNull();
  });

  it('does not clear storage when the normalized account is unchanged', () => {
    const local = memoryStorage();
    const session = memoryStorage();
    prepareDeviceForAccount(local, session, 'First@Example.com');
    writeCatalogCache(local, 'first@example.com', 'v1', catalog);
    local.setItem('stockflow-history-daily-v2:first%40example.com', 'same account chart');
    expect(prepareDeviceForAccount(local, session, ' first@example.com ')).toEqual({ switched: false, retainedPreviousDraft: false });
    expect(readCatalogCache(local, 'first@example.com', 'v1')).toEqual(catalog);
    expect(local.getItem('stockflow-history-daily-v2:first%40example.com')).toBe('same account chart');
  });
});
