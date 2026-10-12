import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ user: vi.fn(), gateway: vi.fn() }));
vi.mock('@/app/chatgpt-auth', () => ({ getChatGPTUser: mocks.user }));
vi.mock('@/lib/order-gateway', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/order-gateway')>(), callOrderGateway: mocks.gateway }));
import { GET } from '@/app/api/market/overview/route';
import { OrderGatewayError } from '@/lib/order-gateway';
import { marketOverviewFilters, parseMarketOverviewQuery } from '@/lib/market-overview-types';

const overview = {
  customers: [], page: { page: 1, pageSize: 50, total: 0 },
  counts: { all: 0, noPin: 0, noEstimate: 0, staleEstimate: 0 },
  pareto: { basis: 'estimated_wallet', focusCustomers: 0, focusWalletPaise: '0', totalWalletPaise: '0', estimatedCustomers: 0, activeCustomers: 0 },
  activeDivisions: 7,
};
const get = (query = '') => GET(new Request(`https://example.test/api/market/overview?${query}`));
beforeEach(() => {
  vi.clearAllMocks(); mocks.user.mockResolvedValue({ email: 'manager@example.test' });
  mocks.gateway.mockResolvedValue(overview);
});
describe('market overview API', () => {
  it('requires sign in', async () => {
    mocks.user.mockResolvedValue(null);
    const response = await get();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Sign in required' });
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it.each(marketOverviewFilters)('passes valid query and filter %s through', async filter => {
    const response = await get(`search=Bengaluru&page=2&filter=${filter}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(overview);
    expect(mocks.gateway).toHaveBeenCalledWith('manager@example.test', 'get_market_overview', { search: 'Bengaluru', page: 2, filter });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.has('server-timing')).toBe(true);
  });
  it('defaults to page one and all', async () => {
    await get();
    expect(mocks.gateway).toHaveBeenCalledWith('manager@example.test', 'get_market_overview', { search: '', page: 1, filter: 'all' });
  });
  it.each(['filter=bad', 'filter=', 'page=0', 'page=-1', 'page=1.5', 'page=abc', 'page=', 'page=2147483648', `search=${'x'.repeat(121)}`])('rejects invalid query %s', async query => {
    const response = await get(query);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid market request' });
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it('accepts boundary pages and counts search characters as PostgreSQL does', () => {
    expect(parseMarketOverviewQuery(new URLSearchParams({ page: '2147483647', search: '😀'.repeat(120) }))).toEqual({ page: 2147483647, search: '😀'.repeat(120), filter: 'all' });
    expect(parseMarketOverviewQuery(new URLSearchParams({ search: '😀'.repeat(121) }))).toBeNull();
  });
  it('passes gateway access denial through', async () => {
    mocks.gateway.mockRejectedValue(new OrderGatewayError('Market access requires administrator or management', 403));
    const response = await get();
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Market access requires administrator or management' });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });
  it('maps unexpected errors', async () => {
    mocks.gateway.mockRejectedValue(new Error('unavailable'));
    const response = await get();
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'Market is temporarily unavailable' });
  });
});
