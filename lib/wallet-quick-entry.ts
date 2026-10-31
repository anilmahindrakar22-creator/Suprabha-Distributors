import type { WalletCommand, WalletConfidence, WalletMethod, WalletRow, WalletSnapshot } from '@/lib/wallet-types';
import { rupeesToPaise } from '@/lib/wallet-format';
import { calculateTestVolume } from '@/lib/wallet-test-volume';

export type QuickEntryShared = {
  source: string;
  method: WalletMethod;
  confidence: WalletConfidence;
  asOf: string;
  note: string;
  workingDaysPerMonth?: number;
  paisePerTest?: number | null;
};

export function quickEntryAmount(shared: QuickEntryShared, typedValue: string): number | null {
  return shared.method === 'test_volume'
    ? calculateTestVolume(Number(typedValue), shared.workingDaysPerMonth ?? 26, shared.paisePerTest ?? NaN)
    : rupeesToPaise(typedValue);
}

export function needsReason(currentPaise: number | null, newPaise: number | null): boolean {
  return currentPaise !== null && newPaise !== null && newPaise < currentPaise;
}

export function buildRowCommand(
  shared: QuickEntryShared,
  row: WalletRow & { current?: WalletSnapshot | null },
  typedRupees: string,
  loweredReason: string,
  requestId: string,
): Extract<WalletCommand, { action: 'record_wallet_snapshot' }> {
  const paise = quickEntryAmount(shared, typedRupees);
  if (paise === null) throw new Error(shared.method === 'test_volume' ? 'Enter valid tests, working days and price per test.' : 'Enter rupees with up to 2 decimals.');
  const currentPaise = row.current?.monthlyWalletPaise ?? row.walletPaise;
  return {
    action: 'record_wallet_snapshot',
    payload: {
      requestId,
      customerId: row.customerId,
      monthlyWalletPaise: paise,
      ...(shared.method === 'test_volume' ? { testVolume: { testsPerDay: Number(typedRupees), workingDaysPerMonth: shared.workingDaysPerMonth ?? 26, paisePerTest: shared.paisePerTest! } } : {}),
      method: shared.method,
      source: shared.source.trim(),
      confidence: shared.confidence,
      asOf: shared.asOf,
      note: shared.note.trim(),
      loweredReason: needsReason(currentPaise, paise) ? loweredReason.trim() : null,
      divisions: [],
      expectedCurrentSnapshotId: row.current?.id ?? null,
    },
  };
}
