import { beforeEach, describe, expect, it, vi } from 'vitest';
import { lineRefsSearchParams, normalizeCostReview, normalizeLineRefs, parseLineRefsSearchParams } from '../../lib/instrument-economics-cost-review';

const mocks = vi.hoisted(() => ({ user: vi.fn(), session: vi.fn(), gateway: vi.fn() }));
vi.mock('@/app/chatgpt-auth', () => ({ getChatGPTUser: mocks.user }));
vi.mock('@/lib/stockflow-session', () => ({ getStockFlowSession: mocks.session }));
vi.mock('@/lib/order-gateway', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/order-gateway')>(), callOrderGateway: mocks.gateway }));
import { GET as getCostReview } from '@/app/api/instrument-economics/cost-review/route';
import { GET as getLineRefs } from '@/app/api/instrument-economics/line-refs/route';

const line = { id: 'sale', companyId: 'co', voucherId: 'voucher', voucherNumber: 'INV-1', revision: '1', lineKey: '1', date: '2026-12-01', kind: 'sale', customerSourceId: 'customer', productId: 'p', productName: 'Product', quantity: '1', unit: 'unit', netSalesPaise: '100', batchId: null, partyName: null, usedByInstrument: false };
const review = { sales: [line], salesTotal: 1, purchases: [{ ...line, id: 'purchase', kind: 'purchase' }], purchasesTotal: 1 };
const refs = { rows: [{ id: 'sale', kind: 'sale', voucherNumber: 'INV-1' }, { id: 'credit', kind: 'credit', voucherNumber: null }], total: 2, limit: 5000 };

describe('cost review normalization', () => {
  it('accepts valid rows, nullable fields and omitted optional fields', () => {
    expect(normalizeCostReview(review)).toEqual(review);
    const { voucherNumber: _voucher, productName: _product, partyName: _party, usedByInstrument: _used, ...required } = line;
    expect(normalizeCostReview({ sales: [required], salesTotal: 2, purchases: [], purchasesTotal: 0 }).sales).toEqual([required]);
    expect(normalizeLineRefs(refs)).toEqual(refs);
  });
  it.each([null, [], {}, { sales: [], purchases: [], purchasesTotal: 0 }, { ...review, salesTotal: -1 }, { ...review, salesTotal: Infinity }, { ...review, purchasesTotal: 1.5 }, { ...review, purchasesTotal: '1' }, { ...review, salesTotal: 0 }, { ...review, purchasesTotal: 0 }, { ...review, sales: Array(501).fill(line), salesTotal: 501 }, { ...review, purchases: Array(5001).fill(line), purchasesTotal: 5001 }])('rejects malformed review %#', body => {
    expect(() => normalizeCostReview(body)).toThrow();
  });
  it.each([
    ['id', 1], ['companyId', null], ['voucherId', 2], ['voucherNumber', false], ['revision', 1], ['lineKey', null], ['date', 1], ['kind', 'unknown'], ['customerSourceId', 1], ['productId', 1], ['productName', null], ['quantity', 1], ['unit', null], ['netSalesPaise', 1], ['batchId', 1], ['partyName', false], ['usedByInstrument', 1],
  ])('validates the %s field', (field, value) => {
    expect(() => normalizeCostReview({ ...review, sales: [{ ...line, [field]: value }] })).toThrow();
    expect(() => normalizeCostReview({ ...review, purchases: [{ ...line, [field]: value }] })).toThrow();
  });
  it.each([null, {}, { ...refs, total: -1 }, { ...refs, total: Infinity }, { ...refs, total: 1.5 }, { ...refs, total: 0 }, { ...refs, limit: 4999 }, { ...refs, rows: [{ id: 1, kind: 'sale', voucherNumber: null }] }, { ...refs, rows: [{ id: 'x', kind: 'other', voucherNumber: null }] }, { ...refs, rows: [{ id: 'x', kind: 'sale' }] }, { ...refs, rows: [{ id: 'x', kind: 'sale', voucherNumber: 1 }] }, { ...refs, rows: Array(5001).fill(refs.rows[0]), total: 5001 }])('rejects malformed line refs %#', body => {
    expect(() => normalizeLineRefs(body)).toThrow();
  });
});

describe('line refs parameters', () => {
  it('round trips required strings and accepts maximum lengths', () => {
    const filter = { companyId: 'co & company', customerSourceId: 'customer/one' };
    expect(parseLineRefsSearchParams(lineRefsSearchParams(filter)!)).toEqual(filter);
    expect(lineRefsSearchParams({ companyId: 'x'.repeat(240), customerSourceId: 'y'.repeat(240) })).not.toBeNull();
  });
  it.each(['', 'companyId=co', 'customerSourceId=customer', 'companyId=&customerSourceId=c', 'companyId=co&customerSourceId=', 'companyId=%20&customerSourceId=c', 'companyId=co&customerSourceId=%20', `companyId=${'x'.repeat(241)}&customerSourceId=c`, `companyId=co&customerSourceId=${'x'.repeat(241)}`, 'companyId=co&customerSourceId=c&other=1', 'companyId=co&companyId=co&customerSourceId=c'])('rejects query %s', query => {
    expect(parseLineRefsSearchParams(new URLSearchParams(query))).toBeNull();
  });
  it.each([{ companyId: '', customerSourceId: 'c' }, { companyId: 'co', customerSourceId: '' }, { companyId: 'co', customerSourceId: ' '.repeat(2) }, { companyId: 'x'.repeat(241), customerSourceId: 'c' }, { companyId: 'co', customerSourceId: 'x'.repeat(241) }, { companyId: 'co', customerSourceId: 'c', other: 'bad' }])('rejects invalid outgoing parameters %#', filter => {
    expect(lineRefsSearchParams(filter)).toBeNull();
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ email: 'accounts@example.com' });
  mocks.session.mockResolvedValue({ email: 'accounts@example.com', roles: ['accounts'] });
});
const request = (path: string, query = '') => new Request(`http://localhost/api/instrument-economics/${path}?${query}`);
describe.each([
  { path: 'cost-review', get: getCostReview, query: '', action: 'get_economic_cost_review', payload: {}, body: review, invalid: 'extra=1', message: 'Invalid cost review request' },
  { path: 'line-refs', get: getLineRefs, query: 'companyId=co&customerSourceId=customer', action: 'get_economic_line_refs', payload: { companyId: 'co', customerSourceId: 'customer' }, body: refs, invalid: 'companyId=co', message: 'Invalid line refs request' },
])('$path route', ({ path, get, query, action, payload, body, invalid, message }) => {
  it.each(['sales', 'operations'])('denies %s', async role => {
    mocks.session.mockResolvedValue({ email: 'accounts@example.com', roles: [role] });
    expect((await get(request(path, query))).status).toBe(403);
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it.each(['accounts', 'management', 'administrator'])('allows %s with the exact gateway payload and no-store', async role => {
    mocks.session.mockResolvedValue({ email: 'accounts@example.com', roles: [role] });
    mocks.gateway.mockResolvedValue(body);
    const response = await get(request(path, query));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(body);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.gateway).toHaveBeenCalledExactlyOnceWith('accounts@example.com', action, payload);
  });
  it('rejects bad queries before calling the gateway', async () => {
    const response = await get(request(path, invalid));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: message });
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it('requires sign in and rejects invalid upstream data', async () => {
    mocks.user.mockResolvedValueOnce(null);
    expect((await get(request(path, query))).status).toBe(401);
    mocks.gateway.mockResolvedValue({});
    expect((await get(request(path, query))).status).toBe(502);
  });
});
