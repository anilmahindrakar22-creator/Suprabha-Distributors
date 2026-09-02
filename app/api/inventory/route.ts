import { getChatGPTUser } from '@/app/chatgpt-auth';
import { validateInventoryCommand } from '@/lib/inventory-types';
import { callOrderGateway, OrderGatewayError } from '@/lib/order-gateway';

const privateHeaders = { 'cache-control': 'private, no-store' };

function failure(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: privateHeaders });
}

async function actorEmail() {
  const user = await getChatGPTUser();
  if (!user) throw new OrderGatewayError('Sign in required', 401);
  return user.email;
}

export async function GET() {
  try {
    return Response.json(
      await callOrderGateway(await actorEmail(), 'bootstrap_inventory'),
      { headers: privateHeaders },
    );
  } catch (error) {
    if (error instanceof OrderGatewayError) return failure(error.message, error.status);
    return failure('Inventory service is temporarily unavailable', 502);
  }
}

export async function POST(request: Request) {
  if (Number(request.headers.get('content-length') || 0) > 32_768) return failure('Inventory request is too large', 413);
  try {
    const command = validateInventoryCommand(await request.json());
    if (!command) return failure('Invalid inventory request', 400);
    return Response.json(
      await callOrderGateway(await actorEmail(), command.action, command.payload),
      { headers: privateHeaders },
    );
  } catch (error) {
    if (error instanceof SyntaxError) return failure('Invalid JSON', 400);
    if (error instanceof OrderGatewayError) return failure(error.message, error.status);
    return failure('Inventory service is temporarily unavailable', 502);
  }
}
