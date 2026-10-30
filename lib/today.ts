export type TodayRankReason = 'value_known' | 'value_unknown' | 'due_soon';
export type TodayTarget = { kind: 'order'; orderId: string; orderNumber?: string } | { kind: 'stock'; itemKey: string } | { kind: 'lab'; customerId: string };
type Decision = { title: string; subtitle: string; rankReason: TodayRankReason };
export type UnblockDecision = Decision & {
  type: 'approve_price' | 'stock_covers' | 'stuck_order'; valuePaise: number | null;
  approximate: boolean; since: string; target: Exclude<TodayTarget, { kind: 'lab' }>;
};
export type GrowDecision = Decision & {
  type: 'diagnose' | 'deadline' | 'overdue_action'; valuePaisePerMonth: number | null;
  valueKind: 'gap' | 'expected' | null; due: string | null; target: Extract<TodayTarget, { kind: 'lab' }>;
};
export type TodayDecision = UnblockDecision | GrowDecision;
export type TodayLane<T> = { total: number; rows: T[] };
export type Today = { policyVersion: 'today-v1'; generatedAt: string; coverageCertified?: boolean; unblock: TodayLane<UnblockDecision>; grow: TodayLane<GrowDecision> };

const fail = (): never => { throw new Error('Invalid Today response'); };
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : fail();
const text = (value: unknown): string => typeof value === 'string' && value.trim().length > 0 ? value : fail();
const money = (value: unknown): number | null => value === null ? null : typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : fail();
const date = (value: unknown): string => {
  const result = text(value);
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(result) || !Number.isFinite(Date.parse(result)) || new Date(`${result.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) !== result.slice(0, 10)) return fail();
  return result;
};
function common(row: Record<string, unknown>): Decision {
  if (!['value_known', 'value_unknown', 'due_soon'].includes(String(row.rankReason))) return fail();
  return { title: text(row.title), subtitle: text(row.subtitle), rankReason: row.rankReason as TodayRankReason };
}
function unblock(input: unknown): UnblockDecision {
  const row = object(input), target = object(row.target);
  if (!['approve_price', 'stock_covers', 'stuck_order'].includes(String(row.type)) || typeof row.approximate !== 'boolean') return fail();
  let parsedTarget: UnblockDecision['target'];
  if (row.type === 'stock_covers' && target.kind === 'stock') parsedTarget = { kind: 'stock', itemKey: text(target.itemKey) };
  else if (row.type !== 'stock_covers' && target.kind === 'order') parsedTarget = { kind: 'order', orderId: text(target.orderId), ...(target.orderNumber === undefined ? {} : { orderNumber: text(target.orderNumber) }) };
  else return fail();
  return { ...common(row), type: row.type as UnblockDecision['type'], valuePaise: money(row.valuePaise), approximate: row.approximate, since: date(row.since), target: parsedTarget };
}
function grow(input: unknown): GrowDecision {
  const row = object(input), target = object(row.target);
  if (!['diagnose', 'deadline', 'overdue_action'].includes(String(row.type)) || ![null, 'gap', 'expected'].includes(row.valueKind as null | string) || target.kind !== 'lab') return fail();
  const value = money(row.valuePaisePerMonth);
  if (value !== null && row.valueKind === null) return fail();
  if ((row.type === 'diagnose' && row.valueKind !== 'gap') || (row.type === 'overdue_action' && row.valueKind !== null && row.valueKind !== 'expected') || (row.type === 'deadline' && row.valueKind !== null && row.valueKind !== 'gap')) return fail();
  return { ...common(row), type: row.type as GrowDecision['type'], valuePaisePerMonth: value, valueKind: row.valueKind as GrowDecision['valueKind'], due: row.due === null ? null : date(row.due), target: { kind: 'lab', customerId: text(target.customerId) } };
}
function lane<T>(input: unknown, parse: (row: unknown) => T): TodayLane<T> {
  const value = object(input);
  if (!Number.isSafeInteger(value.total) || Number(value.total) < 0 || !Array.isArray(value.rows) || value.rows.length > 5 || value.rows.length > Number(value.total)) return fail();
  return { total: Number(value.total), rows: value.rows.map(parse) };
}
/** Extra keys are forward compatible; every required field is checked without coercion. */
export function parseToday(input: unknown): Today {
  const value = object(input);
  if (value.policyVersion !== 'today-v1' || (value.coverageCertified !== undefined && typeof value.coverageCertified !== 'boolean')) return fail();
  return { policyVersion: 'today-v1', generatedAt: date(value.generatedAt), unblock: lane(value.unblock, unblock), grow: lane(value.grow, grow), ...(value.coverageCertified === undefined ? {} : { coverageCertified: value.coverageCertified as boolean }) };
}

export function formatTodayPaise(paise: number): string {
  if (!Number.isSafeInteger(paise) || paise < 0) throw new Error('Invalid paise');
  const rupees = paise / 100;
  const short = (divisor: number) => String(Math.round(rupees / divisor * 10) / 10);
  if (rupees >= 1e7) return `₹${short(1e7)} cr`;
  if (rupees >= 1e5) return `₹${short(1e5)}L`;
  if (rupees >= 1e3) return `₹${short(1e3)}k`;
  return `₹${Math.round(rupees)}`;
}
export function todayValueLabel(row: TodayDecision): string {
  if ('valuePaise' in row) return row.valuePaise === null ? '₹ ?' : `${row.approximate ? '≈ ' : ''}${formatTodayPaise(row.valuePaise)}`;
  return row.valuePaisePerMonth === null ? '₹ ?' : `${formatTodayPaise(row.valuePaisePerMonth)}/mo ${row.valueKind}`;
}
