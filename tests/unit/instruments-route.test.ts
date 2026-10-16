import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ user: vi.fn(), session: vi.fn(), gateway: vi.fn() }));
vi.mock('@/app/chatgpt-auth', () => ({ getChatGPTUser: mocks.user }));
vi.mock('@/lib/stockflow-session', () => ({ getStockFlowSession: mocks.session }));
vi.mock('@/lib/order-gateway', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/order-gateway')>(), callOrderGateway: mocks.gateway }));
import { GET } from '@/app/api/instruments/route';
beforeEach(() => {
  vi.clearAllMocks(); mocks.user.mockResolvedValue({ email: 'ops@example.com' });
  mocks.session.mockResolvedValue({ email: 'ops@example.com', roles: ['operations'] });
  mocks.gateway.mockResolvedValue({ assets: [], tickets: [] });
});
describe('instrument portfolio API', () => {
  it('requires sign in before loading membership or data', async () => {
    mocks.user.mockResolvedValue(null); expect((await GET()).status).toBe(401);
    expect(mocks.session).not.toHaveBeenCalled(); expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it.each([null, { roles: ['viewer'] }])('rejects unapproved access', async session => {
    mocks.session.mockResolvedValue(session); expect((await GET()).status).toBe(403); expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it('reuses authorized service records and prevents response caching', async () => {
    const response = await GET(); expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.gateway).toHaveBeenCalledWith('ops@example.com', 'get_service_workspace');
    expect(await response.json()).toMatchObject({ instruments: [], economicsReadiness: 'separate_workspace' });
  });
  it('surfaces source failure instead of showing an empty healthy portfolio', async () => {
    mocks.gateway.mockRejectedValue(new Error('unavailable')); const response = await GET();
    expect(response.status).toBe(502); expect(await response.json()).toEqual({ error: 'Instrument portfolio is temporarily unavailable' });
  });
});
