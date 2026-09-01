import type { OrderCommand } from './order-types';

export type GatewayAction =
  | 'session'
  | 'bootstrap'
  | 'list_users'
  | 'upsert_user'
  | OrderCommand['action'];

export class OrderGatewayError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new OrderGatewayError('Order service is not configured', 503);
  return value;
}

export async function callOrderGateway<T>(
  actorEmail: string,
  action: GatewayAction,
  payload: Record<string, unknown> = {},
): Promise<T> {
  const url = requiredEnvironment('SUPABASE_URL');
  const gatewayKey = requiredEnvironment('STOCKFLOW_ORDER_GATEWAY_KEY');

  const response = await fetch(`${url}/functions/v1/stockflow-orders`, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      'content-type': 'application/json',
      'x-order-gateway-key': gatewayKey,
    },
    body: JSON.stringify({
      actorEmail,
      action,
      payload,
    }),
  });

  const result = (await response.json()) as T | { message?: string; code?: string };
  if (response.ok) return result as T;

  const failure = result as { message?: string; code?: string };
  const message = failure.message || 'Order service request failed';
  const status =
    failure.code === '42501'
      ? 403
      : failure.code === '40001'
        ? 409
        : failure.code === '54000'
          ? 429
          : response.status >= 500
            ? 502
            : 400;
  throw new OrderGatewayError(message, status);
}
