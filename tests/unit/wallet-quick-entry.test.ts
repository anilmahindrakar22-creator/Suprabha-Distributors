import { describe, expect, it } from 'vitest';
import { buildRowCommand, needsReason } from '@/lib/wallet-quick-entry';
import type { WalletRow } from '@/lib/wallet-types';
import { calculateTestVolume } from '@/lib/wallet-test-volume';

const row: WalletRow = { customerId: 'customer-id', name: 'Lab', city: 'Bidar', walletPaise: 1000000, salesPaise: null, sharePermille: null, untappedPaise: null, captureGapPaise: null, confidence: 'medium', asOf: '2026-10-30', verified: false, stale: false, belowSales: false, inFocusBand: null };
const shared = { source: ' Owner estimate, Oct 2026 ', method: 'manager_estimate' as const, confidence: 'medium' as const, asOf: '2026-10-30', note: ' Quick entry ' };

describe('wallet quick entry command helpers', () => {
  it('calculates integer paise with bounded integer inputs', () => {
    expect(calculateTestVolume(80, 26, 2500)).toBe(5200000);
    expect(calculateTestVolume(1, 1, 1)).toBe(1);
    expect(calculateTestVolume(100000, 31, 100000000)).toBe(310000000000000);
    for (const bad of [0, -1, 1.5, NaN, Infinity]) {
      expect(calculateTestVolume(bad, 26, 2500)).toBeNull();
      expect(calculateTestVolume(80, bad, 2500)).toBeNull();
      expect(calculateTestVolume(80, 26, bad)).toBeNull();
    }
    expect(calculateTestVolume(100001, 26, 2500)).toBeNull();
    expect(calculateTestVolume(80, 32, 2500)).toBeNull();
    expect(calculateTestVolume(80, 26, 100000001)).toBeNull();
  });
  it('builds volume totals and uses them for lowering', () => {
    const volume = { ...shared, method: 'test_volume' as const, workingDaysPerMonth: 26, paisePerTest: 2500 };
    expect(buildRowCommand(volume, row, '80', '', 'request-id').payload).toMatchObject({ monthlyWalletPaise: 5200000, testVolume: { testsPerDay: 80, workingDaysPerMonth: 26, paisePerTest: 2500 }, loweredReason: null });
    expect(buildRowCommand(volume, row, '1', ' Less volume ', 'request-id').payload.loweredReason).toBe('Less volume');
    expect(() => buildRowCommand(volume, row, '1.5', '', 'request-id')).toThrow();
    expect(buildRowCommand(shared, row, '80', '', 'request-id').payload).not.toHaveProperty('testVolume');
  });
  it('includes optional special volume only when a special price and count are supplied', () => {
    const volume = { ...shared, method: 'test_volume' as const, workingDaysPerMonth: 26, paisePerTest: 2500, paisePerSpecialTest: 30000 };
    expect(buildRowCommand(volume, row, '80', '', 'request-id', '100').payload).toMatchObject({ monthlyWalletPaise: 8200000, testVolume: { testsPerDay: 80, workingDaysPerMonth: 26, paisePerTest: 2500, specialTestsPerMonth: 100, paisePerSpecialTest: 30000 } });
    const blank = buildRowCommand(volume, row, '80', '', 'request-id', '').payload.testVolume!;
    expect('specialTestsPerMonth' in blank).toBe(false);
    const noPrice = buildRowCommand({ ...volume, paisePerSpecialTest: null }, row, '80', '', 'request-id', '100').payload;
    expect(noPrice.monthlyWalletPaise).toBe(5200000);
    expect('specialTestsPerMonth' in noPrice.testVolume!).toBe(false);
  });
  it('converts rupees to paise and supplies the exact snapshot command defaults', () => {
    expect(buildRowCommand(shared, row, '12345.67', '', 'request-id')).toEqual({
      action: 'record_wallet_snapshot',
      payload: { requestId: 'request-id', customerId: 'customer-id', monthlyWalletPaise: 1234567, method: 'manager_estimate', source: 'Owner estimate, Oct 2026', confidence: 'medium', asOf: '2026-10-30', note: 'Quick entry', loweredReason: null, divisions: [], expectedCurrentSnapshotId: null },
    });
  });

  it('sets the expected current id and includes a reason only when lowering', () => {
    const current = { id: 'snapshot-id', monthlyWalletPaise: 1000000 } as never;
    expect(buildRowCommand(shared, { ...row, current }, '9000', ' Revised volume ', 'request-id').payload).toMatchObject({ monthlyWalletPaise: 900000, loweredReason: 'Revised volume', expectedCurrentSnapshotId: 'snapshot-id' });
    expect(buildRowCommand(shared, { ...row, current }, '10000', 'unused', 'request-id').payload.loweredReason).toBeNull();
  });

  it('requires a reason only for a strictly lower non-null value', () => {
    expect(needsReason(100, 99)).toBe(true);
    expect(needsReason(100, 100)).toBe(false);
    expect(needsReason(null, 0)).toBe(false);
    expect(needsReason(100, null)).toBe(false);
  });
});
