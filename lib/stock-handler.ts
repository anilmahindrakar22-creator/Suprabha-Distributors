type StockHandlerDependencies<User> = {
  endpoint: string;
  fetchFn: typeof fetch;
  getUser: () => Promise<User | null>;
  hasAccess: (user: User | null) => boolean;
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
    if (!hasAccess(user)) return errorResponse('Access denied', 403);

    const key = readKey();
    if (!key) return errorResponse('Stock service is not configured', 503);

    try {
      const response = await fetchFn(endpoint, {
        cache: 'no-store',
        headers: { 'x-dashboard-key': key },
      });

      return new Response(await response.text(), {
        status: response.status,
        headers: privateJsonHeaders,
      });
    } catch {
      return errorResponse('Stock service is temporarily unavailable', 502);
    }
  };
}
