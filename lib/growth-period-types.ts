import type { GrowthData, GrowthMeasures } from './growth-types';

export type GrowthPeriodSelection = { kind: 'fy'; fy: number } | { kind: 'quarter'; fy: number; quarter: 1 | 2 | 3 | 4 };
type PeriodCheck = {
  days: number; historyDays: number; historySharePct: number; coverageComplete: boolean;
  months: { month: string; state: 'matches' | 'no_control' | 'differs' }[];
  state: 'no_history' | 'differs' | 'unconfirmed' | 'confirmed';
};
type PeriodWindow = { key: string; label: string; from: string; to: string; tree: GrowthMeasures; check: PeriodCheck };
export type GrowthPeriodData = {
  view: 'period';
  period: { kind: 'fy' | 'quarter'; fy: number; quarter: 1 | 2 | 3 | 4 | null; label: string; from: string; to: string; running: boolean };
  current: PeriodWindow & { key: 'current' };
  comparisons: (Omit<PeriodWindow, 'key' | 'tree'> & { key: 'last_year' | 'previous'; tree: GrowthMeasures | null; bridge: GrowthData['bridge'] | null })[];
};

export function parseGrowthPeriodParam(value: string | null): GrowthPeriodSelection | 'rolling12' | null {
  if (value === 'rolling12') return value;
  const match = /^(fy|q[1-4])-(\d{4})$/.exec(value ?? '');
  if (!match) return null;
  const fy = Number(match[2]);
  if (fy < 2017 || fy > 2100) return null;
  return match[1] === 'fy' ? { kind: 'fy', fy } : { kind: 'quarter', fy, quarter: Number(match[1][1]) as 1 | 2 | 3 | 4 };
}

export function formatGrowthPeriodParam(selection: GrowthPeriodSelection | 'rolling12'): string {
  return selection === 'rolling12' ? selection : `${selection.kind === 'fy' ? 'fy' : `q${selection.quarter}`}-${selection.fy}`;
}

type Obj = Record<string, unknown>;
const object = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const keys = (v: Obj, expected: string[]) => Object.keys(v).length === expected.length && expected.every(k => Object.hasOwn(v, k));
const money = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);
const count = (v: unknown): v is number => money(v) && v >= 0;
const date = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
const window = (v: Obj) => typeof v.label === 'string' && date(v.from) && date(v.to) && v.from <= v.to;
const measures = (v: unknown) => object(v)
  && keys(v, ['revenuePaise', 'repeatPaise', 'bulkPaise', 'bulkInvoices', 'labsBuying', 'buyingMonths', 'perBuyingMonthPaise'])
  && ['revenuePaise', 'repeatPaise', 'bulkPaise'].every(k => money(v[k]))
  && (v.perBuyingMonthPaise === null || money(v.perBuyingMonthPaise))
  && ['bulkInvoices', 'labsBuying', 'buyingMonths'].every(k => count(v[k]));
const classes = ['new', 'stopped', 'stoppedRegular', 'grew', 'fell', 'same', 'other'];
const bridge = (v: unknown) => object(v) && keys(v, ['h1Paise', 'h2Paise', ...classes])
  && money(v.h1Paise) && money(v.h2Paise)
  && classes.every(k => object(v[k]) && keys(v[k], ['labs', 'paise']) && count(v[k].labs) && money(v[k].paise));
const check = (v: unknown) => object(v) && keys(v, ['days', 'historyDays', 'historySharePct', 'coverageComplete', 'months', 'state'])
  && count(v.days) && v.days > 0 && count(v.historyDays) && v.historyDays <= v.days
  && typeof v.historySharePct === 'number' && Number.isFinite(v.historySharePct) && v.historySharePct >= 0 && v.historySharePct <= 100
  && typeof v.coverageComplete === 'boolean' && typeof v.state === 'string' && ['no_history', 'differs', 'unconfirmed', 'confirmed'].includes(v.state)
  && Array.isArray(v.months) && v.months.every(m => object(m) && keys(m, ['month', 'state'])
    && typeof m.month === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(m.month)
    && typeof m.state === 'string' && ['matches', 'no_control', 'differs'].includes(m.state));

/** Validate every response field, including nested keys, without coercing server data. */
export function normalizeGrowthPeriod(value: unknown): GrowthPeriodData | null {
  if (!object(value) || !keys(value, ['view', 'period', 'current', 'comparisons']) || value.view !== 'period') return null;
  const p = value.period, cur = value.current;
  if (!object(p) || !keys(p, ['kind', 'fy', 'quarter', 'label', 'from', 'to', 'running']) || !window(p)
    || !count(p.fy) || p.fy < 2017 || p.fy > 2100 || typeof p.running !== 'boolean'
    || !(p.kind === 'fy' ? p.quarter === null : p.kind === 'quarter' && count(p.quarter) && p.quarter >= 1 && p.quarter <= 4)) return null;
  if (!object(cur) || !keys(cur, ['key', 'label', 'from', 'to', 'tree', 'check']) || cur.key !== 'current'
    || !window(cur) || cur.from !== p.from || cur.to !== p.to || cur.label !== p.label || !measures(cur.tree) || !check(cur.check)) return null;
  if (!Array.isArray(value.comparisons) || value.comparisons.length !== (p.kind === 'fy' ? 1 : 2)
    || !value.comparisons.every((c, i) => {
      if (!object(c) || !keys(c, ['key', 'label', 'from', 'to', 'tree', 'bridge', 'check'])
        || c.key !== (i === 0 ? 'last_year' : 'previous') || !window(c) || !check(c.check)) return false;
      return (c.check as Obj).state === 'no_history' ? c.tree === null && c.bridge === null : measures(c.tree) && bridge(c.bridge);
    })) return null;
  return value as GrowthPeriodData;
}
