type StockHandlerDependencies<User> = {
  endpoint: string | (() => string | undefined);
  fetchFn: typeof fetch;
  getUser: () => Promise<User | null>;
  hasAccess: (user: User) => boolean | Promise<boolean>;
  readKey: () => string | undefined;
};

const privateJsonHeaders = {
  'cache-control': 'private, no-store',
  'content-type': 'application/json; charset=utf-8',
};

type StockResult = { body: string; status: number; timing?: string };

// Reconstruct the known numeric metrics; never proxy descriptions or arbitrary headers.
function syncTiming(value: string | null): string | undefined {
  const match = value?.match(/^stockflow;dur=(\d{1,6}\.\d), database;dur=(\d{1,6}\.\d)$/);
  return match ? `sync;dur=${match[1]}, database;dur=${match[2]}` : undefined;
}

function errorResponse(error: string, status: number): Response {
  return Response.json(
    { error },
    { status, headers: { 'cache-control': 'private, no-store' } },
  );
}

const restrictedCommercialKeys = new Set([
  'pricingHistory', 'rate', 'invoiceRate', 'approvedRate', 'proposedRate', 'recentRates',
  'cost', 'costAmount', 'purchaseCost', 'landedCost', 'grossProfit', 'grossMargin',
  'margin', 'marginErosion', 'suggestion', 'suggestedPrice', 'discount',
]);

export function sanitizeStockPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeStockPayload);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).flatMap(([key, child]) =>
    restrictedCommercialKeys.has(key) ? [] : [[key, sanitizeStockPayload(child)]],
  ));
}

const dashboardStockFields = new Set([
  'company', 'fetchedAt', 'fetchedAtShort', 'fetchedAtIso', 'sourceFetchedAtIso',
  'supplyHistoryFrom', 'supplyHistoryTo', 'supplyHistoryRange', 'rows', 'groups',
]);

function projectDashboardStockPayload(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key]) => dashboardStockFields.has(key)));
}

export function createStockHandler<User>({
  endpoint,
  fetchFn,
  getUser,
  hasAccess,
  readKey,
}: StockHandlerDependencies<User>): (request?: Request) => Promise<Response> {
  // Coalesce reads for each view's current credential in this handler instance. No settled
  // responses are cached; every caller still passes its own authorization check.
  const inFlight = new Map<string, { key: string; result: Promise<StockResult> }>();
  return async function getStock(request?: Request): Promise<Response> {
    const startedAt = performance.now();
    const user = await getUser();
    if (!user) return errorResponse('Sign in required', 401);
    if (!(await hasAccess(user))) return errorResponse('Access denied', 403);

    const key = readKey();
    const resolvedEndpoint = typeof endpoint === 'function' ? endpoint() : endpoint;
    if (!key || !resolvedEndpoint) return errorResponse('Stock service is not configured', 503);

    try {
      const dashboardView = request && new URL(request.url).searchParams.get('view') === 'dashboard';
      const upstream = new URL(resolvedEndpoint);
      if (dashboardView) upstream.searchParams.set('view', 'dashboard');
      const view = upstream.toString();
      let entry = inFlight.get(view);
      if (!entry || entry.key !== key) {
        const result = (async () => {
          const response = await fetchFn(upstream.toString(), {
            cache: 'no-store',
            headers: { 'x-dashboard-key': key },
            signal: AbortSignal.timeout(15_000),
          });
          if (!response.ok) {
            // Database/gateway error bodies can contain commercial values or credentials.
            // Never forward them to operational users, even when they are valid JSON.
            await response.body?.cancel();
            return { body: JSON.stringify({ error: 'Stock service is temporarily unavailable' }), status: response.status };
          }
          const parsed = await response.json();
          if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed) || 'error' in parsed) throw new Error('Invalid snapshot response');
          // Missing source collections are not evidence of zero stock. Reject them
          // so the dashboard can retain its last valid offline snapshot instead.
          const snapshot = parsed as Record<string, unknown>;
          if (dashboardView && (!Array.isArray(snapshot.rows) || !Array.isArray(snapshot.groups)
            || !snapshot.groups.every((group: unknown) => typeof group === 'string')
            || !snapshot.rows.every((row: unknown) => row !== null && typeof row === 'object'
              && !Array.isArray(row) && 'item' in row && typeof row.item === 'string'))) {
            throw new Error('Invalid dashboard snapshot');
          }
          const projected = dashboardView ? projectDashboardStockPayload(parsed) : parsed;
          return { body: JSON.stringify(sanitizeStockPayload(projected)), status: response.status, timing: syncTiming(response.headers.get('server-timing')) };
        })();
        entry = { key, result };
        inFlight.set(view, entry);
      }
      let result: StockResult;
      try { result = await entry.result; }
      finally { if (inFlight.get(view) === entry) inFlight.delete(view); }
      return new Response(result.body, {
        status: result.status,
        headers: {
          ...privateJsonHeaders,
          'server-timing': `stockflow;dur=${Math.max(0, performance.now() - startedAt).toFixed(1)}${result.timing ? `, ${result.timing}` : ''}`,
        },
      });
    } catch {
      return errorResponse('Stock service is temporarily unavailable', 502);
    }
  };
}
