import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ user: vi.fn(), session: vi.fn(), gateway: vi.fn() }));
vi.mock('@/app/chatgpt-auth', () => ({ getChatGPTUser: mocks.user })); vi.mock('@/lib/stockflow-session', () => ({ getStockFlowSession: mocks.session }));
vi.mock('@/lib/order-gateway', async original => ({ ...await original<typeof import('@/lib/order-gateway')>(), callOrderGateway: mocks.gateway }));
import { GET, POST } from '@/app/api/my-actions/route';
const id = '11111111-1111-4111-8111-111111111111';
const post = (body: unknown) => new Request('http://localhost/api/my-actions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
beforeEach(() => { vi.clearAllMocks(); mocks.user.mockResolvedValue({ email: 'sales@example.test' }); mocks.session.mockResolvedValue({ email: 'sales@example.test', roles: ['sales'] }); mocks.gateway.mockResolvedValue({ ok: true }); });
describe('my actions route', () => {
  it('forwards GET and close POST', async () => { const read = await GET(new Request('http://localhost/api/my-actions?action=get_my_actions&page=3')); expect(read.status).toBe(200); expect(mocks.gateway).toHaveBeenCalledWith('sales@example.test', 'get_my_actions', { page: 3 }); const response = await POST(post({ action: 'close_my_action', payload: { requestId: id, actionId: id, result: 'dropped', note: 'No longer needed' } })); expect(response.status).toBe(200); expect(mocks.gateway).toHaveBeenLastCalledWith('sales@example.test', 'close_my_action', { requestId: id, actionId: id, result: 'dropped', note: 'No longer needed' }); });
  it('passes the Action not found gateway message through', async () => { const { OrderGatewayError } = await import('@/lib/order-gateway'); mocks.gateway.mockRejectedValue(new OrderGatewayError('Action not found', 400)); const response = await POST(post({ action: 'close_my_action', payload: { requestId: id, actionId: id, result: 'done', note: 'Completed visit' } })); expect(response.status).toBe(400); expect(await response.json()).toEqual({ error: 'Action not found' }); });
  it('rejects roles outside the API allowlist', async () => { mocks.session.mockResolvedValue({ email: 'warehouse@example.test', roles: ['warehouse'] }); expect((await GET(new Request('http://localhost/api/my-actions?action=get_my_actions'))).status).toBe(403); });
});
