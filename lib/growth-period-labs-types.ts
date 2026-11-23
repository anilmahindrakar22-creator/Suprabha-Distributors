import type { GrowthLabMonthRow } from './growth-lab-month-types';
import type { GrowthPeriodData } from './growth-period-types';

export const growthPeriodLabLists = ['bridge_new', 'bridge_stopped', 'bridge_grew', 'bridge_fell', 'window_labs'] as const;
export type GrowthPeriodLabList = typeof growthPeriodLabLists[number];
export type GrowthPeriodLabMonthsData = {
  window: { from: string; to: string }; months: string[]; totalLabs: number;
  rows: Pick<GrowthLabMonthRow, 'labKey' | 'customerId' | 'name' | 'town' | 'totalPaise' | 'monthsPaise' | 'buyingMonths'>[];
};
export type GrowthPeriodLabsData = {
  list: GrowthPeriodLabList; comparison: 'last_year' | 'previous' | null; page: number; pageSize: 20; total: number;
  period: GrowthPeriodData['period']; reason?: 'no_history';
  rows: { labKey: string; customerId: string | null; name: string | null; town: string | null;
    valuePaise: number; comparisonPaise: number | null; currentPaise: number; monthsBought: number; lastBoughtOn: string }[];
};

type Obj = Record<string, unknown>;
const object = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const keys = (v: Obj, expected: string[]) => Object.keys(v).length === expected.length && expected.every(k => Object.hasOwn(v, k));
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);
const count = (v: unknown): v is number => integer(v) && v >= 0;
const date = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
const identity = (v: Obj) => typeof v.labKey === 'string' && v.labKey.trim().length > 0
  && ['customerId', 'name', 'town'].every(k => v[k] === null || typeof v[k] === 'string');
const period = (p: unknown): p is GrowthPeriodData['period'] => object(p)
  && keys(p, ['kind', 'fy', 'quarter', 'label', 'from', 'to', 'running'])
  && count(p.fy) && p.fy >= 2017 && p.fy <= 2100 && typeof p.label === 'string'
  && date(p.from) && date(p.to) && p.from <= p.to && typeof p.running === 'boolean'
  && (p.kind === 'fy' ? p.quarter === null : p.kind === 'quarter' && count(p.quarter) && p.quarter >= 1 && p.quarter <= 4);

export function normalizeGrowthPeriodLabMonths(value: unknown): GrowthPeriodLabMonthsData | null {
  if (!object(value) || !keys(value, ['window', 'months', 'totalLabs', 'rows']) || !object(value.window)
    || !keys(value.window, ['from', 'to']) || !date(value.window.from) || !date(value.window.to) || value.window.from > value.window.to
    || !Array.isArray(value.months) || value.months.length < 1 || value.months.length > 12
    || !Array.isArray(value.rows) || value.rows.length > 20 || !count(value.totalLabs) || value.totalLabs < value.rows.length) return null;
  const from = value.window.from, to = value.window.to;
  const expectedMonths: string[] = [];
  for (const d = new Date(`${from.slice(0, 7)}-01T00:00:00Z`); d.toISOString().slice(0, 7) <= to.slice(0, 7); d.setUTCMonth(d.getUTCMonth() + 1)) {
    expectedMonths.push(d.toISOString().slice(0, 7));
    if (expectedMonths.length > 12) return null;
  }
  if (value.months.length !== expectedMonths.length || !value.months.every((m, i) => m === expectedMonths[i])) return null;
  if (!value.rows.every(r => object(r) && keys(r, ['labKey', 'customerId', 'name', 'town', 'totalPaise', 'monthsPaise', 'buyingMonths'])
    && identity(r) && integer(r.totalPaise) && r.totalPaise > 0 && Array.isArray(r.monthsPaise)
    && r.monthsPaise.length === expectedMonths.length && r.monthsPaise.every(integer)
    && count(r.buyingMonths) && r.buyingMonths <= expectedMonths.length)) return null;
  return value as GrowthPeriodLabMonthsData;
}

export function normalizeGrowthPeriodLabs(value: unknown): GrowthPeriodLabsData | null {
  if (!object(value) || !keys(value, ['list', 'comparison', 'page', 'pageSize', 'total', 'rows', 'period', ...('reason' in value ? ['reason'] : [])])
    || !growthPeriodLabLists.includes(value.list as GrowthPeriodLabList) || !period(value.period)
    || !integer(value.page) || value.page < 1 || value.page > 1000 || value.pageSize !== 20
    || !count(value.total) || !Array.isArray(value.rows) || value.rows.length > 20 || value.total < value.rows.length
    || (value.list === 'window_labs' ? value.comparison !== null
      : (value.comparison !== 'last_year' && value.comparison !== 'previous') || (value.comparison === 'previous' && value.period.kind !== 'quarter'))
    || ('reason' in value && (value.reason !== 'no_history' || value.list === 'window_labs' || value.rows.length !== 0 || value.total !== 0))) return null;
  const maxMonths = value.period.kind === 'fy' ? 12 : 3;
  if (!value.rows.every(r => object(r) && keys(r, ['labKey', 'customerId', 'name', 'town', 'valuePaise', 'comparisonPaise', 'currentPaise', 'monthsBought', 'lastBoughtOn'])
    && identity(r) && integer(r.valuePaise) && r.valuePaise > 0 && integer(r.currentPaise)
    && (value.list === 'window_labs' ? r.comparisonPaise === null : integer(r.comparisonPaise))
    && count(r.monthsBought) && r.monthsBought <= maxMonths && date(r.lastBoughtOn))) return null;
  return value as GrowthPeriodLabsData;
}
