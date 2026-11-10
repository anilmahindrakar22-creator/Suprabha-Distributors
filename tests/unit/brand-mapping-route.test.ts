import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ user: vi.fn(), session: vi.fn(), gateway: vi.fn() }));
vi.mock('@/app/chatgpt-auth', () => ({ getChatGPTUser: mocks.user }));
vi.mock('@/lib/stockflow-session', () => ({ getStockFlowSession: mocks.session }));
vi.mock('@/lib/order-gateway', async original => ({ ...await original<typeof import('@/lib/order-gateway')>(), callOrderGateway: mocks.gateway }));
import { GET, POST } from '@/app/api/brand-mapping/route';
import { OrderGatewayError } from '@/lib/order-gateway';

const get = (query = '') => new Request(`http://localhost/api/brand-mapping${query}`);
const post = (body: unknown) => new Request('http://localhost/api/brand-mapping', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ email: 'manager@example.test' });
  mocks.session.mockResolvedValue({ email: 'manager@example.test', roles: ['management'] });
  mocks.gateway.mockResolvedValue({ brands: [], groups: [], items: [], equipment: [], total: 0, page: 1, unmappedSalesPaise: 0, totalSalesPaise: 0 });
});

describe('Brand mapping route', () => {
  const itemKind = { action: 'set_item_kind', requestId: '19300000-0000-4000-8000-000000000001', companyId: 'company-1', productId: 'product-1', kind: 'consumable', reason: 'Costly reagent' };
  it.each(['administrator', 'management'])('forwards set_item_kind for %s with only the gateway fields', async role => {
    mocks.session.mockResolvedValue({ email: 'staff@example.test', roles: [role] });
    expect((await POST(post(itemKind))).status).toBe(200);
    const { action, ...payload } = itemKind;
    expect(mocks.gateway).toHaveBeenCalledExactlyOnceWith('staff@example.test', action, payload);
  });
  it.each(['sales', 'operations', 'accounts', 'viewer'])('blocks item-kind writes by %s before the gateway', async role => {
    mocks.session.mockResolvedValue({ email: 'staff@example.test', roles: [role] });
    expect((await POST(post(itemKind))).status).toBe(403);
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it.each(['administrator', 'management'])('allows %s on reads and writes', async role => {
    mocks.session.mockResolvedValue({ email: 'staff@example.test', roles: [role] });
    const read = await GET(get('?q=Acme&page=2'));
    expect(read.status).toBe(200);
    expect(read.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.gateway).toHaveBeenLastCalledWith('staff@example.test', 'get_brand_mapping', { page: 2, q: 'Acme' });
    const write = await POST(post({ action: 'add_brand', name: 'Acme', idempotencyKey: 'brand-route-command-001' }));
    expect(write.status).toBe(200);
    expect(write.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.gateway).toHaveBeenLastCalledWith('staff@example.test', 'add_brand', { name: 'Acme', idempotencyKey: 'brand-route-command-001' });
  });

  it('requires authentication and management access on both methods', async () => {
    mocks.user.mockResolvedValue(null);
    expect((await GET(get())).status).toBe(401);
    expect((await POST(post({ action: 'add_brand', name: 'Acme', idempotencyKey: 'brand-route-command-001' }))).status).toBe(401);
    mocks.user.mockResolvedValue({ email: 'staff@example.test' });
    for (const session of [null, ...['sales', 'operations', 'accounts', 'viewer'].map(role => ({ email: 'staff@example.test', roles: [role] }))]) {
      mocks.session.mockResolvedValue(session);
      expect((await GET(get())).status).toBe(403);
      expect((await POST(post({ action: 'add_brand', name: 'Acme', idempotencyKey: 'brand-route-command-001' }))).status).toBe(403);
    }
    expect(mocks.gateway).not.toHaveBeenCalled();
  });

  it.each(['?unknown=1', '?q=x&q=y', `?q=${'x'.repeat(121)}`, '?page=0', '?page=4001', '?page=1.5', '?page=01', '?page=1&page=2', '?page=1e2', '?q=x&unknown=1'])('rejects invalid read query %s', async query => {
    const response = await GET(get(query));
    expect(response.status).toBe(400);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.gateway).not.toHaveBeenCalled();
  });

  it.each([
    { action: 'bad' }, { action: 'set_group_brand', group: 'BM test group', expectedLinkId: null, brandCode: 'SYSMEX' },
    { action: 'add_brand', name: 'x', idempotencyKey: 'brand-route-command-001', extra: true },
    { action: 'add_brand', payload: { name: 'nested' }, idempotencyKey: 'brand-route-command-001' },
  ])('rejects malformed write commands', async body => {
    const response = await POST(post(body));
    expect(response.status).toBe(400);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.gateway).not.toHaveBeenCalled();
  });

  it.each(['get_brand_mapping', 'set_group_brand', 'set_item_brand', 'set_equipment_area', 'add_brand'])(
    'routes %s through the gateway', async action => {
      const payload = action === 'get_brand_mapping' ? { page: 1 } : action === 'add_brand'
        ? { name: 'Test brand', idempotencyKey: 'brand-route-command-001' }
        : action === 'set_group_brand'
          ? { group: 'BM test group', expectedLinkId: null, brandCode: 'SYSMEX', idempotencyKey: 'brand-route-command-001' }
          : action === 'set_item_brand'
            ? { itemKey: 'BM-test-1', expectedLinkId: null, brandCode: 'SYSMEX', idempotencyKey: 'brand-route-command-001' }
            : { itemKey: 'BM-test-1', expectedLinkId: null, areaCode: 'HAEM', idempotencyKey: 'brand-route-command-001' };
      const response = action === 'get_brand_mapping' ? await GET(get()) : await POST(post({ action, ...payload }));
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(mocks.gateway).toHaveBeenCalledWith('manager@example.test', action, payload);
    },
  );

  it.each([400, 403, 409, 502, 503])('preserves gateway status %i', async status => {
    mocks.gateway.mockRejectedValue(new OrderGatewayError('Gateway failed', status));
    expect((await GET(get())).status).toBe(status);
    expect((await POST(post({ action: 'add_brand', name: 'Acme', idempotencyKey: 'brand-route-command-001' }))).status).toBe(status);
  });

  it('hides unexpected gateway errors', async () => {
    mocks.gateway.mockRejectedValue(new Error('private detail'));
    const response = await GET(get());
    expect(response.status).toBe(502);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual({ error: 'Brand mapping is temporarily unavailable' });
  });

  it('rejects malformed gateway reads', async () => {
    mocks.gateway.mockResolvedValue({ brands: [] });
    const response = await GET(get());
    expect(response.status).toBe(502);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it('accepts an item clear without turning it into an explicit none', async () => {
    const payload = { itemKey: 'BM-test-1', expectedLinkId: null, clear: true, idempotencyKey: 'brand-route-clear-command' };
    expect((await POST(post({ action: 'set_item_brand', ...payload }))).status).toBe(200);
    expect(mocks.gateway).toHaveBeenCalledWith('manager@example.test', 'set_item_brand', payload);
  });

  it('rejects invalid JSON and oversized commands before gateway access', async () => {
    const invalid = new Request('http://localhost/api/brand-mapping', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' });
    expect((await POST(invalid)).status).toBe(400);
    const oversized = await POST(post({ action: 'add_brand', name: 'x'.repeat(8193) }));
    expect(oversized.status).toBe(413);
    expect(oversized.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
});
