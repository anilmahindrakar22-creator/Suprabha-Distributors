export type OrderSubmissionFailureKind = 'retryable' | 'sign_in' | 'access' | 'invalid';

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
  if (status === 401) return new OrderSubmissionError('Your sign-in has expired. Sign in again, then reopen this draft and retry.', 'sign_in');
  if (status === 403) return new OrderSubmissionError('This account no longer has permission to create orders. Ask an administrator before retrying.', 'access');
  return new OrderSubmissionError(serverMessage || 'Check the order details and retry.', 'invalid');
}
