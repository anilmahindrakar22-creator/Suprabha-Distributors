import { readBoundedJson } from '../stockflow-orders/request-gate.ts';

const headers = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'private, no-store',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type, x-dashboard-key, x-upload-key',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
const dashboardFields = [
  'company', 'fetchedAt', 'fetchedAtShort', 'fetchedAtIso', 'sourceFetchedAtIso',
  'supplyHistoryFrom', 'supplyHistoryTo', 'supplyHistoryRange', 'rows', 'groups',
];

type Dependencies = {
  env: (name: string) => string | undefined;
  fetchFn: typeof fetch;
};

export function createSyncHandler({ env, fetchFn }: Dependencies) {
  return async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') return new Response('ok', { headers });
    if (request.method !== 'GET' && request.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
    const reading = request.method === 'GET';
    const key = env(reading ? 'STOCKFLOW_READ_KEY' : 'STOCKFLOW_UPLOAD_KEY');
    if (!key) return reply({ error: 'Stock service is not configured' }, 503);
    if (request.headers.get(reading ? 'x-dashboard-key' : 'x-upload-key') !== key) return reply({ error: 'Unauthorized' }, 401);

    try {
      // Match the Orders function: modern backend secrets go in apikey, never a JWT header.
      const url = env('SUPABASE_URL');
      const secrets = env('SUPABASE_SECRET_KEYS');
      const secret = secrets ? (JSON.parse(secrets) as Record<string, string>).stockflowedge : undefined;
      if (!url || !secret) return reply({ error: 'Stock service is not configured' }, 503);
      const target = new URL(`${url}/rest/v1/stockflow_snapshots`);
      if (reading) {
        const dashboard = new URL(request.url).searchParams.get('view') === 'dashboard';
        // Project inside Postgres/PostgREST, not after transferring the full JSON snapshot.
        target.searchParams.set('select', dashboard
          ? [...dashboardFields.map(field => `${field}:payload->${field}`), 'cloudUpdatedAt:updated_at'].join(',')
          : 'payload,updated_at');
        target.searchParams.set('id', 'eq.suprabha');
        target.searchParams.set('limit', '1');
        const response = await fetchFn(target.toString(), { headers: { apikey: secret }, cache: 'no-store', signal: AbortSignal.timeout(10_000) });
        if (!response.ok) return reply({ error: 'Unable to load snapshot' }, 500);
        const rows = await response.json() as Record<string, unknown>[];
        if (!rows.length) return reply({ error: 'No snapshot has been uploaded yet' }, 404);
        return dashboard ? reply(rows[0]) : reply({ ...rows[0].payload as Record<string, unknown>, cloudUpdatedAt: rows[0].updated_at });
      }

      let payload: Record<string, unknown>;
      try { payload = await readBoundedJson(request, 8 * 1024 * 1024) as typeof payload; }
      catch (error) { return reply({ error: error instanceof RangeError ? 'Snapshot is too large' : 'Invalid JSON' }, error instanceof RangeError ? 413 : 400); }
      if (!payload || !Array.isArray(payload.rows) || !Array.isArray(payload.groups) || typeof payload.company !== 'string') return reply({ error: 'Invalid snapshot' }, 400);
      if (payload.fetchedAt != null && typeof payload.fetchedAt !== 'string') return reply({ error: 'Invalid snapshot' }, 400);
      const fetchedAt = typeof payload.fetchedAt === 'string' ? payload.fetchedAt : new Date().toISOString();
      // Existing single-row atomic upsert and import triggers remain the write boundary.
      target.searchParams.set('on_conflict', 'id');
      const response = await fetchFn(target.toString(), {
        method: 'POST',
        signal: AbortSignal.timeout(10_000),
        headers: { apikey: secret, 'content-type': 'application/json', prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ id: 'suprabha', company: payload.company, fetched_at: fetchedAt, payload, updated_at: new Date().toISOString() }),
      });
      return response.ok ? reply({ ok: true }) : reply({ error: 'Unable to save snapshot' }, 500);
    } catch {
      return reply({ error: 'Stock service is temporarily unavailable' }, 502);
    }
  };
}
