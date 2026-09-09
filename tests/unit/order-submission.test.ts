import { describe, expect, it, vi } from 'vitest';
import { orderSubmissionError, recoverAcceptedOrder } from '../../lib/order-submission';

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
    expect(orderSubmissionError(409).kind).toBe('conflict');
    expect(orderSubmissionError(400, 'Product is no longer active')).toMatchObject({ kind: 'invalid', message: 'Product is no longer active' });
  });

  it('recovers an accepted submission without placing its request key in the URL', async () => {
    const fetchFn: typeof fetch = vi.fn(async (input, init) => {
      expect(String(input)).toBe('/api/orders/recovery');
      expect(init?.method).toBe('POST');
      expect(JSON.parse(String(init?.body))).toEqual({ idempotencyKey: '1234567890abcdef' });
      return Response.json({ status: 'accepted', orderNumber: 'SF-300' });
    });
    await expect(recoverAcceptedOrder('1234567890abcdef', fetchFn)).resolves.toBe('SF-300');
  });
});
