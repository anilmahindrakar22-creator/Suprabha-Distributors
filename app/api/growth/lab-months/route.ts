import { getChatGPTUser } from '@/app/chatgpt-auth';
import { callOrderGateway, OrderGatewayError } from '@/lib/order-gateway';
import { normalizeGrowthLabMonths } from '@/lib/growth-lab-month-types';
import { normalizeGrowthNewLabs } from '@/lib/growth-new-lab-types';
import { parseGrowthPeriodParam } from '@/lib/growth-period-types';
import { normalizeGrowthPeriodLabMonths } from '@/lib/growth-period-labs-types';
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
    if (params.has('period')) {
      const period = parseGrowthPeriodParam(params.get('period'));
      if (params.size !== 1 || !period) return Response.json({ error: 'Invalid growth lab months parameters' }, { status: 400, headers });
      if (period !== 'rolling12') {
        const data = normalizeGrowthPeriodLabMonths(await callOrderGateway(session.email, 'get_growth_lab_months_period', { period }));
        if (!data) throw new Error('Malformed growth lab months response');
        return Response.json(data, { headers });
      }
      params.delete('period');
    }
    const requestedFilter = params.get('filter');
    if (params.size === 1 && requestedFilter === 'new') {
      const data = normalizeGrowthNewLabs(await callOrderGateway(session.email, 'get_growth_lab_months', { filter: 'new' }));
      if (!data) throw new Error('Malformed growth lab months response');
      return Response.json(data, { headers });
    }
    const filter = params.size === 1 && (requestedFilter === 'lapsing' || requestedFilter === 'declining') ? requestedFilter : 'top';
    if (params.size > 0 && filter === 'top') return Response.json({ error: 'Invalid growth lab months parameters' }, { status: 400, headers });
    const data = normalizeGrowthLabMonths(await callOrderGateway(session.email, 'get_growth_lab_months', filter === 'top' ? {} : { filter }), filter);
    if (!data) throw new Error('Malformed growth lab months response');
    return Response.json(data, { headers });
  } catch (error) {
    return Response.json({ error: 'Growth is unavailable. Try again.' }, { status: error instanceof OrderGatewayError ? error.status : 502, headers });
  }
}
export function POST() {
  return Response.json({ error: 'Method not allowed' }, { status: 405, headers: { ...headers, Allow: 'GET' } });
}
