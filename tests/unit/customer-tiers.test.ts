import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ user: vi.fn(), session: vi.fn(), gateway: vi.fn() }));
vi.mock('@/app/chatgpt-auth', () => ({ getChatGPTUser: mocks.user }));
vi.mock('@/lib/stockflow-session', () => ({ getStockFlowSession: mocks.session }));
vi.mock('@/lib/order-gateway', async original => ({ ...await original<typeof import('@/lib/order-gateway')>(), callOrderGateway: mocks.gateway }));
import { chunkOrderIds, normalizeCustomerTiers } from '@/lib/customer-tiers';
import { GET, POST } from '@/app/api/customer-tiers/route';
import { OrderGatewayError } from '@/lib/order-gateway';

const id = '61000000-0000-4000-8000-000000000001';
const result = { month: '2026-11-01', tiers: { [id]: 'diamond' } };
const post = (body: unknown) => POST(new Request('https://app.test/api/customer-tiers', { method: 'POST', body: JSON.stringify(body) }));

describe('customer tier data', () => {
  it('accepts all four tiers, empty tiers and nullable months', () => {
    expect(normalizeCustomerTiers(result)).toEqual(result);
    const all = { month: null, tiers: { a: 'diamond', b: 'platinum', c: 'gold', d: 'silver' } };
    expect(normalizeCustomerTiers(all)).toEqual(all);
    expect(normalizeCustomerTiers({ month: null, tiers: {} })).toEqual({ month: null, tiers: {} });
  });
  it.each([null, [], {}, { tiers: {} }, { month: null }, { month: 42, tiers: {} },
    { ...result, extra: true }, { month: null, tiers: null }, { month: null, tiers: [] },
    { month: null, tiers: 'gold' }, { month: null, tiers: { a: 'untiered' } },
    { month: null, tiers: { a: 'Gold' } }, { month: null, tiers: { a: null } },
  ])('rejects malformed data %j', raw => {
    expect(normalizeCustomerTiers(raw)).toBeNull();
  });
  it('deduplicates in first-seen order and chunks at 100', () => {
    const ids = Array.from({ length: 250 }, (_, i) => `id-${i}`);
    const chunks = chunkOrderIds([ids[0], ...ids, ids[101], ids[249]]);
    expect(chunks.map(chunk => chunk.length)).toEqual([100, 100, 50]);
    expect(chunks.flat()).toEqual(ids);
    expect(chunkOrderIds([])).toEqual([]);
    expect(chunkOrderIds(ids.slice(0, 100))).toEqual([ids.slice(0, 100)]);
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ email: 'staff@example.test' });
  mocks.session.mockResolvedValue({ email: 'staff@example.test', roles: ['sales'] });
  mocks.gateway.mockResolvedValue(result);
});

describe('customer tiers route', () => {
  it.each(['sales', 'operations', 'accounts', 'warehouse', 'management', 'administrator'])('allows %s with order access delegated to SQL', async role => {
    mocks.session.mockResolvedValue({ email: 'staff@example.test', roles: [role] });
    const response = await post({ orderIds: [id] });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual(result);
    expect(mocks.gateway).toHaveBeenCalledWith('staff@example.test', 'get_customer_tiers', { orderIds: [id] });
  });
  it.each([null, [], {}, { orderIds: [] }, { orderIds: 'bad' }, { orderIds: [42] },
    { orderIds: ['bad'] }, { orderIds: [id, id] }, { orderIds: [id], extra: true },
    { orderIds: Array.from({ length: 101 }, (_, i) => `61000000-0000-4000-8000-${String(i).padStart(12, '0')}`) },
  ])('rejects invalid body %j', async body => {
    const response = await post(body);
    expect(response.status).toBe(400);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it('rejects malformed JSON', async () => {
    expect((await POST(new Request('https://app.test/api/customer-tiers', { method: 'POST', body: '{' }))).status).toBe(400);
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it('rejects a body over 8 KB', async () => {
    const response = await POST(new Request('https://app.test/api/customer-tiers', {
      method: 'POST', body: JSON.stringify({ orderIds: [id], padding: 'x'.repeat(8200) }),
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid request' });
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it('rejects a content-length header over 8 KB before reading', async () => {
    const response = await POST(new Request('https://app.test/api/customer-tiers', {
      method: 'POST', headers: { 'content-length': '9000' }, body: JSON.stringify({ orderIds: [id] }),
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid request' });
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it('accepts the maximum of 100 distinct UUIDs', async () => {
    const orderIds = Array.from({ length: 100 }, (_, i) => `61000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    expect((await post({ orderIds })).status).toBe(200);
    expect(mocks.gateway).toHaveBeenCalledWith('staff@example.test', 'get_customer_tiers', { orderIds });
  });
  it('returns 405 for GET', () => {
    const response = GET();
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it('requires sign-in and a session', async () => {
    mocks.user.mockResolvedValue(null);
    expect((await post({ orderIds: [id] })).status).toBe(401);
    mocks.user.mockResolvedValue({ email: 'staff@example.test' });
    mocks.session.mockResolvedValue(null);
    expect((await post({ orderIds: [id] })).status).toBe(403);
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it('returns 502 for malformed gateway responses', async () => {
    mocks.gateway.mockResolvedValue({ month: null, tiers: { [id]: 'unknown' } });
    expect((await post({ orderIds: [id] })).status).toBe(502);
  });
  it.each([400, 403, 502])('preserves gateway error status %s', async status => {
    mocks.gateway.mockRejectedValue(new OrderGatewayError('Unavailable', status));
    expect((await post({ orderIds: [id] })).status).toBe(status);
  });
  it('returns 502 for unexpected failures', async () => {
    mocks.gateway.mockRejectedValue(new Error('Unavailable'));
    expect((await post({ orderIds: [id] })).status).toBe(502);
  });
});
