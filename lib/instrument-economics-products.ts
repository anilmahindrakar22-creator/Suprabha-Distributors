export type EconomicProduct = { companyId: string; productId: string; productName: string; lastDate: string };
export type EconomicProductFilter = { companyId?: string; q?: string; productIds?: string[]; limit?: number; offset?: number };
export type EconomicProductPage = { rows: EconomicProduct[]; total: number; limit: number; offset: number; companies: string[] };
const keys = ['companyId', 'q', 'productIds', 'limit', 'offset'] as const;

export function economicProductSearchParams(filter: EconomicProductFilter): URLSearchParams {
  const params = new URLSearchParams();
  for (const key of keys) {
    const value = filter[key];
    if (value === undefined || value === '' || (Array.isArray(value) && !value.length)) continue;
    const text = key === 'q' ? String(value).trim() : Array.isArray(value) ? value.join(',') : String(value);
    if (text) params.set(key, text);
  }
  return params;
}

export function parseEconomicProductSearchParams(params: URLSearchParams): EconomicProductFilter | null {
  const result: Record<string, unknown> = {};
  for (const [key, value] of params) {
    if (!keys.includes(key as typeof keys[number]) || key in result) return null;
    if (key === 'companyId') {
      if (!value.trim() || value.length > 240) return null;
      result[key] = value;
    } else if (key === 'q') {
      const q = value.trim();
      if (!q || q.length > 80 || q.split(/\s+/).length > 6) return null;
      result[key] = q;
    } else if (key === 'productIds') {
      const ids = value.split(',');
      if (ids.length > 200 || !ids.every(id => id.trim() && id.length <= 240)) return null;
      result[key] = ids;
    } else {
      if (!/^\d+$/.test(value)) return null;
      const n = Number(value);
      if (!Number.isSafeInteger(n) || n < (key === 'limit' ? 1 : 0) || n > (key === 'limit' ? 500 : 100000)) return null;
      result[key] = n;
    }
  }
  return result as EconomicProductFilter;
}

export function normalizeEconomicProductPage(value: unknown): EconomicProductPage {
  const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  const integer = (v: unknown, min: number, max = Number.MAX_SAFE_INTEGER): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max;
  if (!object(value) || !Array.isArray(value.rows) || !integer(value.total, 0) || !integer(value.limit, 1, 500) || !integer(value.offset, 0, 100000) || value.rows.length > value.limit || value.rows.length > value.total || !Array.isArray(value.companies) || !value.companies.every(company => typeof company === 'string')) throw new Error('Invalid product page');
  for (const row of value.rows) {
    if (!object(row) || !['companyId', 'productId', 'productName', 'lastDate'].every(key => typeof row[key] === 'string') || !/^\d{4}-\d{2}-\d{2}$/.test(row.lastDate as string) || !Number.isFinite(Date.parse(row.lastDate as string)) || (row.lastDate as string).startsWith('0000') || new Date(row.lastDate as string).toISOString().slice(0, 10) !== row.lastDate) throw new Error('Invalid product row');
  }
  return value as EconomicProductPage;
}

export function productKey(filter: EconomicProductFilter): string { return economicProductSearchParams(filter).toString(); }
