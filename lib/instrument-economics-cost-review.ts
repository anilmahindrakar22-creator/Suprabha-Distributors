import type { EconomicsWorkspaceData } from './instrument-economics-types';

type Line = NonNullable<EconomicsWorkspaceData['sourceLines']>[number];
export type CostReview = { sales: Line[]; salesTotal: number; purchases: Line[]; purchasesTotal: number };
export type LineRefs = { rows: { id: string; kind: Line['kind']; voucherNumber: string | null }[]; total: number; limit: 5000 };
type LineRefsFilter = { companyId: string; customerSourceId: string };
const kinds = ['sale', 'purchase', 'purchase_return', 'credit', 'return'];
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const nullableString = (value: unknown) => value === null || typeof value === 'string';

function validLine(value: unknown): value is Line {
  return object(value)
    && ['id', 'companyId', 'voucherId', 'revision', 'lineKey', 'date', 'productId', 'quantity', 'unit', 'netSalesPaise'].every(key => typeof value[key] === 'string')
    && typeof value.kind === 'string' && kinds.includes(value.kind)
    && nullableString(value.customerSourceId) && nullableString(value.batchId)
    && (value.voucherNumber === undefined || nullableString(value.voucherNumber))
    && (value.productName === undefined || typeof value.productName === 'string')
    && (value.partyName === undefined || nullableString(value.partyName))
    && (value.usedByInstrument === undefined || typeof value.usedByInstrument === 'boolean');
}

export function normalizeCostReview(body: unknown): CostReview {
  if (!object(body) || !Array.isArray(body.sales) || !Array.isArray(body.purchases)
    || !integer(body.salesTotal) || !integer(body.purchasesTotal)
    || body.sales.length > 500 || body.sales.length > body.salesTotal
    || body.purchases.length > 5000 || body.purchases.length > body.purchasesTotal
    || !body.sales.every(validLine) || !body.purchases.every(validLine)) throw new Error('Invalid cost review');
  return body as CostReview;
}

export function normalizeLineRefs(body: unknown): LineRefs {
  if (!object(body) || !Array.isArray(body.rows) || !integer(body.total) || body.limit !== 5000
    || body.rows.length > body.limit || body.rows.length > body.total
    || !body.rows.every(row => object(row) && typeof row.id === 'string' && typeof row.kind === 'string' && kinds.includes(row.kind) && nullableString(row.voucherNumber))) throw new Error('Invalid line refs');
  return body as LineRefs;
}

export function parseLineRefsSearchParams(params: URLSearchParams): LineRefsFilter | null {
  const result: Record<string, string> = {};
  for (const [key, value] of params) {
    if (!['companyId', 'customerSourceId'].includes(key) || key in result || !value.trim() || value.length > 240) return null;
    result[key] = value;
  }
  return result.companyId && result.customerSourceId ? result as LineRefsFilter : null;
}

export function lineRefsSearchParams(filter: LineRefsFilter): URLSearchParams | null {
  if (!object(filter) || Object.keys(filter).some(key => !['companyId', 'customerSourceId'].includes(key))
    || typeof filter.companyId !== 'string' || typeof filter.customerSourceId !== 'string') return null;
  const params = new URLSearchParams(filter);
  return parseLineRefsSearchParams(params) ? params : null;
}
