import { describe, expect, it } from 'vitest';
import { isApprovedGatewayKey, RequestGate } from '../../supabase/functions/stockflow-orders/request-gate';

const gateway = 'approved-gateway-key';
const actor = 'admin@example.com';

describe('Edge request safety gate', () => {
  it('rejects an outdated gateway key before a database request', async () => {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(gateway));
    const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    expect(await isApprovedGatewayKey(gateway, hash)).toBe(true);
    expect(await isApprovedGatewayKey('old-key', hash)).toBe(false);
  });
  it('allows a command once, then cools down the same stale command even with a new idempotency key', async () => {
    const gate = new RequestGate();
    const first = await gate.begin(gateway, actor, 'transition_order', { orderId: 'order-1', expectedVersion: 4, idempotencyKey: 'first' }, 1_000);
    expect(first.allowed).toBe(true);
    if (!first.allowed) return;
    gate.finish(first, true, 1_100);

    const duplicate = await gate.begin(gateway, actor, 'transition_order', { orderId: 'order-1', expectedVersion: 4, idempotencyKey: 'second' }, 1_200);
    expect(duplicate).toEqual({ allowed: false, retryAfterSeconds: 60 });
    expect((await gate.begin(gateway, actor, 'transition_order', { orderId: 'order-1', expectedVersion: 5 }, 1_200)).allowed).toBe(true);
    expect((await gate.begin(gateway, actor, 'transition_order', { orderId: 'order-2', expectedVersion: 4 }, 1_200)).allowed).toBe(true);
    expect((await gate.begin(gateway, actor, 'transition_order', { orderId: 'order-1', expectedVersion: 4 }, 61_101)).allowed).toBe(true);
  });

  it('blocks concurrent duplicates, but releases successful requests', async () => {
    const gate = new RequestGate();
    const command = { orderId: 'order-1', expectedVersion: 4 };
    const first = await gate.begin(gateway, actor, 'transition_order', command, 1_000);
    expect(first.allowed).toBe(true);
    expect((await gate.begin(gateway, actor, 'transition_order', command, 1_001)).allowed).toBe(false);
    if (!first.allowed) return;
    gate.finish(first, false, 1_002);
    expect((await gate.begin(gateway, actor, 'transition_order', command, 1_003)).allowed).toBe(true);
  });

  it('caps an actor burst without letting another gateway credential poison the approved actor', async () => {
    const gate = new RequestGate(2);
    const invalid = await gate.begin('incorrect-gateway-key', actor, 'edit_order', { orderId: 'a' }, 1_000);
    if (invalid.allowed) gate.finish(invalid, false, 1_000);
    for (const orderId of ['a', 'b']) {
      const admission = await gate.begin(gateway, actor, 'edit_order', { orderId }, 1_001);
      expect(admission.allowed).toBe(true);
      if (admission.allowed) gate.finish(admission, false, 1_001);
    }
    expect(await gate.begin(gateway, actor, 'edit_order', { orderId: 'c' }, 1_002)).toEqual({ allowed: false, retryAfterSeconds: 60 });
    expect((await gate.begin(gateway, actor, 'edit_order', { orderId: 'c' }, 61_001)).allowed).toBe(true);
  });

  it('keeps the actor cap under concurrent requests', async () => {
    const gate = new RequestGate(3);
    const attempts = await Promise.all(Array.from({ length: 20 }, (_, index) =>
      gate.begin(gateway, actor, 'edit_order', { orderId: `order-${index}` }, 1_000)));
    expect(attempts.filter((attempt) => attempt.allowed)).toHaveLength(3);
    expect(attempts.filter((attempt) => !attempt.allowed)).toHaveLength(17);
  });
});
