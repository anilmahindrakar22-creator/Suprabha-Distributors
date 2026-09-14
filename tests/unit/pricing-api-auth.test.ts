import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const identity = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock('next/headers', () => ({ headers: async () => identity.headers }));
import { GET, POST } from '../../app/api/pricing/route';

const network = vi.fn<typeof fetch>();
const key = '11111111-1111-4111-8111-111111111111';
beforeEach(() => {
  identity.headers = new Headers({ 'oai-authenticated-user-id': 'test-account', 'oai-authenticated-user-email': 'accounts@example.test' });
  vi.stubEnv('SUPABASE_URL', 'https://gateway.example.test');
  vi.stubEnv('STOCKFLOW_ORDER_GATEWAY_KEY', 'test-only-key');
  vi.stubGlobal('fetch', network);
  network.mockReset();
  network.mockResolvedValue(Response.json({ status: 'accepted' }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('authenticated pricing API boundary (gateway responses simulated)', () => {
  it('denies unauthenticated reads and writes without contacting the gateway', async () => {
    identity.headers = new Headers();
    expect((await GET(new Request('http://local/api/pricing?policies=1'))).status).toBe(401);
    expect((await POST(new Request('http://local/api/pricing', { method: 'POST', body: '{}' }))).status).toBe(401);
    expect(network).not.toHaveBeenCalled();
  });
  it.each(['accounts@example.test', 'admin@example.test', 'management@example.test'])('uses trusted identity for %s, not a query impersonation', async email => {
    identity.headers.set('oai-authenticated-user-email', email);
    const result = await GET(new Request('http://local/api/pricing?contracts=1&actorEmail=other@example.test'));
    expect(result.status).toBe(200);
    const body = JSON.parse(network.mock.calls[0][1]?.body as string);
    expect(body.actorEmail).toBe(email);
    expect(body.action).toBe('list_price_contracts');
    expect(result.headers.get('cache-control')).toBe('private, no-store');
  });
  it.each(['sales', 'warehouse', 'viewer'])('preserves server denial for %s without returning pricing', async role => {
    identity.headers.set('oai-authenticated-user-email', `${role}@example.test`);
    network.mockResolvedValue(Response.json({ code: '42501', message: 'Pricing access denied' }, { status: 403 }));
    const result = await GET(new Request('http://local/api/pricing?policies=1'));
    expect(result.status).toBe(403);
    expect(await result.json()).toEqual({ error: 'Pricing access denied' });
    expect(result.headers.get('cache-control')).toBe('private, no-store');
  });
  it('rejects malformed recovery requests before contacting the gateway', async () => {
    expect((await GET(new Request('http://local/api/pricing?recoveryKey=bad&pricingAction=create_pricing_policy'))).status).toBe(400);
    expect(network).not.toHaveBeenCalled();
  });
  it('keeps recovery GET read-only even if a close flag is supplied', async () => {
    await GET(new Request(`http://local/api/pricing?recoveryKey=${key}&pricingAction=create_pricing_policy&closeUnresolved=true`));
    expect(JSON.parse(network.mock.calls[0][1]?.body as string).payload).toEqual({ idempotencyKey: key, pricingAction: 'create_pricing_policy' });
  });
  it('allows explicit close POST only for the signed-in actor and approved action', async () => {
    const result = await POST(new Request('http://local/api/pricing', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'close_unresolved_pricing', payload: { idempotencyKey: key, pricingAction: 'create_price_contract', actorEmail: 'other@example.test' } }) }));
    expect(result.status).toBe(200);
    expect(JSON.parse(network.mock.calls[0][1]?.body as string)).toEqual({ actorEmail: 'accounts@example.test', action: 'recover_order_submission', payload: { idempotencyKey: key, pricingAction: 'create_price_contract', closeUnresolved: true } });
  });
  it('does not leak unexpected internal error details', async () => {
    network.mockRejectedValue(new Error('restricted rate 720 internal failure'));
    const result = await GET(new Request('http://local/api/pricing?policies=1'));
    expect(result.status).toBe(502);
    expect(await result.json()).toEqual({ error: 'Pricing service is temporarily unavailable' });
  });
});
