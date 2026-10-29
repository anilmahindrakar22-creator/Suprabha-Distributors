export type WalletMethod = 'customer_stated' | 'test_volume' | 'manager_estimate';
export type WalletConfidence = 'high' | 'medium' | 'low';
export type WalletView = 'focus' | 'all' | 'no_estimate' | 'stale' | 'below_sales';
export type WalletPolicy = { version: number; walletShareTargetBps: number; focusBandBps: number; staleAfterMonths: number; note: string; enteredBy: string; enteredAt: string };
export type WalletCoverage = { certified: boolean; windowFrom: string; windowTo: string; windowLabel: string; reason: string | null };
export type WalletRow = {
  customerId: string; name: string; city: string | null;
  walletPaise: number | null; salesPaise: number | null; sharePermille: number | null;
  untappedPaise: number | null; captureGapPaise: number | null;
  confidence: WalletConfidence | null; asOf: string | null; verified: boolean;
  stale: boolean; belowSales: boolean; inFocusBand: boolean | null;
};
export type WalletWorkspace = {
  policy: WalletPolicy; coverage: WalletCoverage; view: WalletView; page: number; pageSize: 50; total: number; rows: WalletRow[];
  summary: { focusCount: number | null; focusGapPaise: number | null; estimatedAccounts: number; accountsWithSales: number | null; unlinkedSalesPaise: number | null; unlinkedLedgers: number | null };
};
export type WalletSnapshot = { id: string; monthlyWalletPaise: number; method: WalletMethod; source: string; confidence: WalletConfidence; asOf: string; note: string; loweredReason: string | null; enteredBy: string; enteredAt: string; verifiedBy: string | null; divisions: Array<{ code: string; name: string; monthlyWalletPaise: number }>; unallocatedPaise: number };
export type WalletAccount = { policy: WalletPolicy; coverage: WalletCoverage; row: WalletRow; current: WalletSnapshot | null; history: WalletSnapshot[]; divisions: Array<{ code: string; name: string }> };
export type WalletCommand =
  | { action: 'get_wallet_workspace'; payload: { view: WalletView; page: number; search: string } }
  | { action: 'get_wallet_account'; payload: { customerId: string } }
  | { action: 'record_wallet_snapshot'; payload: { requestId: string; customerId: string; monthlyWalletPaise: number; method: WalletMethod; source: string; confidence: WalletConfidence; asOf: string; note: string; loweredReason: string | null; divisions: Array<{ code: string; monthlyWalletPaise: number }>; expectedCurrentSnapshotId: string | null } }
  | { action: 'set_wallet_policy'; payload: { requestId: string; walletShareTargetBps: number; focusBandBps: number; staleAfterMonths: number; note: string; expectedVersion: number } };

const views: WalletView[] = ['focus', 'all', 'no_estimate', 'stale', 'below_sales'];
const methods: WalletMethod[] = ['customer_stated', 'test_volume', 'manager_estimate'];
const confidences: WalletConfidence[] = ['high', 'medium', 'low'];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const date = /^\d{4}-\d{2}-\d{2}$/;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, min: number, max: number) => typeof value === 'string' && value.length >= min && value.length <= max;
const integer = (value: unknown, min: number, max: number) => Number.isInteger(value) && (value as number) >= min && (value as number) <= max;
const fail = (): never => { throw new Error('Invalid wallet request'); };

export function validateWalletCommand(input: unknown): WalletCommand {
  if (!object(input) || !object(input.payload) || typeof input.action !== 'string') return fail();
  const p = input.payload;
  switch (input.action) {
    case 'get_wallet_workspace':
      if (!views.includes(p.view as WalletView) || !integer(p.page, 1, Number.MAX_SAFE_INTEGER) || !text(p.search, 0, 80)) return fail();
      return { action: input.action, payload: { view: p.view as WalletView, page: p.page as number, search: p.search as string } };
    case 'get_wallet_account':
      if (typeof p.customerId !== 'string' || !uuid.test(p.customerId)) return fail();
      return { action: input.action, payload: { customerId: p.customerId } };
    case 'record_wallet_snapshot': {
      if (typeof p.requestId !== 'string' || !uuid.test(p.requestId) || typeof p.customerId !== 'string' || !uuid.test(p.customerId)
        || !integer(p.monthlyWalletPaise, 0, 9e15) || !methods.includes(p.method as WalletMethod) || !text(p.source, 3, 500)
        || !confidences.includes(p.confidence as WalletConfidence) || typeof p.asOf !== 'string' || !date.test(p.asOf)
        || !text(p.note, 3, 500) || !(p.loweredReason === null || text(p.loweredReason, 3, 500))
        || !Array.isArray(p.divisions) || p.divisions.length > 10
        || !p.divisions.every(d => object(d) && text(d.code, 1, 100) && integer(d.monthlyWalletPaise, 0, 9e15))
        || new Set(p.divisions.map(d => (d as Record<string, unknown>).code)).size !== p.divisions.length
        || !(p.expectedCurrentSnapshotId === null || (typeof p.expectedCurrentSnapshotId === 'string' && uuid.test(p.expectedCurrentSnapshotId)))) return fail();
      return { action: input.action, payload: p as unknown as Extract<WalletCommand, { action: 'record_wallet_snapshot' }>['payload'] };
    }
    case 'set_wallet_policy':
      if (typeof p.requestId !== 'string' || !uuid.test(p.requestId) || !integer(p.walletShareTargetBps, 1000, 10000)
        || !integer(p.focusBandBps, 1000, 10000) || !integer(p.staleAfterMonths, 1, 24) || !text(p.note, 3, 500)
        || !integer(p.expectedVersion, 1, Number.MAX_SAFE_INTEGER)) return fail();
      return { action: input.action, payload: p as unknown as Extract<WalletCommand, { action: 'set_wallet_policy' }>['payload'] };
    default: return fail();
  }
}
