import { describe, expect, it } from 'vitest';
import { parseLocationInput, validateSetCustomerLocation } from '@/lib/market-types';

const genericError = { ok: false, error: 'Paste coordinates like 12.9716, 77.5946 or a full map link.' };
const payload = { customerId: '12345678-1234-4234-8234-123456789abc', latitude: '12.971599', longitude: '77.5946', source: 'manual_pin', idempotencyKey: 'market-unit-test-key-001' };
describe('location input parsing', () => {
  it.each([
    ['12.9716, 77.5946', '12.9716', '77.5946'],
    [' 12.9716 , 77.5946 ', '12.9716', '77.5946'],
    ['-33.86,151.2', '-33.86', '151.2'],
    ['https://www.google.com/maps/place/X/@12.9716,77.5946,17z', '12.9716', '77.5946'],
    ['https://maps.google.com/?q=12.9716%2C77.5946', '12.9716', '77.5946'],
    ['https://maps.google.com/?query=12.9716,77.5946', '12.9716', '77.5946'],
    ['https://maps.google.com/?ll=-33.86,151.2', '-33.86', '151.2'],
    [' 12.1234567, 77 ', '12.123457', '77.0'],
    ['90.000000, -180.000000', '90.0', '-180.0'],
  ])('extracts coordinates from %s', (input, latitude, longitude) => {
    expect(parseLocationInput(input)).toEqual({ ok: true, latitude, longitude });
  });
  it.each(['https://maps.app.goo.gl/abcd', 'https://goo.gl/maps/abcd'])('rejects short links with instructions', input => {
    expect(parseLocationInput(input)).toEqual({ ok: false, error: 'Short links can’t be read. Open the link and copy the full address bar URL.' });
  });
  it.each(['0,0', '91,10', 'hello', 'https://www.openstreetmap.org/?mlat=12.9716&mlon=77.5946', '0.00000001,0', '90.0000001,10'])('rejects unsupported or invalid input %s', input => {
    expect(parseLocationInput(input)).toEqual(genericError);
  });
});
describe('set customer location validation', () => {
  it('accepts a valid placement and a versioned move', () => {
    expect(validateSetCustomerLocation(payload)).toEqual(payload);
    expect(validateSetCustomerLocation({ ...payload, expectedVersion: 1, source: 'pasted_link' })).toEqual({ ...payload, expectedVersion: 1, source: 'pasted_link' });
  });
  it.each([
    { latitude: '12.1234567' }, { customerId: 'bad' }, { source: 'unknown' }, { expectedVersion: 0 },
    { expectedVersion: 1.5 }, { expectedVersion: null }, { idempotencyKey: 'short' }, { latitude: '91' },
    { longitude: '181' }, { latitude: '0', longitude: '0' }, { latitude: 12 }, { idempotencyKey: 'x'.repeat(201) },
  ])('rejects invalid payload %j', change => {
    expect(validateSetCustomerLocation({ ...payload, ...change })).toBeNull();
  });
});
