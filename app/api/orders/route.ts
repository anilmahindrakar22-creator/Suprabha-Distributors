import { getChatGPTUser, hasStockFlowAccess } from '@/app/chatgpt-auth';
import { callOrderGateway, OrderGatewayError } from '@/lib/order-gateway';
import type { OrderBootstrap } from '@/lib/order-types';
import { validateOrderCommand } from '@/lib/order-types';

const privateHeaders = { 'cache-control': 'private, no-store' };

function failure(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: privateHeaders });
}

async function authorizedUser() {
  const user = await getChatGPTUser();
  if (!user) throw new OrderGatewayError('Sign in required', 401);
  if (!hasStockFlowAccess(user)) throw new OrderGatewayError('Access denied', 403);
  return user;
}

export async function GET() {
  try {
    const user = await authorizedUser();
    const result = await callOrderGateway<OrderBootstrap>(user.email, 'bootstrap');
    return Response.json(result, { headers: privateHeaders });
  } catch (error) {
    if (error instanceof OrderGatewayError) {
      return failure(error.message, error.status);
    }
    return failure('Order service is temporarily unavailable', 502);
  }
}

export async function POST(request: Request) {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > 65_536) return failure('Order request is too large', 413);

  try {
    const user = await authorizedUser();
    const command = validateOrderCommand(await request.json());
    if (!command) return failure('Invalid order request', 400);

    const result = await callOrderGateway<Record<string, unknown>>(
      user.email,
      command.action,
      command.payload,
    );
    return Response.json(result, { headers: privateHeaders });
  } catch (error) {
    if (error instanceof SyntaxError) return failure('Invalid JSON', 400);
    if (error instanceof OrderGatewayError) {
      return failure(error.message, error.status);
    }
    return failure('Order service is temporarily unavailable', 502);
  }
}
