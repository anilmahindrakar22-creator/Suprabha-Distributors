import { describe, expect, it } from 'vitest';
import { readCustomerCache, removeCustomerCache, writeCustomerCache } from '../../lib/customer-cache';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

const customers = [{ id: '1', name: 'Aster Lab', phone: null, city: null, tallyKey: 'ASTER' }];

describe('account-scoped customer directory cache', () => {
  it('restores only the same account and directory version', () => {
    const storage = memoryStorage();
    writeCustomerCache(storage, 'Sales@Example.com', 'v1', customers);
    expect(readCustomerCache(storage, 'sales@example.com', 'v1')).toEqual(customers);
    expect(readCustomerCache(storage, 'other@example.com', 'v1')).toBeNull();
    expect(readCustomerCache(storage, 'sales@example.com', 'v2')).toBeNull();
  });

  it('discards corrupt data', () => {
    const storage = memoryStorage();
    storage.setItem('stockflow:customers:v1:sales@example.com', '{broken');
    expect(readCustomerCache(storage, 'sales@example.com', 'v1')).toBeNull();
  });

  it('handles storage limits and explicit trusted-device cleanup', () => {
    const storage = memoryStorage();
    expect(writeCustomerCache(storage, 'sales@example.com', 'v1', customers)).toBe(true);
    expect(removeCustomerCache(storage, 'sales@example.com')).toBe(true);
    expect(readCustomerCache(storage, 'sales@example.com', 'v1')).toBeNull();
    expect(writeCustomerCache({ ...storage, setItem: () => { throw new DOMException('full', 'QuotaExceededError'); } }, 'sales@example.com', 'v1', customers)).toBe(false);
  });
});
