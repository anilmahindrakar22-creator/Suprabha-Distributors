import { describe, expect, it, vi } from 'vitest';
import { createSyncHandler } from '../../supabase/functions/stockflow-sync/handler';

const validPayload = { company: 'TEST', fetchedAt: '2026-09-30', rows: [{ item: 'Kit' }], groups: ['Sysmex'] };
const databaseUrl = 'https://database.example';
const databaseSecret = 'test-secret';

function makeHandler(options: {
  env?: Record<string, string | undefined>;
  fetchFn?: typeof fetch;
} = {}) {
  const values = {
    STOCKFLOW_READ_KEY: 'read-key',
    STOCKFLOW_UPLOAD_KEY: 'upload-key',
    SUPABASE_URL: databaseUrl,
    SUPABASE_SECRET_KEYS: JSON.stringify({ stockflowedge: databaseSecret }),
    ...options.env,
  };
  const env = (name: string) => values[name as keyof typeof values];
  const fetchFn = options.fetchFn ?? vi.fn(async () => Response.json([]));
  return { handler: createSyncHandler({ env, fetchFn }), fetchFn };
}

function getRequest(url = 'https://edge.example/stockflow-sync', key?: string) {
  return new Request(url, { headers: key ? { 'x-dashboard-key': key } : undefined });
}

function postRequest(body: string, key?: string, headers: HeadersInit = {}) {
  return new Request('https://edge.example/stockflow-sync', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(key ? { 'x-upload-key': key } : {}), ...headers },
    body,
  });
}

describe('Stockflow sync edge handler', () => {
  it.each([
    ['GET', getRequest()],
    ['POST', postRequest(JSON.stringify(validPayload))],
  ] as const)('rejects unauthenticated %s before any database request', async (_method, request) => {
    const { handler, fetchFn } = makeHandler();
    const response = await handler(request);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it.each([
    ['read key', { STOCKFLOW_READ_KEY: undefined }, getRequest('https://edge.example/stockflow-sync', 'read-key')],
    ['upload key', { STOCKFLOW_UPLOAD_KEY: undefined }, postRequest(JSON.stringify(validPayload), 'upload-key')],
    ['database URL', { SUPABASE_URL: undefined }, getRequest('https://edge.example/stockflow-sync', 'read-key')],
    ['database secret', { SUPABASE_SECRET_KEYS: undefined }, postRequest(JSON.stringify(validPayload), 'upload-key')],
  ] as const)('fails closed when the %s is missing', async (_name, env, request) => {
    const { handler, fetchFn } = makeHandler({ env });
    const response = await handler(request);

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'Stock service is not configured' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('projects only dashboard fields in the PostgREST select', async () => {
    const { handler, fetchFn } = makeHandler();
    const response = await handler(getRequest('https://edge.example/stockflow-sync?view=dashboard', 'read-key'));

    expect(response.status).toBe(404);
    const [url] = vi.mocked(fetchFn).mock.calls[0];
    const target = new URL(url as string);
    expect(target.searchParams.get('select')).toBe([
      'company:payload->company', 'fetchedAt:payload->fetchedAt', 'fetchedAtShort:payload->fetchedAtShort',
      'fetchedAtIso:payload->fetchedAtIso', 'sourceFetchedAtIso:payload->sourceFetchedAtIso',
      'supplyHistoryFrom:payload->supplyHistoryFrom', 'supplyHistoryTo:payload->supplyHistoryTo',
      'supplyHistoryRange:payload->supplyHistoryRange', 'rows:payload->rows', 'groups:payload->groups',
      'cloudUpdatedAt:updated_at',
    ].join(','));
    expect(target.searchParams.get('select')).not.toMatch(/payload(?:,|$)|catalog|customers|pricingHistory/);
  });

  it('returns the projected snapshot with source freshness and private caching', async () => {
    const dashboard = { ...validPayload, sourceFetchedAtIso: { stock: '2026-09-30T12:00:00Z' }, cloudUpdatedAt: '2026-09-30T12:01:00Z' };
    const { handler } = makeHandler({ fetchFn: vi.fn(async () => Response.json([dashboard])) });
    const response = await handler(getRequest('https://edge.example/stockflow-sync?view=dashboard', 'read-key'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(dashboard);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it.each(['GET', 'POST'])('rejects a wrong credential on %s without database work', async method => {
    const { handler, fetchFn } = makeHandler();
    const response = await handler(method === 'GET' ? getRequest('https://edge.example/stockflow-sync', 'wrong-key') : postRequest(JSON.stringify(validPayload), 'wrong-key'));
    expect(response.status).toBe(401);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('keeps the default GET response and database query compatible with legacy clients', async () => {
    const payload = { ...validPayload, catalog: [{ item: 'Catalog only' }], pricingHistory: { internal: true } };
    const fetchFn = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json([{ payload, updated_at: '2026-09-30T12:00:00Z' }]));
    const { handler } = makeHandler({ fetchFn });
    const response = await handler(getRequest('https://edge.example/stockflow-sync', 'read-key'));

    expect(await response.json()).toEqual({ ...payload, cloudUpdatedAt: '2026-09-30T12:00:00Z' });
    const [url] = fetchFn.mock.calls[0];
    expect(new URL(url as string).searchParams.get('select')).toBe('payload,updated_at');
  });

  it('hides database error details and returns a controlled 404 for an absent snapshot', async () => {
    const failed = makeHandler({ fetchFn: vi.fn(async () => Response.json({ message: 'secret database detail' }, { status: 500 })) });
    const failedResponse = await failed.handler(getRequest('https://edge.example/stockflow-sync', 'read-key'));
    expect(failedResponse.status).toBe(500);
    expect(await failedResponse.json()).toEqual({ error: 'Unable to load snapshot' });

    const missing = makeHandler({ fetchFn: vi.fn(async () => Response.json([])) });
    const missingResponse = await missing.handler(getRequest('https://edge.example/stockflow-sync', 'read-key'));
    expect(missingResponse.status).toBe(404);
    expect(await missingResponse.json()).toEqual({ error: 'No snapshot has been uploaded yet' });
  });

  it('writes one atomic merge upsert with the expected row and conflict semantics', async () => {
    const fetchFn = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(null, { status: 204 }));
    const { handler } = makeHandler({ fetchFn });
    const response = await handler(postRequest(JSON.stringify(validPayload), 'upload-key'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0];
    const target = new URL(url as string);
    expect(target.searchParams.get('on_conflict')).toBe('id');
    expect(init).toMatchObject({
      method: 'POST',
      headers: {
        apikey: databaseSecret,
        'content-type': 'application/json',
        prefer: 'resolution=merge-duplicates,return=minimal',
      },
    });
    expect(JSON.parse(init?.body as string)).toMatchObject({ id: 'suprabha', company: validPayload.company, payload: validPayload });
  });

  it.each([
    ['malformed JSON', '{'],
    ['invalid snapshot shape', JSON.stringify({ company: 'TEST', rows: [], groups: 'invalid' })],
    ['invalid fetched-at type', JSON.stringify({ ...validPayload, fetchedAt: { unexpected: true } })],
  ])('rejects %s with a controlled response', async (_case, body) => {
    const { handler, fetchFn } = makeHandler();
    const response = await handler(postRequest(body, 'upload-key'));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: body === '{' ? 'Invalid JSON' : 'Invalid snapshot' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('does not return database details for a failed upsert or network exception', async () => {
    const failed = makeHandler({ fetchFn: vi.fn(async () => Response.json({ message: 'private constraint details' }, { status: 409 })) });
    const failedResponse = await failed.handler(postRequest(JSON.stringify(validPayload), 'upload-key'));
    expect(failedResponse.status).toBe(500);
    expect(await failedResponse.json()).toEqual({ error: 'Unable to save snapshot' });

    const unavailable = makeHandler({ fetchFn: vi.fn(async () => { throw new Error('private connection details'); }) });
    const unavailableResponse = await unavailable.handler(postRequest(JSON.stringify(validPayload), 'upload-key'));
    expect(unavailableResponse.status).toBe(502);
    expect(await unavailableResponse.json()).toEqual({ error: 'Stock service is temporarily unavailable' });
  });

  it('rejects bodies larger than 8 MiB before contacting the database', async () => {
    const { handler, fetchFn } = makeHandler();
    const oversizedBody = `{"company":"TEST","rows":[],"groups":[],"padding":"${'x'.repeat(8 * 1024 * 1024)}"}`;
    const response = await handler(postRequest(oversizedBody, 'upload-key'));

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: 'Snapshot is too large' });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
