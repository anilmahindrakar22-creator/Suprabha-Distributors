export type TodayRankReason = 'value_known' | 'value_unknown' | 'due_soon';
export type TodayTarget = { kind: 'order'; orderId: string; orderNumber?: string } | { kind: 'stock'; itemKey: string } | { kind: 'lab'; customerId: string };
type Decision = { title: string; subtitle: string; rankReason: TodayRankReason };
export type UnblockDecision = Decision & {
  type: 'approve_price' | 'stock_covers' | 'stuck_order'; valuePaise: number | null;
  approximate: boolean; since: string; target: Exclude<TodayTarget, { kind: 'lab' }>;
};
type ExistingGrowDecision = Decision & {
  type: 'diagnose' | 'deadline' | 'overdue_action'; valuePaisePerMonth: number | null;
  valueKind: 'gap' | 'expected' | null; due: string | null; target: Extract<TodayTarget, { kind: 'lab' }>;
};
export type RecoverDecision = Omit<Decision, 'subtitle'> & {
  type: 'recover'; subtitle: null; baselinePaisePerMonth: number; recentPaisePerMonth: number;
  valuePaisePerMonth: number; valueKind: 'lost'; due: null; target: Extract<TodayTarget, { kind: 'lab' }>;
};
export type GrowDecision = ExistingGrowDecision | RecoverDecision;
export type TodayDecision = UnblockDecision | GrowDecision;
export type TodayLane<T> = { total: number; rows: T[] };
export type Today = { policyVersion: 'today-v1'; generatedAt: string; coverageCertified?: boolean; recover?: { certified: boolean; reason: string | null }; unblock: TodayLane<UnblockDecision>; grow: TodayLane<GrowDecision> };

const fail = (): never => { throw new Error('Invalid Today response'); };
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : fail();
const text = (value: unknown): string => typeof value === 'string' && value.trim().length > 0 ? value : fail();
const money = (value: unknown): number | null => value === null ? null : typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : fail();
const date = (value: unknown): string => {
  const result = text(value);
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(result) || !Number.isFinite(Date.parse(result)) || new Date(`${result.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) !== result.slice(0, 10)) return fail();
  return result;
};
function heading(row: Record<string, unknown>): Omit<Decision, 'subtitle'> {
  if (!['value_known', 'value_unknown', 'due_soon'].includes(String(row.rankReason))) return fail();
  return { title: text(row.title), rankReason: row.rankReason as TodayRankReason };
}
function common(row: Record<string, unknown>): Decision {
  return { ...heading(row), subtitle: text(row.subtitle) };
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
  if (row.type === 'recover') {
    if (target.kind !== 'lab' || row.subtitle !== null || row.due !== null || row.valueKind !== 'lost') return fail();
    const baseline = money(row.baselinePaisePerMonth), value = money(row.valuePaisePerMonth);
    // Net sales may be negative after returns/credits; preserve signed paise.
    const recent = row.recentPaisePerMonth;
    if (baseline === null || value === null || typeof recent !== 'number' || !Number.isSafeInteger(recent)) return fail();
    return { ...heading(row), type: 'recover', subtitle: null,
      baselinePaisePerMonth: baseline, recentPaisePerMonth: recent, valuePaisePerMonth: value,
      valueKind: 'lost', due: null, target: { kind: 'lab', customerId: text(target.customerId) } };
  }
  if (!['diagnose', 'deadline', 'overdue_action'].includes(String(row.type)) || ![null, 'gap', 'expected'].includes(row.valueKind as null | string) || target.kind !== 'lab') return fail();
  const value = money(row.valuePaisePerMonth);
  if (value !== null && row.valueKind === null) return fail();
  if ((row.type === 'diagnose' && row.valueKind !== 'gap') || (row.type === 'overdue_action' && row.valueKind !== null && row.valueKind !== 'expected') || (row.type === 'deadline' && row.valueKind !== null && row.valueKind !== 'gap')) return fail();
  return { ...common(row), type: row.type as ExistingGrowDecision['type'], valuePaisePerMonth: value, valueKind: row.valueKind as ExistingGrowDecision['valueKind'], due: row.due === null ? null : date(row.due), target: { kind: 'lab', customerId: text(target.customerId) } };
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
  let recover: Today['recover'];
  if (value.recover !== undefined) {
    const status = object(value.recover);
    if (typeof status.certified !== 'boolean') return fail();
    recover = { certified: status.certified, reason: status.reason === null ? null : text(status.reason) };
  }
  return { policyVersion: 'today-v1', generatedAt: date(value.generatedAt), unblock: lane(value.unblock, unblock), grow: lane(value.grow, grow), ...(value.coverageCertified === undefined ? {} : { coverageCertified: value.coverageCertified as boolean }), ...(recover === undefined ? {} : { recover }) };
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
  return row.valuePaisePerMonth === null ? '₹ ?' : `${formatTodayPaise(row.valuePaisePerMonth)}/mo ${row.valueKind === 'lost' ? 'less' : row.valueKind}`;
}
