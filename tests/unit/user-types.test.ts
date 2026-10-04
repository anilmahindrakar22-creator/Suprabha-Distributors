import { describe, expect, it } from 'vitest';
import { hasAnyStockFlowRole, normalizeStockFlowRoles, validateUserMutation } from '../../lib/user-types';

describe('combined role contract', () => {
  it('retains legacy single roles and normalizes combined assignments deterministically', () => {
    expect(normalizeStockFlowRoles('sales')).toEqual(['sales']);
    expect(normalizeStockFlowRoles(['accounts', 'sales', 'warehouse'])).toEqual(['sales', 'warehouse', 'accounts']);
  });
  it.each([[], ['sales', 'sales'], ['owner'], ['sales', 'owner'], [null], null, {}, Array(8).fill('viewer')])('rejects invalid role sets %#', value => {
    expect(normalizeStockFlowRoles(value)).toBeNull();
    expect(hasAnyStockFlowRole(value, ['administrator', 'accounts'])).toBe(false);
  });
  it('combines permissions without promoting operational roles into pricing roles', () => {
    expect(hasAnyStockFlowRole(['sales', 'warehouse'], ['sales'])).toBe(true);
    expect(hasAnyStockFlowRole(['sales', 'warehouse'], ['warehouse'])).toBe(true);
    expect(hasAnyStockFlowRole(['sales', 'warehouse'], ['administrator', 'management', 'accounts'])).toBe(false);
    expect(hasAnyStockFlowRole(['sales', 'accounts'], ['administrator', 'management', 'accounts'])).toBe(true);
    expect(hasAnyStockFlowRole(['sales', 'accounts'], ['administrator'])).toBe(false);
  });
});

describe('user administration request validation', () => {
  const valid = { idempotencyKey: '1234567890abcdef', email: 'staff@example.com', role: 'operations', status: 'active' };

  it('accepts a bounded known role and status', () => {
    expect(validateUserMutation(valid)).toEqual(valid);
  });

  it.each([
    { ...valid, email: 'not-an-email' },
    { ...valid, email: `${'x'.repeat(250)}@example.com` },
    { ...valid, role: 'owner' },
    { ...valid, status: 'deleted' },
    { ...valid, idempotencyKey: 'short' },
    [],
  ])('rejects malformed or unbounded administration input %#', (payload) => {
    expect(validateUserMutation(payload)).toBeNull();
  });
});
