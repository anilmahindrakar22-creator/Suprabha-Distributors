import type { EconomicException } from './instrument-economics-types';

export type EconomicExceptionsPage = {
  rows: EconomicException[];
  groups: { status: string; reason: string | null; count: number; netSalesPaise: string }[];
  total: number; limit: number; offset: number;
};

export function parseEconomicExceptionsParams(params: URLSearchParams): { status?: string; limit?: number; offset?: number } | null {
  const result: Record<string, string | number> = {};
  for (const [key, value] of params) {
    if (!['status', 'limit', 'offset'].includes(key) || key in result) return null;
    if (key === 'status') {
      if (!value.trim() || value.length > 60) return null;
      result[key] = value;
    } else {
      const number = Number(value);
      if (!/^\d+$/.test(value) || !Number.isSafeInteger(number) || number < (key === 'limit' ? 1 : 0) || number > (key === 'limit' ? 200 : 10000)) return null;
      result[key] = number;
    }
  }
  return result;
}

export function normalizeEconomicExceptions(value: unknown): EconomicExceptionsPage {
  const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  const integer = (v: unknown, min: number, max = Number.MAX_SAFE_INTEGER): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max;
  const paise = (v: unknown) => typeof v === 'string' && /^-?\d+$/.test(v);
  const nullableText = (v: unknown) => v === null || typeof v === 'string';
  const date = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && v.slice(0, 4) !== '0000' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
  if (!object(value) || !Array.isArray(value.rows) || !Array.isArray(value.groups) || !integer(value.total, 0) || !integer(value.limit, 1, 200) || !integer(value.offset, 0, 10000) || value.rows.length > value.limit || value.rows.length > value.total) throw new Error('Invalid exceptions page');
  for (const row of value.rows) {
    if (!object(row) || !['sourceId', 'productId', 'status', 'reason'].every(key => typeof row[key] === 'string') || !date(row.date) || !paise(row.netSalesPaise) || !['voucherNumber', 'voucherType', 'voucherDate', 'detail', 'kind'].every(key => row[key] === undefined || nullableText(row[key])) || (row.sourceLineId !== undefined && typeof row.sourceLineId !== 'string') || (row.lineCount !== undefined && !integer(row.lineCount, 0))) throw new Error('Invalid exception row');
  }
  for (const group of value.groups) {
    if (!object(group) || typeof group.status !== 'string' || !nullableText(group.reason) || !integer(group.count, 0) || !paise(group.netSalesPaise)) throw new Error('Invalid exception group');
  }
  return value as EconomicExceptionsPage;
}
