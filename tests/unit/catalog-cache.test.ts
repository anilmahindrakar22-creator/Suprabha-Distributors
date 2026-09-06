import { describe, expect, it } from 'vitest';
import { readCatalogCache, writeCatalogCache } from '../../lib/catalog-cache';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

const catalog = [
  {
    tallyKey: 'ITEM-1',
    item: 'Diagnostic kit',
    group: 'Kits',
    baseUnit: 'Nos',
    closing: 5,
    active: true,
  },
];

describe('account-scoped Tally catalog cache', () => {
  it('restores a catalogue only for the same account and snapshot version', () => {
    const storage = memoryStorage();
    writeCatalogCache(
      storage,
      ' Sales@example.com ',
      '2026-09-06T10:00:00Z',
      catalog,
    );
    expect(
      readCatalogCache(storage, 'sales@example.com', '2026-09-06T10:00:00Z'),
    ).toEqual(catalog);
    expect(
      readCatalogCache(storage, 'other@example.com', '2026-09-06T10:00:00Z'),
    ).toBeNull();
  });

  it('rejects stale and corrupt catalogue data', () => {
    const storage = memoryStorage();
    writeCatalogCache(storage, 'sales@example.com', 'old', catalog);
    expect(readCatalogCache(storage, 'sales@example.com', 'new')).toBeNull();
    storage.setItem('stockflow:catalog:v1:sales@example.com', '{broken');
    expect(readCatalogCache(storage, 'sales@example.com', 'new')).toBeNull();
  });
});
