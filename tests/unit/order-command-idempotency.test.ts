import { describe, expect, it } from 'vitest';
import { acknowledgeOrderCommand, prepareOrderCommandRetry } from '../../lib/order-command-idempotency';
import type { OrderCommand } from '../../lib/order-types';

const transition: OrderCommand = { action: 'transition_order', payload: { orderId: 'order-1', expectedVersion: 2, toStatus: 'packed' } };

describe('order command retry identity', () => {
  it('reuses a request key after an unacknowledged attempt', () => {
    const pending = new Map<string, string>();
    const first = prepareOrderCommandRetry(transition, pending, () => 'first-request-key');
    const retry = prepareOrderCommandRetry(transition, pending, () => 'wrong-new-key');
    expect(first.command.payload.idempotencyKey).toBe('first-request-key');
    expect(retry.command.payload.idempotencyKey).toBe('first-request-key');
  });

  it('clears the key after acknowledgement and preserves explicit offline keys', () => {
    const pending = new Map<string, string>();
    const first = prepareOrderCommandRetry(transition, pending, () => 'first-request-key');
    acknowledgeOrderCommand(first.identity, pending);
    expect(prepareOrderCommandRetry(transition, pending, () => 'second-request-key').command.payload.idempotencyKey).toBe('second-request-key');
    const explicit = { ...transition, payload: { ...transition.payload, idempotencyKey: 'offline-request-key' } };
    expect(prepareOrderCommandRetry(explicit, pending).command.payload.idempotencyKey).toBe('offline-request-key');
  });

  it('uses a different identity when the intended mutation changes', () => {
    expect(orderIdentity(transition)).not.toBe(orderIdentity({ ...transition, payload: { ...transition.payload, toStatus: 'confirmed' } }));
  });
});

function orderIdentity(command: OrderCommand) {
  return prepareOrderCommandRetry(command, new Map(), () => 'key').identity;
}
