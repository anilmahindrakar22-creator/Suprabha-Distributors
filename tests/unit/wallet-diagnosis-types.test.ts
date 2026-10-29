import { describe, expect, it } from 'vitest';
import { validateWalletDiagnosisCommand } from '@/lib/wallet-diagnosis-types';
const customerId = '11111111-1111-4111-8111-111111111111';
const requestId = '22222222-2222-4222-8222-222222222222';
const opportunityId = '33333333-3333-4333-8333-333333333333';
const contactId = '44444444-4444-4444-8444-444444444444';
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const base = { requestId, opportunityId, evidence: 'A sufficiently detailed note', source: 'document', sourcePerson: null, observedOn: today, expectedCurrentConstraintId: null };
const samples: Array<[string, Record<string, unknown>]> = [
  ['price', { competitor: 'Acme', product: 'Glucose kit', competitorPricePaise: 120000, ourPricePaise: 140000 }], ['portfolio', { product: 'CBC reagent', division: 'HAEM' }],
  ['instrument', { analyser: 'X100', owner: 'customer', closedSystem: 'no', division: 'BIOCHEM' }], ['service', { issue: 'Slow service', since: today }],
  ['availability', { product: 'Kit', issue: 'Repeated stock outs' }], ['credit', { issue: 'Billing dispute' }], ['relationship', { decisionMaker: 'Lab owner', issue: 'No access' }],
  ['clinical', { issue: 'Validation concern' }], ['contract_tender', { holder: 'District lab', endsOn: today }], ['competitor_lock_in', { competitor: 'Acme', endsOn: today }], ['unknown', { nextQuestion: 'Who supplies reagents?', askBy: today }],
];
describe('validateWalletDiagnosisCommand', () => {
  it.each(samples)('accepts valid %s facts and exact record payload', (category, facts) => {
    const result = validateWalletDiagnosisCommand({ action: 'record_constraint', payload: { ...base, category, facts } });
    expect(result.action).toBe('record_constraint');
  });
  it.each(samples)('rejects extra facts keys for %s', (category, facts) => {
    expect(() => validateWalletDiagnosisCommand({ action: 'record_constraint', payload: { ...base, category, facts: { ...facts, unexpected: 'extra' } } })).toThrow('Invalid wallet diagnosis request');
  });
  it('accepts customer stated source and the signals read', () => {
    expect(validateWalletDiagnosisCommand({ action: 'get_account_signals', payload: { customerId } }).action).toBe('get_account_signals');
    expect(validateWalletDiagnosisCommand({ action: 'record_constraint', payload: { ...base, source: 'customer_stated', sourcePerson: 'Lab manager', category: 'credit', facts: { issue: 'Billing dispute' } } }).action).toBe('record_constraint');
  });
  it('accepts an optional valid relationship contact id and rejects invalid ids', () => {
    const relationship = { ...base, category: 'relationship', facts: { decisionMaker: 'Lab owner', issue: 'No access' } };
    expect(validateWalletDiagnosisCommand({ action: 'record_constraint', payload: { ...relationship, facts: { ...relationship.facts, contactId } } }).action).toBe('record_constraint');
    expect(() => validateWalletDiagnosisCommand({ action: 'record_constraint', payload: { ...relationship, facts: { ...relationship.facts, contactId: 'bad-id' } } })).toThrow('Invalid wallet diagnosis request');
  });
  it('rejects missing and extra keys, wrong types, source mismatches and invalid dates', () => {
    const valid = { action: 'record_constraint', payload: { ...base, category: 'price', facts: samples[0][1] } };
    const bad = [
      { ...valid, payload: { ...valid.payload, facts: { competitor: 'Acme', product: 'Kit', ourPricePaise: 10 } } },
      { ...valid, payload: { ...valid.payload, facts: { ...samples[0][1], extra: true } } },
      { ...valid, payload: { ...valid.payload, facts: { ...samples[0][1], competitorPricePaise: '120000' } } },
      { ...valid, payload: { ...valid.payload, confidence: 'high' } },
      { ...valid, payload: { ...valid.payload, source: 'customer_stated', sourcePerson: null } },
      { ...valid, payload: { ...valid.payload, source: 'document', sourcePerson: 'Lab manager' } },
      { ...valid, payload: { ...valid.payload, observedOn: '2099-01-01' } },
      { action: 'record_constraint', payload: { ...base, category: 'unknown', facts: { nextQuestion: 'Who supplies?', askBy: '2000-01-01' } } },
      { action: 'record_constraint', payload: { ...base, category: 'contract_tender', facts: { holder: 'Tender', endsOn: '2026-02-30' } } },
    ];
    for (const input of bad) expect(() => validateWalletDiagnosisCommand(input)).toThrow('Invalid wallet diagnosis request');
  });
});
