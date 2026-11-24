import type { EconomicsWorkspaceData } from './instrument-economics-types';

export type SourceLine = NonNullable<EconomicsWorkspaceData['sourceLines']>[number];
export type EconomicLineFilter = {
  kind?: SourceLine['kind']; companyId?: string; customerSourceId?: string; productId?: string;
  unit?: string; q?: string; ids?: string[]; quantityOne?: boolean; minNetSalesPaise?: string;
  dateFrom?: string; dateTo?: string; unusedOnly?: boolean; limit?: number; offset?: number;
};
export type EconomicLinePage = { rows: SourceLine[]; total: number; limit: number; offset: number };
const kinds = ['sale', 'purchase', 'return', 'credit', 'purchase_return'];
const keys = ['kind', 'companyId', 'customerSourceId', 'productId', 'unit', 'q', 'ids', 'quantityOne', 'minNetSalesPaise', 'dateFrom', 'dateTo', 'unusedOnly', 'limit', 'offset'];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && s.slice(0, 4) !== '0000' && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;

export function economicLineSearchParams(filter: EconomicLineFilter): URLSearchParams {
  const params = new URLSearchParams();
  for (const key of keys) {
    const value = filter[key as keyof EconomicLineFilter];
    if (value === undefined || value === false || value === '' || (Array.isArray(value) && !value.length)) continue;
    const text = key === 'q' ? String(value).trim() : Array.isArray(value) ? value.join(',') : value === true ? '1' : String(value);
    if (text) params.set(key, text);
  }
  return params;
}

export function parseEconomicLineSearchParams(params: URLSearchParams): EconomicLineFilter | null {
  const result: Record<string, unknown> = {};
  for (const [key, value] of params) {
    if (!keys.includes(key) || key in result) return null;
    if (key === 'kind') { if (!kinds.includes(value)) return null; result[key] = value; }
    else if (['companyId', 'customerSourceId', 'productId', 'unit'].includes(key)) {
      if (!value.trim() || value.length > (key === 'unit' ? 80 : 240)) return null;
      result[key] = value;
    } else if (key === 'q') {
      const q = value.trim();
      if (!q || q.length > 80 || q.split(/\s+/).length > 6) return null;
      result[key] = q;
    } else if (key === 'ids') {
      const ids = value.split(',');
      if (ids.length > 200 || !ids.every(id => uuid.test(id))) return null;
      result[key] = ids;
    } else if (key === 'quantityOne' || key === 'unusedOnly') {
      if (value !== '1') return null;
      result[key] = true;
    } else if (key === 'minNetSalesPaise') {
      if (!/^\d{1,18}$/.test(value)) return null;
      result[key] = value;
    } else if (key === 'dateFrom' || key === 'dateTo') {
      if (!validDate(value)) return null;
      result[key] = value;
    } else {
      if (!/^\d+$/.test(value)) return null;
      const n = Number(value);
      if (!Number.isSafeInteger(n) || n < (key === 'limit' ? 1 : 0) || n > (key === 'limit' ? 200 : 10000)) return null;
      result[key] = n;
    }
  }
  if (typeof result.dateFrom === 'string' && typeof result.dateTo === 'string' && result.dateFrom > result.dateTo) return null;
  return result as EconomicLineFilter;
}

export function normalizeEconomicLinePage(value: unknown): EconomicLinePage {
  const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  const integer = (v: unknown, min: number, max = Number.MAX_SAFE_INTEGER): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max;
  const nullableText = (v: unknown) => v === null || typeof v === 'string';
  if (!object(value) || !Array.isArray(value.rows) || !integer(value.total, 0) || !integer(value.limit, 1, 200) || !integer(value.offset, 0, 10000) || value.rows.length > value.limit || value.rows.length > value.total) throw new Error('Invalid invoice page');
  for (const row of value.rows) {
    if (!object(row) || !['id', 'companyId', 'voucherId', 'revision', 'lineKey', 'date', 'kind', 'productId', 'quantity', 'unit', 'netSalesPaise'].every(key => typeof row[key] === 'string') || !kinds.includes(row.kind as string) || !validDate(row.date as string) || !nullableText(row.customerSourceId) || !nullableText(row.batchId) || !/^-?\d+$/.test(row.netSalesPaise as string) || !/^-?\d+(?:\.\d+)?$/.test(row.quantity as string) || !/^\d+$/.test(row.revision as string) || (row.productName !== undefined && typeof row.productName !== 'string') || (row.voucherNumber !== undefined && !nullableText(row.voucherNumber)) || (row.partyName !== undefined && !nullableText(row.partyName)) || (row.usedByInstrument !== undefined && typeof row.usedByInstrument !== 'boolean')) throw new Error('Invalid invoice row');
  }
  return value as EconomicLinePage;
}

export function lineKey(filter: EconomicLineFilter): string { return economicLineSearchParams(filter).toString(); }
