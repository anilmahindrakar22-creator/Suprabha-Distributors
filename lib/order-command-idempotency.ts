import type { OrderCommand } from './order-types';

export function orderCommandIdentity(command: OrderCommand) {
  const { idempotencyKey: _ignored, ...payload } = command.payload;
  return JSON.stringify([command.action, payload]);
}

export function prepareOrderCommandRetry(command: OrderCommand, pending: Map<string, string>, createKey = () => crypto.randomUUID()) {
  const identity = orderCommandIdentity(command);
  const suppliedKey = command.payload.idempotencyKey;
  const idempotencyKey = suppliedKey || pending.get(identity) || createKey();
  pending.set(identity, idempotencyKey);
  return {
    identity,
    command: { ...command, payload: { ...command.payload, idempotencyKey } } as OrderCommand,
  };
}

export function acknowledgeOrderCommand(identity: string, pending: Map<string, string>) {
  pending.delete(identity);
}
