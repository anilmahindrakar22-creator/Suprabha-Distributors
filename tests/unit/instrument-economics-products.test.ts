import { beforeEach, describe, expect, it, vi } from 'vitest';
import { economicProductSearchParams, productKey, normalizeEconomicProductPage, parseEconomicProductSearchParams, type EconomicProductFilter } from '../../lib/instrument-economics-products';

const mocks = vi.hoisted(() => ({ user: vi.fn(), session: vi.fn(), gateway: vi.fn() }));
vi.mock('@/app/chatgpt-auth', () => ({ getChatGPTUser: mocks.user }));
vi.mock('@/lib/stockflow-session', () => ({ getStockFlowSession: mocks.session }));
vi.mock('@/lib/order-gateway', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/order-gateway')>(), callOrderGateway: mocks.gateway }));
import { GET } from '@/app/api/instrument-economics/products/route';

const row = { companyId: 'co', productId: 'p', productName: 'Product', lastDate: '2026-07-23' };
const page = { rows: [row], total: 1, limit: 50, offset: 0, companies: ['co'] };

describe('product search contract', () => {
  it('round trips all supported filters and has a stable key', () => {
    const filter: EconomicProductFilter = { companyId: 'co', q: 'product analyzer', productIds: ['p', 'p2'], limit: 500, offset: 100000 };
    expect(parseEconomicProductSearchParams(economicProductSearchParams(filter))).toEqual(filter);
    expect(productKey({ q: '  product analyzer  ', companyId: 'co' })).toBe(productKey({ companyId: 'co', q: 'product analyzer' }));
    expect(economicProductSearchParams({ q: ' ', productIds: [], companyId: '' }).toString()).toBe('');
    expect(economicProductSearchParams(filter).get('productIds')).toBe('p,p2');
  });
  it.each([
    'unknown=1', 'q=a&q=b', 'q=', 'q=%20', `q=${'x'.repeat(81)}`, 'q=a+b+c+d+e+f+g',
    'productIds=', 'productIds=a,,b', `productIds=${Array(201).fill('p').join(',')}`, `productIds=${'p'.repeat(241)}`,
    'companyId=', 'companyId=%20', `companyId=${'a'.repeat(241)}`,
    'limit=0', 'limit=501', 'limit=-1', 'limit=1.5', 'limit=NaN', 'offset=-1', 'offset=100001', 'offset=1e3',
  ])('rejects invalid params %s', query => expect(parseEconomicProductSearchParams(new URLSearchParams(query))).toBeNull());
  it('accepts boundary values and trims query words', () => {
    expect(parseEconomicProductSearchParams(new URLSearchParams('limit=500&offset=100000&q=%20a%20b%20'))).toEqual({ limit: 500, offset: 100000, q: 'a b' });
    expect(parseEconomicProductSearchParams(new URLSearchParams())).toEqual({});
  });
  it('normalizes valid rows without changing them', () => expect(normalizeEconomicProductPage(page)).toEqual(page));
  it.each([null, [], {}, { ...page, total: '1' }, { ...page, limit: 501 }, { ...page, offset: -1 }, { ...page, rows: [{}] }, { ...page, companies: null }, { ...page, companies: [1] }, { ...page, rows: [{ ...row, lastDate: '2026-02-30' }] }, { ...page, rows: [{ ...row, productName: null }] }])('rejects bad response %#', value => expect(() => normalizeEconomicProductPage(value)).toThrow());
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ email: 'accounts@example.com' });
  mocks.session.mockResolvedValue({ email: 'accounts@example.com', roles: ['accounts'] });
  mocks.gateway.mockResolvedValue(page);
});
const request = (query = '') => new Request(`http://localhost/api/instrument-economics/products?${query}`);
describe('product search route', () => {
  it.each(['sales', 'operations'])('denies %s', async role => {
    mocks.session.mockResolvedValue({ email: 'accounts@example.com', roles: [role] });
    expect((await GET(request())).status).toBe(403);
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it('rejects bad params before invoking the gateway', async () => {
    const response = await GET(request('limit=501'));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid product search' });
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it.each(['accounts', 'management', 'administrator'])('allows %s and passes parsed payload', async role => {
    mocks.session.mockResolvedValue({ email: 'accounts@example.com', roles: [role] });
    const response = await GET(request('companyId=co&productIds=p,p2&limit=50&offset=0&q=%20analyzer%20'));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual(page);
    expect(mocks.gateway).toHaveBeenCalledExactlyOnceWith('accounts@example.com', 'get_economic_products', { companyId: 'co', productIds: ['p', 'p2'], limit: 50, offset: 0, q: 'analyzer' });
  });
  it('requires sign in and rejects malformed upstream pages', async () => {
    mocks.user.mockResolvedValueOnce(null);
    expect((await GET(request())).status).toBe(401);
    mocks.gateway.mockResolvedValue({ rows: [{}] });
    expect((await GET(request())).status).toBe(502);
  });
});
