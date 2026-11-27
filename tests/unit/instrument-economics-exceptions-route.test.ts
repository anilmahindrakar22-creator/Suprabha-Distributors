import { beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeEconomicExceptions, parseEconomicExceptionsParams } from '@/lib/instrument-economics-exceptions';

const mocks = vi.hoisted(() => ({ user: vi.fn(), session: vi.fn(), gateway: vi.fn() }));
vi.mock('@/app/chatgpt-auth', () => ({ getChatGPTUser: mocks.user }));
vi.mock('@/lib/stockflow-session', () => ({ getStockFlowSession: mocks.session }));
vi.mock('@/lib/order-gateway', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/order-gateway')>(), callOrderGateway: mocks.gateway }));
import { GET } from '@/app/api/instrument-economics/exceptions/route';

const row = { sourceId: 'import-1', productId: '', date: '2026-10-10', netSalesPaise: '0', status: 'import_rejected', reason: 'Missing customer', voucherNumber: 'INV-42', voucherType: 'Sales', voucherDate: null, detail: null, kind: null };
const page = { rows: [row], groups: [{ status: 'import_rejected', reason: row.reason, count: 2, netSalesPaise: '0' }], total: 2, limit: 200, offset: 0 };
const request = (query = '') => new Request(`http://localhost/api/instrument-economics/exceptions?${query}`);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ email: 'accounts@example.com' });
  mocks.session.mockResolvedValue({ email: 'accounts@example.com', roles: ['accounts'] });
  mocks.gateway.mockResolvedValue(page);
});
describe('economic exceptions route', () => {
  it('requires sign in', async () => {
    mocks.user.mockResolvedValue(null);
    expect((await GET(request())).status).toBe(401);
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it.each(['operations', 'sales'])('denies %s', async role => {
    mocks.session.mockResolvedValue({ email: 'accounts@example.com', roles: [role] });
    expect((await GET(request())).status).toBe(403);
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it.each(['unknown=1', 'limit=201', 'limit=0', 'offset=10001', 'offset=-1', 'limit=2&limit=3', 'status=', `status=${'a'.repeat(61)}`])('rejects %s', async query => {
    expect((await GET(request(query))).status).toBe(400);
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it('returns the normalized page with private caching', async () => {
    const response = await GET(request('status=import_rejected&limit=200&offset=0'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(page);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.gateway).toHaveBeenCalledWith('accounts@example.com', 'get_economic_exceptions', { status: 'import_rejected', limit: 200, offset: 0 });
  });
  it.each([null, {}, { ...page, rows: [{}] }, { ...page, total: '2' }, { ...page, groups: [{}] }, { ...page, limit: 201 }, { ...page, rows: [{ ...row, detail: 1 }] }, { ...page, rows: [{ ...row, netSalesPaise: 'bad' }] }])('returns 502 for malformed responses %#', async value => {
    mocks.gateway.mockResolvedValue(value);
    expect((await GET(request())).status).toBe(502);
    expect(() => normalizeEconomicExceptions(value)).toThrow();
  });
  it('accepts pagination boundaries', () => {
    expect(parseEconomicExceptionsParams(new URLSearchParams('limit=1&offset=10000'))).toEqual({ limit: 1, offset: 10000 });
  });
  it.each([{ reason: null }, { date: '2026-02-30' }, { sourceLineId: 1 }, { lineCount: '2' }])('rejects invalid row fields %j', fields => {
    expect(() => normalizeEconomicExceptions({ ...page, rows: [{ ...row, ...fields }] })).toThrow();
  });
});
