import { getChatGPTUser } from '@/app/chatgpt-auth';
import { callOrderGateway, OrderGatewayError } from '@/lib/order-gateway';
import { buildGrowthMarginPayload, buildGrowthMarginDetailPayload, normalizeGrowthMargin, normalizeGrowthMarginDetail, buildGrowthBilledBelowPayload, normalizeGrowthBilledBelow } from '@/lib/growth-margin-types';
import { getStockFlowSession } from '@/lib/stockflow-session';
import { hasAnyStockFlowRole } from '@/lib/user-types';
import { parseGrowthPeriodParam } from '@/lib/growth-period-types';
import { isGrowthProfitPeriod, normalizeGrowthPeriodGp } from '@/lib/growth-period-profit-types';

const headers = { 'cache-control': 'private, no-store' };
export async function GET(request: Request) {
  try {
    const user = await getChatGPTUser();
    if (!user) return Response.json({ error: 'Sign in required' }, { status: 401, headers });
    const session = await getStockFlowSession(user.email);
    if (!session || !hasAnyStockFlowRole(session.roles, ['administrator', 'management'])) return Response.json({ error: 'Growth is for management only.' }, { status: 403, headers });
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some(k => params.getAll(k).length !== 1)) return Response.json({ error: 'Invalid growth margin parameters' }, { status: 400, headers });
    const selection = params.has('period') ? parseGrowthPeriodParam(params.get('period')) : 'rolling12';
    if (!selection) return Response.json({ error: 'Invalid growth margin parameters' }, { status: 400, headers });
    params.delete('period');
    const period = selection === 'rolling12' ? null : selection;
    if (period && params.has('gp')) {
      if (params.size !== 1 || params.get('gp') !== '1') return Response.json({ error: 'Invalid growth margin parameters' }, { status: 400, headers });
      const data = normalizeGrowthPeriodGp(await callOrderGateway(session.email, 'get_growth_margin_period', { period, read: 'gp' }));
      if (!data) throw new Error('Malformed growth profit response');
      return Response.json(data, { headers });
    }
    const read = async (action: 'get_growth_margin' | 'get_growth_margin_detail' | 'get_growth_billed_below', kind: 'margin' | 'detail' | 'billed_below', payload: Record<string, unknown>) => {
      const raw: unknown = await callOrderGateway(session.email, period ? 'get_growth_margin_period' : action, period ? { period, read: kind, ...payload } : payload);
      if (!period) return { raw, metadata: {} };
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Malformed growth period response');
      const { period: metadata, ...rest } = raw as Record<string, unknown>;
      if (!isGrowthProfitPeriod(metadata)) throw new Error('Malformed growth period response');
      return { raw: rest, metadata: { period: metadata } };
    };
    const pageText = params.get('page');
    if ([...params.keys()].some(k => params.getAll(k).length !== 1) || pageText === null || !/^[1-9]\d*$/.test(pageText)) return Response.json({ error: 'Invalid growth margin parameters' }, { status: 400, headers });
    const input = { ...Object.fromEntries(params), page: Number(pageText) };
    if (params.has('billedBelow')) {
      const { billedBelow, ...billedInput } = input as typeof input & { billedBelow: string };
      const payload = billedBelow === '1' ? buildGrowthBilledBelowPayload(billedInput) : null;
      if (!payload) return Response.json({ error: 'Invalid growth margin parameters' }, { status: 400, headers });
      const response = await read('get_growth_billed_below', 'billed_below', payload);
      const data = normalizeGrowthBilledBelow(response.raw);
      if (!data || data.page !== payload.page) throw new Error('Malformed growth billed below response');
      return Response.json({ ...data, ...response.metadata }, { headers });
    }
    const detail = params.has('itemKey') || params.has('labKey') || params.has('tallyItemKey');
    const payload = detail ? buildGrowthMarginDetailPayload(input) : buildGrowthMarginPayload(input);
    if (!payload) return Response.json({ error: 'Invalid growth margin parameters' }, { status: 400, headers });
    let raw: unknown;
    let metadata: object = {};
    try {
      const response = await read(detail ? 'get_growth_margin_detail' : 'get_growth_margin', detail ? 'detail' : 'margin', payload);
      raw = response.raw;
      metadata = response.metadata;
    } catch (error) {
      if ('tallyItemKey' in payload && error instanceof OrderGatewayError && (error.status === 400 || error.status === 422)) return Response.json({ error: 'No Growth prices for this item yet.' }, { status: 404, headers });
      throw error;
    }
    if (detail) {
      const data = normalizeGrowthMarginDetail(raw);
      if (!data || data.page !== payload.page || ('tallyItemKey' in payload ? data.kind !== 'item' || data.tallyItemKey !== payload.tallyItemKey : 'itemKey' in payload ? data.kind !== 'item' || data.itemKey !== payload.itemKey : !('labKey' in payload) || data.kind !== 'lab' || data.labKey !== payload.labKey)) throw new Error('Malformed growth margin detail response');
      return Response.json({ ...data, ...metadata }, { headers });
    }
    const data = normalizeGrowthMargin(raw);
    const query = buildGrowthMarginPayload(payload)!;
    if (!data || data.page !== query.page || data.view !== query.view || data.sort !== (query.sort ?? 'sales') || data.filter !== (query.filter ?? 'all') || data.q !== (query.q ?? null)) throw new Error('Malformed growth margin response');
    return Response.json({ ...data, ...metadata }, { headers });
  } catch (error) {
    return Response.json({ error: 'Growth is unavailable. Try again.' }, { status: error instanceof OrderGatewayError ? error.status : 502, headers });
  }
}
export function POST() {
  return Response.json({ error: 'Method not allowed' }, { status: 405, headers: { ...headers, Allow: 'GET' } });
}
