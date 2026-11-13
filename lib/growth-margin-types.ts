export type GrowthMarginView = 'labs' | 'items';
export type GrowthMarginSort = 'sales' | 'gp' | 'margin' | 'margin_asc' | 'spread';
export type GrowthMarginFilter = 'all' | 'low' | 'unlinked' | 'below_cost' | 'spread';
export type GrowthMarginPayload = { view: GrowthMarginView; page: number; sort?: GrowthMarginSort; filter?: GrowthMarginFilter; q?: string };
export type GrowthMarginDetailPayload = { itemKey: string; page: number } | { labKey: string; page: number };
export type GrowthBilledBelowPayload = { page: number };
export type GrowthBilledBelow = {
  lines: number; gapPaise: number; unitMismatchLines: number; approvedPricesInUse: number;
  page: number; pageSize: 20; total: number;
  rows: { date: string; customerId: string; name: string | null; town: string | null; itemName: string; quantity: number; billedRatePaise: number; approvedRatePaise: number; gapPaise: number; voucherRef: string }[];
};
type MarginNumbers = { salesPaise: number; knownSalesPaise: number; gpPaise: number; marginPct: number | null; low: boolean };
export type GrowthMarginLabRow = MarginNumbers & { labKey: string; customerId: string | null; name: string | null; town: string | null; coveragePct: number | null; totalSalesPaise?: number | null; instrumentSalesPaise?: number | null };
export type GrowthMarginItemRow = MarginNumbers & { itemKey: string; name: string | null; labs: number; priceLowPaise: number | null; typicalPricePaise: number | null; priceHighPaise: number | null; spreadPaise: number; belowCost: boolean };
export type GrowthMarginLevers = {
  priceSpread: { items: number; pairs: number; paise: number };
  lowMargin: { items: number; paiseToThreshold: number; examples: { name: string | null; marginPct: number | null; salesPaise: number; labs: number }[] };
  freeGoods: { lines: number; costPaise: number }; instrumentsGpPaise: number;
};
type MarginBase = { sort: GrowthMarginSort; filter: GrowthMarginFilter; q: string | null; page: number; pageSize: 20; total: number; thresholdPct: number; consumablesMarginPct: number | null; levers: GrowthMarginLevers };
export type GrowthMarginData = MarginBase & ({ view: 'labs'; rows: GrowthMarginLabRow[] } | { view: 'items'; rows: GrowthMarginItemRow[] });
type PriceRow = { name: string | null; unitPricePaise: number; quantity: number; salesPaise: number; belowTypical: boolean; packDifference: boolean; approvedPricePaise: number | null };
export type GrowthMarginItemDetailRow = PriceRow & { labKey: string; customerId: string | null; town: string | null };
export type GrowthMarginLabDetailRow = PriceRow & { itemKey: string; tallyItemKey: string | null; typicalPricePaise: number | null; gpPaise: number; marginPct: number | null };
type DetailBase = { name: string | null; marginPct: number | null; page: number; pageSize: number; total: number };
export type GrowthMarginDetail = DetailBase & (
  { kind: 'item'; itemKey: string; typicalPricePaise: number | null; labs: number; tallyItemKey: string | null; rows: GrowthMarginItemDetailRow[] }
  | { kind: 'lab'; labKey: string; customerId: string | null; town: string | null; salesPaise: number; gpPaise: number; rows: GrowthMarginLabDetailRow[] }
);
type Obj = Record<string, unknown>;
const object = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const nullableText = (v: unknown) => v === null || typeof v === 'string';
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);
const count = (v: unknown): v is number => integer(v) && v >= 0;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const nullable = (v: unknown, check: (v: unknown) => boolean) => v === null || check(v);
const coverage = (v: unknown) => finite(v) && v >= 0 && v <= 100;
const keys = (v: Obj, required: string[], optional: string[] = []) => required.every(k => Object.hasOwn(v, k)) && Object.keys(v).every(k => [...required, ...optional].includes(k));
const pick = (v: Obj, fields: string[]) => Object.fromEntries(fields.map(k => [k, v[k]]));
export const growthMarginSorts = (view: GrowthMarginView): GrowthMarginSort[] => view === 'items' ? ['sales', 'gp', 'margin', 'margin_asc', 'spread'] : ['sales', 'gp', 'margin', 'margin_asc'];
export const growthMarginFilters = (view: GrowthMarginView): GrowthMarginFilter[] => view === 'items' ? ['all', 'low', 'below_cost', 'spread'] : ['all', 'low', 'unlinked'];

export function buildGrowthMarginPayload(value: unknown): GrowthMarginPayload | null {
  if (!object(value) || !keys(value, ['view', 'page'], ['sort', 'filter', 'q']) || (value.view !== 'labs' && value.view !== 'items') || !count(value.page) || value.page < 1
    || ('sort' in value && !growthMarginSorts(value.view).includes(value.sort as GrowthMarginSort))
    || ('filter' in value && !growthMarginFilters(value.view).includes(value.filter as GrowthMarginFilter))
    || ('q' in value && (!text(value.q) || value.q.length > 60))) return null;
  return { view: value.view, page: value.page, ...('sort' in value ? { sort: value.sort as GrowthMarginSort } : {}), ...('filter' in value ? { filter: value.filter as GrowthMarginFilter } : {}), ...('q' in value ? { q: value.q as string } : {}) };
}

export function buildGrowthMarginDetailPayload(value: unknown): GrowthMarginDetailPayload | null {
  if (!object(value) || !count(value.page) || value.page < 1) return null;
  if (keys(value, ['itemKey', 'page']) && text(value.itemKey)) return { itemKey: value.itemKey, page: value.page };
  if (keys(value, ['labKey', 'page']) && text(value.labKey)) return { labKey: value.labKey, page: value.page };
  return null;
}

const pageValid = (v: Obj, fixed = false) => count(v.page) && v.page >= 1 && count(v.pageSize) && v.pageSize >= 1 && (!fixed || v.pageSize === 20) && count(v.total) && Array.isArray(v.rows) && v.rows.length <= v.pageSize && v.rows.length <= v.total;
export function buildGrowthBilledBelowPayload(value: unknown): GrowthBilledBelowPayload | null {
  return object(value) && keys(value, ['page']) && count(value.page) && value.page >= 1 ? { page: value.page } : null;
}

export function normalizeGrowthBilledBelow(value: unknown): GrowthBilledBelow | null {
  if (!object(value) || !pageValid(value, true) || !['lines', 'gapPaise', 'unitMismatchLines', 'approvedPricesInUse'].every(k => count(value[k]))) return null;
  const fields = ['date', 'customerId', 'name', 'town', 'itemName', 'quantity', 'billedRatePaise', 'approvedRatePaise', 'gapPaise', 'voucherRef'];
  if (!(value.rows as unknown[]).every(r => object(r) && ['date', 'customerId', 'itemName', 'voucherRef'].every(k => text(r[k])) && nullableText(r.name) && nullableText(r.town) && finite(r.quantity) && ['billedRatePaise', 'approvedRatePaise', 'gapPaise'].every(k => integer(r[k])))) return null;
  return { ...pick(value, ['lines', 'gapPaise', 'unitMismatchLines', 'approvedPricesInUse', 'page', 'pageSize', 'total']), rows: (value.rows as Obj[]).map(r => pick(r, fields)) } as GrowthBilledBelow;
}
const baseFields = ['salesPaise', 'knownSalesPaise', 'gpPaise', 'marginPct', 'low'];
const labFields = [...baseFields, 'labKey', 'customerId', 'name', 'town', 'coveragePct', 'totalSalesPaise', 'instrumentSalesPaise'];
/** Total business fields arrive only after the lab-total migration; absent or null is accepted. */
const optionalPaise = (v: unknown) => v === undefined || v === null || integer(v);
const itemFields = [...baseFields, 'itemKey', 'name', 'labs', 'priceLowPaise', 'typicalPricePaise', 'priceHighPaise', 'spreadPaise', 'belowCost'];
export function normalizeGrowthMargin(value: unknown): GrowthMarginData | null {
  if (!object(value) || !pageValid(value, true) || (value.view !== 'labs' && value.view !== 'items') || !growthMarginSorts(value.view).includes(value.sort as GrowthMarginSort) || !growthMarginFilters(value.view).includes(value.filter as GrowthMarginFilter)
    || !nullable(value.q, v => text(v) && v.length <= 60) || !finite(value.thresholdPct) || !nullable(value.consumablesMarginPct, finite)) return null;
  const l = value.levers;
  if (!object(l) || !object(l.priceSpread) || !['items', 'pairs'].every(k => count((l.priceSpread as Obj)[k])) || !integer(l.priceSpread.paise)
    || !object(l.lowMargin) || !count(l.lowMargin.items) || !integer(l.lowMargin.paiseToThreshold) || !Array.isArray(l.lowMargin.examples)
    || !l.lowMargin.examples.every(e => object(e) && nullableText(e.name) && nullable(e.marginPct, finite) && integer(e.salesPaise) && count(e.labs))
    || !object(l.freeGoods) || !count(l.freeGoods.lines) || !integer(l.freeGoods.costPaise) || !integer(l.instrumentsGpPaise)) return null;
  if (!(value.rows as unknown[]).every(r => object(r) && ['salesPaise', 'knownSalesPaise', 'gpPaise'].every(k => integer(r[k])) && nullable(r.marginPct, finite) && typeof r.low === 'boolean' && nullableText(r.name)
    && (value.view === 'labs' ? text(r.labKey) && nullableText(r.customerId) && nullableText(r.town) && nullable(r.coveragePct, coverage) && optionalPaise(r.totalSalesPaise) && optionalPaise(r.instrumentSalesPaise)
      : text(r.itemKey) && count(r.labs) && ['priceLowPaise', 'typicalPricePaise', 'priceHighPaise'].every(k => nullable(r[k], integer)) && integer(r.spreadPaise) && typeof r.belowCost === 'boolean'))) return null;
  return { ...pick(value, ['view', 'sort', 'filter', 'q', 'page', 'pageSize', 'total', 'thresholdPct', 'consumablesMarginPct']), levers: {
    priceSpread: pick(l.priceSpread, ['items', 'pairs', 'paise']), lowMargin: { ...pick(l.lowMargin, ['items', 'paiseToThreshold']), examples: l.lowMargin.examples.map(e => pick(e as Obj, ['name', 'marginPct', 'salesPaise', 'labs'])) }, freeGoods: pick(l.freeGoods, ['lines', 'costPaise']), instrumentsGpPaise: l.instrumentsGpPaise,
  }, rows: (value.rows as Obj[]).map(r => pick(r, value.view === 'labs' ? labFields : itemFields)) } as GrowthMarginData;
}

const priceFields = ['name', 'unitPricePaise', 'quantity', 'salesPaise', 'belowTypical', 'packDifference', 'approvedPricePaise'];
export function normalizeGrowthMarginDetail(value: unknown): GrowthMarginDetail | null {
  if (!object(value) || !pageValid(value) || !nullableText(value.name) || !nullable(value.marginPct, finite)) return null;
  if (value.kind === 'item' ? !text(value.itemKey) || !nullable(value.typicalPricePaise, integer) || !count(value.labs) || !nullableText(value.tallyItemKey)
    : value.kind !== 'lab' || !text(value.labKey) || !nullableText(value.customerId) || !nullableText(value.town) || !integer(value.salesPaise) || !integer(value.gpPaise)) return null;
  if (!(value.rows as unknown[]).every(r => object(r) && nullableText(r.name) && integer(r.unitPricePaise) && finite(r.quantity) && integer(r.salesPaise) && typeof r.belowTypical === 'boolean' && typeof r.packDifference === 'boolean' && nullable(r.approvedPricePaise, integer)
    && (value.kind === 'item' ? text(r.labKey) && nullableText(r.customerId) && nullableText(r.town)
      : text(r.itemKey) && nullableText(r.tallyItemKey) && nullable(r.typicalPricePaise, integer) && integer(r.gpPaise) && nullable(r.marginPct, finite)))) return null;
  return { ...pick(value, ['kind', 'name', 'marginPct', 'page', 'pageSize', 'total', ...(value.kind === 'item' ? ['itemKey', 'typicalPricePaise', 'labs', 'tallyItemKey'] : ['labKey', 'customerId', 'town', 'salesPaise', 'gpPaise'])]), rows: (value.rows as Obj[]).map(r => pick(r, [...priceFields, ...(value.kind === 'item' ? ['labKey', 'customerId', 'town'] : ['itemKey', 'tallyItemKey', 'typicalPricePaise', 'gpPaise', 'marginPct'])])) } as GrowthMarginDetail;
}
