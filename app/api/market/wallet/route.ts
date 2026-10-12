import { getChatGPTUser } from '@/app/chatgpt-auth';
import { BoundedJsonRequestError, readBoundedJsonRequest } from '@/lib/bounded-json-request';
import { callOrderGateway, OrderGatewayError } from '@/lib/order-gateway';
import { measuredJsonResponse } from '@/lib/measured-json-response';
import { validateWalletCommand, walletUuidPattern } from '@/lib/wallet-types';

const privateHeaders = { 'cache-control': 'private, no-store' };
const failure = (error: string, status: number) => Response.json({ error }, { status, headers: privateHeaders });
async function actorEmail() {
  const user = await getChatGPTUser();
  if (!user) throw new OrderGatewayError('Sign in required', 401);
  return user.email;
}
function failed(error: unknown) {
  return error instanceof OrderGatewayError || error instanceof BoundedJsonRequestError
    ? failure(error.message, error.status) : failure('Market is temporarily unavailable', 502);
}
export async function GET(request: Request) {
  const startedAt = performance.now();
  try {
    const email = await actorEmail();
    const query = new URL(request.url).searchParams;
    if (query.size === 1 && query.get('view') === 'divisions') {
      return measuredJsonResponse(await callOrderGateway(email, 'get_wallet_divisions', {}), startedAt);
    }
    const customerId = query.get('customerId');
    if (query.size !== 1 || !customerId || !walletUuidPattern.test(customerId)) return failure('Invalid wallet request', 400);
    return measuredJsonResponse(await callOrderGateway(email, 'get_customer_wallet', { customerId }), startedAt);
  } catch (error) { return failed(error); }
}
export async function POST(request: Request) {
  try {
    const email = await actorEmail();
    const command = validateWalletCommand(await readBoundedJsonRequest(request, 8_192));
    if (!command) return failure('Invalid wallet request', 400);
    return Response.json(await callOrderGateway(email, command.action, command.payload), { headers: privateHeaders });
  } catch (error) { return failed(error); }
}
