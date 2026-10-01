import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const identity = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock('next/headers', () => ({ headers: async () => identity.headers }));

import { GET, POST } from '../../app/api/product-requests/route';

const network = vi.fn<typeof fetch>();
const requestId = '22222222-2222-4222-8222-222222222222';
const idempotencyKey = '11111111-1111-4111-8111-111111111111';
const jsonRequest = (body: unknown) => new Request('http://local/api/product-requests', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

beforeEach(() => {
  identity.headers = new Headers({ 'oai-authenticated-user-id': 'test-account', 'oai-authenticated-user-email': 'sales@example.test' });
  vi.stubEnv('SUPABASE_URL', 'https://gateway.example.test');
  vi.stubEnv('STOCKFLOW_ORDER_GATEWAY_KEY', 'test-only-key');
  vi.stubGlobal('fetch', network);
  network.mockReset();
  network.mockResolvedValue(Response.json({ ok: true }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('product requests API boundary', () => {
  it('denies unauthenticated reads and writes without contacting the gateway', async () => {
    identity.headers = new Headers();
    expect((await GET()).status).toBe(401);
    expect((await POST(jsonRequest({ action: 'create_product_request', payload: {} }))).status).toBe(401);
    expect(network).not.toHaveBeenCalled();
  });

  it('lists through the read-only gateway action with private no-store caching', async () => {
    const result = await GET();
    expect(result.status).toBe(200);
    expect(JSON.parse(network.mock.calls[0][1]?.body as string)).toEqual({ actorEmail: 'sales@example.test', action: 'list_product_requests', payload: {} });
    expect(result.headers.get('cache-control')).toBe('private, no-store');
  });

  it.each([
    { action: 'unknown', payload: {} },
    { action: 'create_product_request', payload: { idempotencyKey: 'bad', productName: 'New item' } },
    { action: 'create_product_request', payload: { idempotencyKey, productName: 'New item', extra: true } },
    { action: 'review_product_request', payload: { idempotencyKey, requestId, expectedVersion: 1, status: 'open', resolution: 'Done' } },
    { action: 'review_product_request', payload: { idempotencyKey, requestId, expectedVersion: 0, status: 'resolved', resolution: 'Done' } },
    { action: 'review_product_request', payload: { idempotencyKey, requestId, expectedVersion: 1, status: 'resolved', resolution: 'Done', actorEmail: 'attacker@example.test' } },
  ])('rejects malformed or unapproved payloads before gateway call', async body => {
    expect((await POST(jsonRequest(body))).status).toBe(400);
    expect(network).not.toHaveBeenCalled();
  });

  it('forwards valid create data with the authenticated server actor', async () => {
    const response = await POST(jsonRequest({
      action: 'create_product_request',
      payload: { idempotencyKey, productName: '  New item  ', details: '  A bounded request  ', customerId: requestId },
    }));
    expect(response.status).toBe(200);
    expect(JSON.parse(network.mock.calls[0][1]?.body as string)).toEqual({
      actorEmail: 'sales@example.test', action: 'create_product_request',
      payload: { idempotencyKey, productName: 'New item', details: 'A bounded request', customerId: requestId },
    });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it('forwards valid review data and preserves database role denials', async () => {
    network.mockResolvedValue(Response.json({ code: '42501', message: 'Role cannot review product requests' }, { status: 403 }));
    const response = await POST(jsonRequest({
      action: 'review_product_request',
      payload: { idempotencyKey, requestId, expectedVersion: 2, status: 'rejected', resolution: '  Duplicate item  ' },
    }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Role cannot review product requests' });
    expect(JSON.parse(network.mock.calls[0][1]?.body as string)).toEqual({
      actorEmail: 'sales@example.test', action: 'review_product_request',
      payload: { idempotencyKey, requestId, expectedVersion: 2, status: 'rejected', resolution: 'Duplicate item' },
    });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it('does not expose unexpected gateway failures', async () => {
    network.mockRejectedValue(new Error('internal service detail'));
    const response = await GET();
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'Product request service is temporarily unavailable' });
  });
});
