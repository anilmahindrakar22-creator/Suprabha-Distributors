import { describe, expect, it } from 'vitest';
import { normalizeGstin, parseLetterhead, validateLetterheadCommand } from '../../lib/letterhead';

const letterhead = { companyName: 'Suprabha Distributors', address: 'Office', gstin: '29ABCDE1234F1Z5',
  phone: '123', deliveryAddress: 'Warehouse', version: 1, updatedAt: '2026-11-22T10:00:00+00:00' };
const payload = { idempotencyKey: '00000000-0000-0000-0000-000000000001', expectedVersion: 1,
  companyName: letterhead.companyName, address: letterhead.address, gstin: letterhead.gstin,
  phone: letterhead.phone, deliveryAddress: letterhead.deliveryAddress };
const command = (p: unknown) => ({ action: 'set_letterhead', payload: p });
describe('company letterhead contract', () => {
  it('parses valid responses and commands with exact keys', () => {
    expect(parseLetterhead(letterhead)).toEqual(letterhead);
    expect(validateLetterheadCommand(command(payload))).toEqual(command(payload));
    expect(() => parseLetterhead({ ...letterhead, extra: true })).toThrow();
    expect(validateLetterheadCommand({ ...command(payload), extra: true })).toBeNull();
    expect(validateLetterheadCommand(command({ ...payload, extra: true }))).toBeNull();
    const { phone: _, ...missing } = payload;
    expect(validateLetterheadCommand(command(missing))).toBeNull();
    expect(validateLetterheadCommand(command({ ...payload, companyName: ' ' + 'a'.repeat(120) + ' ' }))?.payload.companyName).toBe('a'.repeat(120));
  });
  it('rejects bad GSTINs', () => {
    expect(() => parseLetterhead({ ...letterhead, gstin: 'invalid' })).toThrow();
    expect(validateLetterheadCommand(command({ ...payload, gstin: 'invalid' }))).toBeNull();
  });
  it('normalizes GSTIN input', () => {
    expect(normalizeGstin(' 29abcde1234f1z5 ')).toBe('29ABCDE1234F1Z5');
    expect(normalizeGstin('')).toBeNull();
    expect(parseLetterhead({ ...letterhead, gstin: null }).gstin).toBeNull();
    expect(validateLetterheadCommand(command({ ...payload, gstin: null }))).not.toBeNull();
  });
  it.each([{ companyName: '   ' }, { address: 'a'.repeat(401) }, { idempotencyKey: 'bad' },
    { expectedVersion: 0 }, { expectedVersion: 1.5 }, { phone: null }, { deliveryAddress: 'a'.repeat(401) }])('rejects invalid command %j', change => {
    expect(validateLetterheadCommand(command({ ...payload, ...change }))).toBeNull();
  });
  it.each([{ version: 0 }, { updatedAt: 'yesterday' }, { address: 'a'.repeat(401) }, { companyName: '' }, { phone: 123 }])('rejects invalid response %j', change => {
    expect(() => parseLetterhead({ ...letterhead, ...change })).toThrow();
  });
});
