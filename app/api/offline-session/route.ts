import { getChatGPTUser } from '@/app/chatgpt-auth';
import { getStockFlowSession } from '@/lib/stockflow-session';
import { hasAnyStockFlowRole } from '@/lib/user-types';
export async function GET() {
  const headers = { 'cache-control': 'private, no-store' };
  try {
    const user = await getChatGPTUser();
    if (!user) return Response.json({ error: 'Sign in required' }, { status: 401, headers });
    const session = await getStockFlowSession(user.email);
    if (!session || !hasAnyStockFlowRole(session.roles, ['administrator', 'management', 'sales', 'operations'])) return Response.json({ error: 'Order entry access required' }, { status: 403, headers });
    return Response.json({ actorEmail: session.email }, { headers });
  } catch { return Response.json({ error: 'Account verification unavailable' }, { status: 503, headers }); }
}
