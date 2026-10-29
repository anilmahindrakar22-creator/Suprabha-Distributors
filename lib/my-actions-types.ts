import type { ActionResult, ActionType } from '@/lib/wallet-action-types';

export type MyActionRow = { actionId: string; customerId: string; customerName: string; city: string | null; actionType: ActionType; detail: string; dueOn: string; overdue: boolean; constraintCategory: string | null; routeToDecider: string[] | null };
export type MyActions = { page: number; pageSize: 50; total: number; overdueCount: number; rows: MyActionRow[] };
export type MyActionCommand =
  | { action: 'get_my_actions'; payload: { page: number } }
  | { action: 'close_my_action'; payload: { requestId: string; actionId: string; result: ActionResult; note: string; visit: { outcome: 'met' | 'not_available' | 'order_taken' | 'issue_raised' | 'other'; nextVisitOn: string | null } | null } };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const results: ActionResult[] = ['done', 'dropped'];
const visitOutcomes = ['met', 'not_available', 'order_taken', 'issue_raised', 'other'] as const;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const todayIST = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const validDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const fail = (): never => { throw new Error('Invalid my actions request'); };

export function validateMyActionCommand(input: unknown): MyActionCommand {
  if (!object(input) || !exact(input, ['action', 'payload']) || typeof input.action !== 'string' || !object(input.payload)) return fail();
  const payload = input.payload;
  if (input.action === 'get_my_actions') {
    if (!exact(payload, ['page']) || !Number.isInteger(payload.page) || Number(payload.page) < 1 || Number(payload.page) > 10000) return fail();
    return { action: input.action, payload: { page: Number(payload.page) } };
  }
  if (input.action === 'close_my_action') {
    if (!exact(payload, ['requestId', 'actionId', 'result', 'note', ...(Object.hasOwn(payload, 'visit') ? ['visit'] : [])]) || typeof payload.requestId !== 'string' || !uuid.test(payload.requestId) || typeof payload.actionId !== 'string' || !uuid.test(payload.actionId) || !results.includes(payload.result as ActionResult) || typeof payload.note !== 'string' || payload.note.trim() !== payload.note || payload.note.length < 3 || payload.note.length > 500) return fail();
    const visit = Object.hasOwn(payload, 'visit') ? payload.visit : null;
    if (visit !== null) {
      if (payload.result !== 'done' || !object(visit) || !exact(visit, ['outcome', 'nextVisitOn']) || !visitOutcomes.includes(visit.outcome as typeof visitOutcomes[number])) return fail();
      const nextVisitOn = visit.nextVisitOn;
      if (nextVisitOn !== null) {
        if (!validDate(nextVisitOn)) return fail();
        const today = todayIST(); const last = new Date(`${today}T00:00:00Z`); last.setUTCDate(last.getUTCDate() + 180);
        if (nextVisitOn <= today || nextVisitOn > last.toISOString().slice(0, 10)) return fail();
      }
    }
    return { action: input.action, payload: { requestId: payload.requestId, actionId: payload.actionId, result: payload.result as ActionResult, note: payload.note, visit: visit as Extract<MyActionCommand, { action: 'close_my_action' }>['payload']['visit'] } };
  }
  return fail();
}
