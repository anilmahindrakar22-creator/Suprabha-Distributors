import { getChatGPTUser } from '@/app/chatgpt-auth';
import { BoundedJsonRequestError, readBoundedJsonRequest } from '@/lib/bounded-json-request';
import { callOrderGateway, OrderGatewayError } from '@/lib/order-gateway';
import { parseBrandMappingCommand, parseBrandMappingResponse } from '@/lib/brand-mapping';
import { getStockFlowSession } from '@/lib/stockflow-session';
import { hasAnyStockFlowRole } from '@/lib/user-types';

const headers = { 'cache-control': 'private, no-store' };
const failure = (error: string, status: number) => Response.json({ error }, { status, headers });
async function actor() {
  const user = await getChatGPTUser();
  if (!user) throw new OrderGatewayError('Sign in required', 401);
  const session = await getStockFlowSession(user.email);
  if (!session || !hasAnyStockFlowRole(session.roles, ['administrator', 'management'])) throw new OrderGatewayError('Brand mapping access required', 403);
  return session;
}
function failed(error: unknown) {
  return error instanceof OrderGatewayError || error instanceof BoundedJsonRequestError
    ? failure(error.message, error.status) : failure('Brand mapping is temporarily unavailable', 502);
}

export async function GET(request: Request) {
  try {
    const session = await actor();
    const query = new URL(request.url).searchParams;
    const keys = [...query.keys()];
    const rawPage = query.get('page') ?? '1';
    const page = Number(rawPage);
    const q = query.get('q');
    if (keys.some(key => key !== 'q' && key !== 'page') || new Set(keys).size !== keys.length
      || (q !== null && q.length > 120) || !/^[1-9]\d*$/.test(rawPage)
      || !Number.isSafeInteger(page) || page > 4000) return failure('Invalid brand mapping request', 400);
    const data = await callOrderGateway<unknown>(session.email, 'get_brand_mapping', { page, ...(q === null ? {} : { q }) });
    const parsed = parseBrandMappingResponse(data);
    if (!parsed) return failure('Brand mapping is temporarily unavailable', 502);
    return Response.json(parsed, { headers });
  } catch (error) { return failed(error); }
}

export async function POST(request: Request) {
  try {
    const session = await actor();
    const command = parseBrandMappingCommand(await readBoundedJsonRequest(request, 8_192));
    if (!command) return failure('Invalid brand mapping request', 400);
    return Response.json(await callOrderGateway(session.email, command.action, command.payload), { headers });
  } catch (error) { return failed(error); }
}
