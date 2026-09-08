import type { OrderCommand } from './order-types';

export function orderCommandIdentity(command: OrderCommand, accountScope = '') {
  const { idempotencyKey: _ignored, ...payload } = command.payload;
  return JSON.stringify([accountScope.trim().toLocaleLowerCase('en-IN'), command.action, payload]);
}

export function prepareOrderCommandRetry(command: OrderCommand, pending: Map<string, string>, createKey = () => crypto.randomUUID(), accountScope = '') {
  const identity = orderCommandIdentity(command, accountScope);
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
