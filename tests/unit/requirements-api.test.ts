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
it.each(['cover', 'on_po', 'late_pos', 'reorder_check', 'forecast_trial'])('reads stock %s without pagination', async (view) => {
  const response = await GET(new Request(`http://local/api/requirements?view=${view}`));
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(JSON.parse(network.mock.calls[0][1]?.body as string)).toEqual({ actorEmail: 'sales@example.test', action: 'get_requirements', payload: { view } });
});
it.each(['Diasys / reagent & kit', 'Diasys kit '])('reads item detail with the exact key %j and never the waiting-order action', async (itemKey) => {
  const detail = { view: 'item_detail', itemKey, months: [] };
  network.mockResolvedValueOnce(Response.json(detail));
  const response = await GET(new Request(`http://local/api/requirements?view=item_detail&itemKey=${encodeURIComponent(itemKey)}`));
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(await response.json()).toEqual(detail);
  expect(network).toHaveBeenCalledTimes(1);
  expect(JSON.parse(network.mock.calls[0][1]?.body as string)).toEqual({ actorEmail: 'sales@example.test', action: 'get_requirements', payload: { view: 'item_detail', itemKey } });
});
it.each([
  'view=item_detail',
  'view=item_detail&itemKey=',
  'view=item_detail&itemKey=%20%20',
  `view=item_detail&itemKey=${'x'.repeat(221)}`,
  'view=item_detail&itemKey=kit&page=1',
  'view=item_detail&itemKey=kit&page=0',
  'view=item_detail&itemKey=kit&extra=1',
])('rejects invalid item-detail query %s', async (query) => {
  const response = await GET(new Request(`http://local/api/requirements?${query}`));
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: 'Invalid requirements view' });
  expect(network).not.toHaveBeenCalled();
});
it.each(['view=reorder_check&page=1', 'view=forecast_trial&page=1', 'view=late_pos&page=1', 'view=on_po&page=1', 'view=cover&page=1', 'view=cover&alerts=1', 'view=cover&itemKey=kit', 'view=cover&extra=1', 'view=forecast_trial&extra=1', 'view=other'])('rejects invalid cover/view query %s', async (query) => {
  expect((await GET(new Request(`http://local/api/requirements?${query}`))).status).toBe(400);
  expect(network).not.toHaveBeenCalled();
});
it('keeps the paginated to-order contract', async () => {
  expect((await GET(new Request('http://local/api/requirements?view=to_order&page=2'))).status).toBe(200);
  expect(JSON.parse(network.mock.calls[0][1]?.body as string)).toEqual({ actorEmail: 'sales@example.test', action: 'get_requirements', payload: { page: 2, view: 'to_order' } });
});
it('reads the paginated idle view for the authenticated actor', async () => {
  const response = await GET(new Request('http://local/api/requirements?view=idle&page=2'));
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(JSON.parse(network.mock.calls[0][1]?.body as string)).toEqual({ actorEmail: 'sales@example.test', action: 'get_requirements', payload: { view: 'idle', page: 2 } });
});
it('reads idle buyers with the exact item key', async () => {
  const itemKey = 'Reagent / X & kit ';
  expect((await GET(new Request('http://local/api/requirements?view=idle_buyers&itemKey=' + encodeURIComponent(itemKey)))).status).toBe(200);
  expect(JSON.parse(network.mock.calls[0][1]?.body as string)).toEqual({
    actorEmail: 'sales@example.test', action: 'get_requirements', payload: { view: 'idle_buyers', itemKey },
  });
});
it.each(['view=idle_buyers', 'view=idle_buyers&itemKey=X&page=1', 'view=idle_buyers&itemKey=%20%20', 'view=idle_buyers&itemKey=' + 'x'.repeat(221)])('rejects invalid idle buyers query %s', async query => {
  expect((await GET(new Request('http://local/api/requirements?' + query))).status).toBe(400);
  expect(network).not.toHaveBeenCalled();
});
it.each(['view=idle&page=0', 'view=idle&page=101', 'view=idle', 'view=idle&page=1&itemKey=kit', 'view=idle&page=1.5', 'view=idle&page='])('rejects invalid idle query %s', async (query) => {
  expect((await GET(new Request(`http://local/api/requirements?${query}`))).status).toBe(400);
  expect(network).not.toHaveBeenCalled();
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
it('reads operational alerts for the authenticated actor', async () => {
  expect((await GET(new Request('http://local/api/requirements?alerts=1&page=2'))).status).toBe(200);
  expect(JSON.parse(network.mock.calls[0][1]?.body as string)).toEqual({ actorEmail: 'sales@example.test', action: 'get_stock_alerts', payload: { page: 2 } });
});
it.each(['alerts=0','alerts=1&itemKey=kit'])('rejects ambiguous alert query %s', async (query) => {
  expect((await GET(new Request(`http://local/api/requirements?${query}`))).status).toBe(400);
  expect(network).not.toHaveBeenCalled();
});
