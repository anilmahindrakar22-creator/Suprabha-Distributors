import { describe, expect, it } from 'vitest';
import { parseAccountCommand } from '@/lib/account-types';

const command = { action: 'create_customer', name: ' New visit lab ', city: ' Bidar ', phone: ' 9876543210 ', idempotencyKey: 'visit-customer-create-0001' };
describe('customers for visits without a ledger', () => {
  it('requires only a name, with optional town and phone, and never accepts a ledger binding', () => {
    expect(parseAccountCommand(command)).toEqual({ action: 'create_customer', payload: { name: 'New visit lab', city: 'Bidar', phone: '9876543210', idempotencyKey: command.idempotencyKey } });
    expect(parseAccountCommand({ action: command.action, name: 'New visit lab', idempotencyKey: command.idempotencyKey })?.payload).toEqual({ name: 'New visit lab', city: null, phone: null, idempotencyKey: command.idempotencyKey });
    expect(parseAccountCommand({ ...command, tallyKey: 'Unverified ledger' })).toBeNull();
    expect(parseAccountCommand({ ...command, customerSourceId: 'Unverified GUID' })).toBeNull();
  });
  it.each([{ name: ' ' }, { name: 'x'.repeat(161) }, { city: 1 }, { city: 'x'.repeat(161) }, { phone: 'x'.repeat(81) }, { active: true }, { name: null }])('rejects invalid or extra fields %#', fields => {
    expect(parseAccountCommand({ ...command, ...fields })).toBeNull();
  });
});
