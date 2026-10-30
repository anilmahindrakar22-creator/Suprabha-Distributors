import type { WalletCommand, WalletConfidence, WalletMethod, WalletRow, WalletSnapshot } from '@/lib/wallet-types';
import { rupeesToPaise } from '@/lib/wallet-format';

export type QuickEntryShared = {
  source: string;
  method: WalletMethod;
  confidence: WalletConfidence;
  asOf: string;
  note: string;
};

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
  const paise = rupeesToPaise(typedRupees);
  if (paise === null) throw new Error('Enter rupees with up to 2 decimals.');
  const currentPaise = row.current?.monthlyWalletPaise ?? row.walletPaise;
  return {
    action: 'record_wallet_snapshot',
    payload: {
      requestId,
      customerId: row.customerId,
      monthlyWalletPaise: paise,
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
