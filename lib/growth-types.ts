export type GrowthMeasures = {
  revenuePaise: number; repeatPaise: number; bulkPaise: number; bulkInvoices: number;
  labsBuying: number; buyingMonths: number; perBuyingMonthPaise: number | null;
};
type Contribution = { labs: number; paise: number };
export type GrowthData = {
  companyCount: number;
  window: { from: string; to: string; h1From: string; h2From: string };
  confirmed: boolean; confirmedReason: string | null;
  tree: GrowthMeasures;
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
const measures = (v: unknown) => object(v) && ['revenuePaise', 'repeatPaise', 'bulkPaise'].every(k => money(v[k])) && nullable(v.perBuyingMonthPaise, money) && ['bulkInvoices', 'labsBuying', 'buyingMonths'].every(k => count(v[k]));

/** Reject incomplete or incorrectly typed responses; never coerce unknowns into zero. */
export function normalizeGrowth(value: unknown): GrowthData | null {
  if (!object(value)) return null;
  const { window: w, tree, halves, bridge: b, health: h } = value;
  if (!count(value.companyCount) || typeof value.confirmed !== 'boolean' || !nullable(value.confirmedReason, v => typeof v === 'string')) return null;
  if (!object(w) || !['from', 'to', 'h1From', 'h2From'].every(k => date(w[k])) || String(w.from) !== w.h1From || String(w.h1From) >= String(w.h2From) || String(w.h2From) >= String(w.to)) return null;
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
