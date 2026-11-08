import { getChatGPTUser } from '@/app/chatgpt-auth';
import { callOrderGateway, OrderGatewayError } from '@/lib/order-gateway';
import { growthLabLists, isGrowthMonth, normalizeGrowthLabs, type GrowthLabList } from '@/lib/growth-types';
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
    const list = params.get('list'), pageText = params.get('page'), sort = params.get('sort');
    const month = params.get('month'), regularOnly = params.get('regularOnly');
    const half = params.get('half');
    const allowed = ['list', 'page', 'sort', 'month', 'regularOnly', 'half'];
    const page = Number(pageText);
    const monthly = list?.startsWith('month_');
    if ([...params.keys()].some(key => !allowed.includes(key) || params.getAll(key).length !== 1)
      || !growthLabLists.includes(list as GrowthLabList)
      || pageText === null || !/^[1-9]\d*$/.test(pageText) || !Number.isSafeInteger(page) || page < 1
      || (sort !== null && !(list === 'window_labs' ? ['value', 'months', 'last', 'per_month']
        : list === 'bulk_invoices' ? ['value', 'last'] : ['value', 'months', 'last']).includes(sort))
      || (monthly ? !isGrowthMonth(month) : month !== null)
      || (half !== null && (!['window_labs', 'bulk_invoices'].includes(String(list)) || !['H1', 'H2'].includes(half)))
      || (regularOnly !== null && (list !== 'bridge_stopped' || !['true', 'false'].includes(regularOnly)))) {
      return Response.json({ error: 'Invalid growth list parameters' }, { status: 400, headers });
    }
    const payload: Record<string, unknown> = { list, page };
    if (sort !== null) payload.sort = sort;
    if (month !== null) payload.month = month;
    if (regularOnly !== null) payload.regularOnly = regularOnly === 'true';
    if (half !== null) payload.half = half;
    const data = normalizeGrowthLabs(await callOrderGateway(session.email, 'get_growth_labs', payload));
    if (!data || data.list !== list || data.month !== month || data.page !== page) throw new Error('Malformed growth labs response');
    return Response.json(data, { headers });
  } catch (error) {
    return Response.json({ error: 'Growth is unavailable. Try again.' }, { status: error instanceof OrderGatewayError ? error.status : 502, headers });
  }
}
export function POST() {
  return Response.json({ error: 'Method not allowed' }, { status: 405, headers: { ...headers, Allow: 'GET' } });
}
