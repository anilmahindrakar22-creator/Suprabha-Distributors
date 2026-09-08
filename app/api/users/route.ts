import { getChatGPTUser } from '@/app/chatgpt-auth';
import { callOrderGateway, OrderGatewayError } from '@/lib/order-gateway';
import { BoundedJsonRequestError, readBoundedJsonRequest } from '@/lib/bounded-json-request';
import { validateUserMutation } from '@/lib/user-types';

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
    const email = await actorEmail();
    const payload = validateUserMutation(await readBoundedJsonRequest(request, 4_096));
    if (!payload) return fail('Valid email, role, and status are required', 400);
    return Response.json(await callOrderGateway(email, 'upsert_user', payload), { headers });
  } catch (error) {
    if (error instanceof BoundedJsonRequestError) return fail(error.message, error.status);
    return error instanceof OrderGatewayError ? fail(error.message, error.status) : fail('User service is temporarily unavailable', 502);
  }
}
