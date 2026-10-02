import { describe, expect, it } from 'vitest';
import { readPendingProductRequest, removePendingProductRequest, writePendingProductRequest, type ProductRequestPayload } from '../../lib/offline-order-drafts';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

const actorEmail = 'sales@example.test';
const idempotencyKey = '11111111-1111-4111-8111-111111111111';
const customerId = '22222222-2222-4222-8222-222222222222';
const payload: ProductRequestPayload = {
  productName: 'New laboratory kit',
  details: 'A bounded request for the catalogue.',
  customerId,
  idempotencyKey,
};
const storageKey = `stockflow:product-request-retry:v1:${actorEmail}`;

describe('pending product request recovery', () => {
  it('does not replace an unresolved command or mutate its original payload', () => {
    const storage = memoryStorage();
    expect(writePendingProductRequest(storage, actorEmail, payload)).toBe(true);
    expect(writePendingProductRequest(storage, actorEmail, { ...payload, details: 'Changed retry' })).toBe(false);
    expect(writePendingProductRequest(storage, actorEmail, { ...payload, idempotencyKey: customerId })).toBe(false);
    expect(readPendingProductRequest(storage, actorEmail)).toEqual(payload);
  });
  it('does not clear a different unresolved reference', () => {
    const storage = memoryStorage();
    writePendingProductRequest(storage, actorEmail, payload);
    expect(removePendingProductRequest(storage, actorEmail, customerId)).toBe(false);
    expect(readPendingProductRequest(storage, actorEmail)).toEqual(payload);
    expect(removePendingProductRequest(storage, actorEmail, idempotencyKey)).toBe(true);
  });
  it('round trips the exact payload and original idempotency key', () => {
    const storage = memoryStorage();

    expect(writePendingProductRequest(storage, actorEmail, payload)).toBe(true);
    expect(readPendingProductRequest(storage, actorEmail)).toEqual(payload);
    expect(readPendingProductRequest(storage, actorEmail)?.idempotencyKey).toBe(idempotencyKey);
  });

  it('normalizes email identity and keeps accounts separate', () => {
    const storage = memoryStorage();
    writePendingProductRequest(storage, actorEmail, payload);
    writePendingProductRequest(storage, 'ops@example.test', { ...payload, productName: 'Ops item' });

    expect(readPendingProductRequest(storage, ' SALES@EXAMPLE.TEST ')).toEqual(payload);
    expect(readPendingProductRequest(storage, 'ops@example.test')?.productName).toBe('Ops item');
    expect(readPendingProductRequest(storage, 'other@example.test')).toBeNull();
  });

  it.each([
    '{broken',
    JSON.stringify({ schemaVersion: 2, actorEmail, payload }),
    JSON.stringify({ schemaVersion: 1, actorEmail: 'other@example.test', payload }),
    JSON.stringify({ schemaVersion: 1, actorEmail, payload: { ...payload, idempotencyKey: 'bad' } }),
    JSON.stringify({ schemaVersion: 1, actorEmail, payload: { ...payload, customerId: 'bad' } }),
    JSON.stringify({ schemaVersion: 1, actorEmail, payload: { ...payload, productName: 'x' } }),
    JSON.stringify({ schemaVersion: 1, actorEmail, payload: { ...payload, productName: 'x'.repeat(201) } }),
    JSON.stringify({ schemaVersion: 1, actorEmail, payload: { ...payload, details: 'x'.repeat(1001) } }),
    JSON.stringify({ schemaVersion: 1, actorEmail, payload: { ...payload, expectedPrice: 12 } }),
    JSON.stringify({ schemaVersion: 1, actorEmail, payload: { ...payload, price: 12 } }),
  ])('rejects malformed, mismatched, or unapproved saved records', (saved) => {
    const storage = memoryStorage();
    storage.setItem(storageKey, saved);

    expect(readPendingProductRequest(storage, actorEmail)).toBeNull();
  });

  it('does not expire a pending command based on its age', () => {
    const storage = memoryStorage();
    storage.setItem(storageKey, JSON.stringify({
      schemaVersion: 1,
      actorEmail,
      payload,
      createdAt: '2000-01-01T00:00:00.000Z',
    }));

    expect(readPendingProductRequest(storage, actorEmail)).toEqual(payload);
  });

  it('handles storage read, write, and removal failures without throwing', () => {
    const deniedRead = { ...memoryStorage(), getItem: () => { throw new DOMException('Storage denied', 'SecurityError'); } };
    const deniedWrite = { ...memoryStorage(), setItem: () => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); } };
    const deniedRemoval = { ...memoryStorage(), removeItem: () => { throw new DOMException('Storage denied', 'SecurityError'); } };

    expect(() => readPendingProductRequest(deniedRead, actorEmail)).not.toThrow();
    expect(readPendingProductRequest(deniedRead, actorEmail)).toBeNull();
    expect(() => writePendingProductRequest(deniedWrite, actorEmail, payload)).not.toThrow();
    expect(writePendingProductRequest(deniedWrite, actorEmail, payload)).toBe(false);
    expect(() => removePendingProductRequest(deniedRemoval, actorEmail)).not.toThrow();
    expect(removePendingProductRequest(deniedRemoval, actorEmail)).toBe(false);
  });

  it('removes only the selected account record', () => {
    const storage = memoryStorage();
    writePendingProductRequest(storage, actorEmail, payload);
    writePendingProductRequest(storage, 'ops@example.test', { ...payload, productName: 'Ops item' });

    expect(removePendingProductRequest(storage, ' SALES@example.test ')).toBe(true);
    expect(readPendingProductRequest(storage, actorEmail)).toBeNull();
    expect(readPendingProductRequest(storage, 'ops@example.test')?.productName).toBe('Ops item');
  });
});
