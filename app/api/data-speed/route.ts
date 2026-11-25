import { getChatGPTUser } from '@/app/chatgpt-auth';
import { getStockFlowSession } from '@/lib/stockflow-session';
import { hasAnyStockFlowRole } from '@/lib/user-types';
import { callOrderGateway, OrderGatewayError } from '@/lib/order-gateway';
import { normalizeDataSpeed } from '@/lib/data-speed-types';

const headers = { 'cache-control': 'private, no-store' };
const failure = (error: string, status: number) => Response.json({ error }, { status, headers });
async function actor() {
  const user = await getChatGPTUser();
  if (!user) throw new OrderGatewayError('Sign in required', 401);
  const session = await getStockFlowSession(user.email);
  if (!session || !hasAnyStockFlowRole(session.roles, ['administrator', 'management'])) throw new OrderGatewayError('Data speed is restricted', 403);
  return session;
}
export async function GET(request: Request) {
  try {
    const session = await actor();
    if (new URL(request.url).searchParams.size) return failure('Invalid data speed request', 400);
    const body: unknown = await callOrderGateway(session.email, 'get_data_speed_report', {});
    let normalized;
    try { normalized = normalizeDataSpeed(body); }
    catch { return failure('Data speed report is temporarily unavailable', 502); }
    return Response.json(normalized, { headers });
  } catch (error) {
    return error instanceof OrderGatewayError ? failure(error.message, error.status)
      : failure('Data speed report is temporarily unavailable', 502);
  }
}

export async function POST(request: Request) {
  try {
    const session = await actor();
    let body: unknown;
    try { body = await request.json(); } catch { return failure('Invalid acknowledgement request', 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return failure('Invalid acknowledgement request', 400);
    const value = body as Record<string, unknown>;
    const keys = ['action', 'requestId', 'reason', 'expectedCount', 'note'];
    if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))
      || value.action !== 'acknowledge' || typeof value.requestId !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.requestId)
      || typeof value.reason !== 'string' || !Number.isSafeInteger(value.expectedCount) || (value.expectedCount as number) <= 0
      || typeof value.note !== 'string' || value.note.trim().length < 10 || value.note.trim().length > 500) return failure('Invalid acknowledgement request', 400);
    const result = await callOrderGateway<{ actionId: string; acknowledged: number }>(session.email, 'acknowledge_economic_exceptions', {
      requestId: value.requestId, reason: value.reason, expectedCount: value.expectedCount, note: value.note,
    });
    return Response.json(result, { headers });
  } catch (error) {
    return error instanceof OrderGatewayError ? failure(error.message, error.status)
      : failure('Data speed report is temporarily unavailable', 502);
  }
}
