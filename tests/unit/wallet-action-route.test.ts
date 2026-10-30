import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ user: vi.fn(), session: vi.fn(), gateway: vi.fn() }));
vi.mock('@/app/chatgpt-auth', () => ({ getChatGPTUser: mocks.user })); vi.mock('@/lib/stockflow-session', () => ({ getStockFlowSession: mocks.session }));
vi.mock('@/lib/order-gateway', async original => ({ ...await original<typeof import('@/lib/order-gateway')>(), callOrderGateway: mocks.gateway }));
import { GET, POST } from '@/app/api/wallet/actions/route';
const id = '11111111-1111-4111-8111-111111111111'; const requestId = '22222222-2222-4222-8222-222222222222';
const post = (body: unknown) => new Request('http://localhost/api/wallet/actions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
beforeEach(() => { vi.clearAllMocks(); mocks.user.mockResolvedValue({ email: 'manager@example.test' }); mocks.session.mockResolvedValue({ email: 'manager@example.test', roles: ['management'] }); mocks.gateway.mockResolvedValue({ ok: true }); });
describe('wallet actions route', () => {
  it('rejects unauthenticated and invalid input', async () => { mocks.user.mockResolvedValue(null); expect((await GET(new Request('http://localhost/api/wallet/actions?action=get_action_owners'))).status).toBe(401); mocks.user.mockResolvedValue({ email: 'manager@example.test' }); expect((await POST(post({ action: 'create_action', payload: {} }))).status).toBe(400); expect(mocks.gateway).not.toHaveBeenCalled(); });
  it('passes reads, writes and 22023 messages through', async () => { const read = await GET(new Request('http://localhost/api/wallet/actions?action=get_actions_due&page=2')); expect(mocks.gateway).toHaveBeenCalledWith('manager@example.test', 'get_actions_due', { page: 2 }); expect(await read.json()).toEqual({ ok: true }); const command = { action: 'create_action', payload: { requestId, opportunityId: id, actionType: 'visit', detail: 'Visit lab', ownerEmail: 'manager@example.test', dueOn: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()), expectedMonthlyGainPaise: null } }; mocks.gateway.mockRejectedValueOnce(new (await import('@/lib/order-gateway')).OrderGatewayError('Close the open action first', 400)); const result = await POST(post(command)); expect(result.status).toBe(400); expect(await result.json()).toEqual({ error: 'Close the open action first' }); });
  it('routes the other action reads and close write', async () => { await GET(new Request('http://localhost/api/wallet/actions?action=get_opportunity_actions&opportunityId=' + id)); expect(mocks.gateway).toHaveBeenLastCalledWith('manager@example.test', 'get_opportunity_actions', { opportunityId: id }); await GET(new Request('http://localhost/api/wallet/actions?action=get_action_owners')); expect(mocks.gateway).toHaveBeenLastCalledWith('manager@example.test', 'get_action_owners', {}); const response = await POST(post({ action: 'close_action', payload: { requestId, actionId: id, result: 'dropped', note: 'No longer needed' } })); expect(response.status).toBe(200); expect(mocks.gateway).toHaveBeenLastCalledWith('manager@example.test', 'close_action', { requestId, actionId: id, result: 'dropped', note: 'No longer needed' }); });
  it('reads paged contract windows and rejects them on POST', async () => { const response = await GET(new Request('http://localhost/api/wallet/actions?action=get_contract_windows&page=3')); expect(response.status).toBe(200); expect(mocks.gateway).toHaveBeenLastCalledWith('manager@example.test', 'get_contract_windows', { page: 3 }); const defaultPage = await GET(new Request('http://localhost/api/wallet/actions?action=get_contract_windows')); expect(defaultPage.status).toBe(200); expect(mocks.gateway).toHaveBeenLastCalledWith('manager@example.test', 'get_contract_windows', { page: 1 }); const write = await POST(post({ action: 'get_contract_windows', payload: { page: 1 } })); expect(write.status).toBe(400); expect(mocks.gateway).toHaveBeenCalledTimes(2); });
  it.each(['0', '4001', '1.5', 'invalid', '', 'Infinity'])('rejects contract page %s before gateway access', async page => {
    const response = await GET(new Request('http://localhost/api/wallet/actions?action=get_contract_windows&page=' + page));
    expect(response.status).toBe(400);
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it.each(['sales', 'operations'])('denies contract windows for %s', async role => {
    mocks.session.mockResolvedValue({ email: 'staff@example.test', roles: [role] });
    expect((await GET(new Request('http://localhost/api/wallet/actions?action=get_contract_windows'))).status).toBe(403);
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it('allows administrator contract reads through page 4000 with private no-store caching', async () => {
    mocks.session.mockResolvedValue({ email: 'admin@example.test', roles: ['administrator'] });
    const response = await GET(new Request('http://localhost/api/wallet/actions?action=get_contract_windows&page=4000'));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.gateway).toHaveBeenCalledWith('admin@example.test', 'get_contract_windows', { page: 4000 });
  });
  it('requires authentication for contract reads', async () => {
    mocks.user.mockResolvedValue(null);
    expect((await GET(new Request('http://localhost/api/wallet/actions?action=get_contract_windows'))).status).toBe(401);
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it.each([['PT403', 403], ['PT409', 409]] as const)('maps %s', async (code, status) => { const { OrderGatewayError } = await import('@/lib/order-gateway'); mocks.gateway.mockRejectedValue(new OrderGatewayError(code, status)); expect((await GET(new Request('http://localhost/api/wallet/actions?action=get_action_owners'))).status).toBe(status); });
});
