import { getChatGPTUser } from '@/app/chatgpt-auth';
import { getStockFlowSession } from '@/lib/stockflow-session';
import { hasAnyStockFlowRole } from '@/lib/user-types';
import { BoundedJsonRequestError } from '@/lib/bounded-json-request';
import { callOrderGateway, OrderGatewayError } from '@/lib/order-gateway';
import { normalizeEconomicLinePage, parseEconomicLineSearchParams } from '@/lib/instrument-economics-lines';

const headers = { 'cache-control': 'private, no-store' };
export async function GET(request: Request) {
  try {
    const user = await getChatGPTUser();
    if (!user) throw new OrderGatewayError('Sign in required', 401);
    const session = await getStockFlowSession(user.email);
    if (!session || !hasAnyStockFlowRole(session.roles, ['administrator', 'management', 'accounts'])) throw new OrderGatewayError('Commercial economics access required', 403);
    const payload = parseEconomicLineSearchParams(new URL(request.url).searchParams);
    if (!payload) return Response.json({ error: 'Invalid invoice search' }, { status: 400, headers });
    const page = normalizeEconomicLinePage(await callOrderGateway(session.email, 'get_economic_source_lines', payload));
    return Response.json(page, { headers });
  } catch (error) {
    if (error instanceof OrderGatewayError || error instanceof BoundedJsonRequestError) return Response.json({ error: error.message }, { status: error.status, headers });
    return Response.json({ error: 'Instrument economics is temporarily unavailable' }, { status: 502, headers });
  }
}
