import { describe, expect, it } from 'vitest';
import { clearEconomicRecoveryReference, readEconomicRecoveryReference, writeEconomicRecoveryReference } from '@/lib/instrument-economics-recovery';

describe('opaque economic recovery references', () => {
  const reference = { action: 'record_capital' as const, key: 'economic-reference-0001', actorEmail: 'manager@example.com' };
  function storage() {
    const values = new Map<string, string>();
    return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  }
  it('persists only the account, action and opaque key across reloads', () => {
    const store = storage();
    writeEconomicRecoveryReference(store, { ...reference, amountPaise: '55000000', customer: 'Secret customer' } as typeof reference);
    expect(readEconomicRecoveryReference(store)).toEqual(reference);
    expect([...store.values.values()].join('')).not.toMatch(/55000000|Secret customer/);
    clearEconomicRecoveryReference(store);
    expect(readEconomicRecoveryReference(store)).toBeNull();
  });
  it.each(['{bad json', 'null', '{"action":"submit_order","key":"economic-reference-0001","actorEmail":"manager@example.com"}', '{"action":"record_capital","key":"short","actorEmail":"manager@example.com"}'])('fails visibly for a damaged reference: %s', raw => {
    expect(() => readEconomicRecoveryReference({ getItem: () => raw })).toThrow('Reconcile command history');
  });
  it('does not silently bypass unavailable browser storage', () => {
    expect(() => writeEconomicRecoveryReference({ setItem: () => { throw new Error('Storage disabled'); } }, reference)).toThrow('Storage disabled');
  });
});
