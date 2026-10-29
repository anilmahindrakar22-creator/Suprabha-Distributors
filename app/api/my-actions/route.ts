import { getChatGPTUser } from '@/app/chatgpt-auth';
import { getStockFlowSession } from '@/lib/stockflow-session';
import { hasAnyStockFlowRole } from '@/lib/user-types';
import { BoundedJsonRequestError, readBoundedJsonRequest } from '@/lib/bounded-json-request';
import { callOrderGateway, OrderGatewayError } from '@/lib/order-gateway';
import { validateMyActionCommand } from '@/lib/my-actions-types';

const headers = { 'cache-control': 'private, no-store' };
async function actor() {
  const user = await getChatGPTUser();
  if (!user) throw new OrderGatewayError('Sign in required', 401);
  const session = await getStockFlowSession(user.email);
  if (!session || !hasAnyStockFlowRole(session.roles, ['administrator', 'management', 'sales', 'operations'])) throw new OrderGatewayError('My actions access required', 403);
  return session;
}
function failure(error: unknown) {
  if (error instanceof OrderGatewayError || error instanceof BoundedJsonRequestError) return Response.json({ error: error.message }, { status: error.status, headers });
  if (error instanceof Error && error.message === 'Invalid my actions request') return Response.json({ error: error.message }, { status: 400, headers });
  return Response.json({ error: 'Actions are temporarily unavailable' }, { status: 502, headers });
}
export async function GET(request: Request) {
  try {
    const session = await actor(); const params = new URL(request.url).searchParams;
    if (params.get('action') !== 'get_my_actions') return Response.json({ error: 'Invalid my actions read action' }, { status: 400, headers });
    const command = validateMyActionCommand({ action: 'get_my_actions', payload: { page: Number(params.get('page') ?? 1) } });
    return Response.json(await callOrderGateway(session.email, command.action, command.payload), { headers });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    const session = await actor(); const command = validateMyActionCommand(await readBoundedJsonRequest(request, 32_768));
    if (command.action !== 'close_my_action') return Response.json({ error: 'Invalid my actions write action' }, { status: 400, headers });
    return Response.json(await callOrderGateway(session.email, command.action, command.payload), { headers });
  } catch (error) { return failure(error); }
}
