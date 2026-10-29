export type InfluenceStrength = 'strong' | 'medium' | 'low';
export type PowerMapContact = { id: string; name: string; businessRole: string | null; decisionRole: string; stance: string; influence: string; lastMetOn: string | null };
export type InfluenceLink = { id: string; fromContactId: string; toContactId: string; strength: InfluenceStrength; evidence: string; recordedBy: string; recordedAt: string };
export type PowerRoute = { steps: Array<{ contactId: string; name: string; decisionRole: string; stance: string }>; strengths: InfluenceStrength[] } | null;
export type PowerMap = { contacts: PowerMapContact[]; links: InfluenceLink[]; route: PowerRoute };
export type PowerMapCommand =
  | { action: 'get_power_map'; payload: { customerId: string } }
  | { action: 'set_influence'; payload: { requestId: string; customerId: string; fromContactId: string; toContactId: string; strength: InfluenceStrength; evidence: string } }
  | { action: 'end_influence'; payload: { requestId: string; influenceId: string; reason: string } };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const validId = (value: unknown): value is string => typeof value === 'string' && uuid.test(value);
// PostgreSQL char_length counts Unicode code points, rather than UTF-16 units.
const validNote = (value: unknown): value is string => typeof value === 'string' && value.trim() === value && Array.from(value).length >= 3 && Array.from(value).length <= 300;
const fail = (): never => { throw new Error('Invalid power map request'); };

export function validatePowerMapCommand(input: unknown): PowerMapCommand {
  if (!object(input) || !exact(input, ['action', 'payload']) || !object(input.payload)) return fail();
  const p = input.payload;
  if (input.action === 'get_power_map') {
    if (!exact(p, ['customerId']) || !validId(p.customerId)) return fail();
    return { action: input.action, payload: { customerId: p.customerId } };
  }
  if (input.action === 'set_influence') {
    if (!exact(p, ['requestId', 'customerId', 'fromContactId', 'toContactId', 'strength', 'evidence'])
      || ![p.requestId, p.customerId, p.fromContactId, p.toContactId].every(validId)
      || p.fromContactId === p.toContactId || !['strong', 'medium', 'low'].includes(p.strength as string) || !validNote(p.evidence)) return fail();
    return { action: input.action, payload: p as unknown as Extract<PowerMapCommand, { action: 'set_influence' }>['payload'] };
  }
  if (input.action === 'end_influence') {
    if (!exact(p, ['requestId', 'influenceId', 'reason']) || !validId(p.requestId) || !validId(p.influenceId) || !validNote(p.reason)) return fail();
    return { action: input.action, payload: { requestId: p.requestId, influenceId: p.influenceId, reason: p.reason } };
  }
  return fail();
}

/** Read responses may grow extra fields without breaking older clients. */
export function isPowerMap(value: unknown): value is PowerMap {
  const strings = (v: Record<string, unknown>, keys: string[]) => keys.every(key => typeof v[key] === 'string');
  const nullableString = (v: unknown) => v === null || typeof v === 'string';
  const strength = (v: unknown) => typeof v === 'string' && ['strong', 'medium', 'low'].includes(v);
  if (!object(value) || !Array.isArray(value.contacts) || !Array.isArray(value.links)) return false;
  if (!value.contacts.every(c => object(c) && strings(c, ['id', 'name', 'decisionRole', 'stance', 'influence']) && nullableString(c.businessRole) && nullableString(c.lastMetOn))) return false;
  if (!value.links.every(l => object(l) && strings(l, ['id', 'fromContactId', 'toContactId', 'evidence', 'recordedBy', 'recordedAt']) && strength(l.strength))) return false;
  const route = value.route;
  return route === null || (object(route) && Array.isArray(route.steps) && route.steps.length > 0 && route.steps.length <= 5
    && route.steps.every(s => object(s) && strings(s, ['contactId', 'name', 'decisionRole', 'stance']))
    && Array.isArray(route.strengths) && route.strengths.length === route.steps.length - 1 && route.strengths.every(strength));
}
