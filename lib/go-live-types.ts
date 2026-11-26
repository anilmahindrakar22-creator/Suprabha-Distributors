export const goLiveRoles = ['sales', 'operations', 'warehouse', 'accounts', 'billing', 'management', 'administrator', 'viewer'] as const;
export type GoLiveWeek = { weekStart: string; ordersEntered: number; ordersLinkedToTally: number; tallySaleInvoices: number; visitsLogged: number; activePeople: number };
export type GoLiveResponse = {
  weeks: GoLiveWeek[];
  people: { email: string; roles: string[]; actionsThisWeek: number; ordersThisWeek: number; visitsThisWeek: number; lastActionAt: string | null }[];
  membersByRole: Record<typeof goLiveRoles[number], number>;
  generatedAt: string;
};
const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const keys = (v: Record<string, unknown>, names: readonly string[]) => Object.keys(v).length === names.length && names.every(k => Object.hasOwn(v, k));
const integer = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const iso = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) && Number.isFinite(Date.parse(v));
const date = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v;
export function normalizeGoLive(body: unknown): GoLiveResponse {
  if (!object(body) || !keys(body, ['weeks','people','membersByRole','generatedAt']) || !iso(body.generatedAt)
    || !Array.isArray(body.weeks) || body.weeks.length !== 5 || !body.weeks.every(row => object(row)
      && keys(row, ['weekStart','ordersEntered','ordersLinkedToTally','tallySaleInvoices','visitsLogged','activePeople'])
      && date(row.weekStart) && ['ordersEntered','ordersLinkedToTally','tallySaleInvoices','visitsLogged','activePeople'].every(k => integer(row[k]))
      && (row.ordersLinkedToTally as number) <= (row.ordersEntered as number))
    || !Array.isArray(body.people) || body.people.length > 50 || !body.people.every(row => object(row)
      && keys(row, ['email','roles','actionsThisWeek','ordersThisWeek','visitsThisWeek','lastActionAt'])
      && typeof row.email === 'string' && row.email.length > 0 && Array.isArray(row.roles)
      && row.roles.every(role => typeof role === 'string' && goLiveRoles.includes(role as typeof goLiveRoles[number]))
      && ['actionsThisWeek','ordersThisWeek','visitsThisWeek'].every(k => integer(row[k]))
      && (row.lastActionAt === null || iso(row.lastActionAt)))
    || !object(body.membersByRole) || !keys(body.membersByRole, goLiveRoles)
    || !Object.values(body.membersByRole).every(integer)) throw new Error('Invalid go-live report');
  return body as unknown as GoLiveResponse;
}
