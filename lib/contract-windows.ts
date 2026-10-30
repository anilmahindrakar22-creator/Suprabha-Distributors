import type { ConstraintConfidence, EvidenceSource, OpportunityKind } from './wallet-diagnosis-types';

export type ContractWindow = {
  customerId: string; customerName: string; town: string | null; opportunityId: string;
  kind: OpportunityKind; divisionName: string | null;
  category: 'competitor_lock_in' | 'contract_tender' | 'unknown'; party: string; endsOn: string;
  daysLeft: number; confidence: ConstraintConfidence; source: EvidenceSource;
};
export type ContractWindows = { rows: ContractWindow[]; total: number; plannedCount: number; page: number; pageSize: 20 };

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const nullableText = (value: unknown) => value === null || typeof value === 'string';
const uuid = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const date = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const count = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0;
const oneOf = (value: unknown, values: string[]) => typeof value === 'string' && values.includes(value);

export function parseContractWindows(value: unknown): ContractWindows {
  if (!object(value) || !Array.isArray(value.rows) || !count(value.total) || !count(value.plannedCount)
    || !Number.isInteger(value.page) || Number(value.page) < 1 || Number(value.page) > 4000 || value.pageSize !== 20
    || value.rows.length > 20 || value.rows.length > Number(value.total)
    || !value.rows.every(row => object(row) && uuid(row.customerId) && text(row.customerName) && nullableText(row.town)
      && uuid(row.opportunityId) && oneOf(row.kind, ['capture', 'defend', 'recover']) && nullableText(row.divisionName)
      && oneOf(row.category, ['competitor_lock_in', 'contract_tender', 'unknown']) && text(row.party) && date(row.endsOn)
      && Number.isSafeInteger(row.daysLeft) && oneOf(row.confidence, ['high', 'medium', 'low'])
      && oneOf(row.source, ['document', 'customer_stated', 'our_view']))) {
    throw new Error('Invalid contract windows response');
  }
  return value as ContractWindows;
}

export function windowLabel(row: Pick<ContractWindow, 'category' | 'endsOn' | 'daysLeft'>): string {
  if (row.daysLeft < 0) return `${row.category === 'unknown' ? 'Ask-by passed' : 'Ended'} ${-row.daysLeft} ${row.daysLeft === -1 ? 'day' : 'days'} ago`;
  const end = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(new Date(`${row.endsOn}T00:00:00Z`));
  if (row.category === 'unknown') return `Ask by ${end} · ${row.daysLeft === 0 ? 'today' : `${row.daysLeft} ${row.daysLeft === 1 ? 'day' : 'days'} left`}`;
  return `Ends ${end} · ${row.daysLeft === 0 ? 'ends today' : `${row.daysLeft} ${row.daysLeft === 1 ? 'day' : 'days'} left`}`;
}
