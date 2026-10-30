import type { ConstraintCategory } from '@/lib/wallet-diagnosis-types';
import { constraintIcons } from '@/lib/glance-icons';

export const mapColours = { red: '#E24B4A', amber: '#EF9F27', green: '#1D9E75', grey: '#6b777b' } as const;
export type MapTone = keyof typeof mapColours;
export const toneMeanings: Record<MapTone, string> = { red: 'Overdue action or stuck order', amber: 'Needs a plan, diagnosis or decider', green: 'Share on target', grey: 'No data yet' };
export type MapPin = { customerId: string; name: string; lat: number; lng: number; tone: MapTone; focus: boolean; openOrders: number };
export type MapPins = { coverage: { placed: number; total: number }; pins: MapPin[]; notOnMapCount: number };
export type UnplacedCustomers = { page: number; pageSize: number; total: number; rows: { customerId: string; name: string; city: string | null }[] };
export type SheetOrder = { orderId: string; orderNumber: string; stage: string; date: string; amountPaise?: number | null; priceApproval?: boolean };
export type SheetInstrument = { name: string; placedOn: string | null; serial: string | null; payback?: 'paying_back' | 'behind' | 'awaiting_data' | null; closedSystem?: boolean; lockInDays?: number | null };
export type CustomerSheetData = {
  customerId: string; name: string; city: string | null; owner: string | null; accountClass: 'A' | 'B' | null; phone: string | null;
  location: { lat: number | null; lng: number | null; version: number; precision: 'pin' | 'town' } | null;
  sharePermille?: number | null; walletPaise?: number | null; salesPaise?: number | null; gapPaise?: number | null;
  constraint: { category: ConstraintCategory; label: string; proven: boolean } | null;
  openOrders: number | null; lastVisit: string | null; nextActionDue: string | null; overdue: number | null;
  nextAction: { actionId: string; type: string; detail: string; dueOn: string; owned: boolean } | null;
  decider: { name: string; role: string | null; stance: 'supportive' | 'neutral' | 'unknown' | 'opposed' } | null;
  route: { name: string; champion: boolean; decider: boolean }[];
  instruments: { ours: SheetInstrument[]; theirs: SheetInstrument[]; moreCount: number };
  openWork: SheetOrder[]; recentOrders: SheetOrder[]; contacts: { count: number; champions: number };
};

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid customer map response');
  return value as Record<string, unknown>;
}
function string(value: unknown): string { if (typeof value !== 'string' || !value.trim()) throw new Error('Invalid customer map text'); return value; }
function number(value: unknown): number { if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Invalid customer map number'); return value; }
function count(value: unknown): number { const n = number(value); if (!Number.isSafeInteger(n) || n < 0) throw new Error('Invalid customer map count'); return n; }
function boolean(value: unknown): boolean { if (typeof value !== 'boolean') throw new Error('Invalid customer map flag'); return value; }
function nullable<T>(value: unknown, parse: (v: unknown) => T): T | null { return value === null ? null : parse(value); }
function array<T>(value: unknown, parse: (v: unknown) => T): T[] { if (!Array.isArray(value)) throw new Error('Invalid customer map list'); return value.map(parse); }
function choice<T extends string>(value: unknown, choices: readonly T[]): T { if (!choices.includes(value as T)) throw new Error('Invalid customer map status'); return value as T; }
function coordinate(value: unknown, limit: number): number { const n = number(value); if (Math.abs(n) > limit) throw new Error('Invalid coordinate'); return n; }
function date(value: unknown): string { const s = string(value); if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isFinite(Date.parse(s)) || new Date(s).toISOString().slice(0, 10) !== s) throw new Error('Invalid date'); return s; }
function financial(row: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(keys.filter(key => row[key] !== undefined).map(key => [key, nullable(row[key], count)]));
}
export function parseMapPins(value: unknown): MapPins {
  const v = object(value), c = object(v.coverage);
  const result = { coverage: { placed: count(c.placed), total: count(c.total) }, notOnMapCount: count(v.notOnMapCount), pins: array(v.pins, item => {
    const p = object(item); return { customerId: string(p.customerId), name: string(p.name), lat: coordinate(p.lat, 90), lng: coordinate(p.lng, 180), tone: choice(p.tone, Object.keys(mapColours) as MapTone[]), focus: boolean(p.focus), openOrders: count(p.openOrders) };
  }) };
  if (result.pins.length > 500 || result.coverage.placed > result.coverage.total) throw new Error('Invalid coverage');
  return result;
}
export function parseNotOnMap(value: unknown): UnplacedCustomers {
  const v = object(value); const result = { page: count(v.page), pageSize: count(v.pageSize), total: count(v.total), rows: array(v.rows, item => { const r = object(item); return { customerId: string(r.customerId), name: string(r.name), city: nullable(r.city, string) }; }) };
  if (result.page < 1 || result.pageSize !== 20 || result.rows.length > 20) throw new Error('Invalid unplaced page');
  return result;
}
function optional<T>(value: unknown, parse: (v: unknown) => T): T | null { return value === undefined || value === null ? null : parse(value); }
function order(value: unknown): SheetOrder {
  const v = object(value), timestamp = string(v.date);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(timestamp) || !Number.isFinite(Date.parse(timestamp))) throw new Error('Invalid order date');
  date(timestamp.slice(0, 10));
  return { orderId: string(v.orderId), orderNumber: string(v.number), stage: string(v.stage), date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(timestamp)), ...(v.valuePaise === undefined ? {} : { amountPaise: nullable(v.valuePaise, count) }), ...(v.kind === undefined ? {} : { priceApproval: choice(v.kind, ['price', 'order']) === 'price' }) };
}
function instrument(value: unknown): { kind: 'ours' | 'theirs'; item: SheetInstrument } {
  const v = object(value), kind = choice(v.kind, ['ours', 'theirs'] as const);
  const payback = v.payback === undefined ? undefined : nullable(v.payback, n => choice(n, ['Paying back', 'Behind', 'Awaiting data'] as const));
  const days = optional(v.daysLeft, n => { const days = number(n); if (!Number.isSafeInteger(days)) throw new Error('Invalid countdown'); return days; });
  const closed = optional(v.closedSystem, n => choice(n, ['yes', 'no', 'unknown', 'true', 'false']));
  return { kind, item: { name: string(kind === 'ours' ? v.model : v.analyser ?? v.competitor), placedOn: optional(v.placedOn, date), serial: optional(v.serial, string), ...(payback === undefined ? {} : { payback: payback === 'Paying back' ? 'paying_back' : payback === 'Behind' ? 'behind' : 'awaiting_data' }), closedSystem: closed === 'yes' || closed === 'true', lockInDays: days } };
}
export function parseCustomerSheet(value: unknown): CustomerSheetData {
  const v = object(value), tiles = v.tiles === undefined ? {} : object(v.tiles);
  const instruments = v.instruments === undefined ? null : object(v.instruments);
  const rows = instruments ? array(instruments.rows, instrument) : [];
  const contacts = v.contacts === undefined ? null : object(v.contacts);
  const actions = object(v.actions);
  const call = optional(actions.call, string);
  if (call !== null && (!call.startsWith('tel:') || !/\d/.test(call.slice(4)))) throw new Error('Invalid phone');
  choice(actions.pin, ['place', 'move']);
  if (string(actions.orderCustomerId) !== v.customerId) throw new Error('Unexpected order customer');
  if (v.certified !== undefined) boolean(v.certified);
  const share = v.sharePermille === undefined ? undefined : nullable(v.sharePermille, count);
  const decider = object(v.decisionMaker);
  const hasDecider = decider.contactId !== undefined;
  if (hasDecider) string(decider.contactId);
  else { string(decider.label); boolean(decider.canAddContact); }
  const result: CustomerSheetData = {
    customerId: string(v.customerId), name: string(v.name), city: nullable(v.town, string), owner: optional(v.owner, n => string(object(n).email)), accountClass: optional(v.class, n => choice(n, ['A', 'B'])), phone: call?.slice(4) ?? null,
    location: optional(v.location, n => { const p = object(n); return { lat: coordinate(p.lat, 90), lng: coordinate(p.lng, 180), version: count(p.version), precision: choice(p.precision, ['pin'] as const) }; }),
    ...financial(tiles, ['walletPaise', 'salesPaise', 'gapPaise']),
    ...(share === undefined ? {} : { sharePermille: v.certified === false ? null : share }),
    constraint: optional(v.heldBackBy, n => { const r = object(n); return { category: choice(r.category, Object.keys(constraintIcons) as ConstraintCategory[]), label: string(r.label), proven: !boolean(r.priceUnproven) }; }),
    openOrders: optional(tiles.openOrders, count), lastVisit: optional(tiles.lastVisit, n => date(object(n).visitedOn)), nextActionDue: optional(tiles.nextActionDue, date), overdue: optional(tiles.overdue, count),
    nextAction: optional(v.nextAction, n => { const a = object(n); return { actionId: string(a.id), type: string(a.actionType), detail: string(a.detail), dueOn: date(a.dueOn), owned: boolean(a.canDone) }; }),
    decider: hasDecider ? { name: string(decider.name), role: optional(decider.businessRole, string), stance: choice(decider.stance, ['supporter', 'neutral', 'unknown', 'sceptical', 'blocker']) === 'supporter' ? 'supportive' : decider.stance === 'blocker' || decider.stance === 'sceptical' ? 'opposed' : decider.stance as 'neutral' | 'unknown' } : null,
    route: v.route === undefined || v.route === null ? [] : array(object(v.route).steps, n => { const r = object(n); const role = string(r.decisionRole); return { name: string(r.name), champion: role === 'champion', decider: role === 'decision_maker' }; }),
    instruments: { ours: rows.filter(r => r.kind === 'ours').map(r => r.item), theirs: rows.filter(r => r.kind === 'theirs').map(r => r.item), moreCount: instruments ? count(instruments.moreCount) : 0 },
    openWork: v.openWork === undefined ? [] : array(v.openWork, order), recentOrders: v.recentOrders === undefined ? [] : array(v.recentOrders, order), contacts: contacts ? { count: count(contacts.total), champions: count(contacts.champions) } : { count: 0, champions: 0 },
  };
  if (result.contacts.champions > result.contacts.count) throw new Error('Invalid contacts');
  if (rows.length > 3 || result.openWork.length > 3 || result.recentOrders.length > 3) throw new Error('Invalid sheet row limit');
  return result;
}
export type MapBounds = { south: number; west: number; north: number; east: number };
export function formatBoundingBox(bounds: MapBounds): string {
  const south = coordinate(bounds.south, 90), north = coordinate(bounds.north, 90), west = coordinate(bounds.west, 180), east = coordinate(bounds.east, 180);
  if (south >= north || west >= east || north - south > 3 || east - west > 3) throw new Error('Zoom in to load customers (at most 3° across).');
  return [south, west, north, east].map(n => n.toFixed(6)).join(',');
}
export async function readCustomerMap<T>(url: string, parse: (value: unknown) => T, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', signal });
  if (!response.ok) throw new Error('Customer map could not load. Try again.');
  return parse(await response.json());
}
