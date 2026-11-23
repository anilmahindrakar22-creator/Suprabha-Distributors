import { getChatGPTUser } from '@/app/chatgpt-auth';
import { callOrderGateway, OrderGatewayError } from '@/lib/order-gateway';
import { normalizeGrowth } from '@/lib/growth-types';
import { normalizeGrowthPeriod, parseGrowthPeriodParam } from '@/lib/growth-period-types';
import { getStockFlowSession } from '@/lib/stockflow-session';
import { hasAnyStockFlowRole } from '@/lib/user-types';

const headers = { 'cache-control': 'private, no-store' };
export async function GET(request?: Request) {
  try {
    const user = await getChatGPTUser();
    if (!user) return Response.json({ error: 'Sign in required' }, { status: 401, headers });
    const session = await getStockFlowSession(user.email);
    if (!session || !hasAnyStockFlowRole(session.roles, ['administrator', 'management'])) return Response.json({ error: 'Growth is for management only.' }, { status: 403, headers });
    const params = new URL(request?.url ?? 'http://localhost/api/growth').searchParams;
    const period = parseGrowthPeriodParam(params.get('period'));
    if ([...params.keys()].some(key => key !== 'period') || params.getAll('period').length > 1 || (params.has('period') && period === null)) {
      return Response.json({ error: 'Invalid growth period' }, { status: 400, headers });
    }
    const data = period && period !== 'rolling12'
      ? normalizeGrowthPeriod(await callOrderGateway(session.email, 'get_growth_period', { period }))
      : normalizeGrowth(await callOrderGateway(session.email, 'get_growth', {}));
    if (!data) throw new Error('Malformed growth response');
    return Response.json(data, { headers });
  } catch (error) {
    return Response.json({ error: 'Growth is unavailable. Try again.' }, { status: error instanceof OrderGatewayError ? error.status : 502, headers });
  }
}
export function POST() {
  return Response.json({ error: 'Method not allowed' }, { status: 405, headers: { ...headers, Allow: 'GET' } });
}
