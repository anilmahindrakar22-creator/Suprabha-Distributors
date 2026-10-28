export type SalesCoverage = {
  window: { from: string; to: string };
  complete: boolean;
  coveredFrom: string | null;
  coveredTo: string | null;
  importedAt: string | null;
  sourceVersion: string | null;
  blockingCount: number;
  blockingItems: { sourceId: string; reason: string; recordedAt: string }[];
  rebuild: { state: 'ok' | 'paused'; since: string | null; reason: string | null };
  months: {
    month: string;
    appNetPaise: number;
    tallyNetPaise: number | null;
    differencePaise: number | null;
    state: 'matches' | 'differs' | 'no_control';
  }[];
};

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const date = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const timestamp = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
const nullable = (value: unknown, check: (value: unknown) => boolean) => value === null || check(value);
const money = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && Math.abs(value) <= 9e15;

export function parseSalesCoverage(json: unknown): SalesCoverage | null {
  if (!record(json) || !record(json.window) || !date(json.window.from) || !date(json.window.to) || json.window.from > json.window.to ||
    typeof json.complete !== 'boolean' || !nullable(json.coveredFrom, date) || !nullable(json.coveredTo, date) ||
    !nullable(json.importedAt, timestamp) || !nullable(json.sourceVersion, timestamp) ||
    typeof json.blockingCount !== 'number' || !Number.isSafeInteger(json.blockingCount) || json.blockingCount < 0 ||
    !Array.isArray(json.blockingItems) || json.blockingItems.length > 20 ||
    !json.blockingItems.every(item => record(item) && typeof item.sourceId === 'string' && typeof item.reason === 'string' && timestamp(item.recordedAt)) ||
    !record(json.rebuild) || (json.rebuild.state !== 'ok' && json.rebuild.state !== 'paused') ||
    !nullable(json.rebuild.since, timestamp) || !nullable(json.rebuild.reason, value => typeof value === 'string') ||
    !Array.isArray(json.months) || json.months.length !== 3) return null;
  if (json.complete && [json.coveredFrom, json.coveredTo, json.importedAt, json.sourceVersion].some(value => value === null)) return null;
  if (json.rebuild.state === 'paused' && (json.rebuild.since === null || json.rebuild.reason === null)) return null;
  const firstMonth = new Date(`${json.window.from}T00:00:00Z`);
  const lastDay = new Date(Date.UTC(firstMonth.getUTCFullYear(), firstMonth.getUTCMonth() + 3, 0)).toISOString().slice(0, 10);
  if (!json.window.from.endsWith('-01') || json.window.to !== lastDay) return null;
  for (const [index, row] of json.months.entries()) {
    const expected = new Date(Date.UTC(firstMonth.getUTCFullYear(), firstMonth.getUTCMonth() + index, 1)).toISOString().slice(0, 7);
    if (!record(row) || row.month !== expected || !money(row.appNetPaise)) return null;
    if (row.tallyNetPaise === null) {
      if (row.differencePaise !== null || row.state !== 'no_control') return null;
    } else if (!money(row.tallyNetPaise) || !money(row.differencePaise) || row.differencePaise !== row.appNetPaise - row.tallyNetPaise ||
      row.state !== (row.differencePaise === 0 ? 'matches' : 'differs')) return null;
  }
  return json as SalesCoverage;
}

export async function fetchSalesCoverage(signal: AbortSignal): Promise<SalesCoverage> {
  const response = await fetch('/api/instrument-economics?action=get_sales_coverage', { cache: 'no-store', signal });
  if (!response.ok) throw new Error('Sales coverage unavailable');
  const coverage = parseSalesCoverage(await response.json());
  if (!coverage) throw new Error('Sales coverage unavailable');
  return coverage;
}

export function formatPaise(n: number): string {
  const absolute = BigInt(Math.abs(n));
  const fraction = absolute % BigInt(100);
  return `${n < 0 ? '−' : ''}₹${(absolute / BigInt(100)).toLocaleString('en-IN')}${fraction ? `.${String(fraction).padStart(2, '0')}` : ''}`;
}
