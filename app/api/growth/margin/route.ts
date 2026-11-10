import { getChatGPTUser } from '@/app/chatgpt-auth';
import { callOrderGateway, OrderGatewayError } from '@/lib/order-gateway';
import { buildGrowthMarginPayload, buildGrowthMarginDetailPayload, normalizeGrowthMargin, normalizeGrowthMarginDetail, buildGrowthBilledBelowPayload, normalizeGrowthBilledBelow } from '@/lib/growth-margin-types';
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
    const pageText = params.get('page');
    if ([...params.keys()].some(k => params.getAll(k).length !== 1) || pageText === null || !/^[1-9]\d*$/.test(pageText)) return Response.json({ error: 'Invalid growth margin parameters' }, { status: 400, headers });
    const input = { ...Object.fromEntries(params), page: Number(pageText) };
    if (params.has('billedBelow')) {
      const { billedBelow, ...billedInput } = input as typeof input & { billedBelow: string };
      const payload = billedBelow === '1' ? buildGrowthBilledBelowPayload(billedInput) : null;
      if (!payload) return Response.json({ error: 'Invalid growth margin parameters' }, { status: 400, headers });
      const data = normalizeGrowthBilledBelow(await callOrderGateway(session.email, 'get_growth_billed_below', payload));
      if (!data || data.page !== payload.page) throw new Error('Malformed growth billed below response');
      return Response.json(data, { headers });
    }
    const detail = params.has('itemKey') || params.has('labKey');
    const payload = detail ? buildGrowthMarginDetailPayload(input) : buildGrowthMarginPayload(input);
    if (!payload) return Response.json({ error: 'Invalid growth margin parameters' }, { status: 400, headers });
    const raw = await callOrderGateway(session.email, detail ? 'get_growth_margin_detail' : 'get_growth_margin', payload);
    if (detail) {
      const data = normalizeGrowthMarginDetail(raw);
      if (!data || data.page !== payload.page || ('itemKey' in payload ? data.kind !== 'item' || data.itemKey !== payload.itemKey : !('labKey' in payload) || data.kind !== 'lab' || data.labKey !== payload.labKey)) throw new Error('Malformed growth margin detail response');
      return Response.json(data, { headers });
    }
    const data = normalizeGrowthMargin(raw);
    const query = buildGrowthMarginPayload(payload)!;
    if (!data || data.page !== query.page || data.view !== query.view || data.sort !== (query.sort ?? 'sales') || data.filter !== (query.filter ?? 'all') || data.q !== (query.q ?? null)) throw new Error('Malformed growth margin response');
    return Response.json(data, { headers });
  } catch (error) {
    return Response.json({ error: 'Growth is unavailable. Try again.' }, { status: error instanceof OrderGatewayError ? error.status : 502, headers });
  }
}
export function POST() {
  return Response.json({ error: 'Method not allowed' }, { status: 405, headers: { ...headers, Allow: 'GET' } });
}
