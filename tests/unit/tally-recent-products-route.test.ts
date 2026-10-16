import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ user: vi.fn(), gateway: vi.fn() }));
vi.mock('@/app/chatgpt-auth', () => ({ getChatGPTUser: mocks.user }));
vi.mock('@/lib/order-gateway', async original => ({ ...await original<typeof import('@/lib/order-gateway')>(), callOrderGateway: mocks.gateway }));
import { GET } from '@/app/api/orders/route';
import { OrderGatewayError } from '@/lib/order-gateway';
const id = '71000000-0000-4000-8000-000000000001';
const get = (value = id) => GET(new Request(`https://example.test/api/orders?recentProductsFor=${value}`));
beforeEach(() => { vi.clearAllMocks(); mocks.user.mockResolvedValue({ email: 'sales@example.test' }); mocks.gateway.mockResolvedValue({ customerId: id, linked: true, billCount: 0, products: [] }); });
it('uses one customer-scoped read and a private measured response', async () => {
  const r = await get();
  expect(r.status).toBe(200);
  expect(mocks.gateway).toHaveBeenCalledExactlyOnceWith('sales@example.test', 'get_tally_recent_products', { customerId: id });
  expect(r.headers.get('cache-control')).toBe('private, no-store');
  expect(r.headers.has('server-timing')).toBe(true);
  expect(await r.json()).toEqual({ customerId: id, linked: true, billCount: 0, products: [] });
});
it.each(['', 'bad', '71000000-0000-4000-8000-000000000001%27'])('rejects invalid customer ID %s before gateway access', async value => {
  expect((await get(value)).status).toBe(400); expect(mocks.gateway).not.toHaveBeenCalled();
});
it('requires sign-in and preserves member denials without falling back to bootstrap', async () => {
  mocks.user.mockResolvedValue(null); expect((await get()).status).toBe(401); expect(mocks.gateway).not.toHaveBeenCalled();
  mocks.user.mockResolvedValue({ email: 'suspended@example.test' }); mocks.gateway.mockRejectedValue(new OrderGatewayError('Account is not approved', 403));
  expect((await get()).status).toBe(403); expect(mocks.gateway).toHaveBeenCalledTimes(1);
});
