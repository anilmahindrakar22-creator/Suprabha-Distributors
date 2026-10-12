import { getChatGPTUser } from '@/app/chatgpt-auth';
import { BoundedJsonRequestError, readBoundedJsonRequest } from '@/lib/bounded-json-request';
import { callOrderGateway, OrderGatewayError } from '@/lib/order-gateway';
import { measuredJsonResponse } from '@/lib/measured-json-response';
import { validateSetCustomerLocation, type CustomerLocationsPage } from '@/lib/market-types';

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
    const search = query.get('search') ?? '';
    const rawPage = query.get('page') ?? '1';
    const page = Number(rawPage);
    if (search.length > 120 || !/^[0-9]+$/.test(rawPage) || !Number.isInteger(page) || page < 1 || page > 2_147_483_647) return failure('Invalid market request', 400);
    return measuredJsonResponse(await callOrderGateway<CustomerLocationsPage>(email, 'get_customer_locations', { search, page }), startedAt);
  } catch (error) { return failed(error); }
}
export async function POST(request: Request) {
  try {
    const email = await actorEmail();
    const body = await readBoundedJsonRequest(request, 8_192) as { action?: unknown; payload?: unknown } | null;
    const payload = body?.action === 'set_customer_location' ? validateSetCustomerLocation(body.payload) : null;
    if (!payload) return failure('Invalid market request', 400);
    return Response.json(await callOrderGateway(email, 'set_customer_location', payload), { headers: privateHeaders });
  } catch (error) { return failed(error); }
}
