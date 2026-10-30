import { describe, expect, it } from 'vitest';
import { validateWalletActionCommand } from '../../lib/wallet-action-types';

const id = '11111111-1111-4111-8111-111111111111'; const requestId = '22222222-2222-4222-8222-222222222222';
const make = (payload: Record<string, unknown> = {}) => ({ action: 'create_action', payload: { requestId, opportunityId: id, actionType: 'visit', detail: 'Visit the lab', ownerEmail: 'manager@example.test', dueOn: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()), expectedMonthlyGainPaise: null, ...payload } });
describe('wallet action command contract', () => {
  it('accepts all four reads and both writes', () => {
    expect(validateWalletActionCommand({ action: 'get_actions_due', payload: { page: 1 } }).action).toBe('get_actions_due');
    expect(validateWalletActionCommand({ action: 'get_contract_windows', payload: { page: 1 } }).action).toBe('get_contract_windows');
    expect(validateWalletActionCommand({ action: 'get_opportunity_actions', payload: { opportunityId: id } }).action).toBe('get_opportunity_actions');
    expect(validateWalletActionCommand({ action: 'get_action_owners', payload: {} }).action).toBe('get_action_owners');
    expect(validateWalletActionCommand(make()).action).toBe('create_action');
    expect(validateWalletActionCommand({ action: 'close_action', payload: { requestId, actionId: id, result: 'done', note: 'Completed visit' } }).action).toBe('close_action');
  });
  it.each([
    {}, { action: 'x', payload: {} }, { action: 'get_actions_due', payload: { page: 0 } }, { action: 'get_actions_due', payload: { page: 1.5 } },
    { action: 'get_contract_windows', payload: { page: 0 } }, { action: 'get_contract_windows', payload: { page: 4001 } }, { action: 'get_contract_windows', payload: { page: 1.25 } }, { action: 'get_contract_windows', payload: { page: 1, requestId } },
    ...['1', null, true, undefined, NaN, Infinity].map(page => ({ action: 'get_contract_windows', payload: { page } })),
    { action: 'get_contract_windows', payload: {} },
    { action: 'get_opportunity_actions', payload: { opportunityId: 'bad' } }, { action: 'get_action_owners', payload: { extra: true } },
    make({ requestId: 'bad' }), make({ opportunityId: 'bad' }), make({ actionType: 'other' }), make({ detail: '  xx' }), make({ detail: 'ab' }), make({ detail: 'x'.repeat(501) }),
    make({ ownerEmail: 'Manager@example.test' }), make({ ownerEmail: 'bad' }), make({ dueOn: '2026-02-30' }), make({ dueOn: '2000-01-01' }), make({ expectedMonthlyGainPaise: 0 }), make({ expectedMonthlyGainPaise: 9e13 + 1 }), make({ expectedMonthlyGainPaise: 1.5 }),
    { action: 'close_action', payload: { requestId, actionId: id, result: 'other', note: 'valid note' } }, { action: 'close_action', payload: { requestId, actionId: id, result: 'done', note: 'no' } },
  ])('rejects invalid command %#', command => expect(() => validateWalletActionCommand(command)).toThrow('Invalid wallet action request'));
  it('accepts contract window pages through the inclusive limit', () => { expect(validateWalletActionCommand({ action: 'get_contract_windows', payload: { page: 4000 } })).toEqual({ action: 'get_contract_windows', payload: { page: 4000 } }); });
});
