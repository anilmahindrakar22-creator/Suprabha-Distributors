import { walletConstraintLabels } from './wallet-labels';

export const ruleTitle = { R1: 'Regular skipped a month', R2: 'Regular stopped', R3: 'Falling', R4: 'New, not back', R5: 'Pays under typical price' } as const;
export type GrowthRule = keyof typeof ruleTitle;
export const ruleLever = { R1: 'Retain', R2: 'Retain', R3: 'Retain', R4: 'Acquire', R5: 'Price' } as const;
export const growthInboxFilters = ['all', 'R1', 'R2', 'R3', 'R4', 'R5', 'done'] as const;
export type GrowthInboxFilter = typeof growthInboxFilters[number];
export const growthActionLabels = { visit: 'Visit', demo: 'Demo', add_product: 'Add product', fix_service: 'Fix service', fix_supply: 'Fix supply', no_action: 'No action' } as const;
export type GrowthActionType = keyof typeof growthActionLabels;
export const growthReasonLabels = { ...walletConstraintLabels, contract_tender: 'Contract/tender', agreed_volume_rate: 'Agreed volume rate' };
export type GrowthCategory = keyof typeof growthReasonLabels;
type BaseRow = { cardKey: string; labKey: string; customerId: string | null; name: string | null; town: string | null; rule: GrowthRule; period: string };
export type PriceCardInputs = { items: number; annualGapPaise: number; lastBoughtOn: string | null; lines: { itemKey: string; name: string | null; tallyItemKey: string | null; unitPricePaise: number; typicalPricePaise: number; quantity: number; gapPaise: number }[] };
export type GrowthCard = BaseRow & { ruleVersion: number; stakePaise: number; alsoMatches: GrowthRule[]; lastReason: { category: GrowthCategory; source: 'lab_said' | 'our_view'; on: string } | null; state: 'review' | 'in_progress'; action: { id: string; actionType: GrowthActionType; ownerEmail: string; dueOn: string } | null } & ({ rule: 'R5'; inputs: PriceCardInputs } | { rule: Exclude<GrowthRule, 'R5'>; inputs: Record<string, string | number> });
export type GrowthDoneRow = BaseRow & { action: { actionType: GrowthActionType; ownerEmail: string; result: 'done' | 'dropped'; note: string; closedOn: string }; outcome: { status: 'bought' | 'not_bought' | 'waiting'; on: string | null; valuePaise: number | null; daysLeft: number | null } };
export type GrowthInbox = { runMonth: string; salesTo: string; confirmed: boolean; confirmedReason: string | null; counts: Record<'all' | GrowthRule | 'toReview' | 'inProgress' | 'done', number>; stakeToReviewPaise: number; filter: GrowthInboxFilter; page: number; pageSize: 10; total: number; owners: { email: string }[]; rows: (GrowthCard | GrowthDoneRow)[] };
export type GrowthInboxResponse = GrowthInbox & { viewerEmail: string };
export type GrowthDecisionResult = { cardKey: string; state: 'review' | 'in_progress' | 'snoozed' | 'rejected' | 'hidden'; opportunityId?: string; actionId?: string } & ({ decision: 'snooze'; snoozeUntil: string } | { decision: 'accept' | 'reject' | 'undo' | 'review'; snoozeUntil?: never });
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.trim() === v;
const nullableText = (v: unknown) => v === null || text(v);
const integer = (v: unknown, min = 0): v is number => Number.isSafeInteger(v) && Number(v) >= min;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const month = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
const date = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
const member = <T extends string>(v: unknown, values: readonly T[]): v is T => typeof v === 'string' && values.includes(v as T);
const rule = (v: unknown): v is GrowthRule => member(v, ['R1', 'R2', 'R3', 'R4', 'R5']);
const category = (v: unknown) => typeof v === 'string' && Object.hasOwn(growthReasonLabels, v);
const actionType = (v: unknown) => typeof v === 'string' && Object.hasOwn(growthActionLabels, v);
const email = (v: unknown): v is string => text(v) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const uuid = (v: unknown) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const keys = (v: Record<string, unknown>, required: string[], optional: string[] = []) => required.every(k => Object.hasOwn(v, k)) && Object.keys(v).every(k => [...required, ...optional].includes(k));

export function buildGrowthDecision(value: unknown): Record<string, unknown> | null {
  if (!object(value) || !uuid(value.requestId) || !text(value.cardKey)) return null;
  const base = ['requestId', 'cardKey', 'decision'];
  const note = (v: unknown) => typeof v === 'string' && v.length <= 500;
  if (value.decision === 'accept') {
    if (!keys(value, [...base, 'actionType', 'ownerEmail', 'dueOn', 'detail']) || !actionType(value.actionType) || !email(value.ownerEmail) || !date(value.dueOn) || !text(value.detail) || value.detail.length < 3 || value.detail.length > 500) return null;
  } else if (value.decision === 'snooze') {
    if (!keys(value, [...base, 'until'], ['category', 'note']) || !member(value.until, ['2w', '1m', 'next_run']) || (value.category !== undefined && !category(value.category)) || (value.note !== undefined && !note(value.note))) return null;
  } else if (value.decision === 'reject') {
    if (!keys(value, [...base, 'category'], ['note']) || !category(value.category) || (value.note !== undefined && !note(value.note))) return null;
  } else if (value.decision === 'review') {
    if (!keys(value, base, ['note']) || (value.note !== undefined && (typeof value.note !== 'string' || value.note.trim().length < 1 || value.note.length > 500))) return null;
  } else if (value.decision !== 'undo' || !keys(value, base)) return null;
  const payload = { ...value };
  if (typeof payload.note === 'string') {
    const trimmed = payload.note.trim();
    if (trimmed) payload.note = trimmed;
    else delete payload.note;
  }
  return payload;
}

export function normalizeGrowthDecision(value: unknown): GrowthDecisionResult | null {
  if (!object(value) || !text(value.cardKey) || !member(value.decision, ['accept', 'snooze', 'reject', 'undo', 'review']) || !member(value.state, ['review', 'in_progress', 'snoozed', 'rejected', 'hidden']) || (value.opportunityId !== undefined && !text(value.opportunityId)) || (value.actionId !== undefined && !text(value.actionId))) return null;
  if (value.decision === 'review' && value.state !== 'hidden') return null;
  if (value.decision === 'snooze' ? !date(value.snoozeUntil) : Object.hasOwn(value, 'snoozeUntil')) return null;
  const base = { cardKey: value.cardKey, state: value.state, ...(value.opportunityId === undefined ? {} : { opportunityId: value.opportunityId as string }), ...(value.actionId === undefined ? {} : { actionId: value.actionId as string }) };
  return value.decision === 'snooze' ? { ...base, decision: 'snooze', snoozeUntil: value.snoozeUntil as string } : { ...base, decision: value.decision };
}

function validRow(v: unknown, done: boolean): boolean {
  if (!object(v) || !text(v.cardKey) || !text(v.labKey) || !nullableText(v.customerId) || !nullableText(v.name) || !nullableText(v.town) || !rule(v.rule) || !month(v.period)) return false;
  const a = v.action;
  if (done) {
    const o = v.outcome;
    return object(a) && actionType(a.actionType) && email(a.ownerEmail) && member(a.result, ['done', 'dropped']) && typeof a.note === 'string' && date(a.closedOn)
      && object(o) && member(o.status, ['bought', 'not_bought', 'waiting']) && (o.on === null || date(o.on)) && (o.valuePaise === null || integer(o.valuePaise)) && (o.daysLeft === null || integer(o.daysLeft))
      && (o.status !== 'bought' || (date(o.on) && integer(o.valuePaise))) && (o.status !== 'waiting' || integer(o.daysLeft));
  }
  if (!integer(v.ruleVersion, 1) || !integer(v.stakePaise) || !member(v.state, ['review', 'in_progress']) || !Array.isArray(v.alsoMatches) || !v.alsoMatches.every(rule)) return false;
  if (a !== null && (!object(a) || !text(a.id) || !actionType(a.actionType) || !email(a.ownerEmail) || !date(a.dueOn))) return false;
  if ((v.state === 'in_progress') !== (a !== null)) return false;
  const r = v.lastReason;
  if (r !== null && (!object(r) || !category(r.category) || !member(r.source, ['lab_said', 'our_view']) || !date(r.on))) return false;
  const i = v.inputs;
  if (!object(i)) return false;
  if (v.rule === 'R5') return v.state === 'review' && a === null && v.alsoMatches.length === 0
    && keys(i, ['items', 'annualGapPaise', 'lastBoughtOn', 'lines']) && integer(i.items, 1) && integer(i.annualGapPaise)
    && (i.lastBoughtOn === null || date(i.lastBoughtOn)) && Array.isArray(i.lines) && i.lines.length <= Math.min(i.items, 50)
    && i.lines.every((line, index, lines) => object(line) && keys(line, ['itemKey', 'name', 'tallyItemKey', 'unitPricePaise', 'typicalPricePaise', 'quantity', 'gapPaise'])
      && text(line.itemKey) && nullableText(line.name) && nullableText(line.tallyItemKey) && integer(line.unitPricePaise) && integer(line.typicalPricePaise, 1)
      && finite(line.quantity) && line.quantity > 0 && integer(line.gapPaise) && (index === 0 || lines[index - 1].gapPaise >= line.gapPaise));
  if (v.rule === 'R1') return keys(i, ['monthsBoughtPrev11', 'lastBoughtOn', 'typicalPaise']) && integer(i.monthsBoughtPrev11) && i.monthsBoughtPrev11 <= 11 && date(i.lastBoughtOn) && integer(i.typicalPaise);
  if (v.rule === 'R2') return keys(i, ['monthsBoughtH1', 'lastBoughtOn', 'typicalPaise']) && integer(i.monthsBoughtH1) && i.monthsBoughtH1 <= 6 && date(i.lastBoughtOn) && integer(i.typicalPaise);
  if (v.rule === 'R3') return keys(i, ['h1Paise', 'h2Paise', 'dropPct']) && integer(i.h1Paise) && integer(i.h2Paise) && finite(i.dropPct) && i.dropPct >= 0 && i.dropPct <= 100;
  return keys(i, ['firstMonth', 'firstPaise']) && month(i.firstMonth) && integer(i.firstPaise);
}

export function normalizeGrowthInbox(value: unknown): GrowthInbox | null {
  if (!object(value) || !month(value.runMonth) || !date(value.salesTo) || typeof value.confirmed !== 'boolean' || !nullableText(value.confirmedReason) || !object(value.counts) || !integer(value.stakeToReviewPaise) || !member(value.filter, growthInboxFilters) || !integer(value.page, 1) || value.pageSize !== 10 || !integer(value.total) || !Array.isArray(value.owners) || !value.owners.every(o => object(o) && email(o.email)) || !Array.isArray(value.rows) || value.rows.length > 10 || !value.rows.every(v => validRow(v, value.filter === 'done'))) return null;
  if (!['all', 'R1', 'R2', 'R3', 'R4', 'R5', 'toReview', 'inProgress', 'done'].every(k => integer((value.counts as Record<string, unknown>)[k]))) return null;
  // Construct the public response so incidental gateway fields never reach the UI.
  return { runMonth: value.runMonth, salesTo: value.salesTo, confirmed: value.confirmed, confirmedReason: value.confirmedReason as string | null, counts: value.counts as GrowthInbox['counts'], stakeToReviewPaise: value.stakeToReviewPaise, filter: value.filter, page: value.page, pageSize: 10, total: value.total, owners: value.owners.map(o => ({ email: o.email })), rows: value.rows as GrowthInbox['rows'] };
}

export function normalizeGrowthInboxResponse(value: unknown): GrowthInboxResponse | null {
  const data = normalizeGrowthInbox(value);
  return data && object(value) && email(value.viewerEmail) ? { ...data, viewerEmail: value.viewerEmail } : null;
}

export const inboxRupees = (paise: number) => `₹${Math.round(paise / 100).toLocaleString('en-IN')}`;
export const inboxStake = (paise: number) => paise >= 1e7 ? `₹${(paise / 1e7).toFixed(1)} L` : inboxRupees(paise);
export const inboxDate = (s: string) => new Date(`${s}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const monthName = (s: string, offset = 0) => { const d = new Date(`${s.slice(0, 7)}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + offset); return d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }); };
export function growthReasonLine(card: GrowthCard, runMonth: string): string {
  if (card.rule === 'R5') return `Pays under 90% of the typical price on ${card.inputs.items} item${card.inputs.items === 1 ? '' : 's'}${card.inputs.lastBoughtOn ? ` · last bought ${inboxDate(card.inputs.lastBoughtOn)}` : ''}`;
  const i = card.inputs, period = card.period || runMonth;
  const h1 = `${monthName(period, -11)}–${monthName(period, -6)}`, h2 = `${monthName(period, -5)}–${monthName(period)}`;
  if (card.rule === 'R1') return `Bought in ${i.monthsBoughtPrev11} of the previous 11 months, nothing in ${monthName(period)} · last bought ${monthName(String(i.lastBoughtOn))}`;
  if (card.rule === 'R2') return `Bought in ${i.monthsBoughtH1} months ${h1}, nothing since · last bought ${monthName(String(i.lastBoughtOn))}`;
  if (card.rule === 'R3') return `${inboxRupees(Number(i.h1Paise))} in ${h1}, ${inboxRupees(Number(i.h2Paise))} in ${h2} (−${Math.round(Number(i.dropPct))}%)`;
  return `First bought in ${monthName(String(i.firstMonth))} (${inboxRupees(Number(i.firstPaise))}), not since`;
}
