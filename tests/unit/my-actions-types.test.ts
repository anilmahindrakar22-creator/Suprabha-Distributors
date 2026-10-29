import { describe, expect, it } from 'vitest';
import { validateMyActionCommand } from '@/lib/my-actions-types';

const id = '11111111-1111-4111-8111-111111111111';
describe('my actions command contract', () => {
  it('accepts a paged read and valid close', () => {
    expect(validateMyActionCommand({ action: 'get_my_actions', payload: { page: 2 } })).toEqual({ action: 'get_my_actions', payload: { page: 2 } });
    expect(validateMyActionCommand({ action: 'close_my_action', payload: { requestId: id, actionId: id, result: 'done', note: 'Visit completed' } })).toMatchObject({ action: 'close_my_action', payload: { result: 'done', note: 'Visit completed' } });
  });
  it.each([null, {}, { action: 'get_my_actions', payload: { page: 0 } }, { action: 'get_my_actions', payload: { page: 1, extra: true } }, { action: 'close_my_action', payload: { requestId: id, actionId: id, result: 'done', note: 'x' } }, { action: 'close_my_action', payload: { requestId: 'bad', actionId: id, result: 'done', note: 'Valid note' } }])('rejects invalid command %j', input => expect(() => validateMyActionCommand(input)).toThrow('Invalid my actions request'));
});
