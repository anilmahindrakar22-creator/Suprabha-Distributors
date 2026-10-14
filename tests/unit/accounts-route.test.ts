import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ user: vi.fn(), session: vi.fn(), gateway: vi.fn() }));
vi.mock('@/app/chatgpt-auth', () => ({ getChatGPTUser: mocks.user }));
vi.mock('@/lib/stockflow-session', () => ({ getStockFlowSession: mocks.session }));
vi.mock('@/lib/order-gateway', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/order-gateway')>(), callOrderGateway: mocks.gateway }));
import { GET, POST } from '@/app/api/accounts/route';
import { OrderGatewayError } from '@/lib/order-gateway';

const id = '12345678-1234-4234-8234-123456789abc';
const command = { action: 'assign_account', customerId: id, territoryId: id, ownerEmail: 'sales@example.test', expectedVersion: null, idempotencyKey: 'accounts-route-key-001' };
const post = (body: unknown) => new Request('https://example.test/api/accounts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const get = (query = '') => GET(new Request(`https://example.test/api/accounts${query}`));
const workspace = { accounts: [], page: { page: 1, pageSize: 50, total: 0 }, owners: [], territories: [], today: '2026-10-14' };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ email: 'manager@example.test' });
  mocks.session.mockResolvedValue({ email: 'manager@example.test', role: 'management', roles: ['management'] });
  mocks.gateway.mockResolvedValue(workspace);
});
describe('accounts API', () => {
  it('requires authentication for reads and writes', async () => {
    mocks.user.mockResolvedValue(null);
    expect((await get()).status).toBe(401);
    expect((await POST(post(command))).status).toBe(401);
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it('requires active membership and an eligible role', async () => {
    mocks.session.mockResolvedValue(null);
    expect((await get()).status).toBe(403);
    mocks.session.mockResolvedValue({ email: 'viewer@example.test', roles: ['viewer'] });
    expect((await get()).status).toBe(403);
    expect((await POST(post(command))).status).toBe(403);
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it('maps GET query names to gateway fields', async () => {
    const response = await get(`?search=Bengaluru&scope=mine&owner=sales%40example.test&territory=${id}&page=2`);
    expect(mocks.gateway).toHaveBeenCalledWith('manager@example.test', 'get_accounts', { search: 'Bengaluru', scope: 'mine', ownerEmail: 'sales@example.test', territoryId: id, page: 2 });
    expect(await response.json()).toEqual({ ...workspace, actorEmail: 'manager@example.test', canAssign: true });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.has('server-timing')).toBe(true);
  });
  it('defaults GET filters and page', async () => {
    await get();
    expect(mocks.gateway).toHaveBeenCalledWith('manager@example.test', 'get_accounts', { search: '', scope: 'all', page: 1 });
  });
  it.each(['administrator', 'management', 'sales', 'operations'])('reports canAssign for %s', async role => {
    mocks.session.mockResolvedValue({ email: 'member@example.test', role, roles: [role] });
    const response = await get();
    expect(await response.json()).toMatchObject({ actorEmail: 'member@example.test', canAssign: ['administrator', 'management'].includes(role) });
  });
  it.each(['page=0', 'page=1.5', 'page=abc', 'page=2147483648', 'scope=team', 'territory=bad', 'owner=bad', `search=${'x'.repeat(121)}`])('rejects invalid GET %s', async query => {
    expect((await get(`?${query}`)).status).toBe(400);
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it.each([{}, { action: 'wrong' }, { ...command, expectedVersion: undefined }, { ...command, territoryId: 'bad' }, { ...command, idempotencyKey: 'short' }, { action: command.action, payload: command }])('rejects invalid flat POST %#', async body => {
    const response = await POST(post(body));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid accounts request' });
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it('extracts action and forwards the flat payload', async () => {
    mocks.gateway.mockResolvedValue({ ok: true, version: 1 });
    const response = await POST(post(command));
    const { action, ...payload } = command;
    expect(mocks.gateway).toHaveBeenCalledWith('manager@example.test', action, payload);
    expect(await response.json()).toEqual({ ok: true, version: 1 });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });
  it('lets eligible sales log visits and leaves assignment authorization to the database', async () => {
    mocks.session.mockResolvedValue({ email: 'sales@example.test', roles: ['sales'] });
    expect((await POST(post({ action: 'log_visit', customerId: id, visitedOn: '2026-10-14', outcome: 'met', idempotencyKey: 'accounts-visit-key-001' }))).status).toBe(200);
  });
  it.each([400, 403, 409])('preserves gateway errors with status %i', async status => {
    mocks.gateway.mockRejectedValue(new OrderGatewayError('Owner changed; refresh and try again', status));
    const response = await POST(post(command));
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: 'Owner changed; refresh and try again' });
  });
  it('rejects malformed JSON', async () => {
    const response = await POST(new Request('https://example.test/api/accounts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' }));
    expect(response.status).toBe(400);
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it('bounds POST bodies', async () => {
    expect((await POST(post({ padding: 'x'.repeat(8_192) }))).status).toBe(413);
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it('maps unexpected errors to 502', async () => {
    mocks.gateway.mockRejectedValue(new Error('unavailable'));
    const response = await get();
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'Accounts are temporarily unavailable' });
  });
});
