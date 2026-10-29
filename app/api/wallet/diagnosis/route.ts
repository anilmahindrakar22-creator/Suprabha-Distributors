import { getChatGPTUser } from '@/app/chatgpt-auth';
import { getStockFlowSession } from '@/lib/stockflow-session';
import { hasAnyStockFlowRole } from '@/lib/user-types';
import { BoundedJsonRequestError, readBoundedJsonRequest } from '@/lib/bounded-json-request';
import { callOrderGateway, OrderGatewayError } from '@/lib/order-gateway';
import { validateWalletDiagnosisCommand } from '@/lib/wallet-diagnosis-types';

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
  if (error instanceof Error && error.message === 'Invalid wallet diagnosis request') return Response.json({ error: error.message }, { status: 400, headers });
  return Response.json({ error: 'Wallet is temporarily unavailable' }, { status: 502, headers });
}
export async function GET(request: Request) {
  try {
    const session = await actor();
    const params = new URL(request.url).searchParams;
    const action = params.get('action');
    const raw = action === 'get_wallet_diagnoses'
      ? { action, payload: { customerIds: (params.get('customerIds') ?? '').split(',').filter(Boolean) } }
      : action === 'get_account_opportunities' ? { action, payload: { customerId: params.get('customerId') } } : null;
    if (!raw) return Response.json({ error: 'Invalid wallet diagnosis read action' }, { status: 400, headers });
    const command = validateWalletDiagnosisCommand(raw);
    return Response.json(await callOrderGateway(session.email, command.action, command.payload), { headers });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    const session = await actor();
    const input = await readBoundedJsonRequest(request, 32_768);
    const command = validateWalletDiagnosisCommand(input);
    if (command.action === 'get_wallet_diagnoses' || command.action === 'get_account_opportunities') return Response.json({ error: 'Invalid wallet diagnosis write action' }, { status: 400, headers });
    return Response.json(await callOrderGateway(session.email, command.action, command.payload), { headers });
  } catch (error) { return failure(error); }
}
