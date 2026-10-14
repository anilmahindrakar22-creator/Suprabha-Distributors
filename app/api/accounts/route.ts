import { getChatGPTUser } from '@/app/chatgpt-auth';
import { getStockFlowSession } from '@/lib/stockflow-session';
import { hasAnyStockFlowRole } from '@/lib/user-types';
import { BoundedJsonRequestError, readBoundedJsonRequest } from '@/lib/bounded-json-request';
import { callOrderGateway, OrderGatewayError } from '@/lib/order-gateway';
import { measuredJsonResponse } from '@/lib/measured-json-response';
import { accountUuidPattern, parseAccountClass, parseAccountCommand, type AccountsGatewayResponse } from '@/lib/account-types';

const headers = { 'cache-control': 'private, no-store' };
const failure = (error: string, status: number) => Response.json({ error }, { status, headers });
async function actor() {
  const user = await getChatGPTUser();
  if (!user) throw new OrderGatewayError('Sign in required', 401);
  const session = await getStockFlowSession(user.email);
  if (!session || !hasAnyStockFlowRole(session.roles, ['administrator', 'management', 'sales', 'operations'])) throw new OrderGatewayError('Account access required', 403);
  return session;
}
function failed(error: unknown) {
  return error instanceof OrderGatewayError || error instanceof BoundedJsonRequestError
    ? failure(error.message, error.status) : failure('Accounts are temporarily unavailable', 502);
}
export async function GET(request: Request) {
  const startedAt = performance.now();
  try {
    const session = await actor();
    const query = new URL(request.url).searchParams;
    const search = query.get('search') ?? '';
    const scope = query.get('scope') ?? 'all';
    const rawPage = query.get('page') ?? '1';
    const page = Number(rawPage);
    const ownerEmail = query.get('owner');
    const territoryId = query.get('territory');
    const classFilter = query.get('class');
    if (search.length > 120 || !/^[0-9]+$/.test(rawPage) || !Number.isInteger(page) || page < 1 || page > 2_147_483_647
      || (scope !== 'all' && scope !== 'mine')
      || (ownerEmail !== null && (ownerEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail.trim())))
      || (territoryId !== null && !accountUuidPattern.test(territoryId))
      || (classFilter !== null && parseAccountClass(classFilter) === null)) return failure('Invalid accounts request', 400);
    const workspace = await callOrderGateway<AccountsGatewayResponse>(session.email, 'get_accounts', {
      search, scope, page,
      ...(ownerEmail === null ? {} : { ownerEmail: ownerEmail.trim().toLowerCase() }),
      ...(territoryId === null ? {} : { territoryId }),
      ...(classFilter === null ? {} : { class: classFilter }),
    });
    return measuredJsonResponse({ ...workspace, actorEmail: session.email, canAssign: hasAnyStockFlowRole(session.roles, ['administrator', 'management']) }, startedAt);
  } catch (error) { return failed(error); }
}
export async function POST(request: Request) {
  const startedAt = performance.now();
  try {
    const session = await actor();
    const command = parseAccountCommand(await readBoundedJsonRequest(request, 8_192));
    if (!command) return failure('Invalid accounts request', 400);
    return measuredJsonResponse(await callOrderGateway(session.email, command.action, command.payload), startedAt);
  } catch (error) { return failed(error); }
}
