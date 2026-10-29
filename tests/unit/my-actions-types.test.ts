import { describe, expect, it } from 'vitest';
import { validateMyActionCommand } from '@/lib/my-actions-types';

const id = '11111111-1111-4111-8111-111111111111';
const todayIST = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const addDays = (date: string, days: number) => { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
const close = (overrides: Record<string, unknown> = {}) => ({ action: 'close_my_action', payload: { requestId: id, actionId: id, result: 'done', note: 'Visit completed', visit: null, ...overrides } });
describe('my actions command contract', () => {
  it('accepts a paged read and valid close', () => {
    expect(validateMyActionCommand({ action: 'get_my_actions', payload: { page: 2 } })).toEqual({ action: 'get_my_actions', payload: { page: 2 } });
    expect(validateMyActionCommand(close())).toMatchObject({ action: 'close_my_action', payload: { result: 'done', note: 'Visit completed', visit: null } });
  });
  it('normalizes an omitted visit to null', () => {
    const input = { action: 'close_my_action', payload: { requestId: id, actionId: id, result: 'done', note: 'Visit completed' } };
    expect(validateMyActionCommand(input)).toEqual({ action: 'close_my_action', payload: { requestId: id, actionId: id, result: 'done', note: 'Visit completed', visit: null } });
  });
  it.each(['met', 'not_available', 'order_taken', 'issue_raised', 'other'] as const)('accepts visit outcome %s', outcome => {
    expect(validateMyActionCommand(close({ visit: { outcome, nextVisitOn: null } }))).toMatchObject({ payload: { visit: { outcome, nextVisitOn: null } } });
  });
  it('accepts a next visit date after today and within 180 days', () => {
    expect(validateMyActionCommand(close({ visit: { outcome: 'met', nextVisitOn: addDays(todayIST(), 180) } }))).toMatchObject({ payload: { visit: { outcome: 'met' } } });
  });
  it.each([
    null, {}, { action: 'get_my_actions', payload: { page: 0 } }, { action: 'get_my_actions', payload: { page: 1, extra: true } },
    { action: 'close_my_action', payload: { requestId: id, actionId: id, result: 'done', note: 'x', visit: null } },
    { action: 'close_my_action', payload: { requestId: 'bad', actionId: id, result: 'done', note: 'Valid note', visit: null } },
    close({ visit: { outcome: 'invalid', nextVisitOn: null } }), close({ result: 'dropped', visit: { outcome: 'met', nextVisitOn: null } }),
    close({ visit: { outcome: 'met', nextVisitOn: addDays(todayIST(), 0) } }), close({ visit: { outcome: 'met', nextVisitOn: addDays(todayIST(), 181) } }),
    close({ visit: { outcome: 'met', nextVisitOn: '2026-02-30' } }), close({ visit: { outcome: 'met', nextVisitOn: null, extra: true } }),
    close({ extra: true }), close({ visit: undefined }),
  ])('rejects invalid command %j', input => expect(() => validateMyActionCommand(input)).toThrow('Invalid my actions request'));
});
