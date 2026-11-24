import { beforeEach, describe, expect, it, vi } from 'vitest';
import { economicLineSearchParams, lineKey, normalizeEconomicLinePage, parseEconomicLineSearchParams, type EconomicLineFilter } from '../../lib/instrument-economics-lines';

const mocks = vi.hoisted(() => ({ user: vi.fn(), session: vi.fn(), gateway: vi.fn() }));
vi.mock('@/app/chatgpt-auth', () => ({ getChatGPTUser: mocks.user }));
vi.mock('@/lib/stockflow-session', () => ({ getStockFlowSession: mocks.session }));
vi.mock('@/lib/order-gateway', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/order-gateway')>(), callOrderGateway: mocks.gateway }));
import { GET } from '@/app/api/instrument-economics/lines/route';

const row = { id: '00000000-0000-0000-0000-000000000001', companyId: 'co', voucherId: 'v', revision: '1', lineKey: '1', date: '2026-07-23', kind: 'sale', customerSourceId: null, productId: 'p', quantity: '1.000000', unit: 'Nos', netSalesPaise: '1', batchId: null };
const page = { rows: [row], total: 1, limit: 50, offset: 0 };

describe('invoice search contract', () => {
  it('round trips all supported filters and has a stable key', () => {
    const filter: EconomicLineFilter = { kind: 'sale', companyId: 'co', customerSourceId: 'customer', productId: 'product', unit: 'Nos', q: 'invoice analyzer', ids: [row.id], quantityOne: true, minNetSalesPaise: '5000000', dateFrom: '2026-01-01', dateTo: '2026-12-31', unusedOnly: true, limit: 50, offset: 0 };
    expect(parseEconomicLineSearchParams(economicLineSearchParams(filter))).toEqual(filter);
    expect(lineKey({ q: '  invoice analyzer  ', kind: 'sale' })).toBe(lineKey({ kind: 'sale', q: 'invoice analyzer' }));
    expect(economicLineSearchParams({ q: ' ', ids: [], companyId: '', unusedOnly: false }).toString()).toBe('');
    expect(economicLineSearchParams(filter).get('quantityOne')).toBe('1');
  });
  it.each([
    'unknown=1', 'kind=other', 'kind=sale&kind=purchase', 'q=', 'q=%20', `q=${'x'.repeat(81)}`, 'q=a+b+c+d+e+f+g',
    'ids=', 'ids=bad', `ids=${Array(201).fill(row.id).join(',')}`, 'limit=0', 'limit=201', 'limit=-1', 'limit=1.5', 'limit=NaN',
    'offset=-1', 'offset=10001', 'offset=1e3', 'quantityOne=true', 'unusedOnly=0', 'minNetSalesPaise=', 'minNetSalesPaise=-1', 'minNetSalesPaise=1.1', `minNetSalesPaise=${'1'.repeat(19)}`,
    'dateFrom=2026-02-30', 'dateFrom=2025-02-29', 'dateTo=2026-13-01', 'dateFrom=0000-01-01', 'dateFrom=2026-1-01', 'dateFrom=2026-02-01&dateTo=2026-01-01',
    'companyId=', 'customerSourceId=%20', `productId=${'a'.repeat(241)}`, `unit=${'a'.repeat(81)}`, 'unit=',
  ])('rejects invalid params %s', query => expect(parseEconomicLineSearchParams(new URLSearchParams(query))).toBeNull());
  it('accepts boundary values and trims query words', () => {
    expect(parseEconomicLineSearchParams(new URLSearchParams('limit=200&offset=10000&dateFrom=2024-02-29&q=%20a%20b%20'))).toEqual({ limit: 200, offset: 10000, dateFrom: '2024-02-29', q: 'a b' });
    expect(parseEconomicLineSearchParams(new URLSearchParams())).toEqual({});
  });
  it('normalizes valid rows without changing them', () => expect(normalizeEconomicLinePage(page)).toEqual(page));
  it.each([null, [], {}, { ...page, total: '1' }, { ...page, limit: 201 }, { ...page, offset: -1 }, { ...page, rows: [{}] }, { ...page, rows: [{ ...row, batchId: undefined }] }, { ...page, rows: [{ ...row, quantity: 1 }] }, { ...page, rows: [{ ...row, kind: 'other' }] }, { ...page, rows: [{ ...row, netSalesPaise: 'oops' }] }, { ...page, rows: [{ ...row, partyName: 1 }] }])('rejects bad response %#', value => expect(() => normalizeEconomicLinePage(value)).toThrow());
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ email: 'accounts@example.com' });
  mocks.session.mockResolvedValue({ email: 'accounts@example.com', roles: ['accounts'] });
  mocks.gateway.mockResolvedValue(page);
});
const request = (query = '') => new Request(`http://localhost/api/instrument-economics/lines?${query}`);
describe('invoice search route', () => {
  it.each(['sales', 'operations'])('denies %s', async role => {
    mocks.session.mockResolvedValue({ email: 'accounts@example.com', roles: [role] });
    expect((await GET(request())).status).toBe(403);
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it('rejects bad params before invoking the gateway', async () => {
    const response = await GET(request('limit=201'));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid invoice search' });
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it.each(['accounts', 'management', 'administrator'])('allows %s and passes parsed payload', async role => {
    mocks.session.mockResolvedValue({ email: 'accounts@example.com', roles: [role] });
    const response = await GET(request('kind=sale&quantityOne=1&limit=50&offset=0&q=%20analyzer%20'));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual(page);
    expect(mocks.gateway).toHaveBeenCalledExactlyOnceWith('accounts@example.com', 'get_economic_source_lines', { kind: 'sale', quantityOne: true, limit: 50, offset: 0, q: 'analyzer' });
  });
  it('requires sign in and rejects malformed upstream pages', async () => {
    mocks.user.mockResolvedValueOnce(null);
    expect((await GET(request())).status).toBe(401);
    mocks.gateway.mockResolvedValue({ rows: [{}] });
    expect((await GET(request())).status).toBe(502);
  });
});
