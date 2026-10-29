import { describe, expect, it } from 'vitest';
import { decisionRoles, isInsideMarketArea, parseAccountClass, parseAccountCommand, parseLocationInput, powerAlerts, withAccountContacts } from '@/lib/account-types';
import type { AccountRow } from '@/lib/account-types';

describe('optional app contacts response', () => {
  it('defaults absent app contacts to an empty array and preserves supplied contacts', () => {
    const older = { id: 'older' } as Omit<AccountRow, 'appContacts'>;
    const appContacts: AccountRow['appContacts'] = [{ id: 'contact', name: 'Asha', businessRole: null, phone: null, email: null, addedBy: 'sales@example.test', version: 1, canEdit: true }];
    const response = withAccountContacts({ accounts: [older, { ...older, appContacts }] });
    expect(response.accounts[0].appContacts).toEqual([]);
    expect(response.accounts[1].appContacts).toEqual(appContacts);
    expect(older).not.toHaveProperty('appContacts');
  });
});

describe('market area warning bounds', () => {
  it.each([
    ['Kalaburagi', 17.33, 76.83, true],
    ['Bidar', 17.91, 77.52, true],
    ['Raichur', 16.20, 77.36, true],
    ['Bijapur', 16.83, 75.71, true],
    ['Pune', 18.52, 73.85, false],
    ['Bengaluru', 12.97, 77.59, false],
  ] as const)('checks %s', (_name, latitude, longitude, inside) => {
    expect(isInsideMarketArea(latitude, longitude)).toBe(inside);
  });
  it.each([
    [15.4, 75.0], [15.4, 77.9], [18.6, 75.0], [18.6, 77.9],
  ])('includes the boundary at %s, %s', (latitude, longitude) => {
    expect(isInsideMarketArea(latitude, longitude)).toBe(true);
  });
  it.each([
    [15.3999, 76.83], [18.6001, 76.83], [17.33, 74.9999], [17.33, 77.9001],
  ])('excludes coordinates just beyond the boundary at %s, %s', (latitude, longitude) => {
    expect(isInsideMarketArea(latitude, longitude)).toBe(false);
  });
});

const customerId = '12345678-1234-4234-8234-123456789abc';
const idempotencyKey = 'accounts-parser-key-001';
describe('app contact commands', () => {
  const contact = { action: 'add_contact', customerId, name: ' Asha ', businessRole: ' Lab head ', phone: ' 9000000000 ', email: ' a@example.test ', idempotencyKey };
  it('trims fields and extracts add/update/remove targets', () => {
    expect(parseAccountCommand(contact)).toEqual({ action: 'add_contact', payload: { customerId, name: 'Asha', businessRole: 'Lab head', phone: '9000000000', email: 'a@example.test', idempotencyKey } });
    expect(parseAccountCommand({ ...contact, action: 'update_contact', customerId: undefined, contactId: customerId, expectedVersion: 2 })?.payload).toMatchObject({ contactId: customerId, expectedVersion: 2 });
    expect(parseAccountCommand({ action: 'remove_contact', contactId: customerId, expectedVersion: 1, idempotencyKey })).toEqual({ action: 'remove_contact', payload: { contactId: customerId, expectedVersion: 1, idempotencyKey } });
  });
  it('normalizes optional blanks and omitted fields', () => {
    expect(parseAccountCommand({ action: 'add_contact', customerId, name: 'Asha', idempotencyKey })?.payload).toMatchObject({ businessRole: null, phone: null, email: null });
    expect(parseAccountCommand({ ...contact, businessRole: ' ', phone: '', email: ' ' })?.payload).toMatchObject({ businessRole: null, phone: null, email: null });
  });
  it.each([{ name: 'x' }, { name: 'x'.repeat(121) }, { businessRole: 'x'.repeat(81) }, { phone: 'x'.repeat(41) }, { email: 'invalid' }, { email: 'a'.repeat(160)+'@' }, { phone: 123 }, { customerId: 'bad' }, { idempotencyKey: 'short' }])('rejects invalid fields %#', override => {
    expect(parseAccountCommand({ ...contact, ...override })).toBeNull();
  });
  it.each([undefined, null, 0, 1.5, 2147483648, '1'])('requires an integer edit/removal version %s', expectedVersion => {
    for (const action of ['update_contact', 'remove_contact']) expect(parseAccountCommand({ ...contact, action, contactId: customerId, expectedVersion })).toBeNull();
  });
});
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
describe('Power Map commands', () => {
  const contactId = '12345678-1234-4234-8234-123456789abc';
  const idempotencyKey = 'power-map-types-key-0001';
  const assessment = { action: 'set_assessment', contactId, decisionRole: 'decision_maker', stance: 'sceptical', influence: 'high', idempotencyKey };
  it('parses assessments with optional and null reasons', () => {
    expect(parseAccountCommand(assessment)).toEqual({ action: 'set_assessment', payload: { contactId, decisionRole: 'decision_maker', stance: 'sceptical', influence: 'high', idempotencyKey } });
    expect(parseAccountCommand({ ...assessment, reason: null })?.payload).toHaveProperty('reason', null);
    expect(parseAccountCommand({ ...assessment, reason: 'x'.repeat(300) })).not.toBeNull();
  });
  it.each([{ decisionRole: 'bad' }, { stance: 'bad' }, { influence: 'bad' }, { contactId: 'bad' }, { reason: 1 }, { reason: 'x'.repeat(301) }, { idempotencyKey: 'short' }])('rejects malformed assessment %#', override => {
    expect(parseAccountCommand({ ...assessment, ...override })).toBeNull();
  });
  it('parses erasure and requires a bounded reason', () => {
    expect(parseAccountCommand({ action: 'erase_contact', contactId, reason: ' Privacy request ', idempotencyKey })).toEqual({ action: 'erase_contact', payload: { contactId, reason: 'Privacy request', idempotencyKey } });
    for (const reason of [undefined, null, 1, 'ab', 'x'.repeat(301)]) expect(parseAccountCommand({ action: 'erase_contact', contactId, reason, idempotencyKey })).toBeNull();
  });
  it('parses bounded UUID arrays on visits and preserves omission', () => {
    const visit = { action: 'log_visit', customerId: contactId, visitedOn: '2026-10-14', outcome: 'met', idempotencyKey };
    expect(parseAccountCommand(visit)?.payload).not.toHaveProperty('metContactIds');
    for (const metContactIds of [[], [contactId], Array(10).fill(contactId)]) expect(parseAccountCommand({ ...visit, metContactIds })?.payload).toHaveProperty('metContactIds', metContactIds);
    for (const metContactIds of [null, contactId, ['bad'], [1], Array(11).fill(contactId)]) expect(parseAccountCommand({ ...visit, metContactIds })).toBeNull();
  });
});
describe('Social Styles commands', () => {
  const contactId = '12345678-1234-4234-8234-123456789abc';
  const observation = { action: 'record_style_observation', contactId, visitId: contactId, a: [1, 2, 3, 4], r: [4, 3, 2, 1], idempotencyKey: 'social-types-key-0001' };
  it('parses ratings and preserves omitted or empty cues', () => {
    const { action, ...payload } = observation;
    expect(parseAccountCommand(observation)).toEqual({ action, payload });
    expect(parseAccountCommand({ ...observation, cues: [] })?.payload).toHaveProperty('cues', []);
    expect(parseAccountCommand({ ...observation, cues: ['cost_per_test', 'validation_data'] })?.payload).toHaveProperty('cues', ['cost_per_test', 'validation_data']);
  });
  it.each([{ contactId: 'bad' }, { visitId: 'bad' }, { a: null }, { a: [1, 2, 3] }, { r: [1, 2, 3, 4, 1] },
    { a: [0, 1, 2, 3] }, { r: [1, 2, 3, 5] }, { a: [1, 2, 3, 2.5] }, { a: ['1', 2, 3, 4] },
    { cues: null }, { cues: 'cost_per_test' }, { cues: ['bad'] }, { cues: [null] }, { idempotencyKey: 'short' }])('rejects malformed observation %#', override => {
    expect(parseAccountCommand({ ...observation, ...override })).toBeNull();
  });
  it.each(['analytical', 'driving', 'expressive', 'amiable', null])('parses override %s', style => {
    expect(parseAccountCommand({ action: 'set_style_override', contactId, style, reason: ' Reviewed evidence ', idempotencyKey: observation.idempotencyKey }))
      .toEqual({ action: 'set_style_override', payload: { contactId, style, reason: 'Reviewed evidence', idempotencyKey: observation.idempotencyKey } });
  });
  it.each([{ style: undefined }, { style: 'bad' }, { reason: null }, { reason: ' ab ' }, { reason: 'x'.repeat(301) }, { contactId: 'bad' }])('rejects malformed override %#', override => {
    expect(parseAccountCommand({ action: 'set_style_override', contactId, style: null, reason: 'Clear override', idempotencyKey: observation.idempotencyKey, ...override })).toBeNull();
  });
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
describe('Power Map account types', () => {
  it('accepts the added roles and alerts', () => {
    expect(decisionRoles).toEqual(expect.arrayContaining(['champion', 'technical_evaluator', 'coach']));
    expect(powerAlerts).toEqual(expect.arrayContaining(['influential_unknown', 'no_influential_supporter']));
    for (const decisionRole of ['champion', 'technical_evaluator', 'coach']) {
      expect(parseAccountCommand({ action: 'set_assessment', contactId: '66666666-6666-4666-8666-666666666666', decisionRole, stance: 'supporter', influence: 'high', idempotencyKey: 'assessment-key-0001' })).not.toBeNull();
    }
  });
});
