import { getChatGPTUser } from '@/app/chatgpt-auth';
import { BoundedJsonRequestError, readBoundedJsonRequest } from '@/lib/bounded-json-request';
import { callOrderGateway, OrderGatewayError } from '@/lib/order-gateway';

const headers = { 'cache-control': 'private, no-store' };
const fail = (error: string, status: number) => Response.json({ error }, { status, headers });
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const hasOnlyKeys = (value: Record<string, unknown>, allowed: string[]) =>
  Object.keys(value).every((key) => allowed.includes(key));

type ProductRequestCommand = {
  action: 'create_product_request' | 'review_product_request';
  payload: Record<string, unknown>;
};

function validateCommand(value: unknown): ProductRequestCommand | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ['action', 'payload']) || !isRecord(value.payload)) return null;
  const { action, payload } = value;
  if (action === 'create_product_request') {
    if (!hasOnlyKeys(payload, ['idempotencyKey', 'productName', 'details', 'customerId'])) return null;
    const name = payload.productName;
    const details = payload.details ?? '';
    const customerId = payload.customerId;
    if (typeof payload.idempotencyKey !== 'string' || !uuidPattern.test(payload.idempotencyKey)) return null;
    if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 200) return null;
    if (typeof details !== 'string' || details.length > 1000) return null;
    if (customerId !== undefined && (typeof customerId !== 'string' || !uuidPattern.test(customerId))) return null;
    return {
      action,
      payload: {
        idempotencyKey: payload.idempotencyKey,
        productName: name.trim(),
        details: details.trim(),
        ...(customerId === undefined ? {} : { customerId }),
      },
    };
  }
  if (action === 'review_product_request') {
    if (!hasOnlyKeys(payload, ['idempotencyKey', 'requestId', 'expectedVersion', 'status', 'resolution'])) return null;
    if (typeof payload.idempotencyKey !== 'string' || !uuidPattern.test(payload.idempotencyKey)) return null;
    if (typeof payload.requestId !== 'string' || !uuidPattern.test(payload.requestId)) return null;
    if (!Number.isSafeInteger(payload.expectedVersion) || (payload.expectedVersion as number) < 1) return null;
    if (payload.status !== 'resolved' && payload.status !== 'rejected') return null;
    if (typeof payload.resolution !== 'string' || payload.resolution.trim().length < 3 || payload.resolution.trim().length > 1000) return null;
    return {
      action,
      payload: { ...payload, resolution: payload.resolution.trim() },
    };
  }
  return null;
}

async function actorEmail() {
  const user = await getChatGPTUser();
  if (!user) throw new OrderGatewayError('Sign in required', 401);
  return user.email;
}

export async function GET() {
  try {
    return Response.json(await callOrderGateway(await actorEmail(), 'list_product_requests'), { headers });
  } catch (error) {
    return error instanceof OrderGatewayError
      ? fail(error.message, error.status)
      : fail('Product request service is temporarily unavailable', 502);
  }
}

export async function POST(request: Request) {
  try {
    const email = await actorEmail();
    const command = validateCommand(await readBoundedJsonRequest(request, 4_096));
    if (!command) return fail('Invalid product request command', 400);
    return Response.json(await callOrderGateway(email, command.action, command.payload), { headers });
  } catch (error) {
    if (error instanceof BoundedJsonRequestError) return fail(error.message, error.status);
    return error instanceof OrderGatewayError
      ? fail(error.message, error.status)
      : fail('Product request service is temporarily unavailable', 502);
  }
}
