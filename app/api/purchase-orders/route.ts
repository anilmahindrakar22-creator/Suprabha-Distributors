import { getChatGPTUser } from '@/app/chatgpt-auth';
import { callOrderGateway, OrderGatewayError } from '@/lib/order-gateway';
import type { GatewayAction } from '@/lib/order-gateway';
import { validatePurchaseOrderCommand } from '@/lib/purchase-orders';
import { BoundedJsonRequestError, readBoundedJsonRequest } from '@/lib/bounded-json-request';

const headers = { 'cache-control': 'private, no-store' };
function failure(error: string, status: number) { return Response.json({ error }, { status, headers }); }
export async function GET(request: Request) {
  try {
    const user = await getChatGPTUser();
    if (!user) return failure('Sign in required', 401);
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some((key) => !['page', 'status', 'supplierOptions'].includes(key))) return failure('Invalid purchase order query', 400);
    const pageRaw = params.get('page');
    const page = pageRaw === null ? 1 : Number(pageRaw);
    if (!Number.isInteger(page) || page < 1 || page > 4000 || params.getAll('page').length > 1) return failure('Invalid purchase order page', 400);
    const status = params.get('status');
    if (params.getAll('status').length > 1 || (status !== null && !['open', 'received', 'cancelled', 'all'].includes(status))) return failure('Invalid purchase order status', 400);
    const supplierOptions = params.get('supplierOptions');
    if (supplierOptions !== null) {
      if (params.getAll('supplierOptions').length !== 1 || !supplierOptions.length || supplierOptions.length > 220 || params.has('status')) return failure('Invalid supplier options item key', 400);
      return Response.json(await callOrderGateway(user.email, 'supplier_options', { itemKey: supplierOptions }), { headers });
    }
    return Response.json(await callOrderGateway(user.email, 'list_purchase_orders', { page, ...(status ? { status } : {}) }), { headers });
  } catch (error) {
    return failure(error instanceof OrderGatewayError ? error.message : 'Purchase orders temporarily unavailable', error instanceof OrderGatewayError ? error.status : 502);
  }
}
export async function POST(request: Request) {
  try {
    const user = await getChatGPTUser();
    if (!user) return failure('Sign in required', 401);
    const command = validatePurchaseOrderCommand(await readBoundedJsonRequest(request));
    if (!command) return failure('Invalid purchase order request', 400);
    return Response.json(await callOrderGateway(user.email, command.action as GatewayAction, command.payload), { headers });
  } catch (error) {
    if (error instanceof BoundedJsonRequestError) return failure(error.message, error.status);
    return failure(error instanceof OrderGatewayError ? error.message : 'Purchase orders temporarily unavailable', error instanceof OrderGatewayError ? error.status : 502);
  }
}
