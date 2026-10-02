import { getChatGPTUser } from '@/app/chatgpt-auth';
import { callOrderGateway, OrderGatewayError } from '@/lib/order-gateway';

const headers = { 'cache-control': 'private, no-store' };
export async function GET(request: Request) {
  try {
    const user = await getChatGPTUser();
    if (!user) return Response.json({ error: 'Sign in required' }, { status: 401, headers });
    const page = Number(new URL(request.url).searchParams.get('page') || 1);
    if (!Number.isInteger(page) || page < 1 || page > 4000) return Response.json({ error: 'Invalid requirements page' }, { status: 400, headers });
    const alerts = new URL(request.url).searchParams.get('alerts');
    if (alerts !== null) {
      if (alerts !== '1' || new URL(request.url).searchParams.has('itemKey')) return Response.json({ error: 'Invalid alert query' }, { status: 400, headers });
      return Response.json(await callOrderGateway(user.email, 'get_stock_alerts', { page }), { headers });
    }
    const itemKey = new URL(request.url).searchParams.get('itemKey');
    if (itemKey !== null) {
      if (!itemKey.length || itemKey.length > 220) return Response.json({ error: 'Invalid Tally item key' }, { status: 400, headers });
      return Response.json(await callOrderGateway(user.email, 'get_requirement_orders', { page, itemKey }), { headers });
    }
    return Response.json(await callOrderGateway(user.email, 'get_requirements', { page }), { headers });
  } catch (error) {
    return Response.json({ error: error instanceof OrderGatewayError ? error.message : 'Requirements temporarily unavailable' }, { status: error instanceof OrderGatewayError ? error.status : 502, headers });
  }
}
