import { getChatGPTUser } from '@/app/chatgpt-auth';
import { getStockFlowSession } from '@/lib/stockflow-session';
import { OrderGatewayError } from '@/lib/order-gateway';

const headers = { 'cache-control': 'private, no-store' };
const fail = (status: number, error: string) => Response.json({ error }, { status, headers });

export async function GET() {
  try {
    const user = await getChatGPTUser();
    if (!user) return fail(401, 'Sign-in required');
    const session = await getStockFlowSession(user.email);
    if (!session) return fail(403, 'Access denied');
    return Response.json({ email: session.email, role: session.role, roles: session.roles }, { headers });
  } catch (error) {
    if (error instanceof OrderGatewayError && [401, 403].includes(error.status)) return fail(403, 'Access denied');
    return fail(502, 'Session is temporarily unavailable');
  }
}
