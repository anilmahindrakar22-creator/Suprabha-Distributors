import { describe, expect, it } from 'vitest';
import { formatBoundingBox, mapColours, parseCustomerSheet, parseMapPins, parseNotOnMap, toneMeanings } from '../../lib/customer-map';

const pin = { customerId: '66111111-1111-4111-8111-111111111111', name: 'Example Lab', lat: 17.3, lng: 76.8, tone: 'red', focus: true, openOrders: 2 };
const pins = { coverage: { placed: 1, total: 2 }, pins: [pin], notOnMapCount: 1 };
const empty = { customerId: pin.customerId, name: pin.name, town: null, decisionMaker: { label: 'No decider known', canAddContact: true }, actions: { pin: 'place', orderCustomerId: pin.customerId } };
const order = { orderId: 'order-1', number: 'SF-1', stage: 'packed', date: '2026-10-30T20:00:00Z', valuePaise: 120000, kind: 'price', approximate: true };

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
  it('maps every tone to its fixed colour and a textual meaning', () => {
    expect(mapColours).toEqual({ red: '#E24B4A', amber: '#EF9F27', green: '#1D9E75', grey: '#6b777b' });
    for (const tone of Object.keys(mapColours) as (keyof typeof mapColours)[]) expect(toneMeanings[tone].length).toBeGreaterThan(5);
  });
  it('formats south, west, north, east to six decimal places', () => { expect(formatBoundingBox({ south: 16.1, west: 75.1234567, north: 18.6, east: 77.9 })).toBe('16.100000,75.123457,18.600000,77.900000'); });
  it.each([{ south: NaN, west: 75, north: 18, east: 77 }, { south: 16, west: 75, north: 16, east: 77 }, { south: 16, west: 78, north: 18, east: 77 }, { south: -91, west: 75, north: -89, east: 77 }, { south: 14, west: 75, north: 18, east: 77 }, { south: 16, west: 74, north: 18, east: 78 }])('rejects invalid or oversized bounds %#', bounds => { expect(() => formatBoundingBox(bounds)).toThrow(); });
});
