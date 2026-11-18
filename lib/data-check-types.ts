export type DataChecksResponse = {
  view: 'data_checks'; asOf: string;
  unlinkedLedgers: { count: number; ofBuying: number; top: { name: string | null; lastSaleOn: string }[] };
  noPinCode: { count: number; ofBuying: number; top: { customerId: string; name: string; town: string | null }[] };
  itemsNotInStockFlow: { count: number; ofSold: number };
  freshness: { salesThrough: string | null; itemListReadAt: string | null };
};
const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const keys = (v: Record<string, unknown>, expected: string[]) => Object.keys(v).length === expected.length && expected.every(k => Object.hasOwn(v, k));
const count = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const date = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const nullableText = (v: unknown) => v === null || typeof v === 'string';
function buying(v: unknown): v is Record<string, unknown> & { count: number; ofBuying: number; top: unknown[] } {
  return object(v) && keys(v, ['count', 'ofBuying', 'top']) && count(v.count) && count(v.ofBuying)
    && v.count <= v.ofBuying && Array.isArray(v.top);
}
export function normalizeDataChecks(value: unknown): DataChecksResponse | null {
  if (!object(value) || !keys(value, ['view', 'asOf', 'unlinkedLedgers', 'noPinCode', 'itemsNotInStockFlow', 'freshness'])
    || value.view !== 'data_checks' || !date(value.asOf)) return null;
  const asOf = value.asOf;
  const { unlinkedLedgers: ledgers, noPinCode: pins, itemsNotInStockFlow: items, freshness } = value;
  if (!buying(ledgers) || ledgers.top.length !== Math.min(10, ledgers.count)
    || !ledgers.top.every(row => object(row) && keys(row, ['name', 'lastSaleOn']) && nullableText(row.name) && date(row.lastSaleOn) && row.lastSaleOn <= asOf)) return null;
  if (!buying(pins) || pins.top.length !== Math.min(20, pins.count)
    || !pins.top.every(row => object(row) && keys(row, ['customerId', 'name', 'town']) && typeof row.customerId === 'string'
      && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.customerId) && text(row.name) && nullableText(row.town))) return null;
  if (!object(items) || !keys(items, ['count', 'ofSold']) || !count(items.count) || !count(items.ofSold) || items.count > items.ofSold) return null;
  if (!object(freshness) || !keys(freshness, ['salesThrough', 'itemListReadAt'])
    || !(freshness.salesThrough === null || (date(freshness.salesThrough) && freshness.salesThrough <= asOf))
    || !(freshness.itemListReadAt === null || (typeof freshness.itemListReadAt === 'string'
      && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(freshness.itemListReadAt)
      && Number.isFinite(Date.parse(freshness.itemListReadAt))))) return null;
  return value as DataChecksResponse;
}
