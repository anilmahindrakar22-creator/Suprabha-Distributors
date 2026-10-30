import { describe, expect, it } from 'vitest';
import { buildRowCommand, needsReason } from '@/lib/wallet-quick-entry';
import type { WalletRow } from '@/lib/wallet-types';

const row: WalletRow = { customerId: 'customer-id', name: 'Lab', city: 'Bidar', walletPaise: 1000000, salesPaise: null, sharePermille: null, untappedPaise: null, captureGapPaise: null, confidence: 'medium', asOf: '2026-10-30', verified: false, stale: false, belowSales: false, inFocusBand: null };
const shared = { source: ' Owner estimate, Oct 2026 ', method: 'manager_estimate' as const, confidence: 'medium' as const, asOf: '2026-10-30', note: ' Quick entry ' };

describe('wallet quick entry command helpers', () => {
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
