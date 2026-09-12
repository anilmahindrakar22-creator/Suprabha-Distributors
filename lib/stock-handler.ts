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

export function createStockHandler<User>({
  endpoint,
  fetchFn,
  getUser,
  hasAccess,
  readKey,
}: StockHandlerDependencies<User>): () => Promise<Response> {
  return async function getStock(): Promise<Response> {
    const user = await getUser();
    if (!user) return errorResponse('Sign in required', 401);
    if (!(await hasAccess(user))) return errorResponse('Access denied', 403);

    const key = readKey();
    if (!key) return errorResponse('Stock service is not configured', 503);

    try {
      const response = await fetchFn(endpoint, {
        cache: 'no-store',
        headers: { 'x-dashboard-key': key },
      });

      const text = await response.text();
      let body = text;
      try { body = JSON.stringify(sanitizeStockPayload(JSON.parse(text))); } catch { /* Preserve controlled upstream non-JSON errors. */ }
      return new Response(body, {
        status: response.status,
        headers: privateJsonHeaders,
      });
    } catch {
      return errorResponse('Stock service is temporarily unavailable', 502);
    }
  };
}
