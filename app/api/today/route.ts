import { getChatGPTUser } from '@/app/chatgpt-auth';
import { getStockFlowSession } from '@/lib/stockflow-session';
import { hasAnyStockFlowRole } from '@/lib/user-types';
import { callOrderGateway, OrderGatewayError } from '@/lib/order-gateway';

const headers = { 'cache-control': 'private, no-store' };

async function actor() {
  const user = await getChatGPTUser();
  if (!user) throw new OrderGatewayError('Sign in required', 401);
  const session = await getStockFlowSession(user.email);
  if (!session || !hasAnyStockFlowRole(session.roles, ['administrator', 'management'])) {
    throw new OrderGatewayError('Today access required', 403);
  }
  return session;
}

function failure(error: unknown) {
  if (error instanceof OrderGatewayError) return Response.json({ error: error.message }, { status: error.status, headers });
  return Response.json({ error: 'Today is temporarily unavailable' }, { status: 502, headers });
}

export async function GET(request: Request) {
  try {
    const session = await actor();
    if (new URL(request.url).searchParams.size > 0) {
      return Response.json({ error: 'Today does not accept query parameters' }, { status: 400, headers });
    }
    return Response.json(await callOrderGateway(session.email, 'get_today', {}), { headers });
  } catch (error) {
    return failure(error);
  }
}
