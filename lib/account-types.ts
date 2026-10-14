// D-19 (owner, 14 Oct 2026); bounding box with margin; used only to warn
export const MARKET_AREA = { name: 'Kalaburagi, Bidar, Raichur, Yadgir, Bijapur', minLatitude: 15.4, maxLatitude: 18.6, minLongitude: 75.0, maxLongitude: 77.9 } as const;

export function isInsideMarketArea(latitude: number, longitude: number): boolean {
  return latitude >= MARKET_AREA.minLatitude && latitude <= MARKET_AREA.maxLatitude
    && longitude >= MARKET_AREA.minLongitude && longitude <= MARKET_AREA.maxLongitude;
}

export type VisitOutcome = 'met' | 'not_available' | 'order_taken' | 'issue_raised' | 'other';
export const powerAlerts = ['no_decision_maker', 'decision_maker_not_met', 'influential_blocker'] as const;
export type PowerAlert = typeof powerAlerts[number];
export const decisionRoles = ['decision_maker', 'influencer', 'user', 'gatekeeper', 'unknown'] as const;
export const contactStances = ['supporter', 'neutral', 'sceptical', 'blocker', 'unknown'] as const;
export const contactInfluences = ['high', 'medium', 'low', 'unknown'] as const;
export type ContactAssessment = { decisionRole: typeof decisionRoles[number]; stance: typeof contactStances[number]; influence: typeof contactInfluences[number]; reason: string | null; recordedAt: string; actor: string };
export type AppContact = { id: string; name: string; businessRole: string | null; phone: string | null; email: string | null; addedBy: string; version: number; canEdit: boolean; assessment?: ContactAssessment | null; lastMetOn?: string | null };
export const accountClassStates = ['A', 'B', 'below_b', 'not_available', 'not_linked'] as const;
export type AccountClassState = typeof accountClassStates[number];
export function parseAccountClass(value: string | null): AccountClassState | null {
  return accountClassStates.includes(value as AccountClassState) ? value as AccountClassState : null;
}
export type AccountRow = {
  id: string; name: string; city: string | null;
  appContacts: AppContact[];
  powerAlerts?: PowerAlert[];
  class: { state: AccountClassState; monthlyPaise: string | null; window: { from: string; to: string }; policyId?: string };
  owner: { email: string; territoryId: string; territoryName: string; since: string; version: number } | null;
  location: { precision: 'pin' | 'town'; latitude: string | null; longitude: string | null; town: string | null; verifiedBy: string; verifiedAt: string; version: number } | null;
  lastVisit: { visitedOn: string; outcome: VisitOutcome; visitedBy: string; note: string | null; metContacts: { id: string; name: string }[] } | null;
  nextVisitOn: string | null; lastOrderOn: string | null;
};
export type AccountsResponse = {
  classPolicy: { aMinPaise: string; bMinPaise: string };
  accounts: AccountRow[];
  page: { page: number; pageSize: number; total: number };
  owners: { email: string; name: string | null }[];
  territories: { id: string; name: string }[];
  canAssign: boolean; canSeePowerMap: boolean; actorEmail: string; today: string;
};
export type AccountsGatewayResponse = Omit<AccountsResponse, 'canAssign' | 'actorEmail'>;
export function withAccountContacts<T extends { accounts: (Omit<AccountRow, 'appContacts'> & { appContacts?: AccountRow['appContacts'] })[] }>(response: T): T & { accounts: AccountRow[] } {
  return { ...response, accounts: response.accounts.map(row => ({ ...row, appContacts: row.appContacts ?? [] })) };
}
type CommandBase = { idempotencyKey: string };
type ContactFields = { name: string; businessRole: string | null; phone: string | null; email: string | null };
export type AccountCommand =
  | { action: 'set_assessment'; payload: CommandBase & Pick<ContactAssessment, 'decisionRole' | 'stance' | 'influence'> & { contactId: string; reason?: string | null } }
  | { action: 'erase_contact'; payload: CommandBase & { contactId: string; reason: string } }
  | { action: 'add_contact'; payload: CommandBase & ContactFields & { customerId: string } }
  | { action: 'update_contact'; payload: CommandBase & ContactFields & { contactId: string; expectedVersion: number } }
  | { action: 'remove_contact'; payload: CommandBase & { contactId: string; expectedVersion: number } }
  | { action: 'set_class_policy'; payload: CommandBase & { aMinPaise: string; bMinPaise: string; reason: string } }
  | { action: 'create_territory'; payload: CommandBase & { name: string } }
  | { action: 'assign_account'; payload: CommandBase & { customerId: string; ownerEmail: string; territoryId: string; expectedVersion: number | null } }
  | { action: 'set_location'; payload: CommandBase & { customerId: string; expectedVersion: number | null } & (
    { precision: 'pin'; latitude: string; longitude: string; source: 'manual_pin' | 'pasted_link' } |
    { precision: 'town'; town: string; source: 'town' }
  ) }
  | { action: 'log_visit'; payload: CommandBase & { customerId: string; visitedOn: string; outcome: VisitOutcome; note?: string | null; nextVisitOn?: string | null; metContactIds?: string[] } };

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
  if (p.action === 'set_assessment' || p.action === 'erase_contact') {
    if (typeof p.contactId !== 'string' || !accountUuidPattern.test(p.contactId)) return null;
    if (p.action === 'erase_contact') {
      if (typeof p.reason !== 'string' || p.reason.trim().length < 3 || p.reason.trim().length > 300) return null;
      return { action: p.action, payload: { contactId: p.contactId, reason: p.reason.trim(), idempotencyKey } };
    }
    if (!decisionRoles.includes(p.decisionRole as ContactAssessment['decisionRole'])
      || !contactStances.includes(p.stance as ContactAssessment['stance'])
      || !contactInfluences.includes(p.influence as ContactAssessment['influence'])
      || (p.reason != null && (typeof p.reason !== 'string' || p.reason.length > 300))) return null;
    return { action: p.action, payload: { contactId: p.contactId, decisionRole: p.decisionRole as ContactAssessment['decisionRole'],
      stance: p.stance as ContactAssessment['stance'], influence: p.influence as ContactAssessment['influence'], idempotencyKey,
      ...(p.reason === undefined ? {} : { reason: p.reason as string | null }) } };
  }
  if (p.action === 'add_contact' || p.action === 'update_contact' || p.action === 'remove_contact') {
    const editing = p.action !== 'add_contact';
    const target = editing ? p.contactId : p.customerId;
    if (typeof target !== 'string' || !accountUuidPattern.test(target)) return null;
    if (editing && (p.expectedVersion === null || !validVersion(p.expectedVersion))) return null;
    if (p.action === 'remove_contact') return { action: p.action, payload: { contactId: target, expectedVersion: p.expectedVersion as number, idempotencyKey } };
    if (typeof p.name !== 'string' || p.name.trim().length < 2 || p.name.trim().length > 120) return null;
    for (const [field, limit] of [['businessRole', 80], ['phone', 40], ['email', 160]] as const) {
      if (p[field] != null && (typeof p[field] !== 'string' || p[field].trim().length > limit)) return null;
    }
    const email = typeof p.email === 'string' ? p.email.trim() || null : null;
    if (email && !email.includes('@')) return null;
    const fields = { name: p.name.trim(), businessRole: typeof p.businessRole === 'string' ? p.businessRole.trim() || null : null,
      phone: typeof p.phone === 'string' ? p.phone.trim() || null : null, email, idempotencyKey };
    return p.action === 'add_contact' ? { action: p.action, payload: { ...fields, customerId: target } }
      : { action: p.action, payload: { ...fields, contactId: target, expectedVersion: p.expectedVersion as number } };
  }
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
    if (p.metContactIds !== undefined && (!Array.isArray(p.metContactIds) || p.metContactIds.length > 10
      || p.metContactIds.some(id => typeof id !== 'string' || !accountUuidPattern.test(id)))) return null;
    if (!validDate(p.visitedOn) || typeof p.outcome !== 'string' || !outcomes.includes(p.outcome as VisitOutcome)
      || (p.note != null && (typeof p.note !== 'string' || p.note.length > 500))
      || (p.nextVisitOn != null && (!validDate(p.nextVisitOn) || p.nextVisitOn <= p.visitedOn))) return null;
    return { action: p.action, payload: { customerId, visitedOn: p.visitedOn, outcome: p.outcome as VisitOutcome, idempotencyKey,
      ...(p.note === undefined ? {} : { note: p.note as string | null }),
      ...(p.metContactIds === undefined ? {} : { metContactIds: p.metContactIds as string[] }),
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
