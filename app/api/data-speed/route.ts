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
