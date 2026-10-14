export type VisitOutcome = 'met' | 'not_available' | 'order_taken' | 'issue_raised' | 'other';
export const accountClassStates = ['A', 'B', 'below_b', 'not_available', 'not_linked'] as const;
export type AccountClassState = typeof accountClassStates[number];
export function parseAccountClass(value: string | null): AccountClassState | null {
  return accountClassStates.includes(value as AccountClassState) ? value as AccountClassState : null;
}
export type AccountRow = {
  id: string; name: string; city: string | null;
  class: { state: AccountClassState; monthlyPaise: string | null; window: { from: string; to: string }; policyId?: string };
  owner: { email: string; territoryId: string; territoryName: string; since: string; version: number } | null;
  location: { precision: 'pin' | 'town'; latitude: string | null; longitude: string | null; town: string | null; verifiedBy: string; verifiedAt: string; version: number } | null;
  lastVisit: { visitedOn: string; outcome: VisitOutcome; visitedBy: string; note: string | null } | null;
  nextVisitOn: string | null; lastOrderOn: string | null;
};
export type AccountsResponse = {
  classPolicy: { aMinPaise: string; bMinPaise: string };
  accounts: AccountRow[];
  page: { page: number; pageSize: number; total: number };
  owners: { email: string; name: string | null }[];
  territories: { id: string; name: string }[];
  canAssign: boolean; actorEmail: string; today: string;
};
export type AccountsGatewayResponse = Omit<AccountsResponse, 'canAssign' | 'actorEmail'>;
type CommandBase = { idempotencyKey: string };
export type AccountCommand =
  | { action: 'set_class_policy'; payload: CommandBase & { aMinPaise: string; bMinPaise: string; reason: string } }
  | { action: 'create_territory'; payload: CommandBase & { name: string } }
  | { action: 'assign_account'; payload: CommandBase & { customerId: string; ownerEmail: string; territoryId: string; expectedVersion: number | null } }
  | { action: 'set_location'; payload: CommandBase & { customerId: string; expectedVersion: number | null } & (
    { precision: 'pin'; latitude: string; longitude: string; source: 'manual_pin' | 'pasted_link' } |
    { precision: 'town'; town: string; source: 'town' }
  ) }
  | { action: 'log_visit'; payload: CommandBase & { customerId: string; visitedOn: string; outcome: VisitOutcome; note?: string | null; nextVisitOn?: string | null } };

export const accountUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const coordinatePattern = /^-?[0-9]{1,3}(\.[0-9]{1,6})?$/;
const outcomes: VisitOutcome[] = ['met', 'not_available', 'order_taken', 'issue_raised', 'other'];
function validCoordinates(latitude: unknown, longitude: unknown): latitude is string {
  return typeof latitude === 'string' && typeof longitude === 'string'
    && coordinatePattern.test(latitude) && coordinatePattern.test(longitude)
    && Math.abs(Number(latitude)) <= 90 && Math.abs(Number(longitude)) <= 180
    && !(Number(latitude) === 0 && Number(longitude) === 0);
}
function validVersion(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 2_147_483_647);
}
function validDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

/** Validate the flat public POST body and extract the gateway payload. */
export function parseAccountCommand(body: unknown): AccountCommand | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const p = body as Record<string, unknown>;
  if (typeof p.idempotencyKey !== 'string' || p.idempotencyKey.trim().length < 16 || p.idempotencyKey.length > 200) return null;
  const idempotencyKey = p.idempotencyKey;
  if (p.action === 'set_class_policy') {
    if (typeof p.aMinPaise !== 'string' || typeof p.bMinPaise !== 'string'
      || !/^[0-9]{1,19}$/.test(p.aMinPaise) || !/^[0-9]{1,19}$/.test(p.bMinPaise)
      || BigInt(p.aMinPaise) > BigInt('9223372036854775807') || BigInt(p.bMinPaise) <= BigInt(0)
      || BigInt(p.aMinPaise) <= BigInt(p.bMinPaise)
      || typeof p.reason !== 'string' || p.reason.trim().length < 3 || p.reason.trim().length > 500) return null;
    return { action: p.action, payload: { aMinPaise: p.aMinPaise, bMinPaise: p.bMinPaise, reason: p.reason.trim(), idempotencyKey } };
  }
  if (p.action === 'create_territory') {
    if (typeof p.name !== 'string' || p.name.trim().length < 2 || p.name.trim().length > 80) return null;
    return { action: p.action, payload: { name: p.name.trim(), idempotencyKey } };
  }
  if (typeof p.customerId !== 'string' || !accountUuidPattern.test(p.customerId)) return null;
  const customerId = p.customerId;
  if (p.action === 'assign_account') {
    if (typeof p.ownerEmail !== 'string' || p.ownerEmail.trim().length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.ownerEmail.trim())
      || typeof p.territoryId !== 'string' || !accountUuidPattern.test(p.territoryId) || !validVersion(p.expectedVersion)) return null;
    return { action: p.action, payload: { customerId, ownerEmail: p.ownerEmail.trim().toLowerCase(), territoryId: p.territoryId, expectedVersion: p.expectedVersion, idempotencyKey } };
  }
  if (p.action === 'set_location') {
    if (!validVersion(p.expectedVersion)) return null;
    const base = { customerId, expectedVersion: p.expectedVersion, idempotencyKey };
    if (p.precision === 'pin' && validCoordinates(p.latitude, p.longitude) && (p.source === 'manual_pin' || p.source === 'pasted_link') && p.town == null) {
      return { action: p.action, payload: { ...base, precision: 'pin', latitude: p.latitude, longitude: p.longitude as string, source: p.source } };
    }
    if (p.precision === 'town' && typeof p.town === 'string' && p.town.trim().length >= 2 && p.town.trim().length <= 80 && p.latitude == null && p.longitude == null && p.source === 'town') {
      return { action: p.action, payload: { ...base, precision: 'town', town: p.town.trim(), source: 'town' } };
    }
    return null;
  }
  if (p.action === 'log_visit') {
    if (!validDate(p.visitedOn) || typeof p.outcome !== 'string' || !outcomes.includes(p.outcome as VisitOutcome)
      || (p.note != null && (typeof p.note !== 'string' || p.note.length > 500))
      || (p.nextVisitOn != null && (!validDate(p.nextVisitOn) || p.nextVisitOn <= p.visitedOn))) return null;
    return { action: p.action, payload: { customerId, visitedOn: p.visitedOn, outcome: p.outcome as VisitOutcome, idempotencyKey,
      ...(p.note === undefined ? {} : { note: p.note as string | null }),
      ...(p.nextVisitOn === undefined ? {} : { nextVisitOn: p.nextVisitOn as string | null }) } };
  }
  return null;
}

export function parseLocationInput(text: string): { ok: true; latitude: string; longitude: string; source: 'manual_pin' | 'pasted_link' } | { ok: false; error: string } {
  const error = 'Paste coordinates like 12.9716, 77.5946 or a full map link.';
  const pairPattern = /^(-?[0-9]{1,3}(?:\.[0-9]+)?)\s*,\s*(-?[0-9]{1,3}(?:\.[0-9]+)?)$/;
  const input = text.trim();
  let pair = input.match(pairPattern);
  let source: 'manual_pin' | 'pasted_link' = 'manual_pin';
  if (!pair) {
    let url: URL;
    try { url = new URL(input); } catch { return { ok: false, error }; }
    if (url.hostname === 'maps.app.goo.gl' || url.hostname === 'goo.gl') return { ok: false, error: 'Short links can’t be read. Open the link and copy the full address bar URL.' };
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return { ok: false, error };
    source = 'pasted_link';
    pair = url.href.match(/@(-?[0-9]{1,3}(?:\.[0-9]+)?),(-?[0-9]{1,3}(?:\.[0-9]+)?)(?=[,/?&#]|$)/);
    if (!pair) {
      for (const key of ['q', 'query', 'll']) {
        pair = (url.searchParams.get(key) || '').trim().match(pairPattern);
        if (pair) break;
      }
    }
  }
  if (!pair || Math.abs(Number(pair[1])) > 90 || Math.abs(Number(pair[2])) > 180) return { ok: false, error };
  const round = (value: string) => Number(value).toFixed(6).replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1').replace(/^(-?\d+)$/, '$1.0');
  const latitude = round(pair[1]);
  const longitude = round(pair[2]);
  return validCoordinates(latitude, longitude) ? { ok: true, latitude, longitude, source } : { ok: false, error };
}
