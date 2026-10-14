import { getChatGPTUser } from '@/app/chatgpt-auth';
import { getStockFlowSession } from '@/lib/stockflow-session';
import { hasAnyStockFlowRole } from '@/lib/user-types';
import { BoundedJsonRequestError, readBoundedJsonRequest } from '@/lib/bounded-json-request';
import { callOrderGateway, OrderGatewayError } from '@/lib/order-gateway';
import { measuredJsonResponse } from '@/lib/measured-json-response';
import { customerLinkStates, parseLinkCommand, type CustomerLinkState, type CustomerLinksResponse } from '@/lib/customer-link-types';

const headers = { 'cache-control': 'private, no-store' };
const failure = (error: string, status: number) => Response.json({ error }, { status, headers });
async function actor() {
  const user = await getChatGPTUser();
  if (!user) throw new OrderGatewayError('Sign in required', 401);
  const session = await getStockFlowSession(user.email);
  if (!session || !hasAnyStockFlowRole(session.roles, ['administrator', 'management'])) throw new OrderGatewayError('Customer link management access required', 403);
  return session;
}
function failed(error: unknown) {
  return error instanceof OrderGatewayError || error instanceof BoundedJsonRequestError
    ? failure(error.message, error.status) : failure('Customer links are temporarily unavailable', 502);
}
export async function GET(request: Request) {
  const startedAt = performance.now();
  try {
    const session = await actor();
    const query = new URL(request.url).searchParams;
    const companyId = query.get('companyId');
    const search = query.get('search') ?? '';
    const state = query.get('state');
    const rawPage = query.get('page') ?? '1';
    const page = Number(rawPage);
    if (search.length > 120 || !/^[0-9]+$/.test(rawPage) || !Number.isInteger(page) || page < 1 || page > 2_147_483_647
      || (companyId !== null && (!companyId.trim() || companyId.trim().length > 240))
      || (state !== null && !customerLinkStates.includes(state as CustomerLinkState))) return failure('Invalid customer links request', 400);
    return measuredJsonResponse(await callOrderGateway<CustomerLinksResponse>(session.email, 'get_link_suggestions', {
      search, page, ...(companyId === null ? {} : { companyId: companyId.trim() }), ...(state === null ? {} : { state }),
    }), startedAt);
  } catch (error) { return failed(error); }
}
export async function POST(request: Request) {
  const startedAt = performance.now();
  try {
    const session = await actor();
    const command = parseLinkCommand(await readBoundedJsonRequest(request, 32_768));
    if (!command) return failure('Invalid customer links request', 400);
    return measuredJsonResponse(await callOrderGateway(session.email, command.action, command.payload), startedAt);
  } catch (error) { return failed(error); }
}
