import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ user: vi.fn(), gateway: vi.fn() }));
vi.mock('@/app/chatgpt-auth', () => ({ getChatGPTUser: mocks.user }));
vi.mock('@/lib/order-gateway', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/order-gateway')>(), callOrderGateway: mocks.gateway }));
import { GET, POST, DELETE } from '@/app/api/push-subscription/route';
import { OrderGatewayError } from '@/lib/order-gateway';

const endpoint = 'https://push.example.test/device';
const keys = { p256dh: 'B'.repeat(87), auth: 'A'.repeat(22) };
const request = (method: string, body: unknown) => new Request('https://example.test/api/push-subscription', { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('STOCKFLOW_PUSH_PUBLIC_KEY', '');
  mocks.user.mockResolvedValue({ email: 'staff@example.test' });
  mocks.gateway.mockResolvedValue({ enabled: true });
});
afterEach(() => vi.unstubAllEnvs());

describe('push subscription API', () => {
  it('stays dormant without a public key', async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ enabled: false, publicKey: null });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.gateway).toHaveBeenCalledWith('staff@example.test', 'push_config', {});
  });
  it('enables only with a valid key and enabled server config', async () => {
    const publicKey = 'B'.repeat(87);
    vi.stubEnv('STOCKFLOW_PUSH_PUBLIC_KEY', publicKey);
    expect(await (await GET()).json()).toEqual({ enabled: true, publicKey });
    mocks.gateway.mockResolvedValue({ enabled: false });
    expect(await (await GET()).json()).toEqual({ enabled: false, publicKey });
  });
  it.each(['short', 'B'.repeat(101), '+'.repeat(87)])('rejects malformed public key %#', async publicKey => {
    vi.stubEnv('STOCKFLOW_PUSH_PUBLIC_KEY', publicKey);
    expect(await (await GET()).json()).toEqual({ enabled: false, publicKey: null });
  });
  it('fails dormant for missing authentication and gateway errors', async () => {
    mocks.user.mockResolvedValue(null);
    expect(await (await GET()).json()).toEqual({ enabled: false, publicKey: null });
    expect(mocks.gateway).not.toHaveBeenCalled();
    mocks.user.mockResolvedValue({ email: 'staff@example.test' });
    mocks.gateway.mockRejectedValue(new OrderGatewayError('Forbidden', 403));
    expect((await GET()).status).toBe(200);
    expect(await (await GET()).json()).toEqual({ enabled: false, publicKey: null });
  });
  it.each([
    { endpoint: 'http://push.example.test/device', keys },
    { endpoint: 'https://', keys },
    { endpoint: `https://push.example.test/${'x'.repeat(2048)}`, keys },
    { endpoint, keys: { ...keys, p256dh: 'A'.repeat(201) } },
    { endpoint, keys: { ...keys, auth: 'A'.repeat(201) } },
    { endpoint, keys: { ...keys, auth: 'bad+' } },
    { endpoint, keys, userAgent: 123 },
    null,
  ])('rejects invalid POST %#', async body => {
    expect((await POST(request('POST', body))).status).toBe(400);
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it('subscribes as the session user, truncates the label and never echoes subscription material', async () => {
    mocks.gateway.mockResolvedValue({ ok: true, endpoint, keys });
    const response = await POST(request('POST', { endpoint, keys, userAgent: 'x'.repeat(250), actorEmail: 'other@example.test' }));
    expect(mocks.gateway).toHaveBeenCalledWith('staff@example.test', 'push_subscribe', { endpoint, keys, userAgent: 'x'.repeat(200) });
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });
  it('passes DELETE endpoint under the current session, returning only the removal count', async () => {
    mocks.gateway.mockResolvedValue({ ok: true, removed: 1, endpoint, keys });
    const response = await DELETE(request('DELETE', { endpoint }));
    expect(mocks.gateway).toHaveBeenCalledWith('staff@example.test', 'push_unsubscribe', { endpoint });
    expect(await response.json()).toEqual({ ok: true, removed: 1 });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });
  it('rejects invalid DELETE endpoints', async () => {
    expect((await DELETE(request('DELETE', { endpoint: 'http://push.example.test/device' }))).status).toBe(400);
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it('requires authentication for mutations', async () => {
    mocks.user.mockResolvedValue(null);
    expect((await POST(request('POST', { endpoint, keys }))).status).toBe(401);
    expect((await DELETE(request('DELETE', { endpoint }))).status).toBe(401);
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it('bounds JSON bodies and rejects invalid JSON and content types', async () => {
    expect((await POST(request('POST', { padding: 'x'.repeat(8192) }))).status).toBe(413);
    expect((await POST(new Request('https://example.test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' }))).status).toBe(400);
    expect((await DELETE(new Request('https://example.test', { method: 'DELETE', body: '{}' }))).status).toBe(415);
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it.each([403, 409, 429])('preserves gateway error status %i', async status => {
    mocks.gateway.mockRejectedValue(new OrderGatewayError('Request failed', status));
    expect((await POST(request('POST', { endpoint, keys }))).status).toBe(status);
  });
  it('maps unexpected errors to a generic service error', async () => {
    mocks.gateway.mockRejectedValue(new Error('internal detail'));
    const response = await DELETE(request('DELETE', { endpoint }));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'Push service is temporarily unavailable' });
  });
});
