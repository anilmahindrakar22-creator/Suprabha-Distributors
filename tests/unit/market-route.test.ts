import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ user: vi.fn(), gateway: vi.fn() }));
vi.mock('@/app/chatgpt-auth', () => ({ getChatGPTUser: mocks.user }));
vi.mock('@/lib/order-gateway', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/order-gateway')>(), callOrderGateway: mocks.gateway }));
import { GET, POST } from '@/app/api/market/route';
import { OrderGatewayError } from '@/lib/order-gateway';

const payload = { customerId: '12345678-1234-4234-8234-123456789abc', latitude: '12.971599', longitude: '77.5946', source: 'manual_pin', idempotencyKey: 'market-route-test-key-001' };
const post = (body: unknown) => new Request('https://example.test/api/market', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
beforeEach(() => {
  vi.clearAllMocks(); mocks.user.mockResolvedValue({ email: 'manager@example.test' });
  mocks.gateway.mockResolvedValue({ customers: [], page: { page: 1, pageSize: 50, total: 0 } });
});
describe('market API', () => {
  it('requires sign in for reads and writes', async () => {
    mocks.user.mockResolvedValue(null);
    expect((await GET(new Request('https://example.test/api/market'))).status).toBe(401);
    expect((await POST(post({ action: 'set_customer_location', payload }))).status).toBe(401);
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it('passes search and page through and prevents caching', async () => {
    const response = await GET(new Request('https://example.test/api/market?search=Bengaluru&page=2'));
    expect(response.status).toBe(200);
    expect(mocks.gateway).toHaveBeenCalledWith('manager@example.test', 'get_customer_locations', { search: 'Bengaluru', page: 2 });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.has('server-timing')).toBe(true);
  });
  it('defaults to page one', async () => {
    await GET(new Request('https://example.test/api/market'));
    expect(mocks.gateway).toHaveBeenCalledWith('manager@example.test', 'get_customer_locations', { search: '', page: 1 });
  });
  it.each(['page=0', 'page=1.5', 'page=abc', `search=${'x'.repeat(121)}`])('rejects invalid GET query %s', async query => {
    expect((await GET(new Request(`https://example.test/api/market?${query}`))).status).toBe(400);
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it.each([{}, { action: 'wrong', payload }, { action: 'set_customer_location', payload: { ...payload, latitude: '91' } }])('rejects invalid POST without gateway calls', async body => {
    const response = await POST(post(body));
    expect(response.status).toBe(400); expect(await response.json()).toEqual({ error: 'Invalid market request' });
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it('forwards valid POST', async () => {
    const response = await POST(post({ action: 'set_customer_location', payload }));
    expect(response.status).toBe(200);
    expect(mocks.gateway).toHaveBeenCalledWith('manager@example.test', 'set_customer_location', payload);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });
  it('passes gateway conflicts through', async () => {
    mocks.gateway.mockRejectedValue(new OrderGatewayError('Location changed; refresh and try again', 409));
    const response = await POST(post({ action: 'set_customer_location', payload }));
    expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: 'Location changed; refresh and try again' });
  });
  it('bounds POST bodies', async () => {
    expect((await POST(post({ padding: 'x'.repeat(8_192) }))).status).toBe(413);
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it('reports unexpected errors', async () => {
    mocks.gateway.mockRejectedValue(new Error('unavailable'));
    const response = await GET(new Request('https://example.test/api/market'));
    expect(response.status).toBe(502); expect(await response.json()).toEqual({ error: 'Market is temporarily unavailable' });
  });
});
