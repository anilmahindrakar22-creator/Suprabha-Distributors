import { describe, expect, it } from 'vitest';
import { validPricingLookup, validatePricingCommand } from '../../lib/pricing-types';

const id = '11111111-1111-4111-8111-111111111111';

describe('pricing API contracts', () => {
  it('accepts bounded whole pricing decisions and exception actions', () => {
    expect(validatePricingCommand({ action: 'submit_order_pricing', payload: { orderId: id, expectedVersion: 2, idempotencyKey: '1234567890abcdef', lines: [{ lineId: id, enteredRate: 720, reason: 'Current agreed rate' }] } })?.action).toBe('submit_order_pricing');
    expect(validatePricingCommand({ action: 'approve_price_exception', payload: { exceptionId: id, expectedVersion: 1, reason: 'Approved tender rate', idempotencyKey: 'abcdef1234567890' } })?.action).toBe('approve_price_exception');
    expect(validatePricingCommand({ action: 'reject_price_exception', payload: { exceptionId: id, expectedVersion: 1, reason: 'Margin is too low', idempotencyKey: 'abcdef1234567890' } })?.action).toBe('reject_price_exception');
  });

  it('rejects malformed IDs, stale versions, missing reasons, and unsafe rates', () => {
    const valid = { action: 'submit_order_pricing', payload: { orderId: id, expectedVersion: 2, idempotencyKey: '1234567890abcdef', lines: [{ lineId: id, enteredRate: 720 }] } };
    expect(validatePricingCommand({ ...valid, payload: { ...valid.payload, orderId: 'bad' } })).toBeNull();
    expect(validatePricingCommand({ ...valid, payload: { ...valid.payload, expectedVersion: 0 } })).toBeNull();
    expect(validatePricingCommand({ ...valid, payload: { ...valid.payload, lines: [{ lineId: id, enteredRate: 0 }] } })).toBeNull();
    expect(validatePricingCommand({ action: 'approve_price_exception', payload: { exceptionId: id, expectedVersion: 1, reason: '', idempotencyKey: 'abcdef1234567890' } })).toBeNull();
  });

  it('validates bounded pricing lookups', () => {
    expect(validPricingLookup(id, '2026-09-12')).toBe(true);
    expect(validPricingLookup(id, null)).toBe(true);
    expect(validPricingLookup('bad', null)).toBe(false);
    expect(validPricingLookup(id, '12/09/2026')).toBe(false);
  });

  it('validates effective-dated price contracts and controlled decisions', () => {
    expect(validatePricingCommand({ action: 'create_price_contract', payload: { customerId: id, tallyKey: 'ITEM-1', price: 720, validFrom: '2026-10-01', source: 'customer_contract', reason: 'Annual customer agreement', idempotencyKey: '1234567890abcdef' } })?.action).toBe('create_price_contract');
    expect(validatePricingCommand({ action: 'approve_price_contract', payload: { contractId: id, expectedVersion: 1, reason: 'Agreement verified', idempotencyKey: '1234567890abcdef' } })?.action).toBe('approve_price_contract');
    expect(validatePricingCommand({ action: 'create_price_contract', payload: { customerId: id, tallyKey: 'ITEM-1', price: 720, validFrom: '2026-10-01', validTo: '2026-09-01', source: 'customer_contract', reason: 'Invalid range', idempotencyKey: '1234567890abcdef' } })).toBeNull();
  });
});
