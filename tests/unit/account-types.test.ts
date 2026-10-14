import { describe, expect, it } from 'vitest';
import { parseAccountClass, parseAccountCommand, parseLocationInput } from '@/lib/account-types';

const customerId = '12345678-1234-4234-8234-123456789abc';
const idempotencyKey = 'accounts-parser-key-001';
const pin = { action: 'set_location', customerId, idempotencyKey, precision: 'pin', latitude: '12.9716', longitude: '77.5946', source: 'manual_pin', expectedVersion: null };
describe('account class parser', () => {
  it.each(['A', 'B', 'below_b', 'not_available', 'not_linked'])('accepts %s', state => {
    expect(parseAccountClass(state)).toBe(state);
  });
  it.each([null, '', 'a', 'b', 'Below B', 'unknown', ' A ', 'null'])('rejects %s', state => {
    expect(parseAccountClass(state)).toBeNull();
  });
});
describe('account class policy command', () => {
  const policy = { action: 'set_class_policy', aMinPaise: '20000000', bMinPaise: '7500000', reason: ' Owner thresholds ', idempotencyKey };
  it('extracts string thresholds and trims the reason without needing a customer', () => {
    expect(parseAccountCommand(policy)).toEqual({ action: 'set_class_policy', payload: {
      aMinPaise: '20000000', bMinPaise: '7500000', reason: 'Owner thresholds', idempotencyKey,
    } });
  });
  it('preserves exact bigint thresholds through the maximum supported value', () => {
    expect(parseAccountCommand({ ...policy, aMinPaise: '9223372036854775807', bMinPaise: '9223372036854775806' })?.payload)
      .toMatchObject({ aMinPaise: '9223372036854775807', bMinPaise: '9223372036854775806' });
  });
  it.each([
    { aMinPaise: 20000000 }, { bMinPaise: 7500000 }, { aMinPaise: undefined }, { bMinPaise: undefined },
    { aMinPaise: '7500000' }, { aMinPaise: '7499999' }, { bMinPaise: '0' }, { bMinPaise: '-1' },
    { aMinPaise: '20000000.5' }, { aMinPaise: '2e7' }, { aMinPaise: ' 20000000' }, { aMinPaise: '' },
    { aMinPaise: '9223372036854775808' }, { bMinPaise: '9223372036854775808' }, { aMinPaise: '1'.repeat(20) },
    { reason: null }, { reason: '  ab  ' }, { reason: 'x'.repeat(501) },
    { idempotencyKey: 'short' }, { idempotencyKey: ' '.repeat(16) }, { idempotencyKey: 'x'.repeat(201) },
  ])('rejects invalid policy %#', override => {
    expect(parseAccountCommand({ ...policy, ...override })).toBeNull();
  });
});
describe('account command parser', () => {
  it('accepts and trims territory names', () => {
    expect(parseAccountCommand({ action: 'create_territory', name: ' South ', idempotencyKey })).toEqual({ action: 'create_territory', payload: { name: 'South', idempotencyKey } });
  });
  it('accepts assignments with explicit initial or current versions', () => {
    const body = { action: 'assign_account', customerId, territoryId: customerId, ownerEmail: ' Sales@Example.test ', expectedVersion: null, idempotencyKey };
    expect(parseAccountCommand(body)?.payload).toMatchObject({ ownerEmail: 'sales@example.test', expectedVersion: null });
    expect(parseAccountCommand({ ...body, expectedVersion: 2 })?.payload).toMatchObject({ expectedVersion: 2 });
  });
  it('accepts pin and town locations', () => {
    expect(parseAccountCommand(pin)?.payload).toMatchObject({ latitude: '12.9716', expectedVersion: null });
    expect(parseAccountCommand({ action: 'set_location', customerId, idempotencyKey, precision: 'town', town: ' Mysuru ', source: 'town', expectedVersion: 1 })?.payload).toMatchObject({ town: 'Mysuru' });
  });
  it('accepts visits and leaves business date limits to the database', () => {
    expect(parseAccountCommand({ action: 'log_visit', customerId, idempotencyKey, visitedOn: '2026-10-14', outcome: 'met', note: 'Visit', nextVisitOn: '2026-10-20' })?.payload).toMatchObject({ outcome: 'met', nextVisitOn: '2026-10-20' });
  });
  it.each([
    null, [], {}, { ...pin, action: 'unknown' }, { ...pin, customerId: 'bad' }, { ...pin, idempotencyKey: 'short' },
    { ...pin, expectedVersion: undefined }, { ...pin, expectedVersion: 0 }, { ...pin, expectedVersion: 1.5 },
    { ...pin, latitude: '91' }, { ...pin, longitude: '181' }, { ...pin, latitude: '0', longitude: '0' },
    { ...pin, latitude: '12.1234567' }, { ...pin, source: 'town' },
    { ...pin, precision: 'town', town: 'Bengaluru', source: 'town' },
    { ...pin, precision: 'town', latitude: undefined, longitude: undefined, town: 'x', source: 'town' },
    { action: 'create_territory', name: 'x', idempotencyKey },
    { action: 'assign_account', customerId, territoryId: customerId, ownerEmail: 'bad', expectedVersion: null, idempotencyKey },
    { action: 'log_visit', customerId, idempotencyKey, visitedOn: '2026-02-30', outcome: 'met' },
    { action: 'log_visit', customerId, idempotencyKey, visitedOn: '2026-10-14', outcome: 'bad' },
    { action: 'log_visit', customerId, idempotencyKey, visitedOn: '2026-10-14', outcome: 'met', nextVisitOn: '2026-10-14' },
    { action: 'log_visit', customerId, idempotencyKey, visitedOn: '2026-10-14', outcome: 'met', note: 'x'.repeat(501) },
  ])('rejects malformed commands %#', input => { expect(parseAccountCommand(input)).toBeNull(); });
});
describe('account location input', () => {
  it('parses bare coordinates and rounds to six decimals', () => {
    expect(parseLocationInput('12.9715999, 77.5946')).toEqual({ ok: true, latitude: '12.9716', longitude: '77.5946', source: 'manual_pin' });
  });
  it.each([
    'https://www.google.com/maps/place/Bengaluru/@12.9716,77.5946,14z',
    'https://maps.google.com/?q=12.9716,77.5946',
    'https://www.google.com/maps/search/?api=1&query=12.9716%2C77.5946',
    'https://maps.google.com/?ll=12.9716,77.5946',
  ])('parses a full Maps link %s', input => {
    expect(parseLocationInput(input)).toEqual({ ok: true, latitude: '12.9716', longitude: '77.5946', source: 'pasted_link' });
  });
  it.each(['', 'nonsense', '0,0', '91,77', '12,181', 'https://maps.app.goo.gl/short', 'ftp://maps.google.com/?q=12,77', 'https://google.com/maps/place/Bengaluru'])('rejects invalid input %s', input => {
    expect(parseLocationInput(input).ok).toBe(false);
  });
});
