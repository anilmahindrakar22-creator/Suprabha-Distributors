import { getChatGPTUser } from '@/app/chatgpt-auth';
import { getStockFlowSession } from '@/lib/stockflow-session';
import { hasAnyStockFlowRole } from '@/lib/user-types';
import { callOrderGateway, OrderGatewayError } from '@/lib/order-gateway';

const headers = { 'cache-control': 'private, no-store' };
const failure = (error: string, status: number) => Response.json({ error }, { status, headers });
const validDate = (value: unknown): value is string => typeof value === 'string'
  && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value + 'T00:00:00Z'))
  && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;

export async function POST(request: Request) {
  try {
    const user = await getChatGPTUser();
    if (!user) return failure('Sign in required', 401);
    const session = await getStockFlowSession(user.email);
    if (!session || !hasAnyStockFlowRole(session.roles, ['administrator', 'management'])) {
      return failure('Expected use is restricted', 403);
    }
    let body: unknown;
    try { body = await request.json(); } catch { return failure('Invalid expected use request', 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return failure('Invalid expected use request', 400);
    const value = body as Record<string, unknown>;
    const keys = ['requestId', 'itemKey', 'monthlyQty', 'reason', 'reviewOn'];
    if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))
      || typeof value.requestId !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.requestId)
      || typeof value.itemKey !== 'string' || !value.itemKey.trim().length || value.itemKey.length > 220
      || typeof value.monthlyQty !== 'number' || !Number.isFinite(value.monthlyQty) || value.monthlyQty <= 0 || value.monthlyQty > 1_000_000
      || typeof value.reason !== 'string' || value.reason.trim().length < 10 || value.reason.trim().length > 300
      || !validDate(value.reviewOn)) return failure('Invalid expected use request', 400);
    const result = await callOrderGateway(session.email, 'set_item_demand_estimate', value);
    return Response.json(result, { headers });
  } catch (error) {
    return error instanceof OrderGatewayError ? failure(error.message, [400, 401, 403, 409].includes(error.status) ? error.status : 502)
      : failure('Expected use is temporarily unavailable', 502);
  }
}
