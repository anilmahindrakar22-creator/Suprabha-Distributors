import { describe, expect, it } from 'vitest';
import { orderSubmissionError } from '../../lib/order-submission';

describe('offline order submission failures', () => {
  it.each([429, 500, 503])('keeps status %s eligible for reconnect retry', (status) => {
    expect(orderSubmissionError(status).retryable).toBe(true);
  });

  it('stops automatic retry and asks for sign-in when authentication expired', () => {
    const failure = orderSubmissionError(401);
    expect(failure).toMatchObject({ kind: 'sign_in', retryable: false });
    expect(failure.message).toContain('Sign in again');
  });

  it('distinguishes revoked access from invalid order data', () => {
    expect(orderSubmissionError(403).kind).toBe('access');
    expect(orderSubmissionError(400, 'Product is no longer active')).toMatchObject({ kind: 'invalid', message: 'Product is no longer active' });
  });
});
