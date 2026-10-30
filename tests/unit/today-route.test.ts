import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ user: vi.fn(), session: vi.fn(), gateway: vi.fn() }));
vi.mock('@/app/chatgpt-auth', () => ({ getChatGPTUser: mocks.user }));
vi.mock('@/lib/stockflow-session', () => ({ getStockFlowSession: mocks.session }));
vi.mock('@/lib/order-gateway', async original => ({ ...await original<typeof import('@/lib/order-gateway')>(), callOrderGateway: mocks.gateway }));
import { GET } from '@/app/api/today/route';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ email: 'manager@example.test' });
  mocks.session.mockResolvedValue({ email: 'manager@example.test', roles: ['management'] });
  mocks.gateway.mockResolvedValue({ today: [] });
});

const request = (query = '') => new Request(`http://localhost/api/today${query}`);

describe('Today route', () => {
  it('requires authentication and an allowed role', async () => {
    mocks.user.mockResolvedValue(null);
    expect((await GET(request())).status).toBe(401);
    mocks.user.mockResolvedValue({ email: 'staff@example.test' });
    mocks.session.mockResolvedValue({ email: 'staff@example.test', roles: ['sales'] });
    expect((await GET(request())).status).toBe(403);
    mocks.session.mockResolvedValue({ email: 'staff@example.test', roles: ['operations'] });
    expect((await GET(request())).status).toBe(403);
    mocks.session.mockResolvedValue(null);
    expect((await GET(request())).status).toBe(403);
    expect(mocks.gateway).not.toHaveBeenCalled();
  });

  it.each(['?date=2026-10-30', '?action=get_today', '?page=2', '?=value'])('rejects query %s without gateway access', async query => {
    expect((await GET(request(query))).status).toBe(400);
    expect(mocks.gateway).not.toHaveBeenCalled();
  });

  it('returns gateway data with private no-store caching', async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ today: [] });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.gateway).toHaveBeenCalledWith('manager@example.test', 'get_today', {});
  });

  it.each([[403], [409], [502]] as const)('maps gateway errors with status %i', async status => {
    const { OrderGatewayError } = await import('@/lib/order-gateway');
    mocks.gateway.mockRejectedValue(new OrderGatewayError('Gateway failed', status));
    const response = await GET(request());
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: 'Gateway failed' });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it('allows administrator access and maps gateway 400 errors', async () => {
    mocks.session.mockResolvedValue({ email: 'admin@example.test', roles: ['administrator'] });
    expect((await GET(request())).status).toBe(200);
    expect(mocks.gateway).toHaveBeenCalledWith('admin@example.test', 'get_today', {});
    const { OrderGatewayError } = await import('@/lib/order-gateway');
    mocks.gateway.mockRejectedValue(new OrderGatewayError('Bad request', 400));
    const response = await GET(request());
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Bad request' });
  });

  it('maps unexpected errors to 502', async () => {
    mocks.gateway.mockRejectedValue(new Error('internal detail'));
    const response = await GET(request());
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'Today is temporarily unavailable' });
  });
});
