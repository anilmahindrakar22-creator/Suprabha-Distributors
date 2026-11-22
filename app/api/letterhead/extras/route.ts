import { getChatGPTUser } from '@/app/chatgpt-auth';
import { callOrderGateway, OrderGatewayError } from '@/lib/order-gateway';
import { validateLetterheadExtrasCommand } from '@/lib/letterhead-extras';
import { BoundedJsonRequestError, readBoundedJsonRequest } from '@/lib/bounded-json-request';

const headers = { 'cache-control': 'private, no-store' };
function failure(error: string, status: number) { return Response.json({ error }, { status, headers }); }
export async function GET(request: Request) {
  try {
    const user = await getChatGPTUser();
    if (!user) return failure('Sign in required', 401);
    if ([...new URL(request.url).searchParams.keys()].length) return failure('Invalid letterhead extras query', 400);
    return Response.json(await callOrderGateway(user.email, 'get_letterhead_extras', {}), { headers });
  } catch (error) {
    return failure(error instanceof OrderGatewayError ? error.message : 'Letterhead extras temporarily unavailable', error instanceof OrderGatewayError ? error.status : 502);
  }
}
export async function POST(request: Request) {
  try {
    const user = await getChatGPTUser();
    if (!user) return failure('Sign in required', 401);
    const command = validateLetterheadExtrasCommand(await readBoundedJsonRequest(request));
    if (!command) return failure('Invalid letterhead extras request', 400);
    return Response.json(await callOrderGateway(user.email, command.action, command.payload), { headers });
  } catch (error) {
    if (error instanceof BoundedJsonRequestError) return failure(error.message, error.status);
    return failure(error instanceof OrderGatewayError ? error.message : 'Letterhead extras temporarily unavailable', error instanceof OrderGatewayError ? error.status : 502);
  }
}
