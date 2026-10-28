import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ user: vi.fn(), session: vi.fn(), gateway: vi.fn() }));
vi.mock('@/app/chatgpt-auth', () => ({ getChatGPTUser: mocks.user }));
vi.mock('@/lib/stockflow-session', () => ({ getStockFlowSession: mocks.session }));
vi.mock('@/lib/order-gateway', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/order-gateway')>(), callOrderGateway: mocks.gateway }));
import { GET, POST } from '@/app/api/customer-links/route';
import { OrderGatewayError } from '@/lib/order-gateway';
const command = { action: 'confirm_customer_links', companyId: 'company', sourceVersion: 'export-1', rows: [{ customerId: '12345678-1234-4234-8234-123456789abc', ledgerGuid: 'guid' }], reason: 'Verified ledger', idempotencyKey: 'customer-links-key-001' };
const post = (body: unknown) => new Request('https://example.test/api/customer-links', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const get = (query = '') => GET(new Request(`https://example.test/api/customer-links${query}`));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ email: 'manager@example.test' });
  mocks.session.mockResolvedValue({ email: 'manager@example.test', roles: ['management'] });
  mocks.gateway.mockResolvedValue({ rows: [] });
});
describe('customer links API', () => {
  it.each(['administrator', 'management'])('allows %s reads and writes', async role => {
    mocks.session.mockResolvedValue({ email: 'member@example.test', roles: [role] });
    expect((await get()).status).toBe(200);
    expect((await POST(post(command))).status).toBe(200);
  });
  it.each(['sales', 'operations', 'viewer'])('denies %s both methods before gateway access', async role => {
    mocks.session.mockResolvedValue({ email: 'member@example.test', roles: [role] });
    expect((await get()).status).toBe(403);
    expect((await POST(post(command))).status).toBe(403);
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it('requires authentication and active membership for both methods', async () => {
    mocks.user.mockResolvedValue(null);
    expect((await get()).status).toBe(401);
    expect((await POST(post(command))).status).toBe(401);
    mocks.user.mockResolvedValue({ email: 'manager@example.test' });
    mocks.session.mockResolvedValue(null);
    expect((await get()).status).toBe(403);
    expect((await POST(post(command))).status).toBe(403);
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it('maps optional GET filters and defaults', async () => {
    await get();
    expect(mocks.gateway).toHaveBeenLastCalledWith('manager@example.test', 'get_link_suggestions', { search: '', page: 1 });
    await get('?companyId=company&search=Lab&state=suggested&page=2');
    expect(mocks.gateway).toHaveBeenLastCalledWith('manager@example.test', 'get_link_suggestions', { companyId: 'company', search: 'Lab', state: 'suggested', page: 2 });
  });
  it.each(['suggested', 'linked', 'conflict'])('accepts state %s', async state => { expect((await get(`?state=${state}`)).status).toBe(200); });
  it.each(['page=0', 'page=-1', 'page=1.2', 'page=1e2', 'page=', 'page=2147483648', 'state=', 'state=all', 'companyId=', `companyId=${'x'.repeat(241)}`, `search=${'x'.repeat(121)}`])('rejects invalid GET %s', async query => {
    const response = await get(`?${query}`);
    expect(response.status).toBe(400);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it('forwards the flat command and measured private responses', async () => {
    const result = { ok: true, confirmed: 1 };
    mocks.gateway.mockResolvedValue(result);
    const response = await POST(post(command));
    const { action, ...payload } = command;
    expect(mocks.gateway).toHaveBeenCalledWith('manager@example.test', action, payload);
    expect(await response.json()).toEqual(result);
    for (const measured of [response, await get()]) {
      expect(measured.headers.get('cache-control')).toBe('private, no-store');
      expect(measured.headers.has('server-timing')).toBe(true);
      expect(measured.headers.has('x-stockflow-response-bytes')).toBe(true);
    }
  });
  it('rejects nested commands, malformed JSON and oversized bodies', async () => {
    expect((await POST(post({ action: command.action, payload: command }))).status).toBe(400);
    expect((await POST(new Request('https://example.test/api/customer-links', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' }))).status).toBe(400);
    expect((await POST(post({ padding: 'x'.repeat(32_768) }))).status).toBe(413);
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it.each([400, 403, 409])('preserves gateway status %i and private error responses', async status => {
    mocks.gateway.mockRejectedValue(new OrderGatewayError('Source changed', status));
    for (const response of [await get(), await POST(post(command))]) {
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error: 'Source changed' });
      expect(response.headers.get('cache-control')).toBe('private, no-store');
    }
  });
  it('maps unexpected failures on both methods to a private 502', async () => {
    mocks.gateway.mockRejectedValue(new Error('internal detail'));
    for (const response of [await get(), await POST(post(command))]) {
      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({ error: 'Customer links are temporarily unavailable' });
      expect(response.headers.get('cache-control')).toBe('private, no-store');
    }
  });
});
