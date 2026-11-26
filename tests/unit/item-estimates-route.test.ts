import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ user: vi.fn(), session: vi.fn(), gateway: vi.fn() }));
vi.mock('@/app/chatgpt-auth', () => ({ getChatGPTUser: mocks.user }));
vi.mock('@/lib/stockflow-session', () => ({ getStockFlowSession: mocks.session }));
vi.mock('@/lib/order-gateway', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/order-gateway')>(), callOrderGateway: mocks.gateway }));
import { POST } from '@/app/api/item-estimates/route';
import { callOrderGateway, OrderGatewayError } from '@/lib/order-gateway';

const valid = { requestId: '123e4567-e89b-42d3-a456-426614174000', itemKey: 'New reagent', monthlyQty: 12.5, reason: 'Principal plan: 2 labs from Jan', reviewOn: '2027-02-24' };
const post = (body: unknown) => POST(new Request('https://local/api/item-estimates', { method: 'POST', body: JSON.stringify(body) }));

describe('item estimates route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user.mockResolvedValue({ email: 'manager@example.test' });
    mocks.session.mockResolvedValue({ email: 'manager@example.test', roles: ['management'] });
    mocks.gateway.mockResolvedValue({ saved: true });
  });
  it.each(['management', 'administrator'])('forwards the exact body for %s and prevents caching', async role => {
    mocks.session.mockResolvedValue({ email: 'manager@example.test', roles: [role] });
    const response = await post(valid);
    expect(response.status).toBe(200);
    expect(mocks.gateway).toHaveBeenCalledWith('manager@example.test', 'set_item_demand_estimate', valid);
    expect(await response.json()).toEqual({ saved: true });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });
  it.each([
    Object.fromEntries(Object.entries(valid).filter(([key]) => key !== 'reason')),
    { ...valid, extra: true }, { ...valid, monthlyQty: 0 }, { ...valid, monthlyQty: '12' },
    { ...valid, monthlyQty: 1_000_001 }, { ...valid, reason: ' too short ' },
    { ...valid, reason: 'x'.repeat(301) }, { ...valid, reviewOn: '2027-02-30' },
    { ...valid, reviewOn: '24 Feb 2027' }, { ...valid, requestId: 'not-a-uuid' },
    { ...valid, itemKey: '' }, { ...valid, itemKey: 'x'.repeat(221) }, null, [],
  ])('rejects invalid input %#', async body => {
    const response = await post(body);
    expect(response.status).toBe(400);
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it('rejects operations', async () => {
    mocks.session.mockResolvedValue({ email: 'ops@example.test', roles: ['operations'] });
    expect((await post(valid)).status).toBe(403);
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it('requires sign in', async () => {
    mocks.user.mockResolvedValue(null);
    expect((await post(valid)).status).toBe(401);
  });
  it('maps a real gateway 22023 response to 400 with its message', async () => {
    const original = await vi.importActual<typeof import('@/lib/order-gateway')>('@/lib/order-gateway');
    vi.stubEnv('SUPABASE_URL', 'https://gateway.test');
    vi.stubEnv('STOCKFLOW_ORDER_GATEWAY_KEY', 'test-key');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ code: '22023', message: 'Only new items take an expected use' }, { status: 500 })));
    mocks.gateway.mockImplementation(original.callOrderGateway);
    try {
      const response = await post(valid);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'Only new items take an expected use' });
    } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
  });
  it.each([403, 409, 502, 429])('handles gateway status %s', async status => {
    vi.mocked(callOrderGateway).mockRejectedValue(new OrderGatewayError('Gateway error', status));
    expect((await post(valid)).status).toBe(status === 429 ? 502 : status);
  });
});
