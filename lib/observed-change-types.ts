export type ObservedChangeDirection = 'up' | 'down';
export type ObservedChangeVolume = 'fell' | 'held' | 'rose';
export type ObservedChangeRow = {
  customerName: string;
  itemKey: string;
  changedOn: string;
  windowDays: number;
  direction: ObservedChangeDirection;
  volume: ObservedChangeVolume;
  beforeRatePaise: number;
  afterRatePaise: number;
  changePct: number;
  beforeQty: number;
  afterQty: number;
  beforeRevenuePaise: number;
  afterRevenuePaise: number;
  beforeGpPaise: number | null;
  afterGpPaise: number | null;
};
export type ObservedChanges = {
  view: 'observed_changes';
  asOf: string;
  salesThrough: string | null;
  page: number;
  pageSize: 10;
  total: number;
  summary: { changes: number; increases: number; decreases: number; increasesFell: number; increasesHeld: number; increasesRose: number; labs: number; unitChanges: number };
  rows: ObservedChangeRow[];
};

const summaryKeys = ['changes', 'increases', 'decreases', 'increasesFell', 'increasesHeld', 'increasesRose', 'labs', 'unitChanges'] as const;
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value);
const count = (value: unknown): value is number => integer(value) && value >= 0;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
function date(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function normalizeObservedChanges(value: unknown): ObservedChanges | null {
  const data = object(value);
  const summary = object(data?.summary);
  if (!data || !summary || data.view !== 'observed_changes' || !date(data.asOf)
    || (data.salesThrough !== null && !date(data.salesThrough))
    || !integer(data.page) || data.page < 1 || data.page > 100 || data.pageSize !== 10 || !count(data.total)
    || Object.keys(summary).length !== summaryKeys.length || summaryKeys.some(key => !count(summary[key]))
    || !Array.isArray(data.rows) || data.rows.length > 10 || data.rows.length > data.total) return null;
  for (const value of data.rows) {
    const row = object(value);
    if (!row || !text(row.customerName) || !text(row.itemKey) || !date(row.changedOn) || !count(row.windowDays)
      || !['up', 'down'].includes(row.direction as string) || !['fell', 'held', 'rose'].includes(row.volume as string)
      || !count(row.beforeRatePaise) || !count(row.afterRatePaise) || !finite(row.changePct)
      || !finite(row.beforeQty) || !finite(row.afterQty)
      || !count(row.beforeRevenuePaise) || !count(row.afterRevenuePaise)
      || (row.beforeGpPaise !== null && !integer(row.beforeGpPaise))
      || (row.afterGpPaise !== null && !integer(row.afterGpPaise))) return null;
  }
  // Rebuild the public shape so unexpected response fields never reach the UI.
  return {
    view: 'observed_changes', asOf: data.asOf, salesThrough: data.salesThrough as string | null,
    page: data.page, pageSize: 10, total: data.total,
    summary: Object.fromEntries(summaryKeys.map(key => [key, summary[key]])) as ObservedChanges['summary'],
    rows: data.rows.map(value => {
      const row = value as ObservedChangeRow;
      return { customerName: row.customerName, itemKey: row.itemKey, changedOn: row.changedOn, windowDays: row.windowDays,
        direction: row.direction, volume: row.volume, beforeRatePaise: row.beforeRatePaise, afterRatePaise: row.afterRatePaise,
        changePct: row.changePct, beforeQty: row.beforeQty, afterQty: row.afterQty,
        beforeRevenuePaise: row.beforeRevenuePaise, afterRevenuePaise: row.afterRevenuePaise,
        beforeGpPaise: row.beforeGpPaise, afterGpPaise: row.afterGpPaise };
    }),
  };
}
