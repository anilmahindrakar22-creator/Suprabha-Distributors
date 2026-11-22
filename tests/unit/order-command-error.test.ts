import { describe, expect, it } from 'vitest';
import { orderCommandErrorMessage } from '../../lib/order-command-error';

describe('orderCommandErrorMessage', () => {
  it('shows a retry message for cooldown responses', () => {
    expect(orderCommandErrorMessage(429, 'Wait before retrying this command')).toBe('Wait a moment and try again.');
  });
  it('shows a refresh message for conflicting order changes', () => {
    expect(orderCommandErrorMessage(409, 'Order version changed')).toBe('Someone else changed this order. Refresh and try again.');
  });
  it('preserves other server messages', () => {
    expect(orderCommandErrorMessage(400, 'Order has no lines')).toBe('Order has no lines');
  });
  it('uses default or custom fallbacks when no server message is available', () => {
    expect(orderCommandErrorMessage(500, undefined)).toBe('Unable to complete the request');
    expect(orderCommandErrorMessage(500, undefined, 'Try later')).toBe('Try later');
  });
});
