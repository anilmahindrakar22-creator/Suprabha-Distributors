import { describe, expect, it } from 'vitest';
import { isPowerMap, validatePowerMapCommand } from '@/lib/power-map-types';

const id = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const read = { action: 'get_power_map', payload: { customerId: id } };
const set = { action: 'set_influence', payload: { requestId: id, customerId: id, fromContactId: id, toContactId: other, strength: 'strong', evidence: 'Owner asks the pathologist' } };
const end = { action: 'end_influence', payload: { requestId: id, influenceId: other, reason: 'No longer current' } };
describe('power map contract', () => {
  it.each([read, set, end])('accepts $action', command => expect(validatePowerMapCommand(command)).toEqual(command));
  it.each(['strong', 'medium', 'low'])('accepts %s strength', strength => expect(validatePowerMapCommand({ ...set, payload: { ...set.payload, strength } })).toMatchObject({ payload: { strength } }));
  it.each([null, [], {}, { ...read, extra: true }, { ...read, payload: { ...read.payload, extra: true } }, { action: 'erase_contact', payload: {} }, { ...read, payload: { customerId: 'bad' } }, { ...set, payload: { ...set.payload, toContactId: id } }, { ...set, payload: { ...set.payload, strength: '' } }, { ...set, payload: { ...set.payload, requestId: 'bad' } }, { ...set, payload: { ...set.payload, fromContactId: 'bad' } }, { ...set, payload: { ...set.payload, customerId: 'bad' } }, { ...set, payload: { ...set.payload, toContactId: 'bad' } }, { ...set, payload: { ...set.payload, evidence: 'ab' } }, { ...set, payload: { ...set.payload, evidence: 'x'.repeat(301) } }, { ...set, payload: { ...set.payload, evidence: ' padded ' } }, { ...end, payload: { ...end.payload, reason: '' } }, { ...end, payload: { ...end.payload, influenceId: 'bad' } }, { ...end, payload: { ...end.payload, reason: 'x'.repeat(301) } }, { ...end, payload: { ...end.payload, extra: true } }])('rejects invalid input %#', command => expect(() => validatePowerMapCommand(command)).toThrow('Invalid power map request'));
  it('accepts evidence and reason boundaries including Unicode', () => {
    for (const note of ['abc', 'x'.repeat(300), '₹ … ’', '😀'.repeat(300)]) {
      expect(validatePowerMapCommand({ ...set, payload: { ...set.payload, evidence: note } })).toBeTruthy();
      expect(validatePowerMapCommand({ ...end, payload: { ...end.payload, reason: note } })).toBeTruthy();
    }
  });
  it('accepts extra response keys at every level', () => {
    const step = { contactId: id, name: 'Asha', decisionRole: 'decision_maker', stance: 'supporter', extra: true };
    expect(isPowerMap({ contacts: [{ id, name: 'Asha', businessRole: null, decisionRole: 'decision_maker', stance: 'supporter', influence: 'high', lastMetOn: null, extra: true }], links: [{ id, fromContactId: id, toContactId: other, strength: 'strong', evidence: 'Observed', recordedBy: 'manager@example.test', recordedAt: '2026-10-29', extra: true }], route: { steps: [step], strengths: [], extra: true }, extra: true })).toBe(true);
    expect(isPowerMap({ contacts: [], links: [], route: null, extra: true })).toBe(true);
  });
  it.each([null, {}, { contacts: [], links: [] }, { contacts: [null], links: [], route: null }, { contacts: [], links: [{}], route: null }, { contacts: [], links: [], route: { steps: [], strengths: [] } }, { contacts: [], links: [], route: { steps: [{ contactId: id, name: 'Asha', decisionRole: 'decision_maker', stance: 'supporter' }], strengths: ['strong'] } }])('rejects malformed responses %#', value => expect(isPowerMap(value)).toBe(false));
});
