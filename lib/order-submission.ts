export type OrderSubmissionFailureKind = 'retryable' | 'conflict' | 'sign_in' | 'access' | 'invalid';

export class OrderSubmissionError extends Error {
  constructor(message: string, public readonly kind: OrderSubmissionFailureKind) {
    super(message);
  }

  get retryable() {
    return this.kind === 'retryable';
  }
}

export function orderSubmissionError(status: number, serverMessage?: string) {
  if (status >= 500 || status === 429) return new OrderSubmissionError(serverMessage || 'Order service is temporarily unavailable', 'retryable');
  if (status === 409) return new OrderSubmissionError(serverMessage || 'The saved submission conflicts with the server record.', 'conflict');
  if (status === 401) return new OrderSubmissionError('Your sign-in has expired. Sign in again, then reopen this draft and retry.', 'sign_in');
  if (status === 403) return new OrderSubmissionError('This account no longer has permission to create orders. Ask an administrator before retrying.', 'access');
  return new OrderSubmissionError(serverMessage || 'Check the order details and retry.', 'invalid');
}

export async function recoverAcceptedOrder(idempotencyKey: string, fetchFn: typeof fetch = fetch) {
  try {
    const response = await fetchFn('/api/orders/recovery', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idempotencyKey }) });
    if (!response.ok) return null;
    const result = (await response.json()) as { status?: string; orderNumber?: string };
    return result.status === 'accepted' ? result.orderNumber || 'Order' : null;
  } catch {
    return null;
  }
}
