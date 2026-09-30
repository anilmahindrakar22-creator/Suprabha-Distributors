type StockHandlerDependencies<User> = {
  endpoint: string;
  fetchFn: typeof fetch;
  getUser: () => Promise<User | null>;
  hasAccess: (user: User) => boolean | Promise<boolean>;
  readKey: () => string | undefined;
};

const privateJsonHeaders = {
  'cache-control': 'private, no-store',
  'content-type': 'application/json; charset=utf-8',
};

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
  const inFlight = new Map<string, { key: string; result: Promise<{ body: string; status: number }> }>();
  return async function getStock(request?: Request): Promise<Response> {
    const user = await getUser();
    if (!user) return errorResponse('Sign in required', 401);
    if (!(await hasAccess(user))) return errorResponse('Access denied', 403);

    const key = readKey();
    if (!key) return errorResponse('Stock service is not configured', 503);

    try {
      const dashboardView = request && new URL(request.url).searchParams.get('view') === 'dashboard';
      const upstream = new URL(endpoint);
      if (dashboardView) upstream.searchParams.set('view', 'dashboard');
      const view = dashboardView ? 'dashboard' : 'legacy';
      let entry = inFlight.get(view);
      if (!entry || entry.key !== key) {
        const result = (async () => {
          const response = await fetchFn(upstream.toString(), {
            cache: 'no-store',
            headers: { 'x-dashboard-key': key },
            signal: AbortSignal.timeout(15_000),
          });
          const text = await response.text();
          let body = text;
          try {
            const parsed = JSON.parse(text);
            const projected = response.ok && dashboardView ? projectDashboardStockPayload(parsed) : parsed;
            body = JSON.stringify(sanitizeStockPayload(projected));
          } catch { /* Preserve controlled upstream non-JSON errors. */ }
          return { body, status: response.status };
        })();
        entry = { key, result };
        inFlight.set(view, entry);
      }
      let result: { body: string; status: number };
      try { result = await entry.result; }
      finally { if (inFlight.get(view) === entry) inFlight.delete(view); }
      return new Response(result.body, {
        status: result.status,
        headers: privateJsonHeaders,
      });
    } catch {
      return errorResponse('Stock service is temporarily unavailable', 502);
    }
  };
}
