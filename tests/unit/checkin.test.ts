import { describe, expect, it } from 'vitest';
import { parseAccountCommand, parseCheckinPayload } from '@/lib/account-types';

const payload = { customerId: '12345678-1234-4234-8234-123456789abc', latitude: 17.33, longitude: 76.83, accuracyM: 100, requestId: 'gps-request-1' };
describe('GPS check-in contract', () => {
  it('uses the existing accounts POST command path without an idempotencyKey', () => {
    expect(parseCheckinPayload(payload)).toEqual(payload);
    expect(parseAccountCommand({ action: 'check_in', ...payload })).toEqual({ action: 'check_in', payload });
  });
  it.each([
    { verified: false }, { verified: null }, { distanceM: 0 }, { distanceM: null }, { idempotencyKey: 'unexpected' },
    { accuracyM: 0 }, { accuracyM: 5001 }, { accuracyM: 1.5 }, { accuracyM: '100' }, { accuracyM: NaN },
    { customerId: 'invalid' }, { requestId: '' }, { requestId: ' ' }, { requestId: ' a' }, { requestId: 'a'.repeat(201) },
    { latitude: NaN }, { longitude: Infinity }, { latitude: null }, { latitude: '17x' }, { latitude: ' 17' },
    { latitude: 15.3999999 }, { longitude: 77.900001 },
  ])('rejects invalid or extra values %#', override => {
    expect(parseCheckinPayload({ ...payload, ...override })).toBeNull();
    expect(parseAccountCommand({ action: 'check_in', ...payload, ...override })).toBeNull();
  });
  it.each(Object.keys(payload))('requires %s', key => {
    const incomplete: Record<string, unknown> = { ...payload };
    delete incomplete[key];
    expect(parseCheckinPayload(incomplete)).toBeNull();
  });
  it.each([null, [], true, 'gps'])('rejects nonobjects %#', value => expect(parseCheckinPayload(value)).toBeNull());
  it.each([1, 100, 101, 5000])('accepts accuracy %s without claiming verification', accuracyM => {
    expect(parseCheckinPayload({ ...payload, accuracyM })).toEqual({ ...payload, accuracyM });
  });
  it('accepts coordinate strings and inclusive market boundaries', () => {
    expect(parseCheckinPayload({ ...payload, latitude: '15.400000', longitude: '77.900000' })).not.toBeNull();
    expect(parseCheckinPayload({ ...payload, latitude: 18.6, longitude: 75 })).not.toBeNull();
  });
});
