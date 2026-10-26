import { getChatGPTUser } from '@/app/chatgpt-auth';
import { BoundedJsonRequestError, readBoundedJsonRequest } from '@/lib/bounded-json-request';
import { callOrderGateway, OrderGatewayError } from '@/lib/order-gateway';

const privateHeaders = { 'cache-control': 'private, no-store' };
const dormant = { enabled: false, publicKey: null };
// The fixed push contract is routed by the edge gateway. Keep its action typing
// local until the shared GatewayAction union is updated by its owner.
const callPushGateway = callOrderGateway as <T>(
  email: string,
  action: Parameters<typeof callOrderGateway>[1] | 'push_config' | 'push_subscribe' | 'push_unsubscribe',
  payload: Record<string, unknown>,
) => Promise<T>;

function failure(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: privateHeaders });
}

async function actorEmail() {
  const user = await getChatGPTUser();
  if (!user) throw new OrderGatewayError('Sign in required', 401);
  return user.email;
}

export async function GET() {
  try {
    const email = await actorEmail();
    const result = await callPushGateway<{ enabled: boolean }>(email, 'push_config', {});
    const key = process.env.STOCKFLOW_PUSH_PUBLIC_KEY;
    const validKey = typeof key === 'string' && /^[A-Za-z0-9_-]{80,100}$/.test(key);
    return Response.json({ enabled: result.enabled === true && validKey, publicKey: validKey ? key : null }, { headers: privateHeaders });
  } catch {
    return Response.json(dormant, { headers: privateHeaders });
  }
}

function validEndpoint(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048 || !value.startsWith('https://')) return false;
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
}

async function mutate(request: Request, subscribe: boolean) {
  try {
    const email = await actorEmail();
    const body = await readBoundedJsonRequest(request, 8192);
    if (!body || typeof body !== 'object' || Array.isArray(body) || !('endpoint' in body) || !validEndpoint(body.endpoint)) return failure('Invalid push subscription', 400);
    const payload: Record<string, unknown> = { endpoint: body.endpoint };
    if (subscribe) {
      const keys = 'keys' in body ? body.keys : null;
      if (!keys || typeof keys !== 'object' || Array.isArray(keys) || !('p256dh' in keys) || !('auth' in keys)
        || typeof keys.p256dh !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(keys.p256dh)
        || typeof keys.auth !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(keys.auth)
        || ('userAgent' in body && typeof body.userAgent !== 'string')) return failure('Invalid push subscription', 400);
      payload.keys = { p256dh: keys.p256dh, auth: keys.auth };
      if ('userAgent' in body) payload.userAgent = (body.userAgent as string).slice(0, 200);
    }
    const result = await callPushGateway<{ removed?: number }>(email, subscribe ? 'push_subscribe' : 'push_unsubscribe', payload);
    return Response.json(subscribe ? { ok: true } : { ok: true, removed: result.removed ?? 0 }, { headers: privateHeaders });
  } catch (error) {
    if (error instanceof BoundedJsonRequestError || error instanceof OrderGatewayError) return failure(error.message, error.status);
    return failure('Push service is temporarily unavailable', 502);
  }
}

export async function POST(request: Request) { return mutate(request, true); }
export async function DELETE(request: Request) { return mutate(request, false); }
