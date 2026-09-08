import { getChatGPTUser } from '@/app/chatgpt-auth';
import { BoundedJsonRequestError, readBoundedJsonRequest } from '@/lib/bounded-json-request';
import { callOrderGateway, OrderGatewayError } from '@/lib/order-gateway';
import { measuredJsonResponse } from '@/lib/measured-json-response';
import { validateServiceCommand, type ServiceWorkspaceData } from '@/lib/service-types';

const privateHeaders = { 'cache-control': 'private, no-store' };
const failure = (error: string, status: number) => Response.json({ error }, { status, headers: privateHeaders });

async function actorEmail() {
  const user = await getChatGPTUser();
  if (!user) throw new OrderGatewayError('Sign in required', 401);
  return user.email;
}

export async function GET() {
  const startedAt = performance.now();
  try { return measuredJsonResponse(await callOrderGateway<ServiceWorkspaceData>(await actorEmail(), 'get_service_workspace'), startedAt); }
  catch (error) { return error instanceof OrderGatewayError ? failure(error.message, error.status) : failure('Service workspace is temporarily unavailable', 502); }
}

export async function POST(request: Request) {
  try {
    const command = validateServiceCommand(await readBoundedJsonRequest(request, 16_384));
    if (!command) return failure('Invalid service request', 400);
    return Response.json(await callOrderGateway(await actorEmail(), command.action, command.payload), { headers: privateHeaders });
  } catch (error) {
    if (error instanceof BoundedJsonRequestError || error instanceof OrderGatewayError) return failure(error.message, error.status);
    return failure('Service workspace is temporarily unavailable', 502);
  }
}
