import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ user: vi.fn(), gateway: vi.fn() }));
vi.mock('@/app/chatgpt-auth', () => ({ getChatGPTUser: mocks.user }));
vi.mock('@/lib/order-gateway', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/order-gateway')>(), callOrderGateway: mocks.gateway }));
import { GET, POST } from '@/app/api/market/wallet/route';
import { OrderGatewayError } from '@/lib/order-gateway';
const customerId = '12345678-1234-4234-8234-123456789abc';
const command = { action: 'record_wallet_estimate', payload: { customerId, divisionId: customerId, monthlyWalletPaise: '100',
  method: 'manager_estimate', confidence: 'low', note: 'Initial estimate', asOf: '2020-01-01', idempotencyKey: 'wallet-route-test-001' } };
const get = (query: string) => new Request(`https://example.test/api/market/wallet?${query}`);
const post = (body: unknown) => new Request('https://example.test/api/market/wallet', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
beforeEach(() => { vi.clearAllMocks(); mocks.user.mockResolvedValue({ email: 'manager@example.test' }); mocks.gateway.mockResolvedValue({ divisions: [] }); });
describe('wallet API', () => {
  it('requires sign in', async () => {
    mocks.user.mockResolvedValue(null);
    expect((await GET(get('view=divisions'))).status).toBe(401);
    expect((await POST(post(command))).status).toBe(401);
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it('routes division reads and measures without caching', async () => {
    const response = await GET(get('view=divisions'));
    expect(mocks.gateway).toHaveBeenCalledWith('manager@example.test', 'get_wallet_divisions', {});
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.has('server-timing')).toBe(true);
  });
  it('routes customer wallet reads', async () => {
    expect((await GET(get(`customerId=${customerId}`))).status).toBe(200);
    expect(mocks.gateway).toHaveBeenCalledWith('manager@example.test', 'get_customer_wallet', { customerId });
  });
  it.each(['customerId=bad', '', 'view=unknown', `view=divisions&customerId=${customerId}`])('rejects invalid query %s', async query => {
    expect((await GET(get(query))).status).toBe(400); expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it('rejects invalid POST without gateway calls', async () => {
    const response = await POST(post({ ...command, payload: { ...command.payload, monthlyWalletPaise: 100 } }));
    expect(response.status).toBe(400); expect(await response.json()).toEqual({ error: 'Invalid wallet request' });
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it('forwards valid POST', async () => {
    const response = await POST(post(command));
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.gateway).toHaveBeenCalledWith('manager@example.test', command.action, command.payload);
  });
  it('passes gateway conflicts through', async () => {
    mocks.gateway.mockRejectedValue(new OrderGatewayError('Division changed; refresh and try again', 409));
    const response = await POST(post(command));
    expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: 'Division changed; refresh and try again' });
  });
});
