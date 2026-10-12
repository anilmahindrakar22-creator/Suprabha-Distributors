import { describe, expect, it, vi } from 'vitest';
import { formatPaise, rupeesToPaise, validateWalletCommand } from '@/lib/wallet-types';

const payload = { customerId: '12345678-1234-4234-8234-123456789abc', divisionId: '22345678-1234-4234-8234-123456789abc',
  monthlyWalletPaise: '12500000', method: 'customer_stated', confidence: 'high', note: 'Customer confirmed', asOf: '2020-01-01', idempotencyKey: 'wallet-test-key-001' };
describe('wallet money', () => {
  it.each([['125000', '12500000'], ['1,25,000', '12500000'], ['125000.5', '12500050'], ['125000.50', '12500050'],
    ['0.5', '50'], ['10.05', '1005'], ['0', '0'], ['10000000000', '1000000000000'],
    ['1.234', null], ['-5', null], ['abc', null], ['10000000000.01', null], ['', null]])('converts %s', (input, expected) => {
    expect(rupeesToPaise(input!)).toBe(expected);
  });
  it.each([['12500000', '₹1,25,000'], ['50', '₹0.50'], ['1005', '₹10.05'], ['0', '₹0'], ['1000000000000', '₹10,00,00,00,000']])('formats %s', (input, expected) => {
    expect(formatPaise(input)).toBe(expected);
  });
});
describe('wallet command validation', () => {
  it('accepts an estimate and trims its note', () => {
    expect(validateWalletCommand({ action: 'record_wallet_estimate', payload: { ...payload, note: ' Customer confirmed ' } }))
      .toEqual({ action: 'record_wallet_estimate', payload });
  });
  it.each([{ monthlyWalletPaise: 100 }, { monthlyWalletPaise: '-1' }, { monthlyWalletPaise: '1000000000001' },
    { asOf: '2999-01-01' }, { asOf: '2026-02-30' }, { asOf: '1999-12-31' }, { note: 'ab' }, { method: 'bad' },
    { confidence: 'bad' }, { idempotencyKey: 'short' }])('rejects invalid estimate %o', change => {
    expect(validateWalletCommand({ action: 'record_wallet_estimate', payload: { ...payload, ...change } })).toBeNull();
  });
  it('uses the Kolkata date at the UTC day boundary', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-10-11T20:00:00Z'));
      expect(validateWalletCommand({ action: 'record_wallet_estimate', payload: { ...payload, asOf: '2026-10-12' } })).not.toBeNull();
      expect(validateWalletCommand({ action: 'record_wallet_estimate', payload: { ...payload, asOf: '2026-10-13' } })).toBeNull();
    } finally { vi.useRealTimers(); }
  });
  it('accepts division creation and versioned edits', () => {
    const division = { name: ' New division ', active: true, sortOrder: 80, idempotencyKey: payload.idempotencyKey };
    expect(validateWalletCommand({ action: 'set_wallet_division', payload: division })?.payload).toEqual({ ...division, name: 'New division' });
    expect(validateWalletCommand({ action: 'set_wallet_division', payload: { ...division, divisionId: payload.divisionId } })).toBeNull();
    expect(validateWalletCommand({ action: 'set_wallet_division', payload: { ...division, divisionId: payload.divisionId, expectedVersion: 1 } })).not.toBeNull();
  });
});
