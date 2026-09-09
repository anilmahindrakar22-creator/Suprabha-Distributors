import { getChatGPTUser } from '@/app/chatgpt-auth';
import { BoundedJsonRequestError, readBoundedJsonRequest } from '@/lib/bounded-json-request';
import { callOrderGateway, OrderGatewayError } from '@/lib/order-gateway';

const headers = { 'cache-control': 'private, no-store' };

export async function POST(request: Request) {
  try {
    const user = await getChatGPTUser();
    if (!user) return Response.json({ error: 'Sign in required' }, { status: 401, headers });
    const body = await readBoundedJsonRequest(request) as { idempotencyKey?: unknown };
    if (typeof body.idempotencyKey !== 'string' || body.idempotencyKey.length < 16 || body.idempotencyKey.length > 200) return Response.json({ error: 'Valid submission key is required' }, { status: 400, headers });
    return Response.json(await callOrderGateway(user.email, 'recover_order_submission', { idempotencyKey: body.idempotencyKey }), { headers });
  } catch (error) {
    if (error instanceof BoundedJsonRequestError) return Response.json({ error: error.message }, { status: error.status, headers });
    if (error instanceof OrderGatewayError) return Response.json({ error: error.message }, { status: error.status, headers });
    return Response.json({ error: 'Order recovery is temporarily unavailable' }, { status: 502, headers });
  }
}
