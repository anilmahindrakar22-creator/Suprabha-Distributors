import { describe, expect, it } from 'vitest';
import { validateUserMutation } from '../../lib/user-types';

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
