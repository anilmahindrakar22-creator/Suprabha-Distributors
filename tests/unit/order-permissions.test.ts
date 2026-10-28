import { describe, expect, it } from 'vitest';
import { canAddOrderNotes, canCreateOrders, canEditOrders, canRecordFulfilment } from '../../lib/order-permissions';

describe('order permissions mirror server role rules', () => {
  it.each([
    ['administrator', true],
    ['sales', true],
    ['operations', true],
    ['warehouse', true],
    ['accounts', true],
    ['billing', true],
    ['management', true],
    ['viewer', false],
  ] as const)('%s: add notes=%s', (role, allowed) => {
    for (const roles of [role, [role]]) {
      expect(canAddOrderNotes(roles)).toBe(allowed);
    }
  });

  it.each([
    ['administrator', true, true, true],
    ['sales', true, true, true],
    ['operations', true, true, true],
    ['warehouse', false, false, true],
    ['accounts', false, false, true],
    ['billing', false, false, false],
    ['management', true, true, true],
    ['viewer', false, false, false],
  ] as const)('%s: create=%s, edit=%s, fulfil=%s', (role, create, edit, fulfil) => {
    for (const roles of [role, [role]]) {
      expect(canCreateOrders(roles)).toBe(create);
      expect(canEditOrders(roles)).toBe(edit);
      expect(canRecordFulfilment(roles)).toBe(fulfil);
    }
  });

  it.each([
    [['warehouse', 'sales'], true, true, true],
    [['viewer', 'accounts'], false, false, true],
    [['billing', 'viewer'], false, false, false],
  ] as const)('accepts any permitted assigned role in %j', (roles, create, edit, fulfil) => {
    expect(canCreateOrders(roles)).toBe(create);
    expect(canEditOrders(roles)).toBe(edit);
    expect(canRecordFulfilment(roles)).toBe(fulfil);
  });

  it.each([undefined, null, [], ['sales', 'unknown'], ['sales', 'sales']])('fails closed for invalid roles %j', (roles) => {
    expect(canAddOrderNotes(roles)).toBe(false);
    expect(canCreateOrders(roles)).toBe(false);
    expect(canEditOrders(roles)).toBe(false);
    expect(canRecordFulfilment(roles)).toBe(false);
  });
});
