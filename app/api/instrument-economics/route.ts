import { getChatGPTUser } from '@/app/chatgpt-auth';
import { getStockFlowSession } from '@/lib/stockflow-session';
import { hasAnyStockFlowRole } from '@/lib/user-types';
import { BoundedJsonRequestError, readBoundedJsonRequest } from '@/lib/bounded-json-request';
import { callOrderGateway, OrderGatewayError } from '@/lib/order-gateway';
import { measuredJsonResponse } from '@/lib/measured-json-response';
import { economicActions, validateEconomicCommand, type EconomicsWorkspaceData } from '@/lib/instrument-economics-types';

const headers = { 'cache-control': 'private, no-store' };
async function actor(timings?: { auth?: number; member?: number }) {
  const authStartedAt = timings ? performance.now() : 0;
  const user = await getChatGPTUser();
  if (timings) timings.auth = performance.now() - authStartedAt;
  if (!user) throw new OrderGatewayError('Sign in required', 401);
  const memberStartedAt = timings ? performance.now() : 0;
  const session = await getStockFlowSession(user.email);
  if (timings) timings.member = performance.now() - memberStartedAt;
  if (!session || !hasAnyStockFlowRole(session.roles, ['administrator', 'management', 'accounts'])) throw new OrderGatewayError('Commercial economics access required', 403);
  return session;
}
function failure(error: unknown) {
  if (error instanceof OrderGatewayError || error instanceof BoundedJsonRequestError) return Response.json({ error: error.message }, { status: error.status, headers });
  return Response.json({ error: 'Instrument economics is temporarily unavailable' }, { status: 502, headers });
}
export async function GET() {
  const startedAt = performance.now();
  try {
    const timings = { auth: 0, member: 0 };
    const session = await actor(timings);
    const rpcStartedAt = performance.now();
    const workspace = await callOrderGateway<EconomicsWorkspaceData>(session.email, 'get_instrument_economics');
    const rpc = performance.now() - rpcStartedAt;
    const { auth, member } = timings;
    return measuredJsonResponse({ ...workspace, actorEmail: session.email }, startedAt, performance.now(), { auth, member, rpc });
  }
  catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    const session = await actor();
    const input = await readBoundedJsonRequest(request, 32_768);
    if (input && typeof input === 'object' && !Array.isArray(input) && 'action' in input && input.action === 'recover_economic_command') {
      const payload = 'payload' in input ? input.payload : null;
      if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !('commandAction' in payload) || !economicActions.some(action => action === payload.commandAction) || !('commandKey' in payload) || typeof payload.commandKey !== 'string' || !/^[a-zA-Z0-9_-]{16,200}$/.test(payload.commandKey) || !('closeUnresolved' in payload) || typeof payload.closeUnresolved !== 'boolean') return Response.json({ error: 'Invalid recovery reference' }, { status: 400, headers });
      if (!('expectedActorEmail' in payload) || typeof payload.expectedActorEmail !== 'string' || payload.expectedActorEmail.trim().toLowerCase() !== session.email.trim().toLowerCase()) throw new OrderGatewayError('Sign in with the original account to recover this command.', 403);
      if (payload.closeUnresolved && !hasAnyStockFlowRole(session.roles, ['administrator', 'management'])) throw new OrderGatewayError('Management approval required', 403);
      return Response.json(await callOrderGateway(session.email, 'recover_economic_command', { commandAction: payload.commandAction, commandKey: payload.commandKey, closeUnresolved: payload.closeUnresolved }), { headers });
    }
    if (!hasAnyStockFlowRole(session.roles, ['administrator', 'management'])) throw new OrderGatewayError('Management approval required', 403);
    const command = validateEconomicCommand(input);
    if (!command) return Response.json({ error: 'Invalid economic command' }, { status: 400, headers });
    if (typeof command.payload.expectedActorEmail !== 'string' || command.payload.expectedActorEmail.trim().toLowerCase() !== session.email.trim().toLowerCase()) throw new OrderGatewayError('Your account changed. Refresh instrument economics before saving.', 403);
    return Response.json(await callOrderGateway(session.email, command.action, command.payload), { headers });
  } catch (error) { return failure(error); }
}
