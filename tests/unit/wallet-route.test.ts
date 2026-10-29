import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ user: vi.fn(), session: vi.fn(), gateway: vi.fn() }));
vi.mock('@/app/chatgpt-auth', () => ({ getChatGPTUser: mocks.user }));
vi.mock('@/lib/stockflow-session', () => ({ getStockFlowSession: mocks.session }));
vi.mock('@/lib/order-gateway', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/order-gateway')>(), callOrderGateway: mocks.gateway }));
import { GET, POST } from '@/app/api/wallet/route';
const id = '11111111-1111-4111-8111-111111111111';
const requestId = '22222222-2222-4222-8222-222222222222';
const post = (value: unknown) => new Request('http://localhost/api/wallet', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
beforeEach(() => { vi.clearAllMocks(); mocks.user.mockResolvedValue({ email: 'staff@example.com' }); mocks.session.mockResolvedValue({ email: 'staff@example.com', roles: ['management'] }); mocks.gateway.mockResolvedValue({ ok: true, snapshotId: id }); });
describe('wallet API', () => {
  it('rejects unauthenticated requests', async () => { mocks.user.mockResolvedValue(null); expect((await GET(new Request('http://localhost/api/wallet?action=get_wallet_workspace'))).status).toBe(401); });
  it('rejects invalid payload before gateway execution', async () => { const r = await POST(post({ action: 'set_wallet_policy', payload: {} })); expect(r.status).toBe(400); expect(mocks.gateway).not.toHaveBeenCalled(); });
  it('passes successful GET and POST responses through', async () => {
    mocks.gateway.mockResolvedValueOnce({ rows: [] });
    const read = await GET(new Request('http://localhost/api/wallet?action=get_wallet_workspace&view=all&page=2&search=abc'));
    expect(await read.json()).toEqual({ rows: [] }); expect(mocks.gateway).toHaveBeenLastCalledWith('staff@example.com', 'get_wallet_workspace', { view: 'all', page: 2, search: 'abc' });
    const payload = { requestId, customerId: id, monthlyWalletPaise: 100, method: 'test_volume', source: 'Customer data', confidence: 'medium', asOf: '2026-10-29', note: 'Reviewed estimate', loweredReason: null, divisions: [], expectedCurrentSnapshotId: null };
    const write = await POST(post({ action: 'record_wallet_snapshot', payload })); expect(await write.json()).toEqual({ ok: true, snapshotId: id });
  });
  it.each([['PT403', 403], ['PT409', 409]] as const)('maps gateway %s', async (code, status) => {
    const { OrderGatewayError } = await import('@/lib/order-gateway'); mocks.gateway.mockRejectedValue(new OrderGatewayError(code, status));
    const r = await GET(new Request('http://localhost/api/wallet?action=get_wallet_workspace')); expect(r.status).toBe(status); expect(await r.json()).toEqual({ error: code });
  });
});
