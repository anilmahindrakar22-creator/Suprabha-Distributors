import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ user: vi.fn(), session: vi.fn(), gateway: vi.fn() }));
vi.mock('@/app/chatgpt-auth', () => ({ getChatGPTUser: mocks.user }));
vi.mock('@/lib/stockflow-session', () => ({ getStockFlowSession: mocks.session }));
vi.mock('@/lib/order-gateway', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/order-gateway')>(), callOrderGateway: mocks.gateway }));
import { GET } from '@/app/api/data-checks/route';
import { normalizeDataChecks } from '@/lib/data-check-types';
const get = (query = '') => GET(new Request(`https://example.test/api/data-checks${query}`));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ email: 'manager@example.test' });
  mocks.session.mockResolvedValue({ email: 'manager@example.test', roles: ['management'] });
  mocks.gateway.mockResolvedValue({ view: 'data_checks' });
});
describe('data checks API', () => {
  it.each(['administrator', 'management'])('allows %s and sends exactly an empty payload', async role => {
    mocks.session.mockResolvedValue({ email: 'manager@example.test', roles: [role] });
    const response = await get();
    expect(response.status).toBe(200);
    expect(mocks.gateway).toHaveBeenCalledWith('manager@example.test', 'get_data_checks', {});
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });
  it.each(['?view=all', '?x=', '?page=1', '?='])('rejects any parameter: %s', async query => {
    expect((await get(query)).status).toBe(400);
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it('refuses operations', async () => {
    mocks.session.mockResolvedValue({ email: 'ops@example.test', roles: ['operations'] });
    expect((await get()).status).toBe(403);
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it('requires sign in', async () => {
    mocks.user.mockResolvedValue(null);
    expect((await get()).status).toBe(401);
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it('requires membership', async () => {
    mocks.session.mockResolvedValue(null);
    expect((await get()).status).toBe(403);
  });
  it('returns a private failure without internal details', async () => {
    mocks.gateway.mockRejectedValue(new Error('secret'));
    const response = await get();
    expect(response.status).toBe(502);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual({ error: 'Data checks are temporarily unavailable' });
  });
});
describe('data checks normalization', () => {
  const valid = { view: 'data_checks', asOf: '2026-11-18',
    unlinkedLedgers: { count: 1, ofBuying: 2, top: [{ name: null, lastSaleOn: '2026-11-17' }] },
    noPinCode: { count: 0, ofBuying: 1, top: [] }, itemsNotInStockFlow: { count: 0, ofSold: 3 },
    freshness: { salesThrough: '2026-11-17', itemListReadAt: '2026-11-18T01:00:00+00:00' } };
  it('accepts the complete contract including nullable ledger names', () => {
    expect(normalizeDataChecks(valid)).toEqual(valid);
  });
  it.each([null, [], {}, { ...valid, extra: true }, { ...valid, asOf: '2026-02-30' },
    { ...valid, unlinkedLedgers: { count: '1', ofBuying: 2, top: [] } },
    { ...valid, noPinCode: { count: 2, ofBuying: 1, top: [] } },
    { ...valid, itemsNotInStockFlow: { count: -1, ofSold: 2 } },
    { ...valid, freshness: { salesThrough: 'tomorrow', itemListReadAt: null } },
  ])('fails closed for unexpected shapes', value => {
    expect(normalizeDataChecks(value)).toBeNull();
  });
});
