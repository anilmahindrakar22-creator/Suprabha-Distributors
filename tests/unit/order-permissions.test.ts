import { describe, expect, it } from 'vitest';
import { canAddOrderNotes, canBillChallan, canSendOnChallan, canCreateOrders, canEditOrders, canManageDeliveryExceptions, canManageInstallations, canRecordFulfilment } from '../../lib/order-permissions';
import { validateOrderCommand } from '../../lib/order-types';

describe('challan commands', () => {
  it.each(['send_on_challan', 'bill_challan'])('strictly validates %s', action => {
    const field = action === 'send_on_challan' ? 'challanNumber' : 'invoiceNumber';
    const payload = { orderId: 'order-1', expectedVersion: 1, idempotencyKey: '61000000-0000-4000-8000-000000000002', [field]: ' DC-101 ' };
    expect(validateOrderCommand({ action, payload })?.payload).toMatchObject({ [field]: 'DC-101' });
    for (const invalid of [{ [field]: '' }, { [field]: ' '.repeat(4) }, { [field]: 'x'.repeat(41) }, { expectedVersion: '1' }, { expectedVersion: 1.5 }, { idempotencyKey: 'not-a-valid-uuid' }]) {
      expect(validateOrderCommand({ action, payload: { ...payload, ...invalid } })).toBeNull();
    }
  });
});

describe('order permissions mirror server role rules', () => {
  it.each([
    ['administrator', true, true], ['operations', true, true],
    ['accounts', false, true], ['billing', false, true], ['management', false, false],
    ['viewer', false, false], ['sales', false, false], ['warehouse', false, false],
  ] as const)('%s: send challan=%s, bill challan=%s', (role, send, bill) => {
    for (const roles of [role, [role]]) {
      expect(canSendOnChallan(roles)).toBe(send);
      expect(canBillChallan(roles)).toBe(bill);
    }
  });
  it('accepts permitted combined challan roles', () => {
    expect(canSendOnChallan(['viewer', 'operations'])).toBe(true);
    expect(canBillChallan(['warehouse', 'billing'])).toBe(true);
    expect(canSendOnChallan(['warehouse', 'billing'])).toBe(false);
    expect(canBillChallan(['viewer', 'sales'])).toBe(false);
  });
  it.each([
    ['administrator', true], ['operations', true], ['sales', true],
    ['warehouse', true], ['management', true], ['viewer', false],
    ['accounts', false], ['billing', false],
  ] as const)('%s: manage delivery exceptions and installations=%s', (role, allowed) => {
    for (const roles of [role, [role]]) {
      expect(canManageDeliveryExceptions(roles)).toBe(allowed);
      expect(canManageInstallations(roles)).toBe(allowed);
    }
  });

  it('allows a permitted combined role to manage operational records', () => {
    expect(canManageDeliveryExceptions(['viewer', 'warehouse'])).toBe(true);
    expect(canManageInstallations(['viewer', 'warehouse'])).toBe(true);
  });
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
    expect(canSendOnChallan(roles)).toBe(false);
    expect(canBillChallan(roles)).toBe(false);
    expect(canAddOrderNotes(roles)).toBe(false);
    expect(canManageDeliveryExceptions(roles)).toBe(false);
    expect(canManageInstallations(roles)).toBe(false);
    expect(canCreateOrders(roles)).toBe(false);
    expect(canEditOrders(roles)).toBe(false);
    expect(canRecordFulfilment(roles)).toBe(false);
  });
});
