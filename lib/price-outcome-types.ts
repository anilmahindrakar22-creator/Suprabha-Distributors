export type PriceOutcomeState = 'different' | 'not_billed' | 'matches' | 'cannot_match';
export type PriceOutcomeRow = {
  priceId: string;
  customerId: string;
  customerName: string;
  itemKey: string;
  approvedPaise: number;
  effectiveFrom: string;
  validTo: string | null;
  state: PriceOutcomeState;
  reason: 'no_ledger_link' | 'item_not_in_tally' | 'unit_differs' | null;
  lines: number;
  packLines: number;
  lastBilledOn: string | null;
  lastBilledPaise: number | null;
  worstDiffPaise: number | null;
  differentLines: number;
};
export type PriceOutcomes = {
  view: 'price_outcomes';
  asOf: string;
  toleranceRupees: 1;
  page: number;
  pageSize: 10;
  total: number;
  counts: Record<PriceOutcomeState, number>;
  salesThrough: string | null;
  matureCount: number;
  rows: PriceOutcomeRow[];
};

const states = ['different', 'not_billed', 'matches', 'cannot_match'] as const;
const reasons = ['no_ledger_link', 'item_not_in_tally', 'unit_differs'];
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value);
const count = (value: unknown): value is number => integer(value) && value >= 0;
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const uuid = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
function date(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function normalizePriceOutcomes(value: unknown): PriceOutcomes | null {
  const data = object(value);
  const counts = object(data?.counts);
  if (!data || !counts || data.view !== 'price_outcomes' || !date(data.asOf) || data.toleranceRupees !== 1
    || !integer(data.page) || data.page < 1 || data.page > 999999 || data.pageSize !== 10 || !count(data.total)
    || !count(data.matureCount) || (data.salesThrough !== null && !date(data.salesThrough))
    || Object.keys(counts).length !== 4 || states.some(state => !count(counts[state]))
    || !Array.isArray(data.rows) || data.rows.length > 10 || data.rows.length > data.total) return null;
  for (const value of data.rows) {
    const row = object(value);
    if (!row || !uuid(row.priceId) || !uuid(row.customerId) || !text(row.customerName) || !text(row.itemKey)
      || !integer(row.approvedPaise) || row.approvedPaise <= 0 || !date(row.effectiveFrom)
      || (row.validTo !== null && !date(row.validTo)) || !states.includes(row.state as PriceOutcomeState)
      || (row.state === 'cannot_match' ? !reasons.includes(row.reason as string) : row.reason !== null)
      || !count(row.lines) || !count(row.packLines) || !count(row.differentLines) || row.differentLines > row.lines
      || (row.lastBilledOn !== null && !date(row.lastBilledOn))
      || (row.lastBilledPaise !== null && !count(row.lastBilledPaise))
      || (row.worstDiffPaise !== null && !integer(row.worstDiffPaise))
      || (row.lines === 0 ? row.lastBilledOn !== null || row.lastBilledPaise !== null || row.worstDiffPaise !== null
        : row.lastBilledOn === null || row.lastBilledPaise === null || row.worstDiffPaise === null)) return null;
  }
  // Rebuild the public shape so unexpected response fields never reach the UI.
  return {
    view: 'price_outcomes', asOf: data.asOf, toleranceRupees: 1, page: data.page, pageSize: 10,
    total: data.total, counts: Object.fromEntries(states.map(state => [state, counts[state]])) as PriceOutcomes['counts'],
    salesThrough: data.salesThrough as string | null, matureCount: data.matureCount,
    rows: data.rows.map(value => {
      const row = value as PriceOutcomeRow;
      return { priceId: row.priceId, customerId: row.customerId, customerName: row.customerName, itemKey: row.itemKey,
        approvedPaise: row.approvedPaise, effectiveFrom: row.effectiveFrom, validTo: row.validTo, state: row.state,
        reason: row.reason, lines: row.lines, packLines: row.packLines, lastBilledOn: row.lastBilledOn,
        lastBilledPaise: row.lastBilledPaise, worstDiffPaise: row.worstDiffPaise, differentLines: row.differentLines };
    }),
  };
}
