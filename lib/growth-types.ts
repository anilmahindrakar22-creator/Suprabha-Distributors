export type GrowthMeasures = {
  revenuePaise: number; repeatPaise: number; bulkPaise: number; bulkInvoices: number;
  labsBuying: number; buyingMonths: number; perBuyingMonthPaise: number | null;
};
type Contribution = { labs: number; paise: number };
export type GrowthMonth = {
  month: string; labsBuying: number; firstTime: number | null; skippedRegulars: number | null;
  salesPaise: number; purchasesRegularPaise: number; purchasesLargePaise: number; largePurchaseInvoices: number;
};
export type GrowthProfitWindow = {
  salesPaise: number; knownSalesPaise: number; costPaise: number; gpPaise: number;
  gpPct: number | null; coveragePct: number | null;
};
export type GrowthProfit = {
  method: 'average_purchase_cost_to_date';
  window: GrowthProfitWindow;
  halves: [GrowthProfitWindow & { half: 'H1' }, GrowthProfitWindow & { half: 'H2' }];
  repeat: GrowthProfitWindow;
  bulk: GrowthProfitWindow;
  months: { month: string; salesPaise: number; knownSalesPaise: number; gpPaise: number }[];
};
export const growthLabLists = ['month_buying', 'month_first', 'month_skipped', 'month_large_purchases', 'bridge_new', 'bridge_stopped', 'bridge_grew', 'bridge_fell', 'regular_labs', 'window_labs', 'bulk_invoices'] as const;
export type GrowthLabList = typeof growthLabLists[number];
export type GrowthLabRow = {
  labKey: string; customerId: string | null; name: string | null; town: string | null;
  valuePaise: number | null; monthsBought: number; lastBoughtOn: string | null; trend: 'up' | 'down' | 'flat' | null;
};
export type GrowthLargePurchaseRow = { supplierName: string | null; valuePaise: number; date: string };
export type GrowthInvoiceRow = { invoice: true; name: string | null; customerId: string | null; valuePaise: number; date: string };
export type GrowthLabsData = {
  list: GrowthLabList; month: string | null; total: number; page: number; pageSize: 20;
  half?: 'H1' | 'H2' | null;
  rows: (GrowthLabRow | GrowthLargePurchaseRow | GrowthInvoiceRow)[];
};
export type GrowthData = {
  companyCount: number;
  window: { from: string; to: string; h1From: string; h2From: string };
  confirmed: boolean; confirmedReason: string | null;
  tree: GrowthMeasures;
  scorecard: { regularLabs: number; regularPct: number | null; top10Pct: number | null };
  gp?: GrowthProfit;
  months: GrowthMonth[];
  halves: [GrowthMeasures & { half: 'H1' }, GrowthMeasures & { half: 'H2' }];
  bridge: { h1Paise: number; h2Paise: number; new: Contribution; stopped: Contribution; stoppedRegular: Contribution; grew: Contribution; fell: Contribution; same: Contribution; other: Contribution };
  health: {
    gp: { costedPct: number | null; computedAt: string | null };
    history: { firstSaleOn: string | null; monthsImported: number };
    itemGroups: { unmappedPct: number | null };
    reasons: { visitReasons180: number; constraints: number; openActions: number; visits180: number };
    catalog: { observedAt: string | null; groups: number | null };
  };
};
type Obj = Record<string, unknown>;
const object = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const count = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
// A per-buying-month average can have fractional paise; counts cannot.
const money = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const date = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
const timestamp = (v: unknown) => typeof v === 'string' && date(v.slice(0, 10)) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v));
const nullable = (v: unknown, check: (v: unknown) => boolean) => v === null || check(v);
const pct = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100;
const signedPct = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
export const isGrowthMonth = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
const measures = (v: unknown) => object(v) && ['revenuePaise', 'repeatPaise', 'bulkPaise'].every(k => money(v[k])) && nullable(v.perBuyingMonthPaise, money) && ['bulkInvoices', 'labsBuying', 'buyingMonths'].every(k => count(v[k]));

/** Reject incomplete or incorrectly typed responses; never coerce unknowns into zero. */
export function normalizeGrowth(value: unknown): GrowthData | null {
  if (!object(value)) return null;
  const { window: w, tree, halves, bridge: b, health: h } = value;
  if (!count(value.companyCount) || typeof value.confirmed !== 'boolean' || !nullable(value.confirmedReason, v => typeof v === 'string')) return null;
  if (!object(w) || !['from', 'to', 'h1From', 'h2From'].every(k => date(w[k])) || String(w.from) !== w.h1From || String(w.h1From) >= String(w.h2From) || String(w.h2From) >= String(w.to)) return null;
  const s = value.scorecard;
  if (!object(s) || !count(s.regularLabs) || !nullable(s.regularPct, pct) || !nullable(s.top10Pct, pct)) return null;
  const end = new Date(String(w.to));
  const endMonth = end.getUTCFullYear() * 12 + end.getUTCMonth();
  if (!Array.isArray(value.months) || value.months.length !== 12 || !value.months.every((m, i) => {
    if (!object(m) || !isGrowthMonth(m.month)) return false;
    const [year, month] = m.month.split('-').map(Number);
    return year * 12 + month - 1 === endMonth - 12 + i
      && count(m.labsBuying) && nullable(m.firstTime, count) && nullable(m.skippedRegulars, count)
      && count(m.largePurchaseInvoices) && ['salesPaise', 'purchasesRegularPaise', 'purchasesLargePaise'].every(k => money(m[k]));
  })) return null;
  if ('gp' in value) {
    const gp = value.gp;
    const gpWindow = (v: unknown): v is GrowthProfitWindow => object(v)
      && ['salesPaise', 'knownSalesPaise', 'costPaise', 'gpPaise'].every(k => Number.isSafeInteger(v[k]))
      && nullable(v.gpPct, signedPct) && nullable(v.coveragePct, pct);
    if (!object(gp) || gp.method !== 'average_purchase_cost_to_date' || !gpWindow(gp.window)
      || !Array.isArray(gp.halves) || gp.halves.length !== 2
      || !gp.halves.every((v, i) => object(v) && gpWindow(v) && (v as Obj).half === (i === 0 ? 'H1' : 'H2'))
      || !gpWindow(gp.repeat) || !gpWindow(gp.bulk)
      || !Array.isArray(gp.months) || gp.months.length !== 12
      || !gp.months.every((v, i) => object(v) && isGrowthMonth(v.month)
        && v.month === (value.months as Obj[])[i].month
        && ['salesPaise', 'knownSalesPaise', 'gpPaise'].every(k => Number.isSafeInteger(v[k])))) return null;
  }
  if (!measures(tree) || !Array.isArray(halves) || halves.length !== 2 || !halves.every((v, i) => measures(v) && v.half === (i === 0 ? 'H1' : 'H2'))) return null;
  if (!object(b) || !money(b.h1Paise) || !money(b.h2Paise) || !['new', 'stopped', 'stoppedRegular', 'grew', 'fell', 'same', 'other'].every(k => object(b[k]) && count(b[k].labs) && money(b[k].paise))) return null;
  const stoppedRegularLabs = (b.stoppedRegular as Obj).labs, stoppedLabs = (b.stopped as Obj).labs;
  if (!count(stoppedRegularLabs) || !count(stoppedLabs) || stoppedRegularLabs > stoppedLabs) return null;
  if (!object(h) || !object(h.gp) || !nullable(h.gp.costedPct, pct) || !nullable(h.gp.computedAt, timestamp)
    || !object(h.history) || !nullable(h.history.firstSaleOn, date) || !count(h.history.monthsImported)
    || !object(h.itemGroups) || !nullable(h.itemGroups.unmappedPct, pct)
    || !object(h.reasons) || !['visitReasons180', 'constraints', 'openActions', 'visits180'].every(k => count((h.reasons as Obj)[k]))
    || !object(h.catalog) || !nullable(h.catalog.observedAt, timestamp) || !nullable(h.catalog.groups, count)) return null;
  return value as GrowthData;
}

/** Validate drill-down row kinds without substituting missing business data. */
export function normalizeGrowthLabs(value: unknown): GrowthLabsData | null {
  if (!object(value) || !growthLabLists.includes(value.list as GrowthLabList)) return null;
  const monthly = String(value.list).startsWith('month_');
  if (monthly ? !isGrowthMonth(value.month) : value.month !== null) return null;
  if ('half' in value && (!['window_labs', 'bulk_invoices'].includes(String(value.list))
    || !nullable(value.half, v => v === 'H1' || v === 'H2'))) return null;
  if (!count(value.total) || !count(value.page) || value.page < 1 || value.pageSize !== 20
    || !Array.isArray(value.rows) || value.rows.length > 20 || value.rows.length > value.total) return null;
  const text = (v: unknown) => typeof v === 'string';
  const valid = value.list === 'month_large_purchases'
    ? value.rows.every(r => object(r) && nullable(r.supplierName, text) && money(r.valuePaise) && date(r.date))
    : value.list === 'bulk_invoices'
      ? value.rows.every(r => object(r) && r.invoice === true && nullable(r.name, text)
        && nullable(r.customerId, text) && money(r.valuePaise) && date(r.date))
    : value.rows.every(r => object(r) && typeof r.labKey === 'string' && r.labKey.length > 0
      && nullable(r.customerId, text) && nullable(r.name, text) && nullable(r.town, text)
      && nullable(r.valuePaise, money) && count(r.monthsBought) && r.monthsBought <= 12
      && nullable(r.lastBoughtOn, date) && nullable(r.trend, v => v === 'up' || v === 'down' || v === 'flat'));
  return valid ? value as GrowthLabsData : null;
}
