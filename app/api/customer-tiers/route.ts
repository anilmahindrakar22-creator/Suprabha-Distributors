import { getChatGPTUser } from '@/app/chatgpt-auth';
import { callOrderGateway, OrderGatewayError } from '@/lib/order-gateway';
import { normalizeCustomerTiers } from '@/lib/customer-tiers';
import { getStockFlowSession } from '@/lib/stockflow-session';

const headers = { 'cache-control': 'private, no-store' };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function POST(request: Request) {
  try {
    const user = await getChatGPTUser();
    if (!user) return Response.json({ error: 'Sign in required' }, { status: 401, headers });
    const session = await getStockFlowSession(user.email);
    if (!session) return Response.json({ error: 'Access denied' }, { status: 403, headers });
    const contentLength = request.headers.get('content-length');
    if (contentLength !== null && Number(contentLength) > 8192) {
      return Response.json({ error: 'Invalid request' }, { status: 400, headers });
    }
    let body: unknown;
    try {
      const text = await request.text();
      if (text.length > 8192) return Response.json({ error: 'Invalid request' }, { status: 400, headers });
      body = JSON.parse(text);
    } catch {
      return Response.json({ error: 'Invalid request' }, { status: 400, headers });
    }
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || !('orderIds' in body) ||
      !Array.isArray(body.orderIds) || body.orderIds.length < 1 || body.orderIds.length > 100 ||
      body.orderIds.some(id => typeof id !== 'string' || !uuid.test(id)) || new Set(body.orderIds.map(id => id.toLowerCase())).size !== body.orderIds.length) {
      return Response.json({ error: 'Invalid order IDs' }, { status: 400, headers });
    }
    const raw: unknown = await callOrderGateway(session.email, 'get_customer_tiers', { orderIds: body.orderIds });
    const data = normalizeCustomerTiers(raw);
    if (!data) return Response.json({ error: 'Malformed customer tiers response' }, { status: 502, headers });
    return Response.json(data, { headers });
  } catch (error) {
    return Response.json({ error: 'Customer tiers unavailable' }, { status: error instanceof OrderGatewayError ? error.status : 502, headers });
  }
}
export function GET() {
  return Response.json({ error: 'Method not allowed' }, { status: 405, headers: { ...headers, Allow: 'POST' } });
}
