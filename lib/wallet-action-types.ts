export type ActionType = 'visit' | 'demo' | 'get_competitor_proof' | 'add_product' | 'fix_service' | 'fix_supply' | 'instrument_proposal' | 'credit_terms' | 'price_review' | 'no_action';
export type ActionResult = 'done' | 'dropped';
export type WalletAction = { id: string; opportunityId: string; actionType: ActionType; detail: string; ownerEmail: string; dueOn: string; expectedMonthlyGainPaise: number | null; createdBy: string; createdAt: string; result: { result: ActionResult; note: string; closedBy: string; closedAt: string } | null };
export type ActionDueRow = { actionId: string; customerId: string; customerName: string; city: string | null; opportunityKind: 'capture' | 'defend' | 'recover'; constraintCategory: string | null; actionType: ActionType; detail: string; ownerEmail: string; dueOn: string; overdue: boolean; expectedMonthlyGainPaise: number | null };
export type ActionsDue = { page: number; pageSize: 50; total: number; overdueCount: number; rows: ActionDueRow[] };
export type ActionOwner = { email: string; name: string | null };
export type WalletActionCommand =
  | { action: 'get_actions_due'; payload: { page: number } }
  | { action: 'get_opportunity_actions'; payload: { opportunityId: string } }
  | { action: 'get_action_owners'; payload: Record<string, never> }
  | { action: 'create_action'; payload: { requestId: string; opportunityId: string; actionType: ActionType; detail: string; ownerEmail: string; dueOn: string; expectedMonthlyGainPaise: number | null } }
  | { action: 'close_action'; payload: { requestId: string; actionId: string; result: ActionResult; note: string } };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const types: ActionType[] = ['visit','demo','get_competitor_proof','add_product','fix_service','fix_supply','instrument_proposal','credit_terms','price_review','no_action'];
const results: ActionResult[] = ['done','dropped'];
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const text = (v: unknown, min: number, max: number) => typeof v === 'string' && v.trim() === v && v.length >= min && v.length <= max;
const date = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const todayIST = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const fail = (): never => { throw new Error('Invalid wallet action request'); };

export function validateWalletActionCommand(input: unknown): WalletActionCommand {
  if (!object(input) || !exact(input, ['action','payload']) || typeof input.action !== 'string' || !object(input.payload)) return fail();
  const p = input.payload;
  switch (input.action) {
    case 'get_actions_due':
      if (!exact(p, ['page']) || !Number.isInteger(p.page) || Number(p.page) < 1 || Number(p.page) > 10000) return fail();
      return { action: input.action, payload: { page: Number(p.page) } };
    case 'get_opportunity_actions':
      if (!exact(p, ['opportunityId']) || typeof p.opportunityId !== 'string' || !uuid.test(p.opportunityId)) return fail();
      return { action: input.action, payload: { opportunityId: p.opportunityId } };
    case 'get_action_owners':
      if (!exact(p, [])) return fail();
      return { action: input.action, payload: {} };
    case 'create_action': {
      if (!exact(p, ['requestId','opportunityId','actionType','detail','ownerEmail','dueOn','expectedMonthlyGainPaise']) || typeof p.requestId !== 'string' || !uuid.test(p.requestId) || typeof p.opportunityId !== 'string' || !uuid.test(p.opportunityId) || !types.includes(p.actionType as ActionType) || !text(p.detail, 3, 500) || typeof p.ownerEmail !== 'string' || p.ownerEmail !== p.ownerEmail.trim().toLowerCase() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.ownerEmail) || !date(p.dueOn)) return fail();
      const today = todayIST(); const last = new Date(`${today}T00:00:00Z`); last.setUTCDate(last.getUTCDate() + 180);
      if (p.dueOn < today || p.dueOn > last.toISOString().slice(0, 10) || !(p.expectedMonthlyGainPaise === null || (Number.isSafeInteger(p.expectedMonthlyGainPaise) && Number(p.expectedMonthlyGainPaise) >= 1 && Number(p.expectedMonthlyGainPaise) <= 9e13))) return fail();
      return { action: input.action, payload: p as unknown as Extract<WalletActionCommand, { action: 'create_action' }>['payload'] };
    }
    case 'close_action':
      if (!exact(p, ['requestId','actionId','result','note']) || typeof p.requestId !== 'string' || !uuid.test(p.requestId) || typeof p.actionId !== 'string' || !uuid.test(p.actionId) || !results.includes(p.result as ActionResult) || !text(p.note, 3, 500)) return fail();
      return { action: input.action, payload: p as unknown as Extract<WalletActionCommand, { action: 'close_action' }>['payload'] };
    default: return fail();
  }
}
