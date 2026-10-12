export type CustomerLocation = {
  latitude: string; longitude: string; source: 'manual_pin' | 'pasted_link'; version: number;
  updatedAt: string; updatedBy: string;
};
export type MarketCustomer = { id: string; name: string; city: string | null; tallyKey: string | null; location: CustomerLocation | null };
export type CustomerLocationsPage = { customers: MarketCustomer[]; page: { page: number; pageSize: 50; total: number } };
export type SetCustomerLocationCommand = {
  customerId: string; latitude: string; longitude: string; source: CustomerLocation['source'];
  expectedVersion?: number; idempotencyKey: string;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const coordinatePattern = /^-?[0-9]{1,3}(\.[0-9]{1,6})?$/;
function validCoordinates(latitude: unknown, longitude: unknown): latitude is string {
  return typeof latitude === 'string' && typeof longitude === 'string'
    && coordinatePattern.test(latitude) && coordinatePattern.test(longitude)
    && Math.abs(Number(latitude)) <= 90 && Math.abs(Number(longitude)) <= 180
    && !(Number(latitude) === 0 && Number(longitude) === 0);
}

export function validateSetCustomerLocation(input: unknown): SetCustomerLocationCommand | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const p = input as Record<string, unknown>;
  if (typeof p.customerId !== 'string' || !uuidPattern.test(p.customerId)
    || !validCoordinates(p.latitude, p.longitude)
    || (p.source !== 'manual_pin' && p.source !== 'pasted_link')
    || (p.expectedVersion !== undefined && (!Number.isInteger(p.expectedVersion) || Number(p.expectedVersion) < 1 || Number(p.expectedVersion) > 2_147_483_647))
    || typeof p.idempotencyKey !== 'string' || p.idempotencyKey.trim().length < 16 || p.idempotencyKey.length > 200) return null;
  return {
    customerId: p.customerId, latitude: p.latitude as string, longitude: p.longitude as string,
    source: p.source, idempotencyKey: p.idempotencyKey,
    ...(p.expectedVersion === undefined ? {} : { expectedVersion: Number(p.expectedVersion) }),
  };
}

export function parseLocationInput(text: string): { ok: true; latitude: string; longitude: string } | { ok: false; error: string } {
  const error = 'Paste coordinates like 12.9716, 77.5946 or a full map link.';
  const pairPattern = /^(-?[0-9]{1,3}(?:\.[0-9]+)?)\s*,\s*(-?[0-9]{1,3}(?:\.[0-9]+)?)$/;
  const input = text.trim();
  let pair = input.match(pairPattern);
  if (!pair) {
    let url: URL;
    try { url = new URL(input); } catch { return { ok: false, error }; }
    if (url.hostname === 'maps.app.goo.gl' || url.hostname === 'goo.gl') {
      return { ok: false, error: 'Short links can’t be read. Open the link and copy the full address bar URL.' };
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return { ok: false, error };
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
  return validCoordinates(latitude, longitude) ? { ok: true, latitude, longitude } : { ok: false, error };
}
