import { getChatGPTUser } from '@/app/chatgpt-auth';
import { callOrderGateway, OrderGatewayError } from '@/lib/order-gateway';
import { parseGrowthStoppedItems } from '@/lib/growth-stopped-items';
import { getStockFlowSession } from '@/lib/stockflow-session';
import { hasAnyStockFlowRole } from '@/lib/user-types';

const headers = { 'cache-control': 'private, no-store' };
export async function GET(request: Request) {
  try {
    const user = await getChatGPTUser();
    if (!user) return Response.json({ error: 'Sign in required' }, { status: 401, headers });
    const session = await getStockFlowSession(user.email);
    if (!session || !hasAnyStockFlowRole(session.roles, ['administrator', 'management'])) return Response.json({ error: 'Growth is for management only.' }, { status: 403, headers });
    const params = new URL(request.url).searchParams;
    const labKeys = params.getAll('lab');
    if ([...params.keys()].some(key => key !== 'lab') || labKeys.length < 1 || labKeys.length > 8
      || new Set(labKeys).size !== labKeys.length || labKeys.some(key => key.length < 3 || key.length > 300 || !key.includes('|'))) {
      return Response.json({ error: 'Invalid stopped items parameters' }, { status: 400, headers });
    }
    const data = parseGrowthStoppedItems(await callOrderGateway(session.email, 'get_growth_stopped_items', { labKeys }));
    return Response.json(data, { headers });
  } catch (error) {
    return Response.json({ error: 'Growth is unavailable. Try again.' }, { status: error instanceof OrderGatewayError ? error.status : 502, headers });
  }
}
export function POST() {
  return Response.json({ error: 'Method not allowed' }, { status: 405, headers: { ...headers, Allow: 'GET' } });
}
