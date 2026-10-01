import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const identity = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock('next/headers', () => ({ headers: async () => identity.headers }));
import { GET } from '../../app/api/requirements/route';
const network = vi.fn<typeof fetch>();
beforeEach(() => {
  identity.headers = new Headers({ 'oai-authenticated-user-id': 'test', 'oai-authenticated-user-email': 'sales@example.test' });
  vi.stubEnv('SUPABASE_URL', 'https://gateway.example.test'); vi.stubEnv('STOCKFLOW_ORDER_GATEWAY_KEY', 'test-key'); vi.stubGlobal('fetch', network);
  network.mockReset(); network.mockResolvedValue(Response.json({ rows: [] }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it('denies unauthenticated reads before gateway access', async () => {
  identity.headers = new Headers();
  expect((await GET(new Request('http://local/api/requirements'))).status).toBe(401);
  expect(network).not.toHaveBeenCalled();
});
it.each(['0','-1','1.5','4001','NaN'])('rejects invalid page %s without a query', async (page) => {
  expect((await GET(new Request(`http://local/api/requirements?page=${page}`))).status).toBe(400);
  expect(network).not.toHaveBeenCalled();
});
it('uses the authenticated actor and private read action', async () => {
  const response = await GET(new Request('http://local/api/requirements?page=2&actorEmail=attacker'));
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(JSON.parse(network.mock.calls[0][1]?.body as string)).toEqual({ actorEmail: 'sales@example.test', action: 'get_requirements', payload: { page: 2 } });
});
it('uses an exact encoded item key for the bounded waiting-order read', async () => {
  const key = 'Diasys / reagent & kit';
  const response = await GET(new Request(`http://local/api/requirements?itemKey=${encodeURIComponent(key)}&page=2&actorEmail=attacker`));
  expect(response.status).toBe(200);
  expect(JSON.parse(network.mock.calls[0][1]?.body as string)).toEqual({ actorEmail: 'sales@example.test', action: 'get_requirement_orders', payload: { page: 2, itemKey: key } });
});
it.each(['', 'x'.repeat(221)])('rejects invalid item keys before gateway access', async (key) => {
  expect((await GET(new Request(`http://local/api/requirements?itemKey=${key}`))).status).toBe(400);
  expect(network).not.toHaveBeenCalled();
});
