import { describe, expect, it, vi } from 'vitest';
import { MARKET_AREA } from '../../lib/account-types';
import { customerMapDayDifference, formatActionDue, formatBoundingBox, formatCustomerDate, formatLastVisit, mapColours, parseCustomerSheet, parseMapPins, parseNotOnMap, parsePinLabs, toneMeanings } from '../../lib/customer-map';

const pin = { customerId: '66111111-1111-4111-8111-111111111111', name: 'Example Lab', lat: 17.3, lng: 76.8, tone: 'red', focus: true, openOrders: 2 };
const group = { pinCode: '599901', lat: 17.3, lng: 76.8, count: 2, tone: 'red', openOrders: 3 };
const freshness = { calculatedAt: '2026-10-31T12:00:00+00:00', certified: true };
const pins = { coverage: { placed: 1, approx: 2, total: 4 }, pins: [pin], approxGroups: [group], notOnMapCount: 1, freshness };
const empty = { customerId: pin.customerId, name: pin.name, town: null, decisionMaker: { label: 'No decider known', canAddContact: true }, actions: { pin: 'place', orderCustomerId: pin.customerId } };
const order = { orderId: 'order-1', number: 'SF-1', stage: 'packed', date: '2026-10-30T20:00:00Z', valuePaise: 120000, kind: 'price', approximate: true };

const api = vi.hoisted(() => ({ gateway: vi.fn() }));
vi.mock('@/app/chatgpt-auth', () => ({ getChatGPTUser: async () => ({ email: 'pin@example.test' }) }));
vi.mock('@/lib/stockflow-session', () => ({ getStockFlowSession: async () => ({ email: 'pin@example.test', roles: ['sales'] }) }));
vi.mock('@/lib/order-gateway', async original => ({ ...await original<typeof import('@/lib/order-gateway')>(), callOrderGateway: api.gateway }));
import { GET } from '@/app/api/customer-map/route';

describe('PIN list API', () => {
  it.each(['?pin=599901&page=1', '?pin=599901&page=2&q=Lab', '?pin=599901&page=4000&q='])('routes %s with no caching', async query => {
    api.gateway.mockReset().mockResolvedValue({ rows: [] });
    const response = await GET(new Request('http://localhost/api/customer-map' + query));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const params = new URLSearchParams(query);
    expect(api.gateway).toHaveBeenCalledWith('pin@example.test', 'get_pin_labs', { pinCode: '599901', page: Number(params.get('page')), ...(params.has('q') ? { query: params.get('q') } : {}) });
  });
  it.each(['?pin=099901&page=1', '?pin=59990&page=1', '?pin=599901', '?pin=599901&page=0', '?pin=599901&page=1.5',
    '?pin=599901&page=4001', '?pin=599901&page=1&page=2', '?pin=599901&page=1&q=a&q=b',
    '?pin=599901&page=1&notOnMap=1', '?pin=599901&page=1&extra=1', '?pin=599901&pin=599902&page=1',
    '?pin=599901&page=1&q=' + 'a'.repeat(121)])('rejects %s before gateway access', async query => {
    api.gateway.mockReset();
    expect((await GET(new Request('http://localhost/api/customer-map' + query))).status).toBe(400);
    expect(api.gateway).not.toHaveBeenCalled();
  });
});

describe('customer map parsers', () => {
  it('parses pins and discards extra keys', () => {
    expect(parseMapPins({ ...pins, extra: true, pins: [{ ...pin, extra: true }] })).toEqual(pins);
  });
  it.each([null, [], {}, { ...pins, coverage: { placed: 3, total: 2 } }, { ...pins, pins: [{ ...pin, lat: NaN }] }, { ...pins, pins: [{ ...pin, lng: 181 }] }, { ...pins, pins: [{ ...pin, tone: 'blue' }] }, { ...pins, pins: [{ ...pin, focus: 1 }] }, { ...pins, pins: [{ ...pin, openOrders: -1 }] }, { ...pins, pins: [{ ...pin, openOrders: 1.5 }] }, { ...pins, pins: Array.from({ length: 501 }, () => pin) }])('rejects malformed pins %#', value => { expect(() => parseMapPins(value)).toThrow(); });
  it('parses a paginated unplaced list', () => {
    const list = { page: 2, pageSize: 20, total: 21, rows: [{ customerId: pin.customerId, name: pin.name, city: null }] };
    expect(parseNotOnMap({ ...list, extra: 'allowed' })).toEqual(list);
    for (const change of [{ page: 0 }, { pageSize: 50 }, { total: '21' }, { rows: [{ ...list.rows[0], city: 123 }] }]) expect(() => parseNotOnMap({ ...list, ...change })).toThrow();
  });
  it('strictly parses groups, coverage and freshness while discarding extra keys', () => {
    expect(parseMapPins({ ...pins, approxGroups: [{ ...group, walletPaise: 123 }], freshness: { ...freshness, walletAsOf: '2026-10-30', extra: 1 } }))
      .toEqual({ ...pins, freshness: { ...freshness, walletAsOf: '2026-10-30' } });
    expect(parseMapPins(pins).freshness).not.toHaveProperty('walletAsOf');
    expect(parseMapPins({ ...pins, freshness: { ...freshness, walletAsOf: null } }).freshness.walletAsOf).toBeNull();
    for (const change of [{ approxGroups: undefined }, { approxGroups: Array(501).fill(group) }, { coverage: { placed: 1, total: 4 } },
      { coverage: { placed: 1, approx: 3, total: 4 } }, { freshness: undefined }, { freshness: { ...freshness, calculatedAt: 'today' } },
      { freshness: { ...freshness, calculatedAt: '2026-02-30T12:00:00Z' } }, { freshness: { ...freshness, certified: 1 } },
      { freshness: { ...freshness, walletAsOf: '2026-02-30' } }]) expect(() => parseMapPins({ ...pins, ...change })).toThrow();
    for (const change of [{ pinCode: '099901' }, { pinCode: 599901 }, { lat: 91 }, { lng: NaN }, { count: 0 }, { count: 1.5 }, { openOrders: -1 }, { tone: 'blue' }])
      expect(() => parseMapPins({ ...pins, approxGroups: [{ ...group, ...change }] })).toThrow();
  });
  it('parses PIN rows with mandatory tones and no extra financial fields', () => {
    const row = { customerId: pin.customerId, name: pin.name, city: null, tone: 'grey' };
    const list = { page: 1, pageSize: 20, total: 1, rows: [row] };
    expect(parsePinLabs({ ...list, extra: true, rows: [{ ...row, walletPaise: 100 }] })).toEqual(list);
    for (const change of [{ page: 4001 }, { page: 0 }, { pageSize: 21 }, { total: -1 }, { rows: Array(21).fill(row) },
      { rows: [{ ...row, tone: undefined }] }, { rows: [{ ...row, tone: 'blue' }] }, { rows: [{ ...row, city: 2 }] }])
      expect(() => parsePinLabs({ ...list, ...change })).toThrow();
  });
  it('parses approximate sheets without coordinates and financial wallet provenance only when supplied', () => {
    const value = parseCustomerSheet({ ...empty, location: { approximate: { pinCode: '599901', extra: true } } });
    expect(value.location?.approximate).toEqual({ pinCode: '599901' });
    expect(value.location).toEqual({ approximate: { pinCode: '599901' } });
    expect(value).not.toHaveProperty('wallet');
    expect(parseCustomerSheet({ ...empty, wallet: { confidence: 'medium', asOf: '2026-10-30', extra: true } }).wallet)
      .toEqual({ confidence: 'medium', asOf: '2026-10-30' });
    expect(parseCustomerSheet({ ...empty, wallet: { confidence: null, asOf: null } }).wallet).toEqual({ confidence: null, asOf: null });
    for (const change of [{ location: { approximate: { pinCode: 'bad' } } }, { location: { approximate: {} } },
      { wallet: { confidence: 'certain', asOf: '2026-10-30' } }, { wallet: { confidence: 'high', asOf: '2026-02-30' } },
      { wallet: { confidence: 'high' } }]) expect(() => parseCustomerSheet({ ...empty, ...change })).toThrow();
  });
  it('accepts omitted financial keys and empty sections from the gateway', () => {
    const parsed = parseCustomerSheet(empty);
    for (const key of ['walletPaise', 'salesPaise', 'sharePermille', 'gapPaise']) expect(parsed).not.toHaveProperty(key);
    expect(parsed.instruments).toEqual({ ours: [], theirs: [], moreCount: 0 });
    expect(parsed.openWork).toEqual([]); expect(parsed.decider).toBeNull(); expect(parsed.location).toBeNull();
  });
  it('parses the actual gateway financial tiles, power route, instruments and work', () => {
    const value = parseCustomerSheet({ ...empty, town: 'Bidar', owner: { email: 'manager@example.test' }, class: 'A', certified: true, sharePermille: 200,
      tiles: { walletPaise: 1000000, salesPaise: 200000, gapPaise: 600000, lastVisit: { visitedOn: '2026-10-29' } },
      location: { lat: 17.3, lng: 76.8, version: 1, precision: 'pin' }, heldBackBy: { category: 'price', label: 'Price (not proven)', priceUnproven: true },
      nextAction: { id: 'action-1', actionType: 'visit', detail: 'Meet Meena', dueOn: '2026-11-01', canDone: true },
      decisionMaker: { contactId: 'contact-1', name: 'Meena', businessRole: 'Director', stance: 'supporter' },
      route: { steps: [{ name: 'Asha', decisionRole: 'champion' }, { name: 'Meena', decisionRole: 'decision_maker' }] },
      instruments: { moreCount: 2, rows: [{ kind: 'ours', model: 'Analyzer A', placedOn: '2026-01-01', serial: 'SN1', payback: 'Paying back' }, { kind: 'theirs', analyser: 'Analyzer B', closedSystem: 'yes' }, { kind: 'theirs', competitor: 'Other supplier', daysLeft: -2 }] },
      openWork: [order], recentOrders: [{ ...order, kind: 'order' }], contacts: { total: 3, champions: 1 }, actions: { ...empty.actions, call: 'tel:+919876543210' }, extra: 1 });
    expect(value.walletPaise).toBe(1000000); expect(value.constraint?.proven).toBe(false);
    expect(value.owner).toBe('manager@example.test'); expect(value.decider?.stance).toBe('supportive');
    expect(value.route[0].champion).toBe(true); expect(value.route[1].decider).toBe(true);
    expect(value.instruments.ours[0].payback).toBe('paying_back'); expect(value.instruments.theirs[0].closedSystem).toBe(true); expect(value.instruments.theirs[1].lockInDays).toBe(-2);
    expect(value.openWork[0]).toMatchObject({ orderNumber: 'SF-1', date: '2026-10-31', amountPaise: 120000, priceApproval: true });
  });
  it('accepts operational tiles and orders without money', () => {
    const { valuePaise: _ignored, ...operationalOrder } = order;
    const parsed = parseCustomerSheet({ ...empty, tiles: { openOrders: 2, overdue: 1, nextActionDue: '2026-11-01' }, openWork: [operationalOrder] });
    expect(parsed.openOrders).toBe(2); expect(parsed.overdue).toBe(1); expect(parsed.openWork[0]).not.toHaveProperty('amountPaise');
  });
  it('keeps uncertified share unknown', () => { expect(parseCustomerSheet({ ...empty, certified: false, sharePermille: null }).sharePermille).toBeNull(); });
  it('accepts share above 100% when the estimate is below certified sales', () => { expect(parseCustomerSheet({ ...empty, certified: true, sharePermille: 1200 }).sharePermille).toBe(1200); });
  it.each([{ tiles: { walletPaise: '100' } }, { sharePermille: -1 }, { tiles: { lastVisit: { visitedOn: '2026-02-30' } } }, { openWork: [{ ...order, date: 'yesterday' }] }, { instruments: { rows: [{ kind: 'ours', model: 'A', payback: 'invented' }], moreCount: 0 } }, { contacts: { total: 1, champions: 2 } }, { actions: { call: 'javascript:alert(1)' } }])('rejects malformed sheet fields %#', change => { expect(() => parseCustomerSheet({ ...empty, ...change })).toThrow(); });
});
describe('customer map helpers', () => {
  const now = new Date('2026-10-30T06:00:00Z');
  it('formats dates in India, adding only a different year', () => {
    expect(formatCustomerDate('2026-10-29', now)).toBe('29 Oct');
    expect(formatCustomerDate('2025-10-29', now)).toBe('29 Oct 2025');
    expect(formatCustomerDate('2027-01-01', now)).toBe('1 Jan 2027');
    expect(formatCustomerDate('2026-10-29T20:00:00Z', now)).toBe('30 Oct');
    const indiaNewYear = new Date('2026-12-31T20:00:00Z');
    expect(formatCustomerDate('2027-01-01', indiaNewYear)).toBe('1 Jan');
    expect(formatCustomerDate('2026-12-31', indiaNewYear)).toBe('31 Dec 2026');
  });
  it('compares calendar days across Indian midnight and leap days', () => {
    expect(customerMapDayDifference('2026-10-30', new Date('2026-10-29T18:29:59Z'))).toBe(1);
    expect(customerMapDayDifference('2026-10-30', new Date('2026-10-29T18:30:00Z'))).toBe(0);
    expect(customerMapDayDifference('2026-12-31', new Date('2026-12-31T20:00:00Z'))).toBe(-1);
    expect(customerMapDayDifference('2024-02-28', new Date('2024-03-01T06:00:00Z'))).toBe(-2);
  });
  it('formats last visits as today, elapsed days or Never', () => {
    expect(formatLastVisit(null, now)).toBe('Never');
    expect(formatLastVisit('2026-10-30', now)).toBe('today');
    expect(formatLastVisit('2026-10-29', now)).toBe('1 d ago');
    expect(formatLastVisit('2026-10-18', now)).toBe('12 d ago');
    expect(formatLastVisit('2026-11-01', now)).toBe('1 Nov');
  });
  it('formats action due dates as upcoming, today or late', () => {
    expect(formatActionDue('2026-11-01', now)).toBe('in 2 d');
    expect(formatActionDue('2026-10-30', now)).toBe('today');
    expect(formatActionDue('2026-10-27', now)).toBe('3 d late');
  });
  it('rejects invalid display dates', () => {
    expect(() => formatCustomerDate('2026-02-30', now)).toThrow();
    expect(() => formatActionDue('not a date', now)).toThrow();
    expect(() => formatLastVisit('not a date', now)).toThrow();
  });
  it('maps every tone to its fixed colour and a textual meaning', () => {
    expect(mapColours).toEqual({ red: '#E24B4A', amber: '#EF9F27', green: '#1D9E75', grey: '#6b777b' });
    for (const tone of Object.keys(mapColours) as (keyof typeof mapColours)[]) expect(toneMeanings[tone].length).toBeGreaterThan(5);
  });
  it('formats south, west, north, east to six decimal places', () => { expect(formatBoundingBox({ south: 16.1, west: 75.1234567, north: 18.6, east: 77.9 })).toBe('16.100000,75.123457,18.600000,77.900000'); });
  it('accepts and formats the exact MARKET_AREA on initial load', () => {
    expect(formatBoundingBox({ south: MARKET_AREA.minLatitude, west: MARKET_AREA.minLongitude, north: MARKET_AREA.maxLatitude, east: MARKET_AREA.maxLongitude }))
      .toBe('15.400000,75.000000,18.600000,77.900000');
  });
  it('accepts a box exactly 4° across in both dimensions', () => {
    expect(formatBoundingBox({ south: 14, west: 74, north: 18, east: 78 })).toBe('14.000000,74.000000,18.000000,78.000000');
  });
  it.each([{ south: NaN, west: 75, north: 18, east: 77 }, { south: 16, west: 75, north: 16, east: 77 }, { south: 16, west: 78, north: 18, east: 77 }, { south: -91, west: 75, north: -89, east: 77 }, { south: 14, west: 75, north: 18.01, east: 77 }, { south: 16, west: 74, north: 18, east: 78.01 }])('rejects invalid or oversized bounds %#', bounds => { expect(() => formatBoundingBox(bounds)).toThrow(); });
});
