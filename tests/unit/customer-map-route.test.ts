import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ user: vi.fn(), session: vi.fn(), gateway: vi.fn() }));
vi.mock('@/app/chatgpt-auth', () => ({ getChatGPTUser: mocks.user }));
vi.mock('@/lib/stockflow-session', () => ({ getStockFlowSession: mocks.session }));
vi.mock('@/lib/order-gateway', async original => ({ ...await original<typeof import('@/lib/order-gateway')>(), callOrderGateway: mocks.gateway }));
import { GET } from '@/app/api/customer-map/route';
import { OrderGatewayError } from '@/lib/order-gateway';

const request = (query = '?bbox=16,76,18,78') => new Request(`http://localhost/api/customer-map${query}`);
const customerId = '12345678-1234-1234-1234-123456789abc';
beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ email: 'manager@example.test' });
  mocks.session.mockResolvedValue({ email: 'manager@example.test', roles: ['management'] });
  mocks.gateway.mockResolvedValue({ pins: [] });
});

describe('Customer map route', () => {
  it.each(['administrator', 'management', 'sales', 'operations'])('allows %s and disables caching', async role => {
    mocks.session.mockResolvedValue({ email: 'staff@example.test', roles: [role] });
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual({ pins: [] });
    expect(mocks.gateway).toHaveBeenCalledWith('staff@example.test', 'get_map_pins', { south: 16, west: 76, north: 18, east: 78 });
  });

  it('requires authentication and an allowed session', async () => {
    mocks.user.mockResolvedValue(null);
    expect((await GET(request())).status).toBe(401);
    mocks.user.mockResolvedValue({ email: 'staff@example.test' });
    for (const session of [null, { email: 'staff@example.test', roles: ['accounts'] }]) {
      mocks.session.mockResolvedValue(session);
      expect((await GET(request())).status).toBe(403);
    }
    expect(mocks.gateway).not.toHaveBeenCalled();
  });

  it.each([
    ['?notOnMap=1&page=1', 'get_not_on_map', { page: 1 }],
    ['?notOnMap=1&page=4000&q=Lab', 'get_not_on_map', { page: 4000, query: 'Lab' }],
    ['?notOnMap=1&page=2&q=', 'get_not_on_map', { page: 2, query: '' }],
    [`?customer=${customerId}`, 'get_customer_sheet', { customerId }],
    ['?bbox=-90,-180,-87,-177', 'get_map_pins', { south: -90, west: -180, north: -87, east: -177 }],
  ])('routes %s', async (query, action, payload) => {
    expect((await GET(request(query as string))).status).toBe(200);
    expect(mocks.gateway).toHaveBeenCalledWith('manager@example.test', action, payload);
  });

  it.each([
    '', '?foo=1', '?=value', '?bbox=16,76,18,78&foo=1', '?bbox=16,76,18,78&bbox=16,76,18,78',
    '?bbox=16,76,18,78&notOnMap=1&page=1', `?bbox=16,76,18,78&customer=${customerId}`,
    '?bbox=16,76,18', '?bbox=,76,18,78', '?bbox=NaN,76,18,78', '?bbox=Infinity,76,18,78',
    '?bbox=19,76,18,78', '?bbox=16,79,18,78', '?bbox=16,76,16,78', '?bbox=16,76,18,76',
    '?bbox=16,76,19.01,78', '?bbox=16,76,18,79.01', '?bbox=-91,76,-89,78', '?bbox=89,76,91,78',
    '?bbox=16,-181,18,-179', '?bbox=16,179,18,181', '?bbox=0x10,76,18,78',
    '?notOnMap=1', '?notOnMap=0&page=1', '?notOnMap=1&page=0', '?notOnMap=1&page=-1',
    '?notOnMap=1&page=1.5', '?notOnMap=1&page=4001', '?notOnMap=1&page=1e2', '?notOnMap=1&page=01',
    '?notOnMap=1&page=1&page=2', '?notOnMap=1&page=1&q=a&q=b', `?notOnMap=1&page=1&q=${'a'.repeat(121)}`,
    `?notOnMap=1&page=1&customer=${customerId}`, '?customer=bad', '?customer=', `?customer=${customerId}&page=1`,
    `?customer=${customerId}&customer=${customerId}`,
  ])('rejects invalid query %s without gateway access', async query => {
    const response = await GET(request(query));
    expect(response.status).toBe(400);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.gateway).not.toHaveBeenCalled();
  });

  it.each([400, 403, 409, 502, 503])('preserves gateway status %i', async status => {
    mocks.gateway.mockRejectedValue(new OrderGatewayError('Gateway failed', status));
    const response = await GET(request());
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: 'Gateway failed' });
  });

  it('hides unexpected error details', async () => {
    mocks.gateway.mockRejectedValue(new Error('internal detail'));
    const response = await GET(request());
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'Customer map is temporarily unavailable' });
  });
});
