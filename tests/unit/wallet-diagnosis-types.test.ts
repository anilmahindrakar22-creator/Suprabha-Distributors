import { describe, expect, it } from 'vitest';
import { validateWalletDiagnosisCommand } from '@/lib/wallet-diagnosis-types';
const customerId = '11111111-1111-4111-8111-111111111111';
const requestId = '22222222-2222-4222-8222-222222222222';
const opportunityId = '33333333-3333-4333-8333-333333333333';
describe('validateWalletDiagnosisCommand', () => {
  it('accepts all five commands', () => {
    expect(validateWalletDiagnosisCommand({ action: 'get_wallet_diagnoses', payload: { customerIds: [customerId] } }).action).toBe('get_wallet_diagnoses');
    expect(validateWalletDiagnosisCommand({ action: 'get_account_opportunities', payload: { customerId } }).action).toBe('get_account_opportunities');
    expect(validateWalletDiagnosisCommand({ action: 'open_opportunity', payload: { requestId, customerId, kind: 'capture', reason: 'Customer demand' } }).action).toBe('open_opportunity');
    expect(validateWalletDiagnosisCommand({ action: 'record_constraint', payload: { requestId, opportunityId, category: 'price', evidence: 'Competitor quote', confidence: 'high', expectedCurrentConstraintId: null } }).action).toBe('record_constraint');
    expect(validateWalletDiagnosisCommand({ action: 'close_opportunity', payload: { requestId, opportunityId, outcome: 'lost', reason: 'Customer chose another supplier' } }).action).toBe('close_opportunity');
  });
  it('rejects a bad UUID, duplicate or over limit customers, bounds, enums, and expected ID', () => {
    const good = { action: 'open_opportunity', payload: { requestId, customerId, kind: 'capture', reason: 'valid reason' } };
    for (const input of [null, { ...good, payload: { ...good.payload, requestId: 'bad' } }, { ...good, payload: { ...good.payload, kind: 'other' } }, { ...good, payload: { ...good.payload, reason: 'ab' } }, { action: 'get_wallet_diagnoses', payload: { customerIds: [customerId, customerId] } }, { action: 'get_wallet_diagnoses', payload: { customerIds: Array(51).fill(customerId) } }, { action: 'record_constraint', payload: { requestId, opportunityId, category: 'bad', evidence: 'valid', confidence: 'high', expectedCurrentConstraintId: 'bad' } }, { action: 'close_opportunity', payload: { requestId, opportunityId, outcome: 'bad', reason: 'valid reason' } }]) expect(() => validateWalletDiagnosisCommand(input)).toThrow('Invalid wallet diagnosis request');
  });
});
