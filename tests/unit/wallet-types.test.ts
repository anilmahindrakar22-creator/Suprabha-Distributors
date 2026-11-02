import { describe, expect, it } from 'vitest';
import { parseWalletAccount, validateWalletCommand } from '@/lib/wallet-types';

const customerId = '11111111-1111-4111-8111-111111111111';
const requestId = '22222222-2222-4222-8222-222222222222';
const snapshot = { action: 'record_wallet_snapshot', payload: { requestId, customerId, monthlyWalletPaise: 1000, method: 'customer_stated', source: 'Customer call', confidence: 'high', asOf: '2026-10-29', note: 'Reviewed estimate', loweredReason: null, divisions: [{ code: 'BIOCHEM', monthlyWalletPaise: 500 }], expectedCurrentSnapshotId: null } };
const walletAccount = { policy: {}, coverage: {}, row: {}, current: null, history: [], divisions: [] };
const labSize = { testsPerDay: 80, basis: 'lab_said', reportedBy: 'Ravi', reportedOn: '2026-11-01', statedMonthlySpendPaise: 5000000, spendReportedOn: '2026-11-03' };
describe('parseWalletAccount', () => {
  it('preserves wallet fields and parses a nullable financial lab size', () => {
    expect(parseWalletAccount({ ...walletAccount, labSize: { ...labSize, extra: true } })).toEqual({ ...walletAccount, labSize });
    expect(parseWalletAccount({ ...walletAccount, labSize: { ...labSize, statedMonthlySpendPaise: null } }).labSize)
      .toEqual({ ...labSize, statedMonthlySpendPaise: null });
    expect(parseWalletAccount({ ...walletAccount, labSize: null }).labSize).toBeNull();
    expect(parseWalletAccount(walletAccount)).toEqual(walletAccount);
  });
  it.each([
    { testsPerDay: 0 }, { testsPerDay: 100001 }, { testsPerDay: 2.5 }, { basis: 'estimate' },
    { reportedBy: '' }, { reportedOn: '2026-02-30' }, { reportedOn: '2026-11-01T00:00:00Z' },
    { statedMonthlySpendPaise: undefined }, { statedMonthlySpendPaise: -1 }, { statedMonthlySpendPaise: 9e15 + 1 },
    { statedMonthlySpendPaise: 1.5 }, { statedMonthlySpendPaise: '5000000' }, { spendReportedOn: 'today' }, { spendReportedOn: undefined },
  ])('rejects invalid wallet lab size %#', change => {
    expect(() => parseWalletAccount({ ...walletAccount, labSize: { ...labSize, ...change } })).toThrow('Invalid wallet request');
  });
});
describe('validateWalletCommand', () => {
  it('validates test volume, ranges, method and matching total', () => {
    const testVolume = { testsPerDay: 80, workingDaysPerMonth: 26, paisePerTest: 2500 };
    const command = { ...snapshot, payload: { ...snapshot.payload, method: 'test_volume', monthlyWalletPaise: 5200000, testVolume } };
    expect(validateWalletCommand(command)).toEqual(command);
    for (const value of [undefined, null, [], {}, { ...testVolume, testsPerDay: 0 }, { ...testVolume, testsPerDay: 100001 }, { ...testVolume, workingDaysPerMonth: 32 }, { ...testVolume, paisePerTest: 100000001 }, { ...testVolume, paisePerTest: 1.5 }, { ...testVolume, testsPerDay: '80' }]) {
      expect(() => validateWalletCommand({ ...command, payload: { ...command.payload, testVolume: value } })).toThrow('Invalid wallet request');
    }
    expect(() => validateWalletCommand({ ...command, payload: { ...command.payload, monthlyWalletPaise: 1 } })).toThrow();
    expect(() => validateWalletCommand({ ...snapshot, payload: { ...snapshot.payload, testVolume } })).toThrow();
    expect(validateWalletCommand({ ...snapshot, payload: { ...snapshot.payload, testVolume: null } })).toBeTruthy();
  });
  it('validates routine plus paired special test volume', () => {
    const testVolume = { testsPerDay: 80, workingDaysPerMonth: 26, paisePerTest: 2500, specialTestsPerMonth: 100, paisePerSpecialTest: 30000 };
    const command = { ...snapshot, payload: { ...snapshot.payload, method: 'test_volume', monthlyWalletPaise: 8200000, testVolume } };
    expect(validateWalletCommand(command)).toEqual(command);
    expect(() => validateWalletCommand({ ...command, payload: { ...command.payload, testVolume: { ...testVolume, paisePerSpecialTest: undefined } } })).toThrow();
    expect(() => validateWalletCommand({ ...command, payload: { ...command.payload, monthlyWalletPaise: 8200001 } })).toThrow();
  });
  it('accepts valid examples of all four commands', () => {
    expect(validateWalletCommand({ action: 'get_wallet_workspace', payload: { view: 'focus', page: 1, search: '' } }).action).toBe('get_wallet_workspace');
    expect(validateWalletCommand({ action: 'get_wallet_account', payload: { customerId } }).action).toBe('get_wallet_account');
    expect(validateWalletCommand(snapshot).action).toBe('record_wallet_snapshot');
    expect(validateWalletCommand({ action: 'set_wallet_policy', payload: { requestId, walletShareTargetBps: 8000, focusBandBps: 8000, staleAfterMonths: 6, note: 'Policy review', expectedVersion: 1 } }).action).toBe('set_wallet_policy');
  });
  it('validates wallet snapshot verification and trims its note', () => {
    const command = { action: 'verify_wallet_snapshot', payload: { requestId, snapshotId: customerId, note: '  Checked against source  ' } };
    expect(validateWalletCommand(command)).toEqual({ ...command, payload: { ...command.payload, note: 'Checked against source' } });
    for (const payload of [
      { ...command.payload, requestId: 'bad' },
      { ...command.payload, snapshotId: 'bad' },
      { ...command.payload, note: '  ' },
      { ...command.payload, note: undefined },
      { ...command.payload, note: 'x'.repeat(501) },
    ]) expect(() => validateWalletCommand({ ...command, payload })).toThrow('Invalid wallet request');
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
