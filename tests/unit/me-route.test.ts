import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ user: vi.fn(), session: vi.fn() }));
vi.mock('@/app/chatgpt-auth', () => ({ getChatGPTUser: mocks.user }));
vi.mock('@/lib/stockflow-session', () => ({ getStockFlowSession: mocks.session }));
vi.mock('@/lib/order-gateway', () => ({ OrderGatewayError: class extends Error { constructor(message: string, public status: number) { super(message); } } }));
import { GET } from '@/app/api/me/route';
import { OrderGatewayError } from '@/lib/order-gateway';

describe('/api/me', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.user.mockResolvedValue({ email: 'staff@example.test' }); mocks.session.mockResolvedValue({ email: 'staff@example.test', role: 'sales', roles: ['sales', 'billing'] }); });
  it('returns 401 without a signed-in identity', async () => {
    mocks.user.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
  });
  it('returns 403 for missing or suspended membership', async () => {
    mocks.session.mockResolvedValue(null);
    expect((await GET()).status).toBe(403);
  });
  it('returns current caller roles with no-store caching', async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ email: 'staff@example.test', role: 'sales', roles: ['sales', 'billing'] });
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(mocks.session).toHaveBeenCalledWith('staff@example.test');
  });
  it('maps gateway errors to 502 except explicit denial', async () => {
    mocks.session.mockRejectedValue(new OrderGatewayError('denied', 403));
    expect((await GET()).status).toBe(403);
    mocks.session.mockRejectedValue(new Error('offline'));
    expect((await GET()).status).toBe(502);
  });
});
