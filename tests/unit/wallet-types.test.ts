import { describe, expect, it } from 'vitest';
import { validateWalletCommand } from '@/lib/wallet-types';

const customerId = '11111111-1111-4111-8111-111111111111';
const requestId = '22222222-2222-4222-8222-222222222222';
const snapshot = { action: 'record_wallet_snapshot', payload: { requestId, customerId, monthlyWalletPaise: 1000, method: 'customer_stated', source: 'Customer call', confidence: 'high', asOf: '2026-10-29', note: 'Reviewed estimate', loweredReason: null, divisions: [{ code: 'BIOCHEM', monthlyWalletPaise: 500 }], expectedCurrentSnapshotId: null } };
describe('validateWalletCommand', () => {
  it('accepts valid examples of all four commands', () => {
    expect(validateWalletCommand({ action: 'get_wallet_workspace', payload: { view: 'focus', page: 1, search: '' } }).action).toBe('get_wallet_workspace');
    expect(validateWalletCommand({ action: 'get_wallet_account', payload: { customerId } }).action).toBe('get_wallet_account');
    expect(validateWalletCommand(snapshot).action).toBe('record_wallet_snapshot');
    expect(validateWalletCommand({ action: 'set_wallet_policy', payload: { requestId, walletShareTargetBps: 8000, focusBandBps: 8000, staleAfterMonths: 6, note: 'Policy review', expectedVersion: 1 } }).action).toBe('set_wallet_policy');
  });
  const invalidInputs: unknown[] = [
    [{ action: 'get_wallet_workspace', payload: { view: 'bad', page: 1, search: '' } }, 'view'],
    [{ action: 'get_wallet_workspace', payload: { view: 'all', page: 0, search: '' } }, 'page'],
    [{ action: 'get_wallet_workspace', payload: { view: 'all', page: 1, search: 'x'.repeat(81) } }, 'search'],
    [{ action: 'get_wallet_account', payload: { customerId: 'nope' } }, 'uuid'],
    [{ ...snapshot, payload: { ...snapshot.payload, monthlyWalletPaise: -1 } }, 'amount'],
    [{ ...snapshot, payload: { ...snapshot.payload, source: 'ab' } }, 'source'],
    [{ ...snapshot, payload: { ...snapshot.payload, note: 'ab' } }, 'note'],
    [{ ...snapshot, payload: { ...snapshot.payload, loweredReason: 'ab' } }, 'reason'],
    [{ ...snapshot, payload: { ...snapshot.payload, asOf: '2026-2-1' } }, 'date'],
    [{ ...snapshot, payload: { ...snapshot.payload, divisions: Array.from({ length: 11 }, (_, i) => ({ code: String(i), monthlyWalletPaise: 0 })) } }, 'count'],
    [{ ...snapshot, payload: { ...snapshot.payload, divisions: [{ code: 'X', monthlyWalletPaise: 1 }, { code: 'X', monthlyWalletPaise: 2 }] } }, 'unique'],
    { action: 'set_wallet_policy', payload: { requestId, walletShareTargetBps: 999, focusBandBps: 8000, staleAfterMonths: 6, note: 'Policy review', expectedVersion: 1 } },
  ];
  it('rejects an invalid example for every validation rule', () => {
    for (const input of invalidInputs) expect(() => validateWalletCommand(input)).toThrow('Invalid wallet request');
  });
});
