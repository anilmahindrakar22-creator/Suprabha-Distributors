import { getChatGPTUser } from '@/app/chatgpt-auth';
import { getStockFlowSession } from '@/lib/stockflow-session';
import { hasAnyStockFlowRole } from '@/lib/user-types';
import { callOrderGateway, OrderGatewayError } from '@/lib/order-gateway';

const headers = { 'cache-control': 'private, no-store' };
const failure = (error: string, status: number) => Response.json({ error }, { status, headers });
async function actor() {
  const user = await getChatGPTUser();
  if (!user) throw new OrderGatewayError('Sign in required', 401);
  const session = await getStockFlowSession(user.email);
  if (!session || !hasAnyStockFlowRole(session.roles, ['administrator', 'management'])) throw new OrderGatewayError('Data checks are restricted', 403);
  return session;
}
export async function GET(request: Request) {
  try {
    const session = await actor();
    if (new URL(request.url).searchParams.size) return failure('Invalid data checks request', 400);
    return Response.json(await callOrderGateway(session.email, 'get_data_checks', {}), { headers });
  } catch (error) {
    return error instanceof OrderGatewayError ? failure(error.message, error.status)
      : failure('Data checks are temporarily unavailable', 502);
  }
}
