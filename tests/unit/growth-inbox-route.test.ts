import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ user: vi.fn(), session: vi.fn(), gateway: vi.fn() }));
vi.mock('@/app/chatgpt-auth', () => ({ getChatGPTUser: mocks.user }));
vi.mock('@/lib/stockflow-session', () => ({ getStockFlowSession: mocks.session }));
vi.mock('@/lib/order-gateway', async original => ({ ...await original<typeof import('@/lib/order-gateway')>(), callOrderGateway: mocks.gateway }));
import { GET, POST } from '@/app/api/growth/inbox/route';
import { OrderGatewayError } from '@/lib/order-gateway';

const sample = {
  runMonth: '2026-11', salesTo: '2026-10-31', confirmed: false, confirmedReason: 'October differs',
  counts: { all: 0, R1: 0, R2: 0, R3: 0, R4: 0, toReview: 0, inProgress: 0, done: 0 },
  stakeToReviewPaise: 0, filter: 'all', page: 1, pageSize: 10, total: 0,
  owners: [{ email: 'manager@example.test' }], rows: [],
};
const accept = {
  requestId: '9bf8ea85-f0a5-471f-85ca-ad468387f450', cardKey: 'card-a', decision: 'accept',
  actionType: 'visit', ownerEmail: 'manager@example.test', dueOn: '2026-11-16', detail: 'Please follow up',
};
const get = (query = 'filter=all&page=1') => GET(new Request(`https://app.example.test/api/growth/inbox?${query}`));
const post = (body: unknown = accept) => POST(new Request('https://app.example.test/api/growth/inbox', { method: 'POST', body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ email: 'manager@example.test' });
  mocks.session.mockResolvedValue({ email: 'manager@example.test', roles: ['management'] });
  mocks.gateway.mockResolvedValue(sample);
});

describe('Growth inbox route', () => {
  it.each(['all', 'R1', 'R2', 'R3', 'R4', 'done'])('reads %s with exactly the validated payload', async filter => {
    mocks.gateway.mockResolvedValue({ ...sample, filter, page: 2 });
    const response = await get(`filter=${filter}&page=2`);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual({ ...sample, filter, page: 2, viewerEmail: 'manager@example.test' });
    expect(mocks.gateway).toHaveBeenCalledWith('manager@example.test', 'get_growth_inbox', { filter, page: 2 });
  });
  it.each(['', 'filter=all', 'page=1', 'filter=bad&page=1', 'filter=all&page=0', 'filter=all&page=-1',
    'filter=all&page=1.5', 'filter=all&page=01', 'filter=all&page=9007199254740992', 'filter=all&page=NaN',
    'filter=all&page=1&sort=value', 'filter=all&filter=R1&page=1', 'filter=all&page=1&page=2'])('rejects invalid GET: %s', async query => {
    expect((await get(query)).status).toBe(400);
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it.each(['sales', 'operations', 'accounts', 'warehouse'])('denies %s for reads and writes before gateway access', async role => {
    mocks.session.mockResolvedValue({ email: 'staff@example.test', roles: [role] });
    expect((await get()).status).toBe(403);
    expect((await post()).status).toBe(403);
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it.each(['management', 'administrator'])('permits %s writes with exactly the validated body', async role => {
    mocks.session.mockResolvedValue({ email: 'manager@example.test', roles: [role] });
    const result = { cardKey: 'card-a', decision: 'accept', state: 'in_progress', opportunityId: 'opp-a', actionId: 'action-a' };
    mocks.gateway.mockResolvedValue(result);
    const response = await post();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual(result);
    expect(mocks.gateway).toHaveBeenCalledWith('manager@example.test', 'decide_growth_card', accept);
  });
  it('requires sign in and a StockFlow session for both methods', async () => {
    mocks.user.mockResolvedValue(null);
    expect((await get()).status).toBe(401);
    expect((await post()).status).toBe(401);
    mocks.user.mockResolvedValue({ email: 'manager@example.test' });
    mocks.session.mockResolvedValue(null);
    expect((await get()).status).toBe(403);
    expect((await post()).status).toBe(403);
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it.each([null, [], {}, { ...accept, decision: 'invalid' }, { ...accept, detail: 'x' },
    { ...accept, actionType: 'call' }, { ...accept, dueOn: '2026-13-16' },
    { requestId: accept.requestId, cardKey: 'card-a', decision: 'reject' },
    { requestId: accept.requestId, cardKey: 'card-a', decision: 'snooze', until: 'tomorrow' },
    { ...accept, extra: 'not allowed' }])('rejects invalid POST bodies without forwarding: %j', async body => {
    expect((await post(body)).status).toBe(400);
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it('rejects malformed JSON without gateway access', async () => {
    const response = await POST(new Request('https://app.example.test/api/growth/inbox', { method: 'POST', body: '{' }));
    expect(response.status).toBe(400);
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it.each([
    { decision: 'snooze', until: '2w', category: 'price', note: 'Call later' },
    { decision: 'snooze', until: 'next_run' },
    { decision: 'reject', category: 'competitor_lock_in', note: 'Contract active' },
    { decision: 'undo' },
  ])('passes only decision-specific keys: %j', async fields => {
    const body = { requestId: accept.requestId, cardKey: 'card-a', ...fields };
    const state = fields.decision === 'undo' ? 'review' : fields.decision === 'reject' ? 'rejected' : 'snoozed';
    const result = { cardKey: 'card-a', decision: fields.decision, state, ...(fields.decision === 'snooze' ? { snoozeUntil: '2026-11-23' } : {}) };
    mocks.gateway.mockResolvedValue(result);
    const response = await post(body);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(result);
    expect(mocks.gateway).toHaveBeenCalledWith('manager@example.test', 'decide_growth_card', body);
  });
  it('adds the viewer from the session without trusting or forwarding a gateway viewer', async () => {
    mocks.session.mockResolvedValue({ email: 'signed-in@example.test', roles: ['management'] });
    mocks.gateway.mockResolvedValue({ ...sample, viewerEmail: 'spoofed@example.test' });
    const response = await get();
    expect(await response.json()).toMatchObject({ viewerEmail: 'signed-in@example.test' });
    expect(mocks.gateway).toHaveBeenCalledWith('signed-in@example.test', 'get_growth_inbox', { filter: 'all', page: 1 });
  });
  it.each(['reject', 'snooze'])('trims and omits empty notes before forwarding %s', async decision => {
    const base = { requestId: accept.requestId, cardKey: 'card-a', decision, ...(decision === 'snooze' ? { until: '2w' } : { category: 'price' }) };
    mocks.gateway.mockResolvedValue({ cardKey: 'card-a', decision, state: decision === 'snooze' ? 'snoozed' : 'rejected', ...(decision === 'snooze' ? { snoozeUntil: '2026-11-23' } : {}) });
    for (const [note, expected] of [['  Follow up  ', { ...base, note: 'Follow up' }], [' \n\t ', base], ['', base]] as const) {
      expect((await post({ ...base, note })).status).toBe(200);
      expect(mocks.gateway).toHaveBeenLastCalledWith('manager@example.test', 'decide_growth_card', expected);
    }
  });
  it.each([undefined, null, '2026-02-30', 'tomorrow'])('rejects an invalid snooze date: %s', async snoozeUntil => {
    mocks.gateway.mockResolvedValue({ cardKey: 'card-a', decision: 'snooze', state: 'snoozed', ...(snoozeUntil === undefined ? {} : { snoozeUntil }) });
    expect((await post({ requestId: accept.requestId, cardKey: 'card-a', decision: 'snooze', until: '2w' })).status).toBe(502);
  });
  it.each([[400, 'Card is no longer current'], [400, 'Link the ledger first'], [409, 'Card already decided'], [409, 'Already in progress']] as const)('preserves known %s error: %s', async (status, message) => {
    mocks.gateway.mockRejectedValue(new OrderGatewayError(message, status));
    const response = await post();
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: message });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });
  it.each([400, 403, 409, 502])('hides unexpected gateway messages with status %s', async status => {
    mocks.gateway.mockRejectedValue(new OrderGatewayError('Private database detail', status));
    const response = await get();
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: 'Growth inbox is unavailable. Try again.' });
  });
  it.each([{ rows: [] }, { ...sample, page: 2 }, { ...sample, filter: 'R1' }])('rejects malformed or mismatched read data', async result => {
    mocks.gateway.mockResolvedValue(result);
    expect((await get()).status).toBe(502);
  });
  it.each([
    { cardKey: 'card-a', decision: 'accept', state: 'unknown' },
    { cardKey: 'card-b', decision: 'accept', state: 'in_progress' },
    { cardKey: 'card-a', decision: 'undo', state: 'review' },
  ])('rejects malformed or mismatched decision data', async result => {
    mocks.gateway.mockResolvedValue(result);
    expect((await post()).status).toBe(502);
  });
});
