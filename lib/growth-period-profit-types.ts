import { normalizeGrowthBrands, type GrowthBrandsData } from './growth-brand-types';
import type { GrowthPeriodData } from './growth-period-types';
import type { GrowthProfit } from './growth-types';

type Obj = Record<string, unknown>;
const object = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const keys = (v: Obj, required: string[], optional: string[] = []) => required.every(k => Object.hasOwn(v, k))
  && Object.keys(v).every(k => [...required, ...optional].includes(k));
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);
const count = (v: unknown): v is number => integer(v) && v >= 0;
const date = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
  && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The same period metadata checks used by the period and period-labs responses. */
export const isGrowthProfitPeriod = (p: unknown): p is GrowthPeriodData['period'] => object(p)
  && keys(p, ['kind', 'fy', 'quarter', 'label', 'from', 'to', 'running'])
  && count(p.fy) && p.fy >= 2017 && p.fy <= 2100 && typeof p.label === 'string'
  && date(p.from) && date(p.to) && p.from <= p.to && typeof p.running === 'boolean'
  && (p.kind === 'fy' ? p.quarter === null : p.kind === 'quarter' && count(p.quarter) && p.quarter >= 1 && p.quarter <= 4);

export type GrowthPeriodBrandsData = GrowthBrandsData & {
  period: GrowthPeriodData['period'];
  comparison: { key: 'last_year' | 'previous'; label: string; state: 'no_history' | 'differs' | 'unconfirmed' | 'confirmed' };
  comparisonWindow: { from: string; to: string };
};
export function normalizeGrowthPeriodBrands(raw: unknown): GrowthPeriodBrandsData | null {
  if (!object(raw)) return null;
  const { period, comparison, comparisonWindow, ...rest } = raw;
  if (!isGrowthProfitPeriod(period) || !object(comparison) || !keys(comparison, ['key', 'label', 'state'])
    || (comparison.key !== 'last_year' && comparison.key !== 'previous')
    || (comparison.key === 'previous' && period.kind !== 'quarter') || typeof comparison.label !== 'string'
    || typeof comparison.state !== 'string' || !['no_history', 'differs', 'unconfirmed', 'confirmed'].includes(comparison.state)
    || !object(comparisonWindow) || !keys(comparisonWindow, ['from', 'to'])
    || !date(comparisonWindow.from) || !date(comparisonWindow.to) || comparisonWindow.from > comparisonWindow.to) return null;
  const brands = normalizeGrowthBrands(rest);
  return brands ? { ...brands, period, comparison: comparison as GrowthPeriodBrandsData['comparison'], comparisonWindow: comparisonWindow as GrowthPeriodBrandsData['comparisonWindow'] } : null;
}

export type GrowthPeriodGp = GrowthProfit & { period: GrowthPeriodData['period'] };
const profitWindow = (v: unknown, half?: string): boolean => object(v)
  && keys(v, ['salesPaise', 'knownSalesPaise', 'costPaise', 'gpPaise', 'gpPct', 'coveragePct', ...(half ? ['half'] : [])], ['unreliableLines'])
  && ['salesPaise', 'knownSalesPaise', 'costPaise', 'gpPaise'].every(k => integer(v[k]))
  && (v.gpPct === null || finite(v.gpPct))
  && (v.coveragePct === null || finite(v.coveragePct) && v.coveragePct >= 0 && v.coveragePct <= 100)
  && (!('unreliableLines' in v) || count(v.unreliableLines)) && (!half || v.half === half);

/** Strict standalone Profit-card response, with period-sized month arrays. */
export function normalizeGrowthPeriodGp(raw: unknown): GrowthPeriodGp | null {
  if (!object(raw) || !keys(raw, ['method', 'window', 'halves', 'repeat', 'bulk', 'months', 'period'], ['consumables', 'instruments'])
    || !isGrowthProfitPeriod(raw.period) || raw.method !== 'average_purchase_cost_to_date'
    || !profitWindow(raw.window) || !profitWindow(raw.repeat) || !profitWindow(raw.bulk)
    || ('consumables' in raw && !profitWindow(raw.consumables)) || ('instruments' in raw && !profitWindow(raw.instruments))
    || !Array.isArray(raw.halves) || raw.halves.length !== 2 || !raw.halves.every((h, i) => profitWindow(h, i === 0 ? 'H1' : 'H2'))
    || !Array.isArray(raw.months)) return null;
  const months: string[] = [];
  for (const d = new Date(`${raw.period.from.slice(0, 7)}-01T00:00:00Z`); d.toISOString().slice(0, 7) <= raw.period.to.slice(0, 7); d.setUTCMonth(d.getUTCMonth() + 1)) {
    months.push(d.toISOString().slice(0, 7));
    if (months.length > 12) return null;
  }
  const required = ['salesPaise', 'knownSalesPaise', 'gpPaise'];
  const optional = ['consumablesKnownSalesPaise', 'consumablesGpPaise', 'instrumentsKnownSalesPaise', 'instrumentsGpPaise'];
  if (raw.months.length !== months.length || !raw.months.every((m, i) => object(m)
    && keys(m, ['month', ...required], optional) && m.month === months[i]
    && required.every(k => integer(m[k])) && optional.every(k => !(k in m) || integer(m[k])))) return null;
  return raw as GrowthPeriodGp;
}
