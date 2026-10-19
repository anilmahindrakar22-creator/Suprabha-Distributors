import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ user: vi.fn(), gateway: vi.fn(), session: vi.fn() }));
vi.mock('@/app/chatgpt-auth', () => ({ getChatGPTUser: mocks.user }));
vi.mock('@/lib/order-gateway', async (original) => ({ ...await original<typeof import('@/lib/order-gateway')>(), callOrderGateway: mocks.gateway }));
vi.mock('@/lib/stockflow-session', () => ({ getStockFlowSession: mocks.session }));
import { POST } from '@/app/api/orders/route';
import { POST as recover } from '@/app/api/orders/recovery/route';
import { GET as session } from '@/app/api/offline-session/route';
const command = { action: 'create_order', payload: { idempotencyKey: 'original-retry-key-123', customerName: 'Test Laboratory', source: 'phone', lines: [{ tallyKey: 'GLUCOSE', quantity: 1 }] } };
beforeEach(() => { vi.clearAllMocks(); mocks.user.mockResolvedValue({ email: 'staff@example.test' }); mocks.gateway.mockResolvedValue({ orderNumber: 'SF-1' }); mocks.session.mockResolvedValue({ email: 'staff@example.test', roles: ['sales'] }); });
const request = (actor: string, body: unknown) => new Request('https://staff.example.test/api/orders', { method: 'POST', headers: { 'content-type': 'application/json', 'x-stockflow-actor': actor }, body: JSON.stringify(body) });
describe('offline reconnect account boundary', () => {
  it('rejects account switching between verification and submission', async () => {
    expect((await POST(request('other@example.test', command))).status).toBe(403);
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it('rejects account switching before recovery', async () => {
    expect((await recover(request('other@example.test', { idempotencyKey: command.payload.idempotencyKey }))).status).toBe(403);
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it('sends the unchanged command through the existing gateway', async () => {
    expect((await POST(request('staff@example.test', command))).status).toBe(200);
    expect(mocks.gateway).toHaveBeenCalledWith('staff@example.test', 'create_order', command.payload);
  });
  it('requires online identity and current order-entry membership', async () => {
    mocks.user.mockResolvedValue(null);
    expect((await session()).status).toBe(401);
    mocks.user.mockResolvedValue({ email: 'staff@example.test' });
    mocks.session.mockResolvedValue({ email: 'staff@example.test', roles: ['viewer'] });
    expect((await session()).status).toBe(403);
  });
  it('returns only the verified account and never caches it', async () => {
    const response = await session();
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual({ actorEmail: 'staff@example.test' });
  });
});
