import { getChatGPTUser } from '@/app/chatgpt-auth';
import { getStockFlowSession } from '@/lib/stockflow-session';
import { hasAnyStockFlowRole } from '@/lib/user-types';
import { callOrderGateway, OrderGatewayError, type GatewayAction } from '@/lib/order-gateway';

const headers = { 'cache-control': 'private, no-store' };
const invalid = () => new OrderGatewayError('Invalid customer map query', 400);

function command(params: URLSearchParams): [GatewayAction, Record<string, unknown>] {
  const keys = [...params.keys()];
  if (new Set(keys).size !== keys.length) throw invalid();
  if (keys.length === 1 && params.has('bbox')) {
    const parts = params.get('bbox')!.split(',');
    if (parts.length !== 4 || parts.some(value => !value.trim() || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value))) throw invalid();
    const [south, west, north, east] = parts.map(Number);
    if (![south, west, north, east].every(Number.isFinite)
      || south < -90 || north > 90 || west < -180 || east > 180
      || south >= north || west >= east || north - south > 3 || east - west > 3) throw invalid();
    return ['get_map_pins', { south, west, north, east }];
  }
  if (params.get('notOnMap') === '1' && params.has('page') && keys.every(key => ['notOnMap', 'page', 'q'].includes(key))) {
    const rawPage = params.get('page')!;
    const page = Number(rawPage);
    const query = params.get('q');
    if (!/^[1-9]\d*$/.test(rawPage) || !Number.isSafeInteger(page) || page > 4000 || (query !== null && query.length > 120)) throw invalid();
    return ['get_not_on_map', { page, ...(query !== null ? { query } : {}) }];
  }
  if (keys.length === 1 && params.has('customer')) {
    const customerId = params.get('customer')!;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(customerId)) throw invalid();
    return ['get_customer_sheet', { customerId }];
  }
  throw invalid();
}

export async function GET(request: Request) {
  try {
    const user = await getChatGPTUser();
    if (!user) throw new OrderGatewayError('Sign in required', 401);
    const session = await getStockFlowSession(user.email);
    if (!session || !hasAnyStockFlowRole(session.roles, ['administrator', 'management', 'sales', 'operations'])) {
      throw new OrderGatewayError('Customer map access required', 403);
    }
    const [action, payload] = command(new URL(request.url).searchParams);
    return Response.json(await callOrderGateway(session.email, action, payload), { headers });
  } catch (error) {
    if (error instanceof OrderGatewayError) return Response.json({ error: error.message }, { status: error.status, headers });
    return Response.json({ error: 'Customer map is temporarily unavailable' }, { status: 502, headers });
  }
}
