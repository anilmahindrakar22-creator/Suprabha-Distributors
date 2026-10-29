import { getChatGPTUser } from '@/app/chatgpt-auth';
import { getStockFlowSession } from '@/lib/stockflow-session';
import { hasAnyStockFlowRole } from '@/lib/user-types';
import { BoundedJsonRequestError, readBoundedJsonRequest } from '@/lib/bounded-json-request';
import { callOrderGateway, OrderGatewayError } from '@/lib/order-gateway';
import { validateWalletActionCommand } from '@/lib/wallet-action-types';

const headers = { 'cache-control': 'private, no-store' };
async function actor() {
  const user = await getChatGPTUser();
  if (!user) throw new OrderGatewayError('Sign in required', 401);
  const session = await getStockFlowSession(user.email);
  if (!session || !hasAnyStockFlowRole(session.roles, ['administrator', 'management'])) throw new OrderGatewayError('Wallet access required', 403);
  return session;
}
function failure(error: unknown) {
  if (error instanceof OrderGatewayError || error instanceof BoundedJsonRequestError) return Response.json({ error: error.message }, { status: error.status, headers });
  if (error instanceof Error && error.message === 'Invalid wallet action request') return Response.json({ error: error.message }, { status: 400, headers });
  return Response.json({ error: 'Wallet is temporarily unavailable' }, { status: 502, headers });
}
export async function GET(request: Request) {
  try {
    const session = await actor(); const params = new URL(request.url).searchParams; const action = params.get('action');
    const raw = action === 'get_actions_due' ? { action, payload: { page: Number(params.get('page') ?? 1) } }
      : action === 'get_opportunity_actions' ? { action, payload: { opportunityId: params.get('opportunityId') } }
      : action === 'get_action_owners' ? { action, payload: {} } : null;
    if (!raw) return Response.json({ error: 'Invalid wallet action read action' }, { status: 400, headers });
    const command = validateWalletActionCommand(raw);
    return Response.json(await callOrderGateway(session.email, command.action, command.payload), { headers });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    const session = await actor(); const input = await readBoundedJsonRequest(request, 32_768); const command = validateWalletActionCommand(input);
    if (command.action === 'get_actions_due' || command.action === 'get_opportunity_actions' || command.action === 'get_action_owners') return Response.json({ error: 'Invalid wallet action write action' }, { status: 400, headers });
    return Response.json(await callOrderGateway(session.email, command.action, command.payload), { headers });
  } catch (error) { return failure(error); }
}
