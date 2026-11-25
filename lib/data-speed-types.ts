export type DataSpeedResponse = {
  statsAvailable: boolean; statsResetAt: string | null; windowFrom: string | null;
  reads: { gateway: string; calls: number; meanMs: number; previousMeanMs: number | null; maxMs: number }[];
  budget: { meanMs: number; maxMs: number };
  lastImportAt: string | null; lastRebuildAt: string | null;
  exceptions: { reason: string; total: number; under7Days: number; from7To30Days: number; over30Days: number; acknowledgeable: number }[];
  snapshotCount: number;
};
const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const nullableString = (v: unknown): v is string | null => v === null || typeof v === 'string';
export function normalizeDataSpeed(body: unknown): DataSpeedResponse {
  if (!object(body) || typeof body.statsAvailable !== 'boolean' || !nullableString(body.statsResetAt) || !nullableString(body.windowFrom)
    || !nullableString(body.lastImportAt) || !nullableString(body.lastRebuildAt) || !integer(body.snapshotCount)
    || !object(body.budget) || !integer(body.budget.meanMs) || !integer(body.budget.maxMs)
    || !Array.isArray(body.reads) || body.reads.length > 30 || !body.reads.every(row => object(row)
      && typeof row.gateway === 'string' && integer(row.calls) && integer(row.meanMs)
      && (row.previousMeanMs === null || integer(row.previousMeanMs)) && integer(row.maxMs))
    || !Array.isArray(body.exceptions) || body.exceptions.length > 50 || !body.exceptions.every(row => object(row)
      && typeof row.reason === 'string' && integer(row.total) && integer(row.under7Days)
      && integer(row.from7To30Days) && integer(row.over30Days)
      && row.total === row.under7Days + row.from7To30Days + row.over30Days
      && (row.acknowledgeable === undefined || integer(row.acknowledgeable)))) throw new Error('Invalid data speed report');
  for (const row of body.exceptions as Record<string, unknown>[]) if (row.acknowledgeable === undefined) row.acknowledgeable = 0;
  return body as unknown as DataSpeedResponse;
}
const labels: Record<string, string> = {
  economics: 'Instrument economics', requirements: 'Requirements', today: 'Today', growth: 'Growth', order_list: 'Orders list',
  order_summary: 'Order summary', purchase: 'Purchase orders', customer_map: 'Customer map', accounts: 'Accounts', pricing: 'Pricing',
  wallet: 'Wallet', power_map: 'Power map', user: 'Sign-in and user', my_actions: 'My actions', stock_alert: 'Stock alerts',
};
export function gatewayLabel(name: string): string {
  if (Object.hasOwn(labels, name)) return labels[name];
  const label = name.replace(/^stockflow_/, '').replace(/_gateway$/, '').replaceAll('_', ' ');
  return label.charAt(0).toUpperCase() + label.slice(1);
}
export function overBudget(row: Pick<DataSpeedResponse['reads'][number], 'meanMs' | 'maxMs'>, budget: DataSpeedResponse['budget']): 'mean' | 'max' | null {
  return row.meanMs > budget.meanMs ? 'mean' : row.maxMs > budget.maxMs ? 'max' : null;
}
