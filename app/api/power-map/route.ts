import { getChatGPTUser } from '@/app/chatgpt-auth';
import { getStockFlowSession } from '@/lib/stockflow-session';
import { hasAnyStockFlowRole } from '@/lib/user-types';
import { BoundedJsonRequestError, readBoundedJsonRequest } from '@/lib/bounded-json-request';
import { callOrderGateway, OrderGatewayError } from '@/lib/order-gateway';
import { validatePowerMapCommand } from '@/lib/power-map-types';

const headers = { 'cache-control': 'private, no-store' };
async function actor() {
  const user = await getChatGPTUser();
  if (!user) throw new OrderGatewayError('Sign in required', 401);
  const session = await getStockFlowSession(user.email);
  if (!session || !hasAnyStockFlowRole(session.roles, ['administrator', 'management'])) throw new OrderGatewayError('Power map access required', 403);
  return session;
}
function failure(error: unknown) {
  if (error instanceof OrderGatewayError || error instanceof BoundedJsonRequestError) return Response.json({ error: error.message }, { status: error.status, headers });
  if (error instanceof Error && error.message === 'Invalid power map request') return Response.json({ error: error.message }, { status: 400, headers });
  return Response.json({ error: 'Power map is temporarily unavailable' }, { status: 502, headers });
}
export async function GET(request: Request) {
  try {
    const session = await actor(); const params = new URL(request.url).searchParams;
    if (params.get('action') !== 'get_power_map') return Response.json({ error: 'Invalid power map read action' }, { status: 400, headers });
    const command = validatePowerMapCommand({ action: 'get_power_map', payload: { customerId: params.get('customerId') } });
    return Response.json(await callOrderGateway(session.email, command.action, command.payload), { headers });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    const session = await actor(); const command = validatePowerMapCommand(await readBoundedJsonRequest(request, 32_768));
    if (command.action === 'get_power_map') return Response.json({ error: 'Invalid power map write action' }, { status: 400, headers });
    return Response.json(await callOrderGateway(session.email, command.action, command.payload), { headers });
  } catch (error) { return failure(error); }
}
