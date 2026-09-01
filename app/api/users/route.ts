import { getChatGPTUser } from '@/app/chatgpt-auth';
import { callOrderGateway, OrderGatewayError } from '@/lib/order-gateway';

const headers = { 'cache-control': 'private, no-store' };
const fail = (message: string, status: number) => Response.json({ error: message }, { status, headers });

async function actorEmail() {
  const user = await getChatGPTUser();
  if (!user) throw new OrderGatewayError('Sign in required', 401);
  return user.email;
}

export async function GET() {
  try {
    return Response.json(await callOrderGateway(await actorEmail(), 'list_users'), { headers });
  } catch (error) {
    return error instanceof OrderGatewayError ? fail(error.message, error.status) : fail('User service is temporarily unavailable', 502);
  }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json() as { email?: unknown; role?: unknown; status?: unknown };
    if (typeof payload.email !== 'string' || typeof payload.role !== 'string' || typeof payload.status !== 'string') return fail('Email, role, and status are required', 400);
    return Response.json(await callOrderGateway(await actorEmail(), 'upsert_user', payload as Record<string, unknown>), { headers });
  } catch (error) {
    if (error instanceof SyntaxError) return fail('Invalid JSON', 400);
    return error instanceof OrderGatewayError ? fail(error.message, error.status) : fail('User service is temporarily unavailable', 502);
  }
}
